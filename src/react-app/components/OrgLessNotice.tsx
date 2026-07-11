// src/react-app/components/OrgLessNotice.tsx
//
// A persistent notice shown across the dashboard when the signed-in user
// hasn't been placed in any organisation yet. Open signup creates org-less
// users (MULTIUSER_PLAN §7) — they can authenticate, but they belong to no
// firm, so every list (matters / reports / projects) is empty until an admin
// places them. Without this banner the workspace just looks "broken"; this
// gives them an explicit explanation and a path forward.

import { Info, Mail } from "lucide-react";

import { useAuth } from "@/react-app/auth/useAuth";

export function OrgLessNotice() {
  const { user, status } = useAuth();
  // Only relevant for an authenticated user who has no org (org-less holding
  // state, per MULTIUSER_PLAN §7 / §13.1). A super-admin is special: they may
  // legitimately be org-less but still have a workspace via the Admin panel,
  // so we don't pester them with this notice.
  if (status !== "authenticated") return null;
  if (!user || user.orgId !== null) return null;
  if (user.role === "super_admin") return null;

  return (
    <div className="mx-4 mt-3 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          Your account isn’t linked to a firm yet.
        </p>
        <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">
          Until a firm admin adds you (or you accept an invitation), this
          workspace will stay empty. Ask your admin to add{" "}
          <span className="font-mono">{user.email}</span> to the firm in their
          Admin panel — they’ll see you in the member search.
        </p>
      </div>
      <a
        href={`mailto:?subject=${encodeURIComponent(
          "Please add me to LAI",
        )}&body=${encodeURIComponent(
          `Hi,\n\nI've signed up to LAI with ${user.email} but I'm not in a firm yet. Could you add me to ours via the Admin panel?\n\nThanks,\n${user.fullName || ""}`,
        )}`}
        className="ml-2 inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-900 dark:text-amber-100 hover:bg-amber-500/20 transition-colors"
      >
        <Mail className="w-3.5 h-3.5" />
        Email my admin
      </a>
    </div>
  );
}
