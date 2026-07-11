// src/react-app/pages/DashboardAdmin.tsx
//
// Phase C admin panel (MULTIUSER_PLAN §7, §10.4). Single page, two sections:
//
//   1) Organisations (super-admin only) — list every firm with member count,
//      create a new firm, select one to manage.
//   2) Members of the selected org — list members with their role, change
//      role, remove, and add new members via a trigram typeahead.
//
// A firm admin sees only their own org pre-selected; the org list / create
// affordance is hidden. A super-admin sees the org list, can create new orgs,
// and can drill into any org's membership. Authorisation is enforced server-
// side; this page just shapes the UX.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import { Label } from "@/react-app/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/react-app/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/react-app/components/ui/dropdown-menu";
import { Loader2, Plus, Search, Shield, Trash2, Users } from "lucide-react";

import { useAuth } from "@/react-app/auth/useAuth";
import { cn } from "@/react-app/lib/utils";
import {
  AdminApiError,
  type Invitation,
  type Member,
  type OrgSummary,
  addMember,
  createInvite,
  createOrg,
  listInvites,
  listMembers,
  listOrgs,
  removeMember,
  revokeInvite,
  searchUsers,
  setMemberRole,
} from "@/react-app/lib/adminApi";

// Lightweight email validity check used to decide when to surface the
// "Invite by email" affordance. We let the backend's EmailStr do the real
// validation; this is purely a UI heuristic.
const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function looksLikeEmail(s: string): boolean {
  return _EMAIL_RE.test(s.trim());
}

function roleLabel(role: Member["role"]): string {
  if (role === "super_admin") return "Super-Admin";
  if (role === "admin") return "Firm-Admin";
  return "Member";
}

function roleBadgeClass(role: Member["role"]): string {
  if (role === "super_admin")
    return "bg-violet-500/10 text-violet-700 border-violet-500/30 dark:text-violet-300";
  if (role === "admin")
    return "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300";
  return "bg-muted text-muted-foreground border-border";
}

export default function DashboardAdminPage() {
  const { user } = useAuth();
  const isSuper = user?.role === "super_admin";

  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  // Pending invitations for the selected org — only outstanding (unaccepted,
  // unexpired) rows. Drives the "Pending invitations" panel; refreshes
  // alongside the member list whenever the org selection changes.
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Load orgs on mount ────────────────────────────────────────────────
  const refreshOrgs = useCallback(async () => {
    setOrgsLoading(true);
    setOrgsError(null);
    try {
      const list = await listOrgs();
      setOrgs(list);
      // Auto-select: super_admin gets the first org; firm admin gets their own.
      setSelectedOrgId((prev) => {
        if (prev && list.some((o) => o.id === prev)) return prev;
        if (user?.orgId && list.some((o) => o.id === user.orgId)) {
          return user.orgId;
        }
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setOrgsError(err instanceof Error ? err.message : "Failed to load orgs");
    } finally {
      setOrgsLoading(false);
    }
  }, [user?.orgId]);

  useEffect(() => {
    void refreshOrgs();
  }, [refreshOrgs]);

  // ── Load members + pending invitations when org selection changes ────
  useEffect(() => {
    if (!selectedOrgId) {
      setMembers([]);
      setInvitations([]);
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    setMembersError(null);
    Promise.all([
      listMembers(selectedOrgId),
      listInvites(selectedOrgId).catch(() => [] as Invitation[]),
    ])
      .then(([memberList, inviteList]) => {
        if (cancelled) return;
        setMembers(memberList);
        setInvitations(inviteList);
      })
      .catch((err) => {
        if (cancelled) return;
        setMembersError(
          err instanceof Error ? err.message : "Failed to load members",
        );
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOrgId]);

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === selectedOrgId) ?? null,
    [orgs, selectedOrgId],
  );

  const handleCreateOrg = async () => {
    const name = newOrgName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createOrg(name);
      setOrgs((prev) => [created, ...prev]);
      setSelectedOrgId(created.id);
      setNewOrgName("");
      setCreateOpen(false);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create org",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRemoveMember = async (m: Member) => {
    if (!selectedOrgId) return;
    if (!window.confirm(`Remove ${m.full_name || m.email} from this org?`))
      return;
    try {
      await removeMember(selectedOrgId, m.id);
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
      setOrgs((prev) =>
        prev.map((o) =>
          o.id === selectedOrgId
            ? { ...o, member_count: Math.max(0, o.member_count - 1) }
            : o,
        ),
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const handleSetRole = async (m: Member, role: Member["role"]) => {
    if (!selectedOrgId || m.role === role) return;
    try {
      const updated = await setMemberRole(selectedOrgId, m.id, role);
      setMembers((prev) =>
        prev.map((x) => (x.id === m.id ? updated : x)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to change role";
      window.alert(msg);
    }
  };

  const handleAddMember = async (target: Member, role: "user" | "admin") => {
    if (!selectedOrgId) return;
    try {
      const added = await addMember(selectedOrgId, target.id, role);
      setMembers((prev) => {
        const existing = prev.findIndex((x) => x.id === added.id);
        if (existing >= 0) {
          const next = prev.slice();
          next[existing] = added;
          return next;
        }
        return [...prev, added].sort((a, b) =>
          a.full_name.localeCompare(b.full_name),
        );
      });
      setOrgs((prev) =>
        prev.map((o) =>
          o.id === selectedOrgId
            ? { ...o, member_count: o.member_count + 1 }
            : o,
        ),
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to add");
    }
  };

  // Invite an UNREGISTERED email — creates an outstanding invitation row +
  // emails the recipient a link to /accept-invite. Backend rejects with 409
  // if the email already maps to a user (the admin should use search-add).
  const handleInvite = async (email: string, role: "user" | "admin") => {
    if (!selectedOrgId) return;
    try {
      const created = await createInvite(selectedOrgId, email, role);
      setInvitations((prev) => {
        // Upsert by email (re-invite refreshes in place server-side).
        const idx = prev.findIndex((i) => i.email === created.email);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = created;
          return next;
        }
        return [created, ...prev];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to invite";
      window.alert(msg);
    }
  };

  const handleRevokeInvite = async (inv: Invitation) => {
    if (!selectedOrgId) return;
    if (!window.confirm(`Revoke invitation for ${inv.email}?`)) return;
    try {
      await revokeInvite(selectedOrgId, inv.id);
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to revoke");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* ── Page header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Admin</h1>
              <p className="text-sm text-muted-foreground">
                {isSuper
                  ? "Manage every organisation and its members."
                  : "Manage members of your firm."}
              </p>
            </div>
          </div>
          {isSuper && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              New organisation
            </Button>
          )}
        </div>

        {/* ── Organisations card (super-admin sees the picker) ─────────── */}
        {isSuper && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organisations</CardTitle>
            </CardHeader>
            <CardContent>
              {orgsLoading ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : orgsError ? (
                <p className="text-sm text-destructive">{orgsError}</p>
              ) : orgs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No organisations yet. Create one to get started.
                </p>
              ) : (
                <ul className="divide-y divide-border/60 -mx-2">
                  {orgs.map((o) => (
                    <li key={o.id}>
                      <button
                        onClick={() => setSelectedOrgId(o.id)}
                        className={cn(
                          "w-full text-left flex items-center justify-between gap-3 px-2 py-2.5 rounded-md transition-colors",
                          selectedOrgId === o.id
                            ? "bg-primary/5"
                            : "hover:bg-muted/40",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {o.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {o.member_count}{" "}
                            {o.member_count === 1 ? "member" : "members"}
                          </p>
                        </div>
                        {selectedOrgId === o.id && (
                          <span className="text-xs font-medium text-primary">
                            selected
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Members card ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              {selectedOrg ? (
                <>
                  Members of{" "}
                  <span className="text-foreground">«{selectedOrg.name}»</span>
                </>
              ) : (
                "Members"
              )}
            </CardTitle>
            {selectedOrg && (
              <span className="text-xs text-muted-foreground">
                {selectedOrg.member_count}{" "}
                {selectedOrg.member_count === 1 ? "member" : "members"}
              </span>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedOrgId ? (
              <p className="text-sm text-muted-foreground">
                Select an organisation above to manage its members.
              </p>
            ) : membersLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading members…
              </div>
            ) : membersError ? (
              <p className="text-sm text-destructive">{membersError}</p>
            ) : (
              <>
                {members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No members yet. Use the search below to add one.
                  </p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {members.map((m) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        canManageSelf={m.id !== user?.id}
                        isSuper={isSuper}
                        onChangeRole={(role) => handleSetRole(m, role)}
                        onRemove={() => handleRemoveMember(m)}
                      />
                    ))}
                  </ul>
                )}
                {invitations.length > 0 && (
                  <PendingInvitations
                    invitations={invitations}
                    onRevoke={handleRevokeInvite}
                  />
                )}
                <AddMemberSearch
                  members={members}
                  invitations={invitations}
                  isSuper={isSuper}
                  onAdd={handleAddMember}
                  onInvite={handleInvite}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── New-org dialog ─────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New organisation</DialogTitle>
            <DialogDescription>
              Create a new firm. You can add members afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="Nordlicht Wind Rechtsabteilung"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateOrg();
              }}
            />
            {createError && (
              <p className="text-xs text-destructive">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateOrg}
              disabled={!newOrgName.trim() || creating}
            >
              {creating && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Member row ──────────────────────────────────────────────────────────────
function MemberRow({
  member,
  canManageSelf,
  isSuper,
  onChangeRole,
  onRemove,
}: {
  member: Member;
  canManageSelf: boolean;
  isSuper: boolean;
  onChangeRole: (role: Member["role"]) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{member.full_name}</p>
        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium",
                roleBadgeClass(member.role),
              )}
            >
              {roleLabel(member.role)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onChangeRole("user")}>
              Member
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onChangeRole("admin")}>
              Firm-Admin
            </DropdownMenuItem>
            {isSuper && (
              <DropdownMenuItem onClick={() => onChangeRole("super_admin")}>
                Super-Admin
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onRemove}
          disabled={!canManageSelf}
          title={canManageSelf ? "Remove from org" : "You cannot remove yourself"}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </li>
  );
}

// ── Pending invitations panel ───────────────────────────────────────────────
function PendingInvitations({
  invitations,
  onRevoke,
}: {
  invitations: Invitation[];
  onRevoke: (inv: Invitation) => void;
}) {
  return (
    <div className="pt-3 border-t border-border/60 space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        Pending invitations
      </Label>
      <ul className="divide-y divide-border/60 border border-border/60 rounded-md bg-muted/20">
        {invitations.map((inv) => {
          const expires = new Date(inv.expires_at);
          const daysLeft = Math.max(
            0,
            Math.ceil((expires.getTime() - Date.now()) / 86_400_000),
          );
          return (
            <li
              key={inv.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm truncate">
                  <span className="font-mono">{inv.email}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    invited as{" "}
                    {inv.role === "admin" ? "Firm-Admin" : "Member"} ·
                    expires in {daysLeft}{" "}
                    {daysLeft === 1 ? "day" : "days"}
                  </span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRevoke(inv)}
                className="text-muted-foreground hover:text-destructive"
                title="Revoke invitation"
              >
                Revoke
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Add-member search (trigram typeahead) ──────────────────────────────────
function AddMemberSearch({
  members,
  invitations,
  isSuper,
  onAdd,
  onInvite,
}: {
  members: Member[];
  invitations: Invitation[];
  isSuper: boolean;
  onAdd: (target: Member, role: "user" | "admin") => Promise<void>;
  onInvite: (email: string, role: "user" | "admin") => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const list = await searchUsers(q, 10);
        // Exclude users already in this org (the search includes them so the
        // admin can find them for management; for the ADD picker, hide them).
        const memberIds = new Set(members.map((m) => m.id));
        setResults(list.filter((u) => !memberIds.has(u.id)));
      } catch (err) {
        const msg =
          err instanceof AdminApiError ? err.detail : "Search failed";
        // Lightweight error path; the input keeps working.
        console.warn("admin search:", msg);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, members]);

  return (
    <div className="pt-3 border-t border-border/60 space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        Add member
      </Label>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a name or email…"
          className="pl-9"
        />
        {searching && (
          <Loader2 className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {results.length > 0 && (
        <ul className="border border-border/60 rounded-md divide-y divide-border/60 bg-card">
          {results.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm truncate">{u.full_name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {u.email}
                  {u.org_id ? (
                    <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                      · already in another org
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await onAdd(u, "user");
                    setQ("");
                    setResults([]);
                  }}
                  disabled={!isSuper && u.org_id !== null}
                >
                  Add as member
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    await onAdd(u, "admin");
                    setQ("");
                    setResults([]);
                  }}
                  disabled={!isSuper && u.org_id !== null}
                >
                  Add as admin
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !searching && results.length === 0 && (
        looksLikeEmail(q) ? (
          invitations.some(
            (i) => i.email === q.trim().toLowerCase(),
          ) ? (
            <p className="text-xs text-muted-foreground">
              Already invited — see Pending invitations above.
            </p>
          ) : (
            <div className="rounded-md border border-dashed border-border/70 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                No registered account for{" "}
                <span className="font-mono">{q.trim()}</span>. Invite them by
                email — they’ll receive a link to set up their account
                themselves (no auto-generated password).
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await onInvite(q.trim(), "user");
                    setQ("");
                  }}
                >
                  Invite as member
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    await onInvite(q.trim(), "admin");
                    setQ("");
                  }}
                >
                  Invite as admin
                </Button>
              </div>
            </div>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            No matches. Type a full email to invite an unregistered user.
          </p>
        )
      )}
      {q.trim().length > 0 && q.trim().length < 2 && (
        <p className="text-xs text-muted-foreground">
          Type at least 2 characters.
        </p>
      )}
    </div>
  );
}
