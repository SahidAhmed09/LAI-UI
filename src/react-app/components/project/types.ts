import type {
  Chunk,
  CitationValidation,
  JurisdictionWarning,
} from "@/react-app/lib/ragApi";

export interface ProjectFile {
  id: string;
  name: string;
  size: number;
  uploadDate: string;
  type: string;
  lines?: number;
  // Backend ingestion lifecycle for a file added in the project's file
  // section. "uploading" while the POST /upload is in flight, "ready" once
  // the document is indexed into the project's matter session, "error" if
  // the upload failed. Undefined for legacy/seed files that predate uploads.
  status?: "uploading" | "ready" | "error";
  error?: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  // The raw File handle, present only for the live turn that uploaded it.
  // Transient — never survives a localStorage round-trip, so persisted
  // attachments carry metadata only (name/size/type) for re-display.
  file?: File;
  // Upload-on-attach lifecycle (Claude-style): the file uploads to the matter
  // session the moment it's attached, not on send.
  //   uploading  → POST in flight
  //   processing → uploaded, backend OCR/chunk/embed still running
  //   done       → fully parsed + searchable (green check)
  //   error      → upload failed
  // ``uploaded`` flips true once the POST succeeds so the send path knows NOT
  // to upload again; undefined on a rehydrated attachment (send uploads it as
  // a fallback).
  uploadStatus?: "uploading" | "processing" | "done" | "error";
  uploaded?: boolean;
  uploadError?: string;
  // 0–100 byte-upload progress while ``uploadStatus === "uploading"`` (from
  // the XHR upload's progress events). Undefined once the POST completes.
  uploadProgress?: number;
  // 0–100 backend ingestion progress while ``uploadStatus === "processing"``.
  // The hook fuses two signals: real ``pages_done / pages_total`` from the
  // matter-documents poll (whenever the backend has reported a page), AND a
  // size-keyed client-side estimator (so the ring keeps ticking smoothly
  // between polls and during the brief stretch before the first page lands).
  // The shown value is the MAX of the two — the backend always wins if it's
  // ahead, the estimator only fills the gaps.
  processingProgress?: number;
  /** Wall-clock when we entered the processing phase (anchors the estimator). */
  processingStartedAt?: number;
  /** Estimated total processing duration (ms) from a size-based heuristic. */
  processingEstimatedMs?: number;
  // Server-assigned 1-based slot inside the session ([M-n]). Captured from the
  // upload response so the chat composer can send it back in
  // ``focus_doc_indexes`` on the next turn — that scopes the manifest,
  // retrieval and validator-allowed handles to ONLY the docs the user just
  // attached, so the model can't silently pull in other matter documents
  // when the user asks "analyse this document".
  docIndex?: number;
}

export interface ChatMessage {
  id: string;
  message: string;
  sender: "user" | "assistant";
  timestamp: string;
  attachments?: ChatAttachment[];
  // True while an assistant answer is still streaming in from the backend.
  // An empty + streaming assistant bubble renders the typing indicator;
  // a non-empty + streaming bubble renders the partial markdown.
  streaming?: boolean;
  // Set on a failed turn so the bubble can render an error affordance.
  error?: boolean;
  // Live "document still ingesting" progress from the backend's status
  // events, shown as a clean processing indicator while a doc-scoped turn
  // waits for OCR/indexing. Cleared once the real answer streams.
  processingNote?: string;
  // Citation sources ([C-n]/[M-n]) returned with the answer on the SSE
  // ``complete`` event. Drives clickable CitationChips + the CitationPanel,
  // exactly as the normal-chat ChatMessageData does. Absent while streaming
  // (partial handles must not resolve) and on chat-only turns.
  chunks?: Chunk[];
  // Citation-validator summary (fabricated handles + count of
  // "(unbelegt)"-rewritten sentences). Drives the quality-row badge above the
  // bubble — identical to the normal chat. Null on chat-only turns.
  citationValidation?: CitationValidation | null;
  // Jurisdiction-sanity warnings (a rule cited for the wrong Bundesland).
  // Drives the amber jurisdiction chip in the quality row, same as normal chat.
  jurisdictionWarnings?: JurisdictionWarning[];
  // ``messages.id`` of the persisted assistant row — scopes feedback to this
  // specific bubble (matches normal chat). Null when not persisted.
  messageId?: number | null;
  // Thumbs up/down verdict for an assistant turn (optimistic; also sent to
  // the backend at session level). Matches the normal chat's feedback.
  feedback?: 1 | -1 | null;
}

export interface ProjectConversation {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: string;
  messages: ChatMessage[];
  // Backend RAG session id. Null until the first query of this conversation
  // returns one; thereafter every turn reuses it so the backend keeps the
  // chat history + any uploaded matter documents grounded to this thread.
  sessionId?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: "active" | "completed" | "archived";
  owner: string;
  createdDate: string;
  files: ProjectFile[];
  teamMembers: number;
  conversations: ProjectConversation[];
  // User-pinned ("starred") project — surfaced first in the grid.
  favorite?: boolean;
  // The project's backend RAG "matter" session. Documents added in the file
  // section are uploaded here, and EVERY conversation in the project queries
  // this session — that's what lets the chat actually read files dropped in
  // the file section. Null until the first upload (or first chat) mints one.
  sessionId?: string | null;
}
