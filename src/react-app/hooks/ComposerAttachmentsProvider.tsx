// src/react-app/hooks/ComposerAttachmentsProvider.tsx
//
// Dashboard-level store for chat-composer attachment state. Mirrors the
// pattern used by ``UploadQueueProvider`` for the DDiQ library row state:
// hosts the data ABOVE every page that consumes it so navigating between
// Chat / Documents / Projects / Settings doesn't unmount the staging area
// and wipe the upload chips while the XHRs are still running in the
// background.
//
// Scope-keyed so different chat conversations / different projects keep
// independent staging areas. ``useComposerAttachments({ scope, … })``
// looks up ``scope``'s slice of the store; switching to another scope
// (different conversation, different project) reveals that scope's chips
// and conceals others, but nothing is destroyed by route navigation.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { ChatAttachment } from "@/react-app/components/project/types";

interface ComposerAttachmentsStore {
  /** Returns the current attachments for ``scope``. ``[]`` if untouched. */
  getAttachments: (scope: string) => ChatAttachment[];
  /** Apply a state update to ``scope``'s attachments. Mirrors React's
   *  useState setter signature so the hook can swap in/out cleanly. */
  setAttachments: (
    scope: string,
    next:
      | ChatAttachment[]
      | ((prev: ChatAttachment[]) => ChatAttachment[]),
  ) => void;
  /** Returns the mutable session-id holder for ``scope``. Stored OUTSIDE
   *  React state so concurrent uploads can read the latest session id
   *  before a state update has landed. Each scope gets its own ref so the
   *  chat's session can't leak into a project. */
  getSessionRef: (scope: string) => { current: string | null };
  /** Returns the mutable AbortController map for ``scope``. Same lifetime
   *  contract as ``getSessionRef``: outside React state, scope-isolated. */
  getControllers: (scope: string) => Map<string, AbortController>;
}

const Ctx = createContext<ComposerAttachmentsStore | null>(null);

export function ComposerAttachmentsProvider({ children }: { children: ReactNode }) {
  // Single flat state so subscribers re-render on any change; React's
  // bailout for unchanged slices keeps the render cost trivial — the
  // attachment count is small (typically < 20 across all scopes).
  const [byScope, setByScope] = useState<
    Record<string, ChatAttachment[]>
  >({});

  // Refs live across renders — each scope's session id and AbortControllers
  // are stable references the hook uses for synchronous reads inside upload
  // callbacks. Lazily allocated on first ``get*`` call.
  const sessionRefs = useRef<Map<string, { current: string | null }>>(
    new Map(),
  );
  const controllers = useRef<Map<string, Map<string, AbortController>>>(
    new Map(),
  );

  const getAttachments = useCallback(
    (scope: string) => byScope[scope] ?? [],
    [byScope],
  );

  const setAttachments = useCallback<ComposerAttachmentsStore["setAttachments"]>(
    (scope, next) => {
      setByScope((prev) => {
        const cur = prev[scope] ?? [];
        const updated = typeof next === "function" ? next(cur) : next;
        // Cheap referential bail-out: don't churn the parent state object
        // when the update is a no-op.
        if (updated === cur) return prev;
        return { ...prev, [scope]: updated };
      });
    },
    [],
  );

  const getSessionRef = useCallback((scope: string) => {
    let r = sessionRefs.current.get(scope);
    if (!r) {
      r = { current: null };
      sessionRefs.current.set(scope, r);
    }
    return r;
  }, []);

  const getControllers = useCallback((scope: string) => {
    let m = controllers.current.get(scope);
    if (!m) {
      m = new Map<string, AbortController>();
      controllers.current.set(scope, m);
    }
    return m;
  }, []);

  return (
    <Ctx.Provider
      value={{ getAttachments, setAttachments, getSessionRef, getControllers }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useComposerAttachmentsStore(): ComposerAttachmentsStore {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useComposerAttachmentsStore must be used inside ComposerAttachmentsProvider",
    );
  }
  return v;
}
