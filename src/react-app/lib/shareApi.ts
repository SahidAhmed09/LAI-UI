// src/react-app/lib/shareApi.ts
//
// Client for the Path A Step 2 share endpoints. Three shareable resource
// types — chat sessions (serve_rag), DDiQ reports (DDiQ), DDiQ documents
// (DDiQ) — get the same three operations: list, add, revoke. Plus a
// share-target typeahead scoped to the caller's own org.
//
// v1 semantics: shares grant READ access only. The owner can still edit /
// delete; the recipient is a viewer.

import { apiFetch } from "@/react-app/auth/apiFetch";

// Resolved at runtime from the same env the rest of the SPA uses — through
// the Vite proxy in dev (/rag → :18000, /ddiqsvc → :18001).
const RAG_BASE =
  import.meta.env.VITE_BACKEND_URL || "http://192.168.178.82:18000";
const DDIQ_BASE =
  import.meta.env.VITE_DDIQ_URL ||
  (import.meta.env.VITE_BACKEND_URL || "http://192.168.178.82:18001").replace(
    /:(?:\d+)$/,
    ":18001",
  );

export interface ShareUser {
  user_id: string;
  email: string;
  full_name: string;
  granted_at: number | string;  // SQLite returns a UNIX float; Postgres returns ISO.
}

export interface ShareTarget {
  id: string;
  email: string;
  full_name: string;
}

export class ShareApiError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(detail);
    this.name = "ShareApiError";
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  }
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { detail?: string };
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    /* non-JSON body */
  }
  throw new ShareApiError(res.status, detail);
}

// ── Chat session shares (serve_rag) ────────────────────────────────────────

export async function listSessionShares(sessionId: string): Promise<ShareUser[]> {
  const res = await apiFetch(`${RAG_BASE}/sessions/${sessionId}/shares`, {
    credentials: "include",
  });
  return jsonOrThrow<ShareUser[]>(res);
}

export async function addSessionShare(
  sessionId: string,
  userId: string,
): Promise<ShareUser> {
  const res = await apiFetch(`${RAG_BASE}/sessions/${sessionId}/shares`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  return jsonOrThrow<ShareUser>(res);
}

export async function revokeSessionShare(
  sessionId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    `${RAG_BASE}/sessions/${sessionId}/shares/${userId}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok && res.status !== 204) await jsonOrThrow<unknown>(res);
}

// ── DDiQ report shares ─────────────────────────────────────────────────────

export async function listReportShares(reportId: string): Promise<ShareUser[]> {
  const res = await apiFetch(`${DDIQ_BASE}/ddiq/reports/${reportId}/shares`, {
    credentials: "include",
  });
  return jsonOrThrow<ShareUser[]>(res);
}

export async function addReportShare(
  reportId: string,
  userId: string,
): Promise<ShareUser> {
  const res = await apiFetch(`${DDIQ_BASE}/ddiq/reports/${reportId}/shares`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  return jsonOrThrow<ShareUser>(res);
}

export async function revokeReportShare(
  reportId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    `${DDIQ_BASE}/ddiq/reports/${reportId}/shares/${userId}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok && res.status !== 204) await jsonOrThrow<unknown>(res);
}

// ── DDiQ document shares ───────────────────────────────────────────────────

export async function listDocumentShares(
  documentId: string,
): Promise<ShareUser[]> {
  const res = await apiFetch(
    `${DDIQ_BASE}/ddiq/documents/${documentId}/shares`,
    { credentials: "include" },
  );
  return jsonOrThrow<ShareUser[]>(res);
}

export async function addDocumentShare(
  documentId: string,
  userId: string,
): Promise<ShareUser> {
  const res = await apiFetch(
    `${DDIQ_BASE}/ddiq/documents/${documentId}/shares`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    },
  );
  return jsonOrThrow<ShareUser>(res);
}

export async function revokeDocumentShare(
  documentId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    `${DDIQ_BASE}/ddiq/documents/${documentId}/shares/${userId}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok && res.status !== 204) await jsonOrThrow<unknown>(res);
}

// ── Share-target typeahead (serve_rag — same-org members only) ─────────────

export async function searchShareTargets(
  q: string,
  opts: { excludeSessionId?: string; limit?: number } = {},
): Promise<ShareTarget[]> {
  if (q.trim().length < 2) return [];
  const params = new URLSearchParams({
    q: q.trim(),
    limit: String(opts.limit ?? 10),
  });
  if (opts.excludeSessionId) {
    params.set("exclude_session_id", opts.excludeSessionId);
  }
  const res = await apiFetch(
    `${RAG_BASE}/share-targets/search?${params.toString()}`,
    { credentials: "include" },
  );
  return jsonOrThrow<ShareTarget[]>(res);
}

// ── Resource-type dispatch (used by the generic ShareDialog component) ─────

export type ShareResourceType = "session" | "report" | "document";

export interface ShareApi {
  list: (id: string) => Promise<ShareUser[]>;
  add: (id: string, userId: string) => Promise<ShareUser>;
  revoke: (id: string, userId: string) => Promise<void>;
}

/** Resolve the share API for a given resource type. */
export function shareApiFor(type: ShareResourceType): ShareApi {
  switch (type) {
    case "session":
      return { list: listSessionShares, add: addSessionShare, revoke: revokeSessionShare };
    case "report":
      return { list: listReportShares, add: addReportShare, revoke: revokeReportShare };
    case "document":
      return { list: listDocumentShares, add: addDocumentShare, revoke: revokeDocumentShare };
  }
}
