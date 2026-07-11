// src/react-app/lib/adminApi.ts
//
// Client for the Phase C admin endpoints (MULTIUSER_PLAN §10.4):
//
//   GET    /admin/orgs                          — list orgs visible to caller
//   POST   /admin/orgs                          — create org (super_admin)
//   PATCH  /admin/orgs/{id}                     — rename org (super_admin)
//   GET    /admin/orgs/{id}/members             — list members
//   POST   /admin/orgs/{id}/members             — add member
//   DELETE /admin/orgs/{id}/members/{user_id}   — remove member
//   PATCH  /admin/orgs/{id}/members/{user_id}   — change role within org
//   GET    /admin/users/search?q=&limit=        — pg_trgm typeahead
//
// Authorization is enforced server-side; this client just shapes payloads
// and parses responses. Throws a typed AdminApiError on non-2xx so the
// page can surface server messages (e.g. "user already belongs to another
// organisation") verbatim.

import { apiFetch } from "@/react-app/auth/apiFetch";

export interface OrgSummary {
  id: string;
  name: string;
  status: "active" | "disabled";
  member_count: number;
}

export interface Member {
  id: string;
  email: string;
  full_name: string;
  company: string | null;
  role: "user" | "admin" | "super_admin";
  org_id: string | null;
}

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = "AdminApiError";
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { detail?: string };
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    /* non-JSON error body; keep statusText */
  }
  throw new AdminApiError(res.status, detail);
}

// ── Organisations ───────────────────────────────────────────────────────────

export async function listOrgs(): Promise<OrgSummary[]> {
  const res = await apiFetch(`/admin/orgs`, {
    credentials: "include",
  });
  return jsonOrThrow<OrgSummary[]>(res);
}

export async function createOrg(name: string): Promise<OrgSummary> {
  const res = await apiFetch(`/admin/orgs`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return jsonOrThrow<OrgSummary>(res);
}

export async function renameOrg(
  orgId: string,
  name: string,
): Promise<OrgSummary> {
  const res = await apiFetch(`/admin/orgs/${orgId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return jsonOrThrow<OrgSummary>(res);
}

// ── Members ─────────────────────────────────────────────────────────────────

export async function listMembers(orgId: string): Promise<Member[]> {
  const res = await apiFetch(`/admin/orgs/${orgId}/members`, {
    credentials: "include",
  });
  return jsonOrThrow<Member[]>(res);
}

export async function addMember(
  orgId: string,
  userId: string,
  role: "user" | "admin" = "user",
): Promise<Member> {
  const res = await apiFetch(`/admin/orgs/${orgId}/members`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, role }),
  });
  return jsonOrThrow<Member>(res);
}

export async function removeMember(
  orgId: string,
  userId: string,
): Promise<void> {
  const res = await apiFetch(
    `/admin/orgs/${orgId}/members/${userId}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok && res.status !== 204) {
    await jsonOrThrow<unknown>(res); // throws AdminApiError
  }
}

export async function setMemberRole(
  orgId: string,
  userId: string,
  role: "user" | "admin" | "super_admin",
): Promise<Member> {
  const res = await apiFetch(
    `/admin/orgs/${orgId}/members/${userId}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    },
  );
  return jsonOrThrow<Member>(res);
}

// ── User search (trigram typeahead) ─────────────────────────────────────────

export async function searchUsers(
  q: string,
  limit = 20,
): Promise<Member[]> {
  if (q.trim().length < 2) return [];
  const params = new URLSearchParams({ q: q.trim(), limit: String(limit) });
  const res = await apiFetch(
    `/admin/users/search?${params.toString()}`,
    { credentials: "include" },
  );
  return jsonOrThrow<Member[]>(res);
}

// ── Invitations (Phase C.1) ─────────────────────────────────────────────────

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role: "user" | "admin";
  invited_by: string | null;
  expires_at: string;
  created_at: string;
}

export async function createInvite(
  orgId: string,
  email: string,
  role: "user" | "admin" = "user",
): Promise<Invitation> {
  const res = await apiFetch(`/admin/orgs/${orgId}/invites`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  return jsonOrThrow<Invitation>(res);
}

export async function listInvites(orgId: string): Promise<Invitation[]> {
  const res = await apiFetch(`/admin/orgs/${orgId}/invites`, {
    credentials: "include",
  });
  return jsonOrThrow<Invitation[]>(res);
}

export async function revokeInvite(
  orgId: string,
  inviteId: string,
): Promise<void> {
  const res = await apiFetch(`/admin/orgs/${orgId}/invites/${inviteId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    await jsonOrThrow<unknown>(res); // throws AdminApiError
  }
}

// Public invitation preview — no auth, token IS the auth. Drives the "you're
// invited to «Firm»" header on the accept-invite page.
export interface InvitePreview {
  email: string;
  role: "user" | "admin";
  org_id: string;
  org_name: string;
  expires_at: string;
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  const params = new URLSearchParams({ token });
  const res = await apiFetch(`/auth/invite?${params.toString()}`, {
    credentials: "include",
  });
  return jsonOrThrow<InvitePreview>(res);
}
