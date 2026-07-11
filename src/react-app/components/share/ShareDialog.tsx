// src/react-app/components/share/ShareDialog.tsx
//
// Generic per-resource share dialog (Path A Step 2). One component drives all
// three shareable surfaces — chat sessions, DDiQ reports, DDiQ documents —
// via the ``resourceType`` prop. The backend share API is dispatched through
// ``shareApiFor(type)``.
//
// UX (deliberately close to Notion / Google Docs "Share"):
//   • Header: "Share «{resourceName}»".
//   • Helper line: "People you share with can view this {type}."
//     (v1 is view-only; the helper makes that explicit.)
//   • Member typeahead — 250 ms debounced, min 2 chars, same-org only
//     (server-side guard in /share-targets/search). Click a result → adds.
//   • Below the input: a list of people the resource is currently shared
//     with. Each row has an X to revoke.
//
// Sonner toasts surface success + the verbatim server error message.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/react-app/components/ui/dialog";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import { Label } from "@/react-app/components/ui/label";
import { cn } from "@/react-app/lib/utils";
import {
  ShareApiError,
  shareApiFor,
  searchShareTargets,
  type ShareResourceType,
  type ShareTarget,
  type ShareUser,
} from "@/react-app/lib/shareApi";

export interface ShareDialogProps {
  resourceType: ShareResourceType;
  resourceId: string;
  /** Human-readable name shown in the dialog header (e.g. matter title). */
  resourceName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RESOURCE_LABEL: Record<ShareResourceType, string> = {
  session: "matter",
  report: "report",
  document: "document",
};

export function ShareDialog({
  resourceType,
  resourceId,
  resourceName,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const api = shareApiFor(resourceType);
  const label = RESOURCE_LABEL[resourceType];

  const [shares, setShares] = useState<ShareUser[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<ShareTarget[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  // ── Load shares on open ──────────────────────────────────────────────
  const refreshShares = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const list = await api.list(resourceId);
      setShares(list);
    } catch (err) {
      setListError(
        err instanceof ShareApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Failed to load shares",
      );
    } finally {
      setListLoading(false);
    }
  }, [api, resourceId]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults([]);
    void refreshShares();
  }, [open, refreshShares]);

  // ── Typeahead ────────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const list = await searchShareTargets(q, {
          // Only the chat-session endpoint supports exclude_session_id, but
          // passing it for reports/docs is harmless (server ignores
          // unknown ids). The exclude_session_id constraint isn't strictly
          // needed for non-session resources, but we always filter out
          // already-shared and self client-side as the safety net.
          excludeSessionId:
            resourceType === "session" ? resourceId : undefined,
        });
        const sharedIds = new Set(shares.map((s) => s.user_id));
        setResults(list.filter((u) => !sharedIds.has(u.id)));
      } catch (err) {
        console.warn(
          "share-target search:",
          err instanceof ShareApiError ? err.detail : err,
        );
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, shares, resourceType, resourceId]);

  // ── Actions ──────────────────────────────────────────────────────────
  const handleAdd = async (target: ShareTarget) => {
    try {
      const added = await api.add(resourceId, target.id);
      setShares((prev) => {
        const idx = prev.findIndex((s) => s.user_id === added.user_id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = added;
          return next;
        }
        return [added, ...prev];
      });
      setResults((prev) => prev.filter((u) => u.id !== target.id));
      setQ("");
      toast.success(`Shared with ${target.full_name || target.email}`);
    } catch (err) {
      const msg =
        err instanceof ShareApiError ? err.detail
        : err instanceof Error ? err.message
        : "Failed to share";
      toast.error(msg);
    }
  };

  const handleRevoke = async (s: ShareUser) => {
    if (!window.confirm(`Remove ${s.full_name || s.email}'s access?`)) return;
    try {
      await api.revoke(resourceId, s.user_id);
      setShares((prev) => prev.filter((x) => x.user_id !== s.user_id));
      toast.success(`Removed ${s.full_name || s.email}'s access`);
    } catch (err) {
      const msg =
        err instanceof ShareApiError ? err.detail
        : err instanceof Error ? err.message
        : "Failed to revoke";
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Share{resourceName ? ` «${resourceName}»` : ` ${label}`}
          </DialogTitle>
          <DialogDescription>
            People you share with can <span className="font-medium">view</span> this {label}.
            They cannot rename, delete, or send messages.
          </DialogDescription>
        </DialogHeader>

        {/* ── Add by typeahead ─────────────────────────────────────── */}
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Add by name or email
          </Label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type a colleague's name…"
              className="pl-9"
              autoFocus
            />
            {searching && (
              <Loader2 className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          {results.length > 0 && (
            <ul className="border border-border/60 rounded-md divide-y divide-border/60 bg-card max-h-60 overflow-y-auto">
              {results.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm truncate">{u.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {u.email}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => handleAdd(u)}>
                    Share
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No matches in your organisation.
            </p>
          )}
          {q.trim().length > 0 && q.trim().length < 2 && (
            <p className="text-xs text-muted-foreground">
              Type at least 2 characters.
            </p>
          )}
        </div>

        {/* ── Current shares ───────────────────────────────────────── */}
        <div className="pt-3 border-t border-border/60 space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Shared with ({shares.length})
          </Label>
          {listLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : listError ? (
            <p className="text-sm text-destructive">{listError}</p>
          ) : shares.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one yet. Search above to add a colleague.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 -mx-1">
              {shares.map((s) => (
                <li
                  key={s.user_id}
                  className={cn(
                    "flex items-center justify-between gap-3 px-1 py-2",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm truncate">{s.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {s.email}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Remove access"
                    onClick={() => handleRevoke(s)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
