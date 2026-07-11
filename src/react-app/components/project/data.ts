import { ChatMessage, Project, ProjectConversation } from "./types";

// localStorage key for the persisted project workspace. Bumped to ``v2``
// when the legacy hard-coded demo projects (Windtech Farm, etc.) were
// removed in favour of real, user-created projects whose chats stream
// from the live RAG backend. A fresh key avoids resurrecting the old
// dummy blob from anyone's browser cache.
const STORAGE_KEY_BASE = "lai.projects.v2";

// The projects workspace is local-only (not backend-synced), so the key MUST
// be per-user — otherwise a second account on the same browser sees and
// overwrites the first account's projects. The current user's id is published
// to localStorage by the auth layer (auth/clientState.reconcileUserScope)
// before the dashboard mounts. Falls back to the base key only when no user is
// known (shouldn't happen behind the auth guard); that un-suffixed legacy key
// is itself cleaned up by clientState on logout/account-switch.
function storageKey(): string {
  try {
    const uid = window.localStorage.getItem("lai.auth.uid");
    if (uid) return `${STORAGE_KEY_BASE}.${uid}`;
  } catch {
    /* fall through to base key */
  }
  return STORAGE_KEY_BASE;
}

// No seed data. Projects start empty and are created by the user; their
// conversations map to real backend sessions. (The previous build shipped
// a hard-coded ``INITIAL_PROJECTS`` array with canned Q&A — that dummy
// content has been removed so the chat only ever shows real answers.)
export const INITIAL_PROJECTS: Project[] = [];

/** Strip transient/illegal fields before persisting a conversation. */
function sanitizeConversation(c: ProjectConversation): ProjectConversation {
  return {
    ...c,
    messages: c.messages.map((m: ChatMessage) => ({
      ...m,
      // A bubble can't still be streaming once we've serialized it — a
      // reload would otherwise leave a phantom typing indicator on screen.
      streaming: false,
      // File handles can't be serialized; keep only the displayable metadata.
      attachments: m.attachments?.map(({ id, name, size, type }) => ({
        id,
        name,
        size,
        type,
      })),
    })),
  };
}

/** Read the persisted projects, or an empty list if none / unparsable. */
export function loadProjects(): Project[] {
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: ensure no message is left flagged as streaming.
    return parsed.map((p: Project) => ({
      ...p,
      conversations: (p.conversations ?? []).map(sanitizeConversation),
    }));
  } catch {
    return [];
  }
}

/** Persist the full project list. Best-effort — failures are swallowed. */
export function saveProjects(projects: Project[]): void {
  try {
    const safe = projects.map((p) => ({
      ...p,
      conversations: p.conversations.map(sanitizeConversation),
    }));
    window.localStorage.setItem(storageKey(), JSON.stringify(safe));
  } catch {
    // localStorage unavailable (private mode / quota) — lose persistence only.
  }
}
