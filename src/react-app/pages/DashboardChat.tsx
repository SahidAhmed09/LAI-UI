import { useState, useRef, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router";
import { Logo } from "@/react-app/components/Logo";
import { ChevronDown } from "lucide-react";
import {
  ChatMessage,
  ChatMessageData,
  ChatAttachment,
} from "@/react-app/components/chat/ChatMessage";
import { ChatInput } from "@/react-app/components/chat/ChatInput";
import { DocumentList } from "@/react-app/components/chat/DocumentList";
import { DropZone } from "@/react-app/components/chat/DropZone";
import { TypingIndicator } from "@/react-app/components/chat/TypingIndicator";
import { CitationPanel } from "@/react-app/components/chat/CitationPanel";
import { useComposerAttachments } from "@/react-app/hooks/useComposerAttachments";
import type { Chunk, RAGResponse, UploadResponse } from "@/react-app/lib/ragApi";
import type { Conversation } from "@/react-app/components/DashboardLayout";
import {
  streamQuery,
  uploadDocument,
  analyzeContract,
  getSession,
  getAnalyzeProgress,
  appendMessage,
  submitFeedback,
  listSessionFeedback,
  type AnalyzeProgress,
} from "@/react-app/lib/ragApi";
import { randomId } from "@/react-app/utils/uuid";

// localStorage key for the active session id. One per active conversation
// (we scope by activeConversationId so users with multiple chats keep
// their uploaded contract isolated per chat).
const SESSION_KEY_PREFIX = "lai.session.";
function sessionKey(convId: string | undefined | null): string {
  return SESSION_KEY_PREFIX + (convId || "default");
}


// Extensions the backend Docling pipeline accepts — used to filter files
// dropped into / picked for the composer before they're sent for upload.
const COMPOSER_DOC_EXTS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xlsx",
  ".xls",
  ".txt",
  ".csv",
  ".md",
];

interface OutletContextType {
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  conversations: Conversation[];
  setConversations: (convs: Conversation[]) => void;
  refreshConversations: () => Promise<void>;
}

export default function DashboardChatPage() {
  const context = useOutletContext<OutletContextType>();
  const {
    activeConversationId,
    setActiveConversationId,
    refreshConversations,
  } = context || {};

  // Answer language is no longer chosen via a toggle: the backend
  // mirrors the language of each question (ask in German → German
  // answer, ask in English → English answer), so /query/stream is
  // called without a ``target_language`` override.
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Holds the AbortController for the currently in-flight
  // streamQuery() call (if any). Aborted when the user navigates to a
  // different conversation, the component unmounts, or a new submit
  // supersedes the prior stream. Keeping the controller in a ref
  // (instead of state) avoids a re-render every time we (re)assign it.
  const streamAbortRef = useRef<AbortController | null>(null);
  // Set true just before WE programmatically change activeConversationId
  // (e.g. after a fresh upload creates a new session). Tells the
  // rehydration useEffect to skip its setMessages([]) reset for that
  // single transition — otherwise the chat thread we just built up
  // gets wiped and replaced with the server-side message list.
  const skipNextRehydrate = useRef(false);
  // True while a /query/stream is in flight (thinking + token streaming).
  // Drives the composer's Stop button so the lawyer can halt a long answer.
  const [isStreaming, setIsStreaming] = useState(false);
  // Bumped on each successful upload — drives DocumentList's refetch.
  const [docRefreshKey, setDocRefreshKey] = useState(0);

  // Composer attachments now use the shared upload-on-attach hook: a file
  // uploads to the matter session the moment it's attached, the preview card
  // shows a live %, and the send button is disabled until uploads finish —
  // identical to the project chat.
  const handleSessionEstablished = useCallback(
    (sid: string) => {
      setSessionId(sid);
      if (activeConversationId !== sid) {
        skipNextRehydrate.current = true;
        setActiveConversationId?.(sid);
      }
      refreshConversations?.();
      setDocRefreshKey((k) => k + 1);
    },
    [activeConversationId, setActiveConversationId, refreshConversations],
  );
  // Scope the composer to this conversation so attachments mid-upload survive
  // route navigation (Chat → Documents → back to Chat). Falls back to a
  // shared "chat-new" scope when no conversation is active yet, so a file
  // dropped on the empty-state landing also persists across tab switches.
  const composer = useComposerAttachments({
    scope: activeConversationId
      ? `chat-conv:${activeConversationId}`
      : "chat-new",
    sessionId,
    onSessionEstablished: handleSessionEstablished,
  });
  const composerAttachments = composer.attachments;
  const isUploading = composer.isUploading;
  // True while any uploaded document is still being ingested (OCR + embed
  // + index). Driven by DocumentList's status poll; gates the composer so
  // a question isn't asked before the document is searchable (it would
  // otherwise fall back to the corpus with a dangling [M-n]).
  const [docsIngesting, setDocsIngesting] = useState(false);

  // Citation panel state — opens when a CitationChip is clicked anywhere
  // in the thread. `openChunks` carries the chunks of the message the
  // chip belongs to, so the panel doesn't need to search every other
  // message in `messages` to resolve the handle.
  const [openCiteHandle, setOpenCiteHandle] = useState<string | null>(null);
  const [openCiteChunks, setOpenCiteChunks] = useState<Chunk[]>([]);

  const handleCiteClick = useCallback((handle: string, chunks: Chunk[]) => {
    setOpenCiteHandle(handle);
    setOpenCiteChunks(chunks);
  }, []);

  const handleCitePanelClose = useCallback(() => {
    setOpenCiteHandle(null);
  }, []);

  // Thumbs-up / thumbs-down handler. The setMessages call paints the
  // verdict optimistically (instant UI feedback) and then fires
  // ``POST /feedback`` in the background. On failure we revert to the
  // previous state so the UI doesn't lie about what the server saved.
  // The backend upserts on (user, session, message) so re-clicking
  // the same button is a no-op and clicking the opposite button
  // toggles in place.
  const handleFeedback = useCallback(
    (uiMessageId: string, rating: 1 | -1) => {
      let priorVerdict: 1 | -1 | null = null;
      let serverMessageId: number | null = null;
      let activeSessionId: string | null = null;
      setMessages((prev) => {
        // ``find`` is cheap (≤ a few hundred bubbles per session) and
        // avoids threading two pieces of state out through closures.
        const target = prev.find((m) => m.id === uiMessageId);
        priorVerdict = target?.feedback ?? null;
        serverMessageId = target?.messageId ?? null;
        return prev.map((m) =>
          m.id === uiMessageId ? { ...m, feedback: rating } : m,
        );
      });
      activeSessionId = sessionId;
      if (!activeSessionId) return;

      void (async () => {
        const newId = await submitFeedback({
          sessionId: activeSessionId!,
          messageId: serverMessageId,
          rating,
        });
        if (newId === null) {
          // Revert — the server rejected (auth, 4xx, transport).
          setMessages((prev) =>
            prev.map((m) =>
              m.id === uiMessageId ? { ...m, feedback: priorVerdict } : m,
            ),
          );
        }
      })();
    },
    [sessionId],
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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

  useEffect(() => {
    const timer = setTimeout(() => forceScrollToBottom("smooth"), 0);
    return () => clearTimeout(timer);
  }, [messages.length, isTyping, forceScrollToBottom]);

  // ── Stream lifecycle ─────────────────────────────────────────────────
  // Abort any in-flight /query/stream when the user navigates to a
  // DIFFERENT conversation or the chat page unmounts. Without this the
  // backend keeps generating, the tokens accumulate into a stale ref,
  // and the next session_id swap can race with a late onComplete.
  //
  // Critically, this must NOT fire for our OWN programmatic id changes:
  // uploading a document (or the first query) mints a session and we call
  // ``setActiveConversationId`` mid-send. That id change is the SAME
  // conversation continuing — aborting here would kill the answer the user
  // just asked for and surface a bogus "Stopped" (the doc+text bug). The
  // ``skipNextRehydrate`` flag is already set true for exactly those
  // programmatic switches, so we reuse it to suppress the abort too.
  useEffect(() => {
    return () => {
      if (skipNextRehydrate.current) return;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    };
  }, [activeConversationId]);

  // ── Session rehydration ───────────────────────────────────────────────
  // On conversation change (or first mount), fetch the server-side message
  // history for the active conversation and replay it. The sidebar list
  // already gives us the session id (each `conv.id` from /sessions is the
  // session_id), so we fetch directly — no localStorage indirection.
  //
  // The previous version gated the fetch on a `lai.session.<convId>` cache
  // key that only existed if the conversation had been active in *this*
  // browser before. That meant clicking any sidebar entry that came from
  // the backend list (rather than one freshly created in this tab) showed
  // an empty chat. localStorage is now used only as a write-side cache so
  // restored ids survive a serve_rag restart, never as a read gate.
  useEffect(() => {
    if (skipNextRehydrate.current) {
      // We just set activeConversationId ourselves (post-upload /
      // post-first-query). Keep the in-flight chat thread; don't reset.
      skipNextRehydrate.current = false;
      return;
    }
    setMessages([]);
    setShowScrollBtn(false);
    setSessionId(null);

    if (!activeConversationId) return;

    let cancelled = false;
    (async () => {
      const result = await getSession(activeConversationId);
      if (cancelled) return;
      if (!result.ok) {
        // Only treat a TRUE 404 as a stale id worth clearing. Network
        // errors (e.g. serve_rag mid-restart) leave the localStorage cache
        // alone so a later mount can still rehydrate.
        if (result.reason === "not-found") {
          try { window.localStorage.removeItem(sessionKey(activeConversationId)); } catch { /* ignore */ }
          // Clear the dead id from the conversation context too — otherwise
          // the sidebar + DocumentList keep polling a session the server has
          // deleted, spamming 404s. Refresh the list so it drops out.
          setActiveConversationId?.(null);
          refreshConversations?.();
        }
        return;
      }
      const detail = result.session;
      setSessionId(detail.session_id);
      const replayed: ChatMessageData[] = detail.messages.map((m) => ({
        id: randomId(),
        role: m.role,
        content: m.content,
        timestamp: new Date((m.created_at || 0) * 1000),
        // Carry the persisted ``messages.id`` so the thumbs-up/down
        // buttons can scope feedback to this specific bubble even
        // after a full page reload. Without this, replayed bubbles
        // would silently downgrade to session-level feedback.
        messageId: m.id,
        // Restore the citation sources so [M-n]/[C-n] chips resolve to
        // their source after a reload, not just in the live SSE turn.
        chunks: m.chunks && m.chunks.length > 0 ? m.chunks : undefined,
      }));
      setMessages(replayed);

      // ── Repaint persisted feedback verdicts ─────────────────────
      // Best-effort: a failed fetch leaves the bubbles unrated, which
      // is the right default. The map keyed on the persisted message
      // id is what makes a refresh show the lawyer their own previous
      // thumbs-up/down state instead of resetting it.
      const records = await listSessionFeedback(detail.session_id);
      if (cancelled) return;
      if (records.length > 0) {
        const verdict = new Map<number, 1 | -1>();
        for (const r of records) {
          if (r.message_id !== null && (r.rating === 1 || r.rating === -1)) {
            verdict.set(r.message_id, r.rating);
          }
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId != null && verdict.has(m.messageId)
              ? { ...m, feedback: verdict.get(m.messageId) ?? null }
              : m,
          ),
        );
      }
    })();

    return () => { cancelled = true; };
  }, [activeConversationId]);

  // Persist sessionId to localStorage when we have one. Don't auto-clear
  // on null — the rehydration effect above is the only place that should
  // remove a stored id, and only on confirmed 404. Otherwise an initial
  // null state on mount would wipe the value before rehydration can read it.
  useEffect(() => {
    if (!sessionId) return;
    try {
      const k = sessionKey(activeConversationId);
      window.localStorage.setItem(k, sessionId);
    } catch {
      // localStorage unavailable (private mode etc.) — ignore, just lose persistence
    }
  }, [sessionId, activeConversationId]);

  // ── Shared upload-confirmation ───────────────────────────────────────
  //
  // Two upload paths feed into the same UI flow:
  //   1. ChatInput attachments (handleSendMessage's upload loop) — when
  //      the user attaches a file to a typed question and submits.
  //   2. DropZone in the empty state — when the user drops a file before
  //      typing anything.
  //
  // Both need to: sync sessionId state, promote/refresh the sidebar
  // entry, render the 📎 user bubble + "Document uploaded" assistant
  // bubble, and persist both to the server in deterministic order so
  // refresh-replay sees the same sequence. This helper is the single
  // source of truth so the two paths can't drift apart.
  const applyUploadConfirmation = useCallback(
    async (
      uploadResult: UploadResponse,
      // ``silent`` skips the local 📎 chat bubble (but still does the
      // session bookkeeping). The composer-with-text path uses this because
      // it renders ONE combined user bubble (the typed text + attachment
      // chips together) instead of a separate 📎 bubble — otherwise the
      // same submit produced two user bubbles.
      //
      // ``persistMarker`` controls whether the 📎 marker is written to the
      // server. We skip it when the turn ALSO has typed text: that text is
      // persisted by /query and stands in for the turn, so persisting a
      // separate marker would replay as a second user bubble on reload —
      // re-creating the very double-bubble we're removing. Upload-only and
      // DropZone turns keep persistMarker=true so the attachment still
      // shows after a reload.
      opts: { silent?: boolean; persistMarker?: boolean } = {},
    ) => {
      const persistMarker = opts.persistMarker ?? true;
      setSessionId(uploadResult.session_id);

      if (activeConversationId !== uploadResult.session_id) {
        skipNextRehydrate.current = true;
        setActiveConversationId?.(uploadResult.session_id);
      }
      refreshConversations?.();

      // Just a compact attachment marker — NOT the old verbose "Document
      // uploaded · Pages · Chunks · type analyze contract" blurb. The real,
      // document-grounded analysis is streamed right after by
      // ``autoAnalyzeDocument`` so the user gets an accurate answer instead
      // of a static confirmation.
      const userBubbleText = `📎 ${uploadResult.filename}`;

      if (!opts.silent) {
        setMessages((prev) => [
          ...prev,
          {
            id: randomId(),
            role: "user",
            content: userBubbleText,
            timestamp: new Date(),
          },
        ]);
      }

      // Persist the upload marker so refresh-replay shows the attachment.
      // Skipped when typed text accompanies the upload (see persistMarker).
      if (persistMarker) {
        try {
          await appendMessage(uploadResult.session_id, "user", userBubbleText, "upload");
        } catch {
          /* persistence failure — UI already updated */
        }
      }

      // Invalidate DocumentList's cached fetch so the freshly-uploaded
      // row replaces the "no documents" placeholder. Cheap counter
      // bump — see ``docRefreshKey`` declaration above.
      setDocRefreshKey((k) => k + 1);
    },
    [activeConversationId, setActiveConversationId, refreshConversations],
  );


  // ── Stream an answer into an existing assistant bubble ───────────────
  // Shared by the normal /query path and the Regenerate button so both
  // produce identical streaming/citation/feedback wiring. The bubble with
  // ``aiMessageId`` must already exist (created as a streaming placeholder
  // by the caller); this fills it token-by-token and finalises it with the
  // citation-validated answer + chunks on completion.
  const streamAnswerInto = useCallback(
    (
      aiMessageId: string,
      question: string,
      sid: string | null,
      // Per-turn focus: [M-n] slots of docs the composer just attached.
      // When set, the answer scopes to ONLY those docs (manifest + retrieval
      // + validator-allowed handles narrow). Null/empty ⇒ full session.
      focusDocIndexes?: number[] | null,
    ): Promise<void> =>
      new Promise<void>((resolve) => {
        streamAbortRef.current?.abort();
        setIsStreaming(true);
        let firstTokenSeen = false;
        streamAbortRef.current = streamQuery(question, sid, {
          // While the uploaded document is still ingesting, the backend
          // streams ``status`` progress. Show it as a clean indicator and
          // drop the generic typing dots — the bubble itself now reports
          // "processing your document…".
          onStatus: (note) => {
            setIsTyping(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId
                  ? { ...m, processingNote: note, streaming: true }
                  : m,
              ),
            );
          },
          onToken: (delta) => {
            // Empty deltas are the backend's watchdog re-arm heartbeats, and
            // the ⏳ notice is the transient "still processing" placeholder —
            // the status indicator covers both, so neither belongs in the
            // answer text.
            if (!delta) return;
            if (delta.includes("⏳")) return;
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              setIsTyping(false);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId
                  ? { ...m, content: m.content + delta, processingNote: undefined }
                  : m,
              ),
            );
          },
          onComplete: (payload: RAGResponse) => {
            if (payload.session_id) {
              setSessionId(payload.session_id);
              if (
                !activeConversationId ||
                activeConversationId !== payload.session_id
              ) {
                skipNextRehydrate.current = true;
                setActiveConversationId?.(payload.session_id);
                refreshConversations?.();
              }
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId
                  ? {
                      ...m,
                      content: payload.answer,
                      chunks: payload.chunks,
                      citationValidation: payload.citation_validation ?? null,
                      jurisdictionWarnings:
                        payload.jurisdiction_warnings ?? undefined,
                      streaming: false,
                      timestamp: new Date(),
                      messageId: payload.message_id ?? null,
                      processingNote: undefined,
                    }
                  : m,
              ),
            );
            setIsStreaming(false);
            streamAbortRef.current = null;
            resolve();
          },
          onError: (detail) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId
                  ? {
                      ...m,
                      content: `⚠️ **Error:** ${detail}`,
                      streaming: false,
                      timestamp: new Date(),
                    }
                  : m,
              ),
            );
            setIsStreaming(false);
            streamAbortRef.current = null;
            resolve();
          },
          // Stop button: keep whatever streamed so far, finalise the bubble,
          // and append a quiet "(stopped)" marker when nothing had arrived
          // yet so the turn doesn't look like a silent failure.
          onAbort: () => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId
                  ? {
                      ...m,
                      content: m.content.trim().length
                        ? `${m.content}\n\n_⏹ Stopped._`
                        : "_⏹ Generation stopped._",
                      streaming: false,
                      timestamp: new Date(),
                    }
                  : m,
              ),
            );
            setIsStreaming(false);
            streamAbortRef.current = null;
            resolve();
          },
        }, null, focusDocIndexes ?? null);
      }),
    [activeConversationId, setActiveConversationId, refreshConversations],
  );

  // ── Regenerate ────────────────────────────────────────────────────────
  // Re-runs the user question that produced a given assistant bubble and
  // streams a fresh answer back INTO the same bubble (so the thread keeps
  // its position, the previous answer is simply replaced). Walks backwards
  // from the target to the nearest real user question, skipping the 📎
  // upload markers so regenerate works even right after an upload turn.
  const handleRegenerate = useCallback(
    (assistantMsgId: string) => {
      const idx = messages.findIndex((m) => m.id === assistantMsgId);
      if (idx < 0) return;
      let question = "";
      for (let i = idx - 1; i >= 0; i--) {
        const m = messages[i];
        if (
          m.role === "user" &&
          m.content.trim().length > 0 &&
          !m.content.startsWith("📎")
        ) {
          question = m.content;
          break;
        }
      }
      if (!question) return;

      // Reset the target bubble to a clean streaming state — drop the old
      // answer's chunks/validation/feedback so stale chips don't linger.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: "",
                chunks: undefined,
                citationValidation: null,
                jurisdictionWarnings: undefined,
                feedback: null,
                messageId: null,
                streaming: true,
                timestamp: new Date(),
              }
            : m,
        ),
      );
      setIsTyping(true);
      setTimeout(() => forceScrollToBottom("smooth"), 0);
      void streamAnswerInto(assistantMsgId, question, sessionId).finally(() =>
        setIsTyping(false),
      );
    },
    [messages, sessionId, streamAnswerInto, forceScrollToBottom],
  );

  // ── Stop generating ────────────────────────────────────────────────────
  // Aborting the controller triggers streamQuery's onAbort, which finalises
  // the partial bubble and resolves the awaiting promise, so the composer
  // returns to idle on its own.
  const handleStopGenerating = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  // ── Edit & resubmit a user turn ─────────────────────────────────────────
  // Replace the message's text, drop everything after it (the now-stale
  // answer), and stream a fresh answer into a new bubble. Note: the server
  // still holds the original turns — on a hard reload the pre-edit thread
  // replays; the live edit is authoritative only for this session view.
  const handleEditUserMessage = useCallback(
    (uiMessageId: string, newText: string) => {
      const trimmed = newText.trim();
      if (!trimmed) return;
      const idx = messages.findIndex((m) => m.id === uiMessageId);
      if (idx < 0) return;
      const aiMessageId = randomId();
      setMessages((prev) => {
        const head = prev.slice(0, idx);
        const edited: ChatMessageData = {
          ...prev[idx],
          content: trimmed,
          timestamp: new Date(),
        };
        const placeholder: ChatMessageData = {
          id: aiMessageId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          streaming: true,
        };
        return [...head, edited, placeholder];
      });
      setIsTyping(true);
      setTimeout(() => forceScrollToBottom("smooth"), 0);
      void streamAnswerInto(aiMessageId, trimmed, sessionId).finally(() =>
        setIsTyping(false),
      );
    },
    [messages, sessionId, streamAnswerInto, forceScrollToBottom],
  );

  // ── DropZone → composer ─────────────────────────────────────────────────
  // Files dropped on (or picked from) the empty-state DropZone become
  // composer attachments — NOT an instant upload — so the lawyer can add a
  // question and send one combined turn. Mirrors the paperclip exactly.
  const handleDroppedFiles = useCallback(
    (files: File[]) => {
      const accepted = files.filter((f) =>
        COMPOSER_DOC_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext)),
      );
      if (accepted.length === 0) return;
      // Upload-on-attach: the hook uploads each immediately and shows a card
      // with live progress in the composer.
      composer.addFiles(accepted);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    [composer],
  );

  // ── Send message ──────────────────────────────────────────────────────────
  // CHANGED: replaced mock timeout + mockResponses with real queryRAG() call
  //
  // Local-UI ordering must match server-persisted ordering, otherwise on
  // refresh the user sees a different bubble layout than they did during
  // the live chat. Specifically, when a submit includes BOTH attachments
  // AND typed text, the server stores 4 separate bubbles (📎 filename,
  // upload-confirmation, typed text, response) in upload→analyze order;
  // the local UI used to add a single combined bubble (chips + text)
  // BEFORE the upload happened, which then got shuffled on refresh.
  //
  // Strategy:
  //   - With no attachments: add the typed user bubble immediately
  //     (matches server: typed → response).
  //   - With attachments: skip the up-front bubble. Do uploads first,
  //     then for each upload add 📎 + upload-confirmation locally
  //     (matching the appendMessage pair sent to the server). After all
  //     uploads, if there's also typed text, add that user bubble. Then
  //     proceed with /analyze or /query.
  //
  // The TypingIndicator with "Uploading document..." gives the user
  // feedback that something's happening even though their typed text
  // isn't echoed yet.
  const handleSendMessage = async (
    content: string,
    attachments: ChatAttachment[],
  ) => {
    const hasAttachments = attachments.some((a) => a.file);
    const trimmedContent = content.trim();

    // Render the user's turn as a SINGLE bubble immediately — the typed
    // text with its attachment chips shown together (like every modern
    // chat app), instead of a separate "📎 filename" bubble plus a second
    // text bubble. The upload loop below therefore runs in ``silent`` mode
    // so it doesn't add its own 📎 bubble.
    if (hasAttachments || trimmedContent.length > 0) {
      const userMessage: ChatMessageData = {
        id: randomId(),
        role: "user",
        content,
        attachments: hasAttachments ? attachments : undefined,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
    }

    // The files are already uploaded (upload-on-attach); clear the composer
    // preview now that the turn has captured them.
    composer.clear();

    setIsTyping(true);
    setTimeout(() => forceScrollToBottom("smooth"), 0);

    try {
      let currentSessionId = sessionId;

      // Upload all document attachments — backend Docling accepts
      // PDF, DOCX/DOC, XLSX/XLS, TXT, CSV, MD. Match the same set the
      // ChatInput file picker offers; if Docling can't parse a specific
      // file the backend will return an error which is surfaced in chat.
      const SUPPORTED_DOC_EXTS = [".pdf", ".doc", ".docx", ".xlsx", ".xls", ".txt", ".csv", ".md"];
      const docAttachments = attachments.filter(
        (a) => a.file && SUPPORTED_DOC_EXTS.some(
          (ext) => a.file!.name.toLowerCase().endsWith(ext)
        )
      );

      // Documents are uploaded on attach (the composer's preview cards show
      // live progress), so most are already done here. Any not yet uploaded
      // (a failed/rehydrated attachment) is uploaded now as a fallback so the
      // turn is always self-contained. The session is already synced via the
      // hook's onSessionEstablished.
      for (const attachment of docAttachments) {
        if (attachment.uploaded || !attachment.file) continue;
        try {
          const uploadResult = await uploadDocument(
            attachment.file,
            currentSessionId,
          );
          currentSessionId = uploadResult.session_id;
          await applyUploadConfirmation(uploadResult, {
            silent: true,
            persistMarker: trimmedContent.length === 0,
          });
        } catch {
          /* one bad file shouldn't abort the turn — the error surfaces in
             the answer if the document can't be grounded */
        }
      }

      // Special command: "analyze contract" runs the clause-by-clause
      // analyzer on the currently-uploaded session document.
      const trimmed = content.trim().toLowerCase();
      const isAnalyzeCmd =
        currentSessionId &&
        (trimmed === "analyze contract" ||
         trimmed === "analyse vertrag" ||
         trimmed === "analysiere vertrag" ||
         trimmed.startsWith("/analyze"));

      if (isAnalyzeCmd) {
        // Live progress message — updated in place every few seconds
        // while the long /analyze-contract POST is open.
        const progressMsgId = randomId();
        const progressMsg: ChatMessageData = {
          id: progressMsgId,
          role: "assistant",
          content: "🔄 **Analyse läuft…** Vorbereitung",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, progressMsg]);

        const renderProgress = (p: AnalyzeProgress): string => {
          if (p.status === "error") {
            return `❌ **Analyse fehlgeschlagen** — ${p.error ?? "unbekannter Fehler"}`;
          }
          const elapsed = Math.max(0, Math.round(p.elapsed_s ?? 0));
          const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;
          const pct = Math.round((p.percent ?? 0) * 100);
          let label = "Vorbereitung";
          if (p.step === "starting") label = "Starte Analyse";
          else if (p.step === "classifying") label = "Vertragstyp wird erkannt";
          else if (p.step === "classify_done") label = "Vertragstyp erkannt";
          else if (p.step === "preparing_context" || p.step === "preparing_context_done")
            label = "Kontext wird vorbereitet";
          else if (p.step === "tables_reconciled") label = "Tabellen abgeglichen";
          else if (p.step === "extracting_parcels") label = "Flurstücke werden extrahiert";
          else if (p.step === "parcels_done")
            label = `Flurstücke extrahiert (${p.current ?? 0})`;
          else if (p.step === "analyzing_clause")
            label = `Klausel ${p.current}/${p.total} wird analysiert`;
          else if (p.step === "clauses_done") label = "Klausel-Analyse abgeschlossen";
          else if (p.step === "whole_contract") label = "Gesamtvertrag wird geprüft";
          else if (p.step === "done") label = "Fertig";
          // Rough ETA — simple linear extrapolation, only meaningful when
          // we have non-zero progress.
          let etaStr = "";
          if (pct > 5 && pct < 100 && elapsed > 0) {
            const totalEst = elapsed / Math.max(p.percent ?? 0.001, 0.01);
            const remaining = Math.max(0, Math.round(totalEst - elapsed));
            etaStr = remaining >= 60
              ? ` · ~${Math.ceil(remaining / 60)} min verbleibend`
              : ` · ~${remaining}s verbleibend`;
          }
          return `🔄 **${label}** — ${pct}% · ${elapsedStr} elapsed${etaStr}`;
        };

        // Start polling. Stops when analyzeContract resolves below.
        // currentSessionId is guaranteed non-null here (isAnalyzeCmd
        // guards on it), but the TS narrowing doesn't survive into a
        // separate boolean variable — assert non-null explicitly.
        const sidForAnalyze: string = currentSessionId!;
        let pollDone = false;
        const pollInterval = window.setInterval(async () => {
          if (pollDone) return;
          const p = await getAnalyzeProgress(sidForAnalyze);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === progressMsgId ? { ...m, content: renderProgress(p) } : m,
            ),
          );
        }, 3000);

        let a;
        try {
          a = await analyzeContract(sidForAnalyze);
        } finally {
          pollDone = true;
          window.clearInterval(pollInterval);
        }

        // Replace the progress placeholder with the final result.
        const lines: string[] = [];
        lines.push(`**Contract analysis** — ${a.filename}`);
        lines.push(`Detected ${a.n_clauses} clauses (analysis took ${a.elapsed_s}s)`);
        lines.push("");
        if (a.missing_required_clauses.length > 0) {
          lines.push("### ❌ Missing required clauses");
          for (const m of a.missing_required_clauses) {
            lines.push(`- **[${m.severity.toUpperCase()}] ${m.type ?? ""}** — ${m.description}`);
          }
          lines.push("");
        }
        const flagged = a.clauses.filter((c) => c.issues && c.issues.length > 0);
        if (flagged.length > 0) {
          lines.push("### ⚠️ Flagged clauses");
          for (const c of flagged) {
            lines.push(`#### ${c.id} · ${c.type}`);
            if (c.summary) lines.push(`> ${c.summary}`);
            for (const i of c.issues) {
              lines.push(
                `- **[${i.severity.toUpperCase()}]** ${i.description}` +
                (i.recommendation ? `\n   _Empfehlung: ${i.recommendation}_` : "")
              );
            }
            if (c.citations.length > 0) {
              lines.push(`- 📎 ${c.citations.join(", ")}`);
            }
            lines.push("");
          }
        } else {
          lines.push("✅ No issues flagged in any clause.");
        }
        // Replace the progress placeholder we inserted earlier with the
        // final analysis text — keeping the same id so React updates in
        // place rather than appending a new bubble.
        const analysisText = lines.join("\n");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === progressMsgId
              ? { ...m, content: analysisText, timestamp: new Date() }
              : m,
          ),
        );
        // Persist user trigger + assistant output sequentially (NOT
        // Promise.allSettled) so the user bubble is guaranteed a smaller
        // server-side time.time() than the assistant bubble. With parallel
        // POSTs, FastAPI threadpool concurrency could race for the SQLite
        // write lock and swap their order on refresh-replay.
        try {
          await appendMessage(sidForAnalyze, "user", content || "analyze contract", "analyze");
          await appendMessage(sidForAnalyze, "assistant", analysisText, "analyze");
        } catch {
          /* best-effort; UI already shows the result */
        }
      } else if (content.trim().length === 0 && docAttachments.length > 0) {
        // Upload-only — user attached file(s) with no question. Ingestion is
        // asynchronous, so we don't analyze immediately (the document isn't
        // ready the instant upload returns, and a data room may be many
        // files). Post a short notice; the sidebar shows live per-document
        // progress and a checkmark when each is ready to query.
        const noticeId = randomId();
        const noticeText =
          docAttachments.length === 1
            ? `📥 **${docAttachments[0].name}** wird verarbeitet — der Fortschritt erscheint in der Seitenleiste. Stellen Sie Ihre Frage, sobald das Dokument bereit ist (grünes Häkchen).`
            : `📥 ${docAttachments.length} Dokumente werden verarbeitet — der Fortschritt erscheint in der Seitenleiste. Stellen Sie Ihre Frage, sobald sie bereit sind (grünes Häkchen).`;
        setMessages((prev) => [
          ...prev,
          {
            id: noticeId,
            role: "assistant",
            content: noticeText,
            timestamp: new Date(),
          },
        ]);
        if (currentSessionId) {
          try {
            await appendMessage(currentSessionId, "assistant", noticeText, "upload");
          } catch {
            /* best-effort */
          }
        }
      } else if (content.trim().length === 0) {
        // Empty submit, no attachment either — nothing to do.
      } else {
        // Normal /query path — streamed via SSE so the lawyer sees
        // tokens land in real time instead of staring at the typing
        // indicator for 8-15s. UI_GUIDE.md §8.1 Option B.
        //
        // Wire shape:
        //   1. Insert a placeholder assistant bubble (empty content,
        //      ``streaming: true``, no chunks — partial [C-n] handles
        //      must not render as broken chips mid-stream).
        //   2. On each ``onToken`` append the delta to that bubble's
        //      content via a functional setMessages keyed by id.
        //   3. On ``onComplete`` swap the accumulated raw text for the
        //      citation-validated ``payload.answer`` and attach chunks +
        //      validation summary — at that point CitationChip can
        //      finally resolve handles.
        //   4. On ``onError`` replace the placeholder with the same
        //      error bubble shape today's catch path produces.
        //
        // We supersede any prior in-flight stream by aborting
        // ``streamAbortRef.current`` before opening the new one, so a
        // user firing two questions back-to-back doesn't get two
        // overlapping token streams writing into different bubbles.
        const aiMessageId = randomId();
        const placeholder: ChatMessageData = {
          id: aiMessageId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          streaming: true,
        };
        setMessages((prev) => [...prev, placeholder]);

        // streamAnswerInto returns a promise that resolves on the terminal
        // complete/error event, so the outer try/catch's ``finally`` (which
        // resets isTyping + restores focus) waits for stream completion
        // instead of firing right after the placeholder lands. Same wiring
        // is reused by the Regenerate button.
        //
        // Per-turn focus: when this turn attached docs, scope the answer
        // to ONLY them — otherwise the model silently pulls in the rest
        // of the session's matter (e.g. "analyse this document" referring
        // to two PREVIOUSLY uploaded files as well). If any attachment
        // lacks a docIndex (older backend / fallback re-upload path), we
        // skip scoping rather than narrow to a partial set.
        const focusIdxs = docAttachments.map((a) => a.docIndex);
        const focusDocIndexes =
          focusIdxs.length > 0 && focusIdxs.every((i): i is number => typeof i === "number")
            ? (focusIdxs as number[])
            : null;
        await streamAnswerInto(aiMessageId, content, currentSessionId, focusDocIndexes);
      }
    } catch (err: unknown) {
      // Show the error as an assistant message so it's visible in chat
      const errorMessage: ChatMessageData = {
        id: randomId(),
        role: "assistant",
        content: `⚠️ **Error:** ${err instanceof Error ? err.message : "Could not reach the backend. Make sure the API server is running on the SSH server."}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      {/* The page title, notifications, and theme toggle now live in the
          global AppHeader (DashboardLayout), so the chat page starts straight
          at the message thread. */}

      {/* ── Scrollable Messages ── */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 w-full min-h-0 overflow-y-auto flex flex-col relative"
      >
        {!hasMessages && !activeConversationId ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 px-4">
            <div className="flex items-center justify-center mb-6">
              <Logo size="lg" showText={false} />
            </div>
            <h2 className="text-2xl font-bold mb-2">Welcome to LAI</h2>
            <p className="text-muted-foreground text-center max-w-md mb-8">
              Your AI assistant for wind energy legal due diligence, grounded
              in 350 GB of German legal corpus. Upload documents, ask
              questions, and get instant analysis.
            </p>
            {/* Drop-zone first — UI_GUIDE.md §1 frames the demo as
                "drop a PDF, then ask a question." Putting the upload
                affordance above the suggested prompts mirrors that
                order so the lawyer's first reflex matches the pitch. */}
            <div className="w-full max-w-lg mb-6">
              <DropZone
                sessionId={sessionId}
                onFiles={handleDroppedFiles}
                hint="Drop a Pachtvertrag, BImSchG-Bescheid, or any contract PDF — it attaches to your message so you can ask a question with it · max 50 MB"
              />
            </div>
          </div>
        ) : !hasMessages && activeConversationId ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 px-4">
            <div className="flex items-center justify-center mb-4">
              <Logo size="lg" showText={false} />
            </div>
            <h3 className="text-lg font-semibold mb-2">New Conversation</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Ask me anything about wind energy permits, contracts, or legal
              compliance. You can also upload documents for analysis.
            </p>
            <div className="w-full max-w-lg space-y-4">
              <DropZone
                sessionId={sessionId}
                onFiles={handleDroppedFiles}
              />
              {/* Lists the document already attached to this session
                  (if any) — relevant when the user lands here via the
                  ?session_id deep-link or sidebar entry and the session
                  was previously populated. Empty state shows "No
                  documents uploaded yet." */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                  Documents
                </p>
                <DocumentList
                  sessionId={sessionId ?? activeConversationId}
                  refreshKey={docRefreshKey}
                  onIngestingChange={setDocsIngesting}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto w-full px-4 py-4">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                onRegenerate={
                  message.role === "assistant" && !message.streaming
                    ? () => handleRegenerate(message.id)
                    : undefined
                }
                activeCiteHandle={openCiteHandle}
                onCiteClick={handleCiteClick}
                onFeedback={
                  message.role === "assistant"
                    ? (rating) => handleFeedback(message.id, rating)
                    : undefined
                }
                onEdit={
                  message.role === "user" && !isStreaming
                    ? (text) => handleEditUserMessage(message.id, text)
                    : undefined
                }
              />
            ))}
            {/* Upload feedback now lives in the UploadProgress panel above
                the composer, so the in-thread indicator is just for the
                model's thinking/answering phase. */}
            {isTyping && !isUploading && (
              <TypingIndicator message="LAI is thinking..." />
            )}
            <div ref={bottomAnchorRef} style={{ height: 1 }} />
          </div>
        )}

        {showScrollBtn && hasMessages && (
          <button
            onClick={() => forceScrollToBottom("smooth")}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 w-fit mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all text-xs font-medium z-10"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Latest
          </button>
        )}
      </div>

      {/* ── Input ── */}
      <div className="flex-shrink-0 border-t border-border">
        <div className="max-w-4xl mx-auto w-full px-4 py-4 space-y-2">
          {/* No language toggle: the backend mirrors the question's
              language automatically (German question → German answer,
              English question → English answer). Upload progress now shows on
              the attachment preview cards inside the composer. */}
          <ChatInput
            onSend={handleSendMessage}
            disabled={isTyping || docsIngesting}
            isStreaming={isStreaming}
            isUploading={isUploading}
            onStop={handleStopGenerating}
            attachments={composerAttachments}
            onAddFiles={composer.addFiles}
            onRemoveAttachment={composer.removeAttachment}
            placeholder={
              isUploading
                ? "Uploading document..."
                : docsIngesting
                  ? "Document is being processed — you can ask once it's ready…"
                  : "Ask LAI about permits, contracts, or upload documents..."
            }
            inputRef={inputRef}
          />
        </div>
      </div>

      {/* Citation side panel — fixed-position so it overlays the chat
          regardless of where in the JSX it sits. Closed (null handle)
          renders nothing. */}
      <CitationPanel
        openHandle={openCiteHandle}
        chunks={openCiteChunks}
        onClose={handleCitePanelClose}
        sessionId={sessionId}
      />
    </div>
  );
}
