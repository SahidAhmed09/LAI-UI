// src/react-app/lib/ragApi.ts

// Route every request through the auth-aware fetch wrapper so the Bearer
// access token is attached and a 401 transparently triggers a
// refresh-via-cookie + retry. Without this the protected /query,
// /sessions, … endpoints all 401. apiFetch passes absolute URLs through
// unchanged, so the BACKEND_URL construction below still works.
import { apiFetch, getAccessToken, bootstrapAuth } from "@/react-app/auth/apiFetch";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://192.168.178.82:8000";

// Answer-language codes the backend `target_language` field accepts as
// a hard override. The UI no longer sends one — it leaves this ``null``
// so the backend mirrors the question's language automatically (German
// question → German answer, English question → English answer). Kept
// for the API contract and any programmatic caller that wants to force
// a language.
export type Language = "de" | "en";

export interface Chunk {
  text: string;
  section: string;
  law_refs: string[];
  sources: string[];       // ["vector"] or ["vector", "bm25"]
  similarity: number;
  rerank_score: number;
  // Citation handle the LLM was instructed to cite verbatim (e.g. "C-1", "M-1").
  // Empty for chat-only responses; populated for every chunk on rag / rag+contract
  // / contract turns. Drives the CitationChip / CitationPanel lookup.
  cite_id: string;
  // "corpus" = chunk from the legal corpus (blue chip). "matter" = chunk from
  // a user-uploaded document (amber chip).
  source_kind: "corpus" | "matter";
  // 1-based page the cited passage was OCR'd from (matter docs ingested via
  // the vision-OCR path). Lets the citation panel scroll the PDF preview to
  // the right page. null/0/undefined when unknown.
  page?: number | null;
}

// Structured summary of the Day-4 citation validator pass. Populated only
// when the prompt carried sources (rag / rag+contract / contract modes).
// See serve_rag.py:CitationValidationOut for the canonical shape.
export interface CitationValidation {
  // Handles the prompt presented to the LLM, sorted.
  allowed: string[];
  // Handles the model actually emitted (deduplicated, first-seen order).
  emitted: string[];
  // Subset of `emitted` not in `allowed` — stripped from `answer`; surrounding
  // sentence rewritten to end "(unbelegt)".
  fabricated: string[];
  // Number of sentences the validator rewrote with the "(unbelegt)" marker.
  // Drives the "N unverifiable claims removed" badge above the bubble.
  sentences_flagged: number;
}

// Day-4 jurisdiction sanity gate. One entry per Bundesland-specific rule
// (e.g. Bayern's 10H BayBO) cited in the answer when the matter is in a
// DIFFERENT state. Drives an amber warning chip in the UI:
// "Cited 10H BayBO but the matter is in Niedersachsen."
//
// Empty list means either no Bundesland was detected for the matter, OR
// the answer didn't mention any state-specific rule from the wrong state.
export interface JurisdictionWarning {
  rule_label: string;
  rule_bundesland: string;
  expected_bundesland: string;
  excerpt: string;
}

export interface Timings {
  embed_s: number;
  retrieve_s: number;
  rerank_s: number;
  generate_s: number;
  total_s: number;
}

export interface RAGResponse {
  answer: string;
  chunks: Chunk[];
  timings: Timings;
  tokens: {
    prompt: number;
    completion: number;
  };
  session_id: string;
  // Backend reports which routing decision it made.
  // "chat" = no retrieval; "rag" = corpus retrieval;
  // "contract" = uses uploaded contract only;
  // "rag+contract" = both.
  mode?: "chat" | "rag" | "contract" | "rag+contract";
  // Null on chat-only turns (no sources to validate); populated on grounded
  // turns. The UI uses `fabricated` / `sentences_flagged` for the "N
  // unverifiable claims removed" badge.
  citation_validation?: CitationValidation | null;
  // Empty when no Bundesland detected for the matter OR when no
  // jurisdictionally-suspect rule appears in the answer. One warning
  // per (rule, expected state) pair.
  jurisdiction_warnings?: JurisdictionWarning[];
  // ``messages.id`` of the persisted assistant row. Drives the
  // FeedbackButtons so a thumbs-up scopes to a specific bubble rather
  // than the whole session. ``null`` only when the backend couldn't
  // persist the message (best-effort path); the UI then falls back to
  // session-level feedback.
  message_id?: number | null;
}

export interface ClauseIssue {
  severity: "low" | "medium" | "high";
  description: string;
  recommendation?: string;
  reason?: string;
  type?: string;
}

export interface AnalyzedClause {
  id: string;
  title: string;
  text: string;
  type: string;
  summary: string;
  issues: ClauseIssue[];
  citations: string[];
}

export interface AnalyzeResponse {
  session_id: string;
  filename: string;
  n_clauses: number;
  clauses: AnalyzedClause[];
  missing_required_clauses: ClauseIssue[];
  elapsed_s: number;
}

export interface UploadResponse {
  session_id: string;
  filename: string;
  pages: number;
  chunks: number;
  message: string;
  // Per-turn focus: server-assigned 1-based slot inside the session — the
  // [M-n] handle and the value the chat composer sends back in
  // ``focus_doc_indexes`` so this turn's answer is scoped to ONLY the
  // documents just attached.
  doc_index?: number;
}

export async function queryRAG(
  question: string,
  sessionId: string | null = null,
  targetLanguage: Language | null = null,
): Promise<RAGResponse> {
  // Only include ``target_language`` in the wire payload when the
  // caller passed one. Older serve_rag builds without the field on
  // ``QueryReq`` would 422 on a literal ``null`` value (pydantic
  // refuses unknown fields by default) — omitting the key is the
  // forward-compatible default.
  const body: Record<string, unknown> = { question, session_id: sessionId };
  if (targetLanguage) body.target_language = targetLanguage;

  const res = await apiFetch(`${BACKEND_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || `Server error: ${res.status}`);
  }

  return res.json();
}

export async function uploadDocument(file: File, sessionId: string | null = null): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (sessionId) {
    formData.append("session_id", sessionId);
  }

  const res = await apiFetch(`${BACKEND_URL}/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || `Upload failed: ${res.status}`);
  }

  return res.json();
}

// One XHR attempt: returns a transport-level outcome (status + body, or a
// network/timeout/abort failure flag) WITHOUT throwing. Callers decide what
// to retry. ``onProgress`` receives 0–100; resets to 0 on retry so the UI
// doesn't jump backwards visibly.
type XhrOutcome =
  | { kind: "http"; status: number; text: string }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "aborted" };

/** Thrown when a caller's AbortSignal fired mid-upload. The composer's
 *  upload loop swallows these so cancelled rows don't surface as errors. */
export class UploadAbortError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortError";
  }
}

function _uploadXhrOnce(
  url: string,
  formData: FormData,
  token: string | null,
  onProgress: (percent: number) => void,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<XhrOutcome> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ kind: "aborted" });
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    // Without a timeout an XHR can hang indefinitely behind a stalled proxy
    // or a dead TLS connection — the user sees the chip pegged at "98%" with
    // nothing happening. 10 minutes is generous enough to upload a 100 MB
    // file on a 1 Mbit link.
    xhr.timeout = timeoutMs;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () =>
      resolve({ kind: "http", status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => resolve({ kind: "network" });
    xhr.ontimeout = () => resolve({ kind: "timeout" });
    xhr.onabort = () => resolve({ kind: "aborted" });
    if (signal) {
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(formData);
  });
}

// Upload variant that reports byte-level progress via XHR (fetch can't), so
// the composer can show a real upload percentage. Same endpoint/shape as
// ``uploadDocument``.
//
// Two reliability behaviours live here so the UI doesn't have to know:
//   1. **401 auto-refresh** — the in-memory access token expires after
//      ~15 min, and a raw XHR can't use ``apiFetch``'s auto-refresh. On 401
//      we mint a fresh token via the httpOnly refresh cookie and retry once.
//   2. **Transient-failure retry** — large uploads (15–100 MB) routinely
//      hit a network blip, a server hiccup (502/503/504), or a proxy that
//      drops a long-running connection. We retry up to 2 times with
//      exponential backoff (1.5 s, then 4 s); 4xx errors (other than 401)
//      and 2xx are never retried. The progress bar resets to 0 on retry so
//      the user sees the new attempt starting.
export async function uploadDocumentWithProgress(
  file: File,
  sessionId: string | null,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<UploadResponse> {
  const TIMEOUT_MS = 10 * 60 * 1000;
  const url = `${BACKEND_URL}/upload`;
  const build = () => {
    const fd = new FormData();
    fd.append("file", file);
    if (sessionId) fd.append("session_id", sessionId);
    return fd;
  };

  let lastDetail = "Upload failed";
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (signal?.aborted) throw new UploadAbortError();
    if (attempt > 1) {
      onProgress(0); // visible "starting over" signal for the chip
      await new Promise((r) => setTimeout(r, attempt === 2 ? 1500 : 4000));
      if (signal?.aborted) throw new UploadAbortError();
    }

    let res = await _uploadXhrOnce(
      url, build(), getAccessToken(), onProgress, TIMEOUT_MS, signal,
    );
    if (res.kind === "http" && res.status === 401) {
      // Access token stale → mint a fresh one from the refresh cookie and retry.
      const fresh = await bootstrapAuth();
      if (fresh) {
        res = await _uploadXhrOnce(
          url, build(), fresh, onProgress, TIMEOUT_MS, signal,
        );
      }
    }

    if (res.kind === "aborted") throw new UploadAbortError();

    if (res.kind === "http" && res.status >= 200 && res.status < 300) {
      try {
        return JSON.parse(res.text) as UploadResponse;
      } catch {
        throw new Error("Malformed upload response");
      }
    }

    if (res.kind === "http") {
      lastDetail = `Upload failed: ${res.status}`;
      try {
        lastDetail =
          (JSON.parse(res.text) as { detail?: string }).detail || lastDetail;
      } catch {
        /* keep status-line fallback */
      }
      // Only retry transient server errors. 4xx is the user's / file's
      // fault (size cap, unsupported type, auth, …) — retrying won't help.
      if (res.status < 500) throw new Error(lastDetail);
    } else if (res.kind === "timeout") {
      lastDetail = "Upload timed out — network too slow or server unresponsive";
    } else {
      lastDetail = "Network error during upload — check your connection";
    }
  }
  throw new Error(lastDetail);
}

export async function analyzeContract(sessionId: string): Promise<AnalyzeResponse> {
  const res = await apiFetch(`${BACKEND_URL}/analyze-contract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || `Analysis failed: ${res.status}`);
  }

  return res.json();
}

// ── SSE streaming companion to /query (Day-2 strategy doc) ─────────────────
//
// Backend ``POST /query/stream`` wire format:
//
//   event: token
//   data: {"delta": "<piece of the answer>"}
//
//   ... more token events ...
//
//   event: complete
//   data: {answer, chunks[], citation_validation, timings, tokens,
//          session_id, mode}
//
// On transport / model error the server emits:
//
//   event: error
//   data: {"detail": "<reason>"}
//
// The frontend consumes via ``fetch + ReadableStream`` (NOT EventSource —
// EventSource does not support POST bodies). Each ``token`` event grows
// the current assistant bubble's text; the ``complete`` event replaces
// it with the validated answer + chunks so CitationChip can render.

export interface QueryStreamHandlers {
  /** Fires on every ``event: token``. ``delta`` is the new fragment. */
  onToken: (delta: string) => void;
  /**
   * Fires once on ``event: complete``. ``payload`` is the same shape
   * the non-streaming :func:`queryRAG` returns (modulo ``citation_validation``
   * already populated when applicable).
   */
  onComplete: (payload: RAGResponse) => void;
  /** Fires on ``event: error`` and on transport / parsing failures. */
  onError: (message: string) => void;
  /**
   * Fires on ``event: status`` — emitted by the backend while a doc-scoped
   * turn waits for the just-uploaded document to finish OCR/ingestion. The
   * message carries live page progress ("Dokument wird verarbeitet… Seite
   * X/Y"). Lets the UI show a clean "processing…" state instead of the raw
   * placeholder token the backend also streams as a heartbeat.
   */
  onStatus?: (message: string) => void;
  /**
   * Fires once when the caller aborts the stream via the returned
   * ``AbortController`` (the Stop button). Distinct from ``onError`` so the
   * UI can finalise the partial answer cleanly — keeping whatever streamed
   * so far — instead of replacing it with an error bubble. Optional: callers
   * that never abort (or don't care) can omit it.
   */
  onAbort?: () => void;
}

/**
 * Open an SSE stream against ``POST /query/stream`` and dispatch events
 * to the supplied handlers. Returns an ``AbortController`` the caller
 * can use to cancel mid-stream (e.g. on component unmount).
 *
 * Errors and the terminal ``complete`` event are both handled; the
 * caller must not assume ``onComplete`` will always fire — pair it
 * with ``onError`` for the failure path.
 */
export function streamQuery(
  question: string,
  sessionId: string | null,
  handlers: QueryStreamHandlers,
  targetLanguage: Language | null = null,
  focusDocIndexes: number[] | null = null,
): AbortController {
  const controller = new AbortController();

  // ── Stall watchdog ──────────────────────────────────────────────────
  // Without this, ANY stall — a connection that never opens, a backend
  // that accepts the request then goes quiet, a flaky SSH tunnel — leaves
  // the UI "thinking" forever with no error to act on. We arm a timer
  // before the fetch and re-arm it on every token; if WATCHDOG_MS passes
  // with no activity we abort and surface an actionable error instead of
  // an eternal spinner. ``settled`` guarantees no terminal handler fires
  // twice (e.g. a late frame arriving after the watchdog already aborted).
  const WATCHDOG_MS = 60_000;
  let settled = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const clearWatchdog = () => {
    if (watchdog !== undefined) clearTimeout(watchdog);
    watchdog = undefined;
  };
  const armWatchdog = () => {
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      handlers.onError(
        "The server didn't respond (no data for 60s). It may be busy or starting up — please try again.",
      );
    }, WATCHDOG_MS);
  };
  // Wrap the caller's handlers so the watchdog is fed on every token and
  // cleared on the terminal event, and so a stale post-abort frame is
  // ignored once we've settled.
  const safe: QueryStreamHandlers = {
    onToken: (delta) => {
      if (settled) return;
      armWatchdog();
      handlers.onToken(delta);
    },
    onComplete: (payload) => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      handlers.onComplete(payload);
    },
    onError: (detail) => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      handlers.onError(detail);
    },
    onAbort: () => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      handlers.onAbort?.();
    },
    onStatus: (message) => {
      if (settled) return;
      // A status frame is real activity (the backend's ingestion heartbeat),
      // so it re-arms the stall watchdog just like a token.
      armWatchdog();
      handlers.onStatus?.(message);
    },
  };

  // Same forward-compat omission rule as :func:`queryRAG` — only send
  // ``target_language`` when set, so older backends that don't yet
  // accept the field don't 422 on a literal null.
  const body: Record<string, unknown> = { question, session_id: sessionId };
  if (targetLanguage) body.target_language = targetLanguage;
  // Per-turn focus: when the composer just attached one or more docs,
  // their server-assigned doc_index values arrive here. Sending them
  // scopes the manifest + retrieval + validator-allowed handles to
  // ONLY those docs so the model can't pull in the rest of the matter.
  if (focusDocIndexes && focusDocIndexes.length > 0) {
    body.focus_doc_indexes = focusDocIndexes;
  }

  // Fire-and-forget — the returned controller is for cancellation.
  (async () => {
    armWatchdog();
    let res: Response;
    try {
      res = await apiFetch(`${BACKEND_URL}/query/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        credentials: "include",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        safe.onAbort?.();
      } else {
        safe.onError((e as Error).message || "network error");
      }
      return;
    }

    if (!res.ok || !res.body) {
      let detail = `Server error: ${res.status}`;
      try {
        const j = await res.json();
        detail = (j as { detail?: string }).detail || detail;
      } catch {
        // ignore — keep the status-line fallback
      }
      safe.onError(detail);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by ``\n\n``. Process complete
        // frames out of the buffer; the trailing partial frame stays
        // in ``buffer`` for the next read.
        let frameEnd = buffer.indexOf("\n\n");
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          parseFrame(frame, safe);
          frameEnd = buffer.indexOf("\n\n");
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        safe.onAbort?.();
      } else {
        safe.onError((e as Error).message || "stream interrupted");
      }
    } finally {
      // A clean close (``done``) without a terminal ``complete`` event
      // would otherwise leave the watchdog armed to fire a spurious error
      // 60s later. Disarm it here; the backend always sends ``complete``,
      // so reaching this with !settled means the stream just ended quietly.
      if (!settled) clearWatchdog();
    }
  })();

  return controller;
}

function parseFrame(frame: string, handlers: QueryStreamHandlers): void {
  // One frame is several ``key: value`` lines, the relevant ones being
  // ``event:`` and ``data:``. Lines starting with `:` are comments.
  let event = "message";
  let dataStr = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      // Per the SSE spec, multiline ``data:`` lines are joined with
      // newlines; in practice the backend always emits one ``data:``
      // line per frame.
      dataStr += (dataStr ? "\n" : "") + line.slice(5).trim();
    }
  }
  if (!dataStr) return;

  let data: unknown;
  try {
    data = JSON.parse(dataStr);
  } catch {
    handlers.onError(`malformed SSE payload: ${dataStr.slice(0, 200)}`);
    return;
  }

  if (event === "token") {
    const delta = (data as { delta?: string }).delta;
    if (typeof delta === "string") handlers.onToken(delta);
    return;
  }
  if (event === "complete") {
    handlers.onComplete(data as RAGResponse);
    return;
  }
  if (event === "error") {
    const detail = (data as { detail?: string }).detail || "unknown error";
    handlers.onError(detail);
    return;
  }
  if (event === "status") {
    const message = (data as { message?: string }).message;
    if (typeof message === "string") handlers.onStatus?.(message);
    return;
  }
  // Unknown event — silently ignore. Forward-compat: future server
  // versions may add ``event: progress`` etc.
}


export async function checkHealth(): Promise<boolean> {
  try {
    const res = await apiFetch(`${BACKEND_URL}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

// Full /health payload — the boolean ``checkHealth()`` above is kept for
// callers that only care "is the backend up?". UI boot needs the richer
// ``loaded`` flag to distinguish "cold-start, still warming the corpus"
// (show splash, keep polling) from "ready" (let the app render).
//
// Shape matches the backend at ``serve_rag.py:1234``:
//   { ok: true, loaded: bool, llm_backend: "remote"|"local",
//     llm_model: string|null, n_sessions: number }
export interface HealthStatus {
  ok: boolean;
  loaded: boolean;
  llm_backend?: "remote" | "local";
  llm_model?: string | null;
  n_sessions?: number;
}

// Distinguished result so the UI can render different states:
//   - ``reachable: true, loaded: false`` → cold-start splash
//   - ``reachable: true, loaded: true``  → app ready
//   - ``reachable: false``               → offline blocking screen
export type HealthProbe =
  | { reachable: true; status: HealthStatus }
  | { reachable: false };

export async function fetchHealth(): Promise<HealthProbe> {
  // DEMO MODE: real /health probe disabled — the boot gate always reports
  // ready so the dashboard is reachable without a live backend. To restore
  // the real cold-start/offline gate, uncomment the block below and remove
  // the mocked return underneath it.
  //
  // try {
  //   const res = await apiFetch(`${BACKEND_URL}/health`, {
  //     method: "GET",
  //     signal,
  //   });
  //   if (!res.ok) return { reachable: false };
  //   const status = (await res.json()) as HealthStatus;
  //   return { reachable: true, status };
  // } catch {
  //   return { reachable: false };
  // }

  return {
    reachable: true,
    status: { ok: true, loaded: true, llm_backend: "remote", llm_model: "demo-model", n_sessions: 0 },
  };
}


// ── Document streaming for [M-n] citation preview ─────────────────────────
//
// The backend serves the raw uploaded document bytes at
//   GET /sessions/{session_id}/document
// with an ``inline`` Content-Disposition + the correct media type. The
// frontend fetches it as a blob, wraps in ``URL.createObjectURL``, and
// hands that URL to the ``<object>`` tag in CitationPanel — the
// browser's native PDF viewer renders it without pulling in pdfjs.

/** Result of trying to load a session document. */
export type SessionDocumentResult =
  | { ok: true; objectUrl: string; mediaType: string; filename: string | null }
  | { ok: false; reason: "not-attached" | "missing-file" | "unreachable" };

/**
 * Fetch the uploaded document bytes for a session and return an Object
 * URL the caller can hand to ``<object data={url} />`` or revoke when
 * the panel closes. Callers MUST revoke the URL on unmount via
 * ``URL.revokeObjectURL`` to avoid leaking memory.
 *
 * The function distinguishes three failure modes so the UI can render
 * a different message for each:
 *   - ``not-attached``: chat-only session, no upload ever happened
 *   - ``missing-file``: row says there was an upload but the file is gone
 *   - ``unreachable``: backend hiccup; transient
 */
export async function fetchSessionDocument(sessionId: string): Promise<SessionDocumentResult> {
  try {
    const res = await apiFetch(`${BACKEND_URL}/sessions/${sessionId}/document`, {
      credentials: "include",
    });
    if (res.status === 404) {
      // Parse the detail message to distinguish "no upload yet" from
      // "file gone." Backend uses two different strings.
      let detail = "";
      try {
        const j = await res.json();
        detail = String(j?.detail || "");
      } catch {
        // ignore — fall through to "missing-file" default
      }
      return {
        ok: false,
        reason: detail.includes("no document attached") ? "not-attached" : "missing-file",
      };
    }
    if (!res.ok) return { ok: false, reason: "unreachable" };

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    // Parse the filename out of Content-Disposition if present. The
    // backend writes ``inline; filename="..."`` — extract for display.
    const disposition = res.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const filename = filenameMatch ? filenameMatch[1] : null;

    return {
      ok: true,
      objectUrl,
      mediaType: res.headers.get("Content-Type") || blob.type || "application/octet-stream",
      filename,
    };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}


// ── Matter documents (multiple PDFs per session = a "Matter") ────────────
//
// A session/matter holds many uploaded documents, each addressable as a
// [M-n] citation handle. ``listMatterDocuments`` backs the workspace
// Documents tab; ``fetchMatterDocument`` previews a specific [M-n].

export type MatterDocStatus = "queued" | "processing" | "done" | "failed";

export interface MatterDocument {
  doc_index: number;   // the n in [M-n]
  cite_id: string;     // "M-1", "M-2", …
  filename: string;
  n_pages: number;
  created_at: number;
  // Async-ingestion status for the live progress UI. Older backends omit
  // these → default to a finished ("done") document.
  status: MatterDocStatus;
  pages_done: number;
  pages_total: number;
  n_chunks: number;
  error: string | null;
}

/** All documents attached to a matter, ordered by [M-n]. Empty on error. */
export async function listMatterDocuments(sessionId: string): Promise<MatterDocument[]> {
  try {
    const res = await apiFetch(`${BACKEND_URL}/sessions/${sessionId}/documents`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { documents: MatterDocument[] };
    return body.documents ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch one matter document's bytes by its [M-n] index — the
 * multi-document companion to ``fetchSessionDocument``. Same Object-URL
 * contract: the caller MUST revoke the URL on unmount.
 */
export async function fetchMatterDocument(
  sessionId: string,
  docIndex: number,
): Promise<SessionDocumentResult> {
  try {
    const res = await apiFetch(
      `${BACKEND_URL}/sessions/${sessionId}/documents/${docIndex}`,
      { credentials: "include" },
    );
    if (res.status === 404) {
      let detail = "";
      try {
        const j = await res.json();
        detail = String(j?.detail || "");
      } catch {
        // ignore
      }
      return {
        ok: false,
        reason: detail.includes("no longer available") ? "missing-file" : "not-attached",
      };
    }
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const disposition = res.headers.get("Content-Disposition") || "";
    const m = disposition.match(/filename="([^"]+)"/);
    return {
      ok: true,
      objectUrl,
      mediaType: res.headers.get("Content-Type") || blob.type || "application/octet-stream",
      filename: m ? m[1] : null,
    };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}


// ── Session rehydration (persistence across UI refreshes) ────────────────

export interface PersistedMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  mode: string | null;
  created_at: number;
  // Citation sources behind an assistant answer, persisted so the
  // citation panel still resolves [M-n]/[C-n] handles after the
  // conversation is reloaded from the server. Empty for user turns and
  // for assistant turns saved before this field existed.
  chunks?: Chunk[];
}

export interface SessionDetail {
  session_id: string;
  filename: string | null;
  n_pages: number;
  uploaded_at: number | null;
  has_analysis: boolean;
  analyzer_version: string | null;
  messages: PersistedMessage[];
}

export interface SessionSummary {
  id: string;
  title: string;                 // always non-null — backend COALESCE chain
  user_title: string | null;     // what the user explicitly set, or null
  filename: string | null;
  n_pages: number;
  uploaded_at: number;
  updated_at: number;
  has_analysis: boolean;
  n_messages: number;
}

// Distinguished result so the caller can tell "session is truly gone (404)"
// from "couldn't reach the backend right now" — only the former should
// invalidate cached state in the UI.
export type SessionFetchResult =
  | { ok: true; session: SessionDetail }
  | { ok: false; reason: "not-found" | "unreachable" };

export async function getSession(sessionId: string): Promise<SessionFetchResult> {
  try {
    const res = await apiFetch(`${BACKEND_URL}/sessions/${sessionId}`);
    if (res.status === 404) return { ok: false, reason: "not-found" };
    if (!res.ok) return { ok: false, reason: "unreachable" };
    return { ok: true, session: await res.json() };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

export async function listSessions(limit = 50): Promise<SessionSummary[]> {
  try {
    const res = await apiFetch(`${BACKEND_URL}/sessions?limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.sessions || [];
  } catch {
    return [];
  }
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${BACKEND_URL}/sessions/${sessionId}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// Append a message bubble to a session so refresh-replay sees it.
// Used for UI-rendered bubbles (upload confirmation, analyze output)
// that the backend doesn't auto-persist via /query.
export async function appendMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  mode?: string,
): Promise<boolean> {
  if (!content.trim()) return false;
  try {
    const res = await apiFetch(`${BACKEND_URL}/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content, mode: mode ?? null }),
    });
    return res.ok;
  } catch {
    return false;
  }
}


// ── Live analyze progress ─────────────────────────────────────────────────

export interface AnalyzeProgress {
  status: "idle" | "running" | "done" | "error";
  step?: string;       // e.g. "analyzing_clause", "whole_contract", "done"
  current?: number;
  total?: number;
  elapsed_s?: number;
  percent?: number;    // 0.0 .. 1.0
  error?: string;
  session_id?: string;
}

export async function getAnalyzeProgress(sessionId: string): Promise<AnalyzeProgress> {
  try {
    const res = await apiFetch(
      `${BACKEND_URL}/analyze-contract/progress?session_id=${encodeURIComponent(sessionId)}`,
    );
    if (!res.ok) return { status: "idle" };
    return await res.json();
  } catch {
    return { status: "idle" };
  }
}

export async function renameSession(sessionId: string, title: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${BACKEND_URL}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    return res.ok;
  } catch {
    return false;
  }
}


// ── Lawyer feedback (POST /feedback) ─────────────────────────────────────────
//
// Captures the lawyer's verdict on an assistant bubble. The backend
// upserts on ``(user_id, session_id, message_id)`` so re-submitting
// toggles in place; the UI relies on that to let the user flip
// thumbs-up → thumbs-down without leaving stale rows behind.

// Closed-enum reason tags accepted by the backend's POST /feedback.
// Keep this in sync with ``_FEEDBACK_REASONS`` in serve_rag.py — a
// typo here surfaces as a 400 from the backend.
export type FeedbackReason =
  | "wrong-citation"
  | "wrong-jurisdiction"
  | "hallucination"
  | "incomplete"
  | "tone"
  | "other";

export interface FeedbackPayload {
  sessionId: string;
  /** Optional message id from ``GET /sessions/:id/messages``. Omit for
   *  session-level feedback ("the whole chat was wrong"). */
  messageId?: number | null;
  /** ``1`` = thumbs-up, ``-1`` = thumbs-down. */
  rating: 1 | -1;
  reason?: FeedbackReason | null;
  comment?: string | null;
}

export interface FeedbackRecord {
  id: number;
  session_id: string;
  message_id: number | null;
  user_id: string;
  rating: number;
  reason: string | null;
  comment: string | null;
  created_at: number;
}

/**
 * Submit a thumbs-up/down (and optional reason + free-text comment).
 * Returns the new feedback row id, or ``null`` on transport / 4xx
 * error — the UI uses a non-null id as the "saved" indicator.
 */
export async function submitFeedback(payload: FeedbackPayload): Promise<number | null> {
  if (payload.comment && payload.comment.length > 2048) {
    // Mirror the backend cap — clip on the client so the user sees
    // their full submission go through instead of a 400.
    payload = { ...payload, comment: payload.comment.slice(0, 2048) };
  }
  try {
    const res = await apiFetch(`${BACKEND_URL}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        session_id: payload.sessionId,
        message_id: payload.messageId ?? null,
        rating: payload.rating,
        reason: payload.reason ?? null,
        comment: payload.comment ?? null,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok: boolean; id: number };
    return body.ok ? body.id : null;
  } catch {
    return null;
  }
}

/**
 * All feedback rows the calling user has left on a session. The
 * frontend uses this on session-load to re-paint the persisted
 * thumbs-up/down state under each assistant bubble.
 */
export async function listSessionFeedback(sessionId: string): Promise<FeedbackRecord[]> {
  try {
    const res = await apiFetch(`${BACKEND_URL}/sessions/${sessionId}/feedback`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { feedback: FeedbackRecord[] };
    return body.feedback ?? [];
  } catch {
    return [];
  }
}