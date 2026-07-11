import { useState } from "react";
import {
  Copy,
  Check,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  Download,
  Pencil,
  Loader2,
  User,
} from "lucide-react";
import { Button } from "@/react-app/components/ui/button";
import { cn } from "@/react-app/lib/utils";
import { CitedMarkdown } from "@/react-app/components/chat/CitedMarkdown";
import { Logo } from "@/react-app/components/Logo";
import {
  ManuscriptIcon, // replaces FileText (lucide) — legal document/file
} from "@/react-app/components/icons";
import type {
  Chunk,
  CitationValidation,
  JurisdictionWarning,
} from "@/react-app/lib/ragApi";

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  file?: File;
  // Upload-on-attach lifecycle (shared with the project composer). The file
  // uploads the moment it's attached; the preview card reflects the status.
  uploadStatus?: "uploading" | "processing" | "done" | "error";
  uploaded?: boolean;
  uploadError?: string;
  // 0–100 byte-upload progress while ``uploadStatus === "uploading"``.
  uploadProgress?: number;
  // Server-assigned [M-n] slot — sent back as ``focus_doc_indexes`` on the
  // next chat turn so this turn answers ONLY from the just-attached docs.
  docIndex?: number;
}

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
  timestamp: Date;
  // Chunks returned alongside the assistant answer. Populated on rag /
  // rag+contract / contract turns; undefined on chat-only and on
  // replayed-from-server messages (the persistence layer doesn't yet
  // carry chunks; see ragApi.PersistedMessage).
  chunks?: Chunk[];
  // Structured citation-validator summary (fabricated handles + the
  // count of "(unbelegt)"-rewritten sentences). Drives the badge above
  // the bubble. Undefined on chat-only turns.
  citationValidation?: CitationValidation | null;
  // Day-4 jurisdiction-sanity warnings. Populated when the answer cited
  // a Bundesland-specific rule (e.g. Bayern's 10H BayBO) that doesn't
  // apply to the matter's state. Empty / undefined means either no
  // warnings or the backend isn't emitting the field yet (older
  // serve_rag pre-85008f1; renders gracefully as no chip). Drives an
  // amber chip next to the ``unbelegt`` badge.
  jurisdictionWarnings?: JurisdictionWarning[];
  // True while the assistant bubble is still being filled by the SSE
  // ``/query/stream`` endpoint. ``chunks`` is intentionally absent
  // during this window — partial ``[C-n]`` tokens in the streamed
  // text must NOT render as clickable chips (the chunk for the
  // half-typed handle doesn't exist yet). Cleared on the terminal
  // ``complete`` event, at which point the validated answer + chunks
  // arrive together.
  streaming?: boolean;
  // While a doc-scoped turn is waiting for the just-uploaded document to
  // finish OCR/ingestion, the backend streams ``status`` events with live
  // page progress. This holds the latest such message so the bubble shows a
  // clean "processing your document…" indicator instead of the raw German
  // placeholder token. Cleared the moment the real answer starts streaming.
  processingNote?: string;
  // ``messages.id`` of the persisted assistant row. When present, the
  // thumbs-up/down buttons scope POST /feedback to this specific
  // bubble. When absent (chat-only sessions where the response was
  // not persisted, or replayed messages whose ``id`` wasn't carried
  // through) the buttons fall back to session-level feedback.
  messageId?: number | null;
  // The lawyer's persisted verdict for this bubble — ``1`` for
  // thumbs-up, ``-1`` for thumbs-down, ``null`` for not-yet-rated.
  // Used to repaint the active state on session reload.
  feedback?: 1 | -1 | null;
}

interface ChatMessageProps {
  message: ChatMessageData;
  onRegenerate?: () => void;
  // Handle the user clicked in the chat thread — drives the
  // CitationChip's `active` ring. Owned by DashboardChat.
  activeCiteHandle?: string | null;
  // Fires when a CitationChip is clicked. Receives the handle AND this
  // message's chunks so the panel has everything it needs without
  // searching every other message in the thread.
  onCiteClick?: (handle: string, chunks: Chunk[]) => void;
  /**
   * Fires when the user clicks thumbs-up (``rating = 1``) or
   * thumbs-down (``-1``) under this assistant bubble. The handler is
   * responsible for the round-trip to POST /feedback and for updating
   * the parent state so the highlighted button persists. Omitted on
   * sessions where feedback capture is disabled (e.g. logged-out
   * preview mode).
   */
  onFeedback?: (rating: 1 | -1) => void;
  /**
   * Fires when the user saves an edit to their own message. The handler
   * replaces this turn's text, drops everything after it, and re-runs the
   * question (standard "edit & resubmit"). Only supplied for user turns
   * that carry typed text.
   */
  onEdit?: (newText: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Trigger a browser download of the in-memory File handle attached to a
// live message. No-op on replayed messages (no ``file``).
function downloadAttachment(att: ChatAttachment): void {
  if (!att.file) return;
  const url = URL.createObjectURL(att.file);
  const a = document.createElement("a");
  a.href = url;
  a.download = att.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ChatMessage({
  message,
  onRegenerate,
  activeCiteHandle = null,
  onCiteClick,
  onFeedback,
  onEdit,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const isUser = message.role === "user";

  const beginEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };
  const cancelEdit = () => {
    setDraft(message.content);
    setEditing(false);
  };
  const saveEdit = () => {
    const next = draft.trim();
    if (!next || next === message.content.trim()) {
      cancelEdit();
      return;
    }
    setEditing(false);
    onEdit?.(next);
  };
  const flaggedCount = message.citationValidation?.sentences_flagged ?? 0;
  const jurisdictionWarnings = message.jurisdictionWarnings ?? [];
  const jurisdictionCount = jurisdictionWarnings.length;
  // The badge row sits above the bubble when EITHER quality signal is
  // active — citation-validator stripped at least one source, or the
  // jurisdiction validator caught a wrong-state rule citation. The two
  // chips render side-by-side so reviewers see both at once.
  const showQualityRow = !isUser && (flaggedCount > 0 || jurisdictionCount > 0);
  // One-line plain-text summary used as the chip's ``title`` tooltip.
  // Includes every (rule, expected_bundesland) pair so a reviewer can
  // hover to see exactly which citations the validator flagged without
  // opening any panel.
  const jurisdictionTooltip = jurisdictionWarnings
    .map(
      (w) =>
        `${w.rule_label} (${w.rule_bundesland}) — Mandat ist in ${w.expected_bundesland}`,
    )
    .join("\n");
  // The feedback state is owned by the parent (so it survives session
  // reloads via /sessions/:id/feedback). The buttons just reflect it.
  const isUp = message.feedback === 1;
  const isDown = message.feedback === -1;
  // No feedback while the bubble is still streaming — the user can't
  // meaningfully rate a half-typed answer, and the server hasn't
  // persisted the message row yet so messageId would be null anyway.
  const feedbackDisabled = !!message.streaming || !onFeedback;

  const handleCopy = async () => {
    // navigator.clipboard is undefined on insecure origins (http:// on a
    // LAN IP, which is exactly how this app is served over the SSH tunnel),
    // so the modern API silently throws and the button appeared dead. Fall
    // back to a hidden-textarea + execCommand("copy") that works on http.
    const text = message.content;
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        ta.setAttribute("readonly", "");
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked by the browser — leave the button state unchanged */
    }
  };

  // While an assistant bubble is still streaming with no text yet, the
  // parent renders the standalone "LAI is thinking…" indicator. Rendering
  // this (empty) bubble too would paint the LAI avatar + "LAI Assistant"
  // name a SECOND time — the "two thinking assistants" the user saw. Skip
  // it until the first token lands; the indicator then hands off to the
  // filling bubble in the same render (onToken clears isTyping).
  if (
    !isUser &&
    message.streaming &&
    message.content.trim().length === 0 &&
    !message.processingNote
  ) {
    return null;
  }

  return (
    <div
      className={cn("group flex gap-4 py-6", isUser ? "flex-row-reverse" : "")}
    >
      {/* ── Avatar ── */}
      {isUser ? (
        // User avatar — kept with gradient box + User lucide (no custom person-in-box equivalent)
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-primary to-indigo-600">
          <User className="w-5 h-5 text-white" />
        </div>
      ) : (
        // LAI Assistant avatar — Logo replaces Bot lucide (Image 1 fix)
        <div className="w-9 h-9 flex items-center justify-center flex-shrink-0">
          <Logo size="sm" showText={false} />
        </div>
      )}

      {/* ── Message Content ── */}
      <div
        className={cn("flex-1 space-y-3 min-w-0", isUser ? "text-right" : "")}
      >
        <div
          className={cn("flex items-center gap-2", isUser ? "justify-end" : "")}
        >
          <span className="text-sm font-medium">
            {isUser ? "You" : "LAI Assistant"}
          </span>
          <span className="text-xs text-muted-foreground">
            {message.timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        {/* ── Attachments (assistant only) ──
            User attachments are rendered INSIDE the user bubble below so a
            "document + question" turn reads as one input, not a file box
            stacked above a separate text box. Assistant turns never carry
            attachments today, but keep the block for safety. */}
        {!isUser && message.attachments && message.attachments.length > 0 && (
          <div
            className={cn("flex flex-wrap gap-2", isUser ? "justify-end" : "")}
          >
            {message.attachments.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/50 max-w-xs"
              >
                {/* ManuscriptIcon replaces FileText (lucide) — legal manuscript for doc files */}
                <ManuscriptIcon className="w-4 h-4 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                {/* Download — only when we still hold the File handle (live
                    turn). Replayed-from-server attachments have no handle,
                    so the dead button is hidden rather than shown inert. */}
                {file.file && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Download"
                    aria-label={`Download ${file.name}`}
                    onClick={() => downloadAttachment(file)}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Quality-row chips — citation-validator + jurisdiction-sanity.
            Sit ABOVE the bubble so the reader sees them before reading
            the claim. The row renders only when at least one chip has
            content; assistant turns with neither flag get a clean
            bubble. */}
        {showQualityRow && (
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            {flaggedCount > 0 && (
              <>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-md font-medium bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                  title="The citation validator detected one or more handles the model emitted that did not match any of the sources in the prompt. Those handles were stripped and the surrounding sentences marked '(unbelegt)'."
                >
                  ⚠ {flaggedCount} unbelegt
                </span>
                <span className="text-muted-foreground">
                  source{flaggedCount === 1 ? "" : "s"} stripped by citation
                  validator
                </span>
              </>
            )}
            {jurisdictionCount > 0 && (
              <>
                {/* Separator between the two chip groups so a turn with
                    both flagged behaves visibly. Omitted when only the
                    jurisdiction chip is active. */}
                {flaggedCount > 0 && (
                  <span className="text-muted-foreground" aria-hidden>
                    ·
                  </span>
                )}
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-md font-medium bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 whitespace-pre-line"
                  title={jurisdictionTooltip}
                >
                  ⚠ {jurisdictionCount}{" "}
                  {jurisdictionCount === 1
                    ? "Jurisdiktionswarnung"
                    : "Jurisdiktionswarnungen"}
                </span>
                <span className="text-muted-foreground">
                  rule from wrong Bundesland — hover for details
                </span>
              </>
            )}
          </div>
        )}

        {/* ── Message body ──
            A user turn renders its attachment chip(s) AND typed text inside
            ONE rounded bubble, so "document + question" is a single input
            (not a file box stacked above a separate text box). A turn that's
            only an attachment shows just the chip; only-text shows just the
            text. An assistant turn renders the markdown answer bubble. */}
        {isUser ? (
          editing ? (
            <div className="flex flex-col items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                rows={Math.min(10, Math.max(2, draft.split("\n").length))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveEdit();
                  } else if (e.key === "Escape") {
                    cancelEdit();
                  }
                }}
                className="w-full max-w-lg rounded-2xl border border-primary/40 bg-card px-4 py-3 text-sm leading-relaxed text-foreground text-left outline-none resize-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={saveEdit}
                  disabled={
                    !draft.trim() || draft.trim() === message.content.trim()
                  }
                >
                  Save &amp; submit
                </Button>
              </div>
            </div>
          ) : (
            (message.content.trim().length > 0 ||
              (message.attachments?.length ?? 0) > 0) && (
            <div className="flex justify-end">
              <div className="inline-block max-w-full overflow-hidden text-left rounded-2xl rounded-tr-sm bg-primary text-primary-foreground">
                {message.attachments && message.attachments.length > 0 && (
                  <div
                    className={cn(
                      "flex flex-col gap-1.5 p-2",
                      message.content.trim().length > 0 && "pb-0.5",
                    )}
                  >
                    {message.attachments.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-white/15"
                      >
                        <ManuscriptIcon className="w-4 h-4 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {file.name}
                          </p>
                          <p className="text-xs text-primary-foreground/70">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        {file.file && (
                          <button
                            type="button"
                            onClick={() => downloadAttachment(file)}
                            className="flex-shrink-0 p-1 rounded-md hover:bg-white/20 transition-colors"
                            title="Download"
                            aria-label={`Download ${file.name}`}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {message.content.trim().length > 0 && (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed px-4 py-3">
                    {message.content}
                  </p>
                )}
              </div>
            </div>
            )
          )
        ) : message.processingNote && message.content.trim().length === 0 ? (
          // Doc still ingesting: show a clean processing indicator (with the
          // backend's live page progress) instead of the raw placeholder
          // token. Replaced by the real answer the moment it streams.
          <div className="inline-flex items-center gap-2.5 px-4 py-3 rounded-2xl rounded-tl-sm bg-muted/50 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
            <span>{message.processingNote}</span>
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <div className="inline-block px-4 py-3 rounded-2xl bg-muted/50 rounded-tl-sm">
              <CitedMarkdown
                content={message.content}
                chunks={message.chunks}
                activeHandle={activeCiteHandle}
                onCiteClick={
                  onCiteClick
                    ? (handle) => onCiteClick(handle, message.chunks ?? [])
                    : undefined
                }
              />
            </div>
          </div>
        )}

        {/* ── Edit — user turns with typed text ── */}
        {isUser && !editing && onEdit && message.content.trim().length > 0 && (
          <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={beginEdit}
              title="Edit message"
              aria-label="Edit message"
            >
              <Pencil className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* ── Actions — assistant only ── */}
        {/* Copy, RotateCcw, ThumbsUp, ThumbsDown — no custom equivalents, kept from lucide */}
        {!isUser && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleCopy}
              disabled={!!message.streaming}
              title={copied ? "Copied" : "Copy answer"}
              aria-label="Copy answer"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onRegenerate}
              disabled={!!message.streaming || !onRegenerate}
              title="Regenerate answer"
              aria-label="Regenerate answer"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
            <div className="w-px h-4 bg-border mx-1" />
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                isUp && "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-500/15",
              )}
              disabled={feedbackDisabled}
              onClick={() => onFeedback?.(1)}
              aria-label="Mark answer as helpful"
              aria-pressed={isUp}
              title={isUp ? "Bewertet: hilfreich" : "Hilfreich"}
            >
              <ThumbsUp className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                isDown && "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/15",
              )}
              disabled={feedbackDisabled}
              onClick={() => onFeedback?.(-1)}
              aria-label="Mark answer as unhelpful"
              aria-pressed={isDown}
              title={isDown ? "Bewertet: nicht hilfreich" : "Nicht hilfreich"}
            >
              <ThumbsDown className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
