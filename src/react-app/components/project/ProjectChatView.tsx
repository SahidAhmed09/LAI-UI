import { useRef, useState, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  Share2,
  Mic,
  MicOff,
  Send,
  Square,
  Paperclip,
  ChevronDown,
  X,
  Loader2,
} from "lucide-react";
import { ProjectConversation, ChatMessage, ChatAttachment } from "./types";
import {
  ChatMessage as ChatMessageView,
  type ChatMessageData,
} from "@/react-app/components/chat/ChatMessage";
import { CitationPanel } from "@/react-app/components/chat/CitationPanel";
import { TypingIndicator } from "@/react-app/components/chat/TypingIndicator";
import { ShareDialog } from "@/react-app/components/share/ShareDialog";
import { toast } from "sonner";
import { useComposerAttachments } from "@/react-app/hooks/useComposerAttachments";
import { AttachmentChip } from "./AttachmentChip";
import { Logo } from "@/react-app/components/Logo";
import { ManuscriptIcon, GearIcon } from "@/react-app/components/icons";
import { useSpeechRecognition } from "@/react-app/hooks/useSpeechRecognition";
import { cn } from "@/react-app/lib/utils";
import {
  listMatterDocuments,
  type MatterDocument,
  type Chunk,
} from "@/react-app/lib/ragApi";

// Conversation-starter chips shown in the empty state. Clicking one sends it
// straight to the grounded backend — same path as typing it.
const SUGGESTIONS = [
  "What permits are required under BImSchG?",
  "Summarize the key risks in this contract",
  "Check environmental compliance (BNatSchG)",
  "Review the grid connection terms",
];

// Project messages store a display string timestamp ("HH:MM"); the shared
// ChatMessage component wants a Date. Reconstruct one for display.
function tsToDate(ts: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(ts);
  if (m) {
    const d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d;
  }
  return new Date();
}

// Adapt a project ChatMessage to the shared ChatMessageData so the project
// chat renders with the exact same bubbles/actions as the normal chat.
function toChatData(m: ChatMessage): ChatMessageData {
  return {
    id: m.id,
    role: m.sender,
    content: m.message,
    attachments: m.attachments,
    timestamp: tsToDate(m.timestamp),
    chunks: m.chunks,
    citationValidation: m.citationValidation,
    jurisdictionWarnings: m.jurisdictionWarnings,
    messageId: m.messageId,
    streaming: m.streaming,
    processingNote: m.processingNote,
    feedback: m.feedback,
  };
}

interface ProjectChatViewProps {
  projectName: string;
  conversation: ProjectConversation;
  sessionId?: string | null;
  onSessionEstablished?: (sessionId: string) => void;
  onBack: () => void;
  onSendMessage: (message: string, attachments: ChatAttachment[]) => void;
  onStop: () => void;
  onRegenerate: (assistantMsgId: string) => void;
  onEditMessage: (userMsgId: string, newText: string) => void;
  onFeedback: (msgId: string, rating: 1 | -1) => void;
}

export function ProjectChatView({
  projectName,
  conversation,
  sessionId,
  onSessionEstablished,
  onBack,
  onSendMessage,
  onStop,
  onRegenerate,
  onEditMessage,
  onFeedback,
}: ProjectChatViewProps) {
  const [chatInput, setChatInput] = useState("");
  // Scope the composer staging to THIS conversation so attachments mid-upload
  // survive navigation to another project / dashboard tab and reappear here
  // when the user comes back. The store is dashboard-global and scope-keyed.
  const composer = useComposerAttachments({
    scope: `project-conv:${conversation.id}`,
    sessionId,
    onSessionEstablished,
  });
  const attachments = composer.attachments;
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [docs, setDocs] = useState<MatterDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // ── Live ingestion indicator ───────────────────────────────────────────────
  // The composer chip shows upload/processing only until the message is sent
  // (handleSend clears the composer). After that the backend keeps OCR-ing a
  // scanned PDF page-by-page with NO visual cue — the user only learns it's
  // still working by asking. Poll the session's documents and surface any that
  // are still ingesting as a persistent banner above the composer, with live
  // page progress. Re-armed whenever a message is added (every upload produces
  // one), so a freshly-uploaded doc is picked up immediately.
  const [ingestingDocs, setIngestingDocs] = useState<MatterDocument[]>([]);
  useEffect(() => {
    const sid = conversation.sessionId;
    if (!sid) {
      setIngestingDocs([]);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      const list = await listMatterDocuments(sid).catch(() => []);
      if (cancelled) return;
      const proc = list.filter(
        (d) => d.status === "queued" || d.status === "processing",
      );
      setIngestingDocs(proc);
      // Keep polling only while something is still ingesting; stop otherwise.
      if (proc.length > 0) timer = window.setTimeout(tick, 2500);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // messages.length (not content) re-arms the poll on each new turn/upload;
    // streaming token writes don't change it, so this doesn't loop per-token.
  }, [conversation.sessionId, conversation.messages.length]);

  // Citation panel — opens when a CitationChip in any bubble is clicked.
  // openCiteChunks carries the clicked message's chunks so the panel can
  // resolve the handle without scanning the thread (mirrors DashboardChat).
  const [openCiteHandle, setOpenCiteHandle] = useState<string | null>(null);
  const [openCiteChunks, setOpenCiteChunks] = useState<Chunk[]>([]);
  const handleCiteClick = useCallback((handle: string, chunks: Chunk[]) => {
    setOpenCiteHandle(handle);
    setOpenCiteChunks(chunks);
  }, []);
  const handleCitePanelClose = useCallback(() => setOpenCiteHandle(null), []);

  // The backend owns the typing lifecycle now: while any assistant bubble is
  // still streaming, the composer is locked and the streaming bubble itself
  // is the activity indicator.
  const isBusy = conversation.messages.some((m) => m.streaming);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Speech recognition ────────────────────────────────────────────────────
  const handleTranscript = useCallback((fullText: string) => {
    setChatInput(fullText);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height =
          Math.min(textareaRef.current.scrollHeight, 120) + "px";
      }
    });
  }, []);

  const { micState, errorMessage, isSupported, toggleListening } =
    useSpeechRecognition({ onTranscript: handleTranscript });

  const isListening = micState === "listening";

  // ── Scroll helpers ────────────────────────────────────────────────────────
  const forceScrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      bottomAnchorRef.current?.scrollIntoView({ behavior, block: "end" });
      const el = scrollContainerRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior });
      setShowScrollBtn(false);
    },
    [],
  );

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(dist > 120);
  }, []);

  // Initial scroll on mount
  useEffect(() => {
    forceScrollToBottom("instant");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Smooth-scroll on NEW messages only (count change). The per-token scroll
  // — what caused the "screen shakes violently during streaming" — has its
  // own effect below, using a non-animated pin so streaming doesn't trigger
  // a fresh smooth-scroll animation every ~50ms.
  useEffect(() => {
    const timer = setTimeout(() => forceScrollToBottom("smooth"), 0);
    return () => clearTimeout(timer);
  }, [conversation.messages.length, forceScrollToBottom]);

  // Token-tick pin: while the last message's text is growing, keep the
  // viewport at the bottom — BUT only if the user is already there. If
  // they've scrolled up to re-read, we leave them alone (the floating
  // "Latest" button reappears so they can opt back in). The "pin" uses
  // ``scrollTop = scrollHeight`` directly, NOT smooth-behavior, so each
  // token tick is a single-frame snap instead of a competing animation.
  const lastContentLen =
    conversation.messages[conversation.messages.length - 1]?.message.length ??
    0;
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Within 120px of the bottom counts as "user is following along".
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist > 120) return;
    el.scrollTop = el.scrollHeight;
  }, [lastContentLen]);

  // Re-focus the composer once the answer finishes streaming.
  useEffect(() => {
    if (!isBusy) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [isBusy]);

  // ── Documents drawer (real matter docs for this conversation's session) ────
  const loadDocs = useCallback(async () => {
    if (!conversation.sessionId) {
      setDocs([]);
      return;
    }
    setDocsLoading(true);
    const list = await listMatterDocuments(conversation.sessionId);
    setDocs(list);
    setDocsLoading(false);
  }, [conversation.sessionId]);

  const toggleDocs = () => {
    const next = !showDocs;
    setShowDocs(next);
    if (next) void loadDocs();
  };

  // ── Share — Path A Step 2: per-session collaborator dialog ────────────────
  // The previous Share button used the Web Share API to broadcast the URL,
  // but the chat URL is a per-user route — a recipient with no auth or no
  // share couldn't see the conversation. Replace with the proper share
  // dialog: grant a colleague in the same firm view access to this session.
  // (The "Copied" pill state below is retained but unused — left so the
  // shared header markup keeps compiling cleanly.)
  const [shareOpen, setShareOpen] = useState(false);
  const openShareDialog = () => {
    if (!conversation.sessionId) {
      toast.info("Send your first message to create the matter, then share it.");
      return;
    }
    setShareOpen(true);
  };

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = () => {
    const text = chatInput.trim();
    if ((!text && attachments.length === 0) || isBusy || composer.isUploading)
      return;
    if (isListening) toggleListening(chatInput);

    const sent = [...attachments];
    setChatInput("");
    composer.clear();
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    onSendMessage(text, sent);
    setTimeout(() => forceScrollToBottom("smooth"), 0);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setChatInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.currentTarget.files) composer.addFiles(e.currentTarget.files);
    e.currentTarget.value = "";
  };

  const removeAttachment = (id: string) => composer.removeAttachment(id);

  const canSend =
    (chatInput.trim().length > 0 || attachments.length > 0) &&
    !isBusy &&
    !composer.isUploading;

  const hasContent = conversation.messages.length > 0;

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* ── HEADER ── */}
      <div className="flex-shrink-0 h-10 border-b border-border/50 flex items-center justify-between px-5 bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2 text-sm min-w-0">
          {/* Explicit, obvious Back affordance — returns to this project's
              conversation list. */}
          <button
            onClick={onBack}
            title="Back to conversations"
            className="flex items-center gap-1.5 -ml-1 px-2 py-1 rounded-md font-medium text-foreground hover:bg-muted/50 transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <span className="text-border/70 shrink-0">/</span>
          <span className="text-muted-foreground truncate shrink min-w-0">
            {projectName}
          </span>
          <span className="text-border/70 shrink-0">/</span>
          <span className="text-foreground font-semibold truncate">
            {conversation.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-3">
          <button
            onClick={toggleDocs}
            title="Documents in this conversation"
            className={cn(
              "p-1.5 rounded-md transition-colors",
              showDocs
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
            )}
          >
            <ManuscriptIcon className="w-4 h-4" />
          </button>
          <button
            onClick={openShareDialog}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
            title="Share this matter with a colleague (view-only)"
          >
            <Share2 className="w-3.5 h-3.5" />
            Share
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ── MESSAGES ── */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 w-full min-h-0 overflow-y-auto flex flex-col relative"
        >
          {!hasContent && (
            <div className="flex-1 flex flex-col items-center justify-center py-12 px-4 animate-in fade-in duration-500">
              <div className="flex items-center justify-center mb-4">
                <Logo size="lg" showText={false} />
              </div>
              <h3 className="text-base font-semibold mb-2">New Conversation</h3>
              <p className="text-muted-foreground text-center max-w-sm text-sm mb-6">
                Ask me anything about wind energy permits, contracts, or legal
                compliance.
              </p>
              <div className="grid sm:grid-cols-2 gap-2.5 w-full max-w-xl">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s}
                    onClick={() => onSendMessage(s, [])}
                    style={{ animationDelay: `${i * 60}ms` }}
                    className="text-left text-sm px-4 py-3 rounded-xl border border-border/50 bg-card/40 hover:bg-card hover:border-primary/40 hover:shadow-sm transition-all text-muted-foreground hover:text-foreground animate-in fade-in slide-in-from-bottom-2 fill-mode-both"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasContent && (
            <div className="max-w-4xl mx-auto w-full px-5 py-2">
              {conversation.messages.map((msg) => (
                <ChatMessageView
                  key={msg.id}
                  message={toChatData(msg)}
                  activeCiteHandle={openCiteHandle}
                  onCiteClick={handleCiteClick}
                  onRegenerate={
                    msg.sender === "assistant" && !msg.streaming
                      ? () => onRegenerate(msg.id)
                      : undefined
                  }
                  onEdit={
                    msg.sender === "user"
                      ? (text) => onEditMessage(msg.id, text)
                      : undefined
                  }
                  onFeedback={
                    msg.sender === "assistant"
                      ? (rating) => onFeedback(msg.id, rating)
                      : undefined
                  }
                />
              ))}
              {/* "LAI is thinking…" fallback. ChatMessageView returns null
                  for an empty streaming assistant bubble (the "two thinking
                  avatars" fix in chat/ChatMessage.tsx), so without this the
                  user sees a blank gap between submit and the first token.
                  We render the indicator only while the LAST assistant
                  bubble is still empty + streaming with no processingNote
                  — the indicator hands off to the filling bubble the moment
                  any text or status note arrives. */}
              {(() => {
                const last =
                  conversation.messages[conversation.messages.length - 1];
                const showTyping =
                  last?.sender === "assistant" &&
                  last.streaming &&
                  (last.message?.trim().length ?? 0) === 0 &&
                  !last.processingNote;
                return showTyping ? (
                  <TypingIndicator message="LAI is thinking..." />
                ) : null;
              })()}
              <div ref={bottomAnchorRef} style={{ height: 1 }} />
            </div>
          )}

          {showScrollBtn && (
            <button
              onClick={() => forceScrollToBottom("smooth")}
              className="sticky bottom-4 left-1/2 -translate-x-1/2 w-fit mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all text-xs font-medium z-10"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Latest
            </button>
          )}
        </div>

        {/* ── DOCUMENTS DRAWER ── */}
        {showDocs && (
          <aside className="w-72 flex-shrink-0 border-l border-border/50 bg-background/60 backdrop-blur overflow-y-auto">
            <div className="flex items-center justify-between px-4 h-11 border-b border-border/40">
              <span className="text-sm font-semibold">Documents</span>
              <button
                onClick={() => setShowDocs(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              {docsLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : docs.length === 0 ? (
                <div className="text-center py-8">
                  <ManuscriptIcon className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    No documents yet. Attach a PDF or contract with the
                    paperclip below to ground this chat.
                  </p>
                </div>
              ) : (
                docs.map((d) => (
                  <div
                    key={d.cite_id}
                    className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-card/50 p-2.5"
                  >
                    <ManuscriptIcon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">
                        {d.filename}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        [{d.cite_id}] · {d.n_pages} pages
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── INPUT ── */}
      <div className="flex-shrink-0">
        <div className="max-w-4xl mx-auto w-full px-5 pt-3 pb-3">
          {/* Live ingestion banner — persists after send (the composer chip is
              gone), so the user always sees a scanned PDF being transcribed
              page-by-page instead of a silent wait. */}
          {ingestingDocs.length > 0 && (
            <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span className="truncate">
                {ingestingDocs.length === 1 ? (
                  <>
                    Verarbeite „{ingestingDocs[0].filename}“
                    {ingestingDocs[0].pages_total > 0 &&
                      ` — Seite ${ingestingDocs[0].pages_done}/${ingestingDocs[0].pages_total}`}
                  </>
                ) : (
                  `Verarbeite ${ingestingDocs.length} Dokumente…`
                )}
              </span>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map((att) => (
                <AttachmentChip
                  key={att.id}
                  att={att}
                  onRemove={() => removeAttachment(att.id)}
                />
              ))}
            </div>
          )}

          {isListening && (
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <span className="text-xs text-red-500 font-medium">
                Listening… speak now
              </span>
            </div>
          )}

          {micState === "error" && errorMessage && (
            <p className="text-xs text-destructive mb-2 px-1">{errorMessage}</p>
          )}
          {micState === "unsupported" && (
            <p className="text-xs text-muted-foreground mb-2 px-1">
              Voice input not supported in this browser. Try Chrome or Edge.
            </p>
          )}

          <div className="bg-card/60 backdrop-blur rounded-2xl border border-border/50 shadow-sm">
            <div className="flex items-center gap-2 px-3 pt-3 pb-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                title="Attach document"
              >
                <Paperclip className="w-[18px] h-[18px]" />
              </button>

              <textarea
                ref={textareaRef}
                className={cn(
                  "flex-1 resize-none outline-none bg-transparent text-foreground text-sm leading-relaxed min-h-[24px] max-h-[120px] py-0.5",
                  isListening
                    ? "placeholder:text-red-400"
                    : "placeholder-muted-foreground",
                )}
                placeholder={
                  isListening
                    ? "Listening… speak now"
                    : "Ask LAI about permits, contracts, or upload documents..."
                }
                rows={1}
                value={chatInput}
                onChange={handleTextareaChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={isBusy}
              />

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => toggleListening(chatInput)}
                  disabled={isBusy || !isSupported}
                  title={
                    !isSupported
                      ? "Not supported in this browser. Try Chrome or Edge."
                      : isListening
                        ? "Stop recording"
                        : "Start voice input"
                  }
                  className={cn(
                    "relative p-1.5 rounded-lg transition-all duration-200",
                    isListening
                      ? "text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      : !isSupported
                        ? "text-muted-foreground/40 cursor-not-allowed"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
                  )}
                >
                  {isListening && (
                    <span className="absolute inset-0 rounded-lg animate-ping bg-red-400/20" />
                  )}
                  {isListening ? (
                    <MicOff className="w-[18px] h-[18px] relative z-10" />
                  ) : (
                    <Mic className="w-[18px] h-[18px] relative z-10" />
                  )}
                </button>

                {isBusy ? (
                  <button
                    onClick={onStop}
                    title="Stop generating"
                    aria-label="Stop generating"
                    className="w-8 h-8 rounded-full flex items-center justify-center bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm transition-all"
                  >
                    <Square className="w-3 h-3 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!canSend}
                    title="Send message"
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                      canSend
                        ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                        : "bg-muted text-muted-foreground opacity-50 cursor-not-allowed",
                    )}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between px-4 pb-2.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                <GearIcon className="w-3 h-3" />
                LAI analyzes legal documents for wind energy due diligence
              </span>
              <span className="text-xs text-muted-foreground/40">
                Press Enter to send, Shift+Enter for new line
              </span>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept=".pdf,.doc,.docx,.xlsx,.xls,.txt,.csv,.md"
        />
      </div>

      {/* Citation drawer — opens on chip click; resolves [M-n] to the
          uploaded document and [C-n] to the corpus excerpt. Scoped to this
          conversation's matter session. Closed (null handle) renders nothing. */}
      <CitationPanel
        openHandle={openCiteHandle}
        chunks={openCiteChunks}
        onClose={handleCitePanelClose}
        sessionId={conversation.sessionId ?? sessionId ?? null}
      />

      {/* Per-matter collaborator dialog (Path A Step 2 — view-only). Only
          renders when the share button is clicked AND we have a session id
          (a fresh conversation without a sessionId isn't sharable yet). */}
      {conversation.sessionId && (
        <ShareDialog
          resourceType="session"
          resourceId={conversation.sessionId}
          resourceName={conversation.title}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </div>
  );
}
