// src/react-app/hooks/useComposerAttachments.ts
//
// Claude-style upload-on-attach for chat composers (normal chat + project
// chats). The moment a file is attached it's uploaded to the matter session;
// the chip then reflects the real lifecycle — uploading → processing → done
// (green) → error — by polling the backend ingestion status. A green check
// therefore means "fully parsed & searchable", never just "queued".
//
// State storage lives in ``ComposerAttachmentsProvider`` (mounted at
// DashboardLayout) and is scope-keyed via the ``scope`` option. This lets
// the staging area survive route navigation: previously the state was a
// component-local ``useState`` that died with DashboardChat / ProjectChatView
// on every tab switch, leaving in-flight uploads orphaned in the network
// layer with no UI to track or cancel them. Now switching tabs is purely a
// re-mount of the consumer; the chips, progress %, and AbortControllers
// are all looked up by ``scope`` and reappear unchanged.
//
// The send path stays correct either way: each attachment carries
// ``uploaded`` so the turn handler skips re-uploading it, and falls back to
// uploading any attachment that isn't yet uploaded (e.g. a rehydrated one).

import { useCallback, useEffect } from "react";

import {
  listMatterDocuments,
  uploadDocumentWithProgress,
  UploadAbortError,
} from "@/react-app/lib/ragApi";
import {
  estimateProcessingMs,
  naturalProgressPct,
} from "@/react-app/components/ui/ProgressRing";
import { randomId } from "@/react-app/utils/uuid";
import type { ChatAttachment } from "@/react-app/components/project/types";
import { useComposerAttachmentsStore } from "@/react-app/hooks/ComposerAttachmentsProvider";

const POLL_MS = 1500;
// Last-resort safety so a buggy backend that never reports a terminal status
// doesn't spin a card forever. Previously this was 25 s, which lied to the
// user: it flipped the chip to a green check while the doc was still
// indexing, the user asked a question against an un-embedded doc, and the
// assistant hallucinated. 8 minutes is conservative — well past any
// realistic OCR + chunk + embed run, so we only fall through on a true
// backend bug, not on a normal slow file.
const INGEST_TIMEOUT_MS = 8 * 60 * 1000;

function extOf(name: string): string {
  return (name.split(".").pop() ?? "file").toUpperCase();
}

interface UseComposerAttachmentsOpts {
  /** Stable identifier for this composer's staging area. Different scopes
   *  keep independent attachment lists, session refs, and AbortControllers.
   *  Suggested keys:
   *    • DashboardChat conversation: ``"chat"`` or activeConversationId
   *    • ProjectChatView: ``"project:<projectId>:<conversationId>"`` */
  scope: string;
  /** Current matter session id (project- or conversation-scoped). */
  sessionId: string | null | undefined;
  /** Called when an upload mints/confirms a session id, so the parent can
   *  persist it on the project/conversation. */
  onSessionEstablished?: (sessionId: string) => void;
}

export interface UseComposerAttachments {
  attachments: ChatAttachment[];
  /** Add + immediately upload files. */
  addFiles: (files: FileList | File[]) => void;
  removeAttachment: (id: string) => void;
  clear: () => void;
  /** True while any attachment's POST is still in flight — gate send on this
   *  so a question can't run against a not-yet-uploaded document. */
  isUploading: boolean;
}

export function useComposerAttachments(
  opts: UseComposerAttachmentsOpts,
): UseComposerAttachments {
  const store = useComposerAttachmentsStore();
  const scope = opts.scope;

  // Read THIS scope's slice on every render. Other scopes' updates don't
  // re-render this consumer past the cheap-equality check inside React.
  const attachments = store.getAttachments(scope);

  // Mutable per-scope refs — the hook reads/writes these synchronously
  // inside upload callbacks. Lazy-allocated by the store.
  const sessionRef = store.getSessionRef(scope);
  const abortControllers = store.getControllers(scope);

  // Keep the per-scope sessionRef in sync with what the parent passes. Only
  // overwrite when the parent has a non-empty id, so the moment-of-mint
  // upload response always wins.
  useEffect(() => {
    if (opts.sessionId) sessionRef.current = opts.sessionId;
  }, [opts.sessionId, sessionRef]);

  const patch = useCallback(
    (id: string, p: Partial<ChatAttachment>) =>
      store.setAttachments(scope, (prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...p } : a)),
      ),
    [scope, store],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        const id = randomId();
        store.setAttachments(scope, (prev) => [
          ...prev,
          {
            id,
            name: file.name,
            size: file.size,
            type: extOf(file.name),
            file,
            uploadStatus: "uploading",
            uploadProgress: 0,
          },
        ]);
        const controller = new AbortController();
        abortControllers.set(id, controller);
        uploadDocumentWithProgress(
          file,
          sessionRef.current,
          (percent) => {
            if (controller.signal.aborted) return;
            patch(id, { uploadProgress: percent });
          },
          controller.signal,
        )
          .then((res) => {
            if (controller.signal.aborted) return;
            sessionRef.current = res.session_id;
            opts.onSessionEstablished?.(res.session_id);
            patch(id, {
              uploaded: true,
              uploadStatus: "processing",
              uploadProgress: 100,
              processingProgress: 0,
              processingStartedAt: Date.now(),
              processingEstimatedMs: estimateProcessingMs(file.size),
              docIndex: res.doc_index,
            });
          })
          .catch((err) => {
            if (err instanceof UploadAbortError || controller.signal.aborted) {
              return;
            }
            patch(id, {
              uploadStatus: "error",
              uploadError:
                err instanceof Error ? err.message : "Upload fehlgeschlagen",
            });
          })
          .finally(() => {
            abortControllers.delete(id);
          });
      }
    },
    [abortControllers, opts, patch, scope, sessionRef, store],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      const controller = abortControllers.get(id);
      if (controller) {
        controller.abort();
        abortControllers.delete(id);
      }
      store.setAttachments(scope, (prev) => prev.filter((a) => a.id !== id));
    },
    [abortControllers, scope, store],
  );

  const clear = useCallback(() => {
    for (const controller of abortControllers.values()) {
      controller.abort();
    }
    abortControllers.clear();
    store.setAttachments(scope, []);
  }, [abortControllers, scope, store]);

  // Poll backend ingestion status while any attachment is "processing", and
  // flip it to done/error by filename. Keyed on the SET of processing names
  // so the effect re-subscribes only when that set changes (no render-loop).
  const processingKey = attachments
    .filter((a) => a.uploadStatus === "processing")
    .map((a) => a.name)
    .sort()
    .join("|");

  useEffect(() => {
    const sid = sessionRef.current;
    if (!sid || !processingKey) return;
    let cancelled = false;
    let timer: number | undefined;
    const startedAt = Date.now();

    const poll = async () => {
      const docs = await listMatterDocuments(sid).catch(() => []);
      if (cancelled) return;
      const byName = new Map(docs.map((d) => [d.filename, d]));
      const timedOut = Date.now() - startedAt > INGEST_TIMEOUT_MS;
      store.setAttachments(scope, (prev) =>
        prev.map((a) => {
          if (a.uploadStatus !== "processing") return a;
          const d = byName.get(a.name);
          const s: string | undefined = d?.status;
          if (s === "failed")
            return {
              ...a,
              uploadStatus: "error",
              uploadError: d?.error || "Verarbeitung fehlgeschlagen",
              processingProgress: undefined,
            };
          if (s === "done" || s === "ready" || (d && !s) || timedOut)
            return {
              ...a,
              uploadStatus: "done",
              processingProgress: 100,
            };
          const total = d?.pages_total ?? 0;
          const done = d?.pages_done ?? 0;
          const realPct =
            total > 0
              ? Math.max(0, Math.min(99, Math.round((done / total) * 100)))
              : 0;
          const elapsed = a.processingStartedAt
            ? Date.now() - a.processingStartedAt
            : 0;
          const T = a.processingEstimatedMs ?? 30_000;
          const estPct = naturalProgressPct(elapsed, T);
          const next = Math.max(realPct, estPct, a.processingProgress ?? 0);
          return next === a.processingProgress
            ? a
            : { ...a, processingProgress: next };
        }),
      );
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // sessionRef + store are stable refs; depending on processingKey alone
    // is correct — restart polling only when the set of processing names
    // actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingKey]);

  // Fast in-between ticker — the backend poll only runs every POLL_MS, which
  // is too sluggish to keep a satisfying clockwise ring fill. This 300ms tick
  // re-evaluates the linear estimator only (no network), so the ring moves
  // smoothly between polls.
  useEffect(() => {
    if (!processingKey) return;
    const id = window.setInterval(() => {
      store.setAttachments(scope, (prev) =>
        prev.map((a) => {
          if (a.uploadStatus !== "processing" || !a.processingStartedAt)
            return a;
          const elapsed = Date.now() - a.processingStartedAt;
          const T = a.processingEstimatedMs ?? 30_000;
          const estPct = naturalProgressPct(elapsed, T);
          const next = Math.max(estPct, a.processingProgress ?? 0);
          return next === a.processingProgress
            ? a
            : { ...a, processingProgress: next };
        }),
      );
    }, 300);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingKey]);

  const isUploading = attachments.some((a) => a.uploadStatus === "uploading");

  return { attachments, addFiles, removeAttachment, clear, isUploading };
}
