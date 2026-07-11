// User-scoped client-state hygiene.
//
// All backend reads are tenant-scoped (every /sessions, /ddiq/* endpoint
// validates the row's user_id against the caller, 404 on mismatch). But the
// UI also caches user-specific data in localStorage — the projects workspace,
// the active conversation + its session ids, the active DDiQ report, and
// notifications. Those are NOT keyed by user and were never cleared on
// logout, so a SECOND account logging into the same browser would see the
// FIRST account's cached chats / projects / documents (rendered straight from
// localStorage, with no backend call to reject it).
//
// This module is the single source of truth for "what is user data" and
// purges it (a) on logout and (b) when a different user_id is detected
// (account switch / session expiry → different login), before the dashboard
// mounts and rehydrates from localStorage.

// localStorage keys that hold one user's data. Keep in sync with the writers:
//   lai.activeConversation  → DashboardLayout (backend-backed pointer)
//   lai.ddiq.activeReport   → ReportDownloadPanel (report itself is backend-backed)
//   lai.notifications.v1    → NotificationsMenu (app-generated; re-seeds)
//   lai.projects.v2         → LEGACY un-namespaced projects key. Projects are
//     now stored per-user under "lai.projects.v2.<uid>" (see project/data.ts);
//     those per-user keys are NOT listed here (removeItem is exact-match), so
//     each account keeps its own projects. We only clean up the old shared key.
// All entries here are either backend-backed (re-fetched) or app-generated
// (re-seeded), so clearing them never loses user-created data.
const USER_DATA_KEYS = [
  "lai.activeConversation",
  "lai.ddiq.activeReport",
  "lai.notifications.v1",
  "lai.projects.v2",
];

// Prefixes whose every key is user data:
//   lai.session.<conversationId> → DashboardChat (backend session id per convo)
const USER_DATA_PREFIXES = ["lai.session."];

// Marks which user the cached data belongs to, so we can detect a switch.
// NOT itself user data — managed only by this module.
const SCOPE_UID_KEY = "lai.auth.uid";

/** Remove every piece of user-specific cached data from localStorage. Safe to
 *  call repeatedly; never throws (storage may be unavailable/full). */
export function clearUserScopedClientState(): void {
  try {
    for (const key of USER_DATA_KEYS) window.localStorage.removeItem(key);
    // Collect prefix-matched keys first — removing during iteration shifts
    // indices and would skip entries.
    const prefixed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && USER_DATA_PREFIXES.some((p) => key.startsWith(p))) {
        prefixed.push(key);
      }
    }
    for (const key of prefixed) window.localStorage.removeItem(key);
  } catch {
    /* localStorage unavailable — nothing to clear */
  }
}

/** Call once a profile is loaded (login or rehydrate). If the cached data
 *  belongs to a DIFFERENT user than ``userId``, purge it before the new
 *  user's UI reads localStorage. Same user (normal reload) → keep their data.
 *  Run this BEFORE setting the authenticated user in React state. */
export function reconcileUserScope(userId: string): void {
  try {
    const previous = window.localStorage.getItem(SCOPE_UID_KEY);
    if (previous && previous !== userId) {
      clearUserScopedClientState();
    }
    window.localStorage.setItem(SCOPE_UID_KEY, userId);
  } catch {
    /* localStorage unavailable */
  }
}

/** Full purge for an explicit logout: drop the user's data AND the scope
 *  marker, so the browser carries nothing from this account. */
export function clearUserScopeOnLogout(): void {
  clearUserScopedClientState();
  try {
    window.localStorage.removeItem(SCOPE_UID_KEY);
  } catch {
    /* localStorage unavailable */
  }
}
