import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AuthContext } from "./AuthContext";
import {
  apiFetch,
  apiJson,
  bootstrapAuth,
  hasStoredSession,
  onAccessTokenChange,
  setAccessToken,
} from "./apiFetch";
import { clearUserScopeOnLogout, reconcileUserScope } from "./clientState";
import type { AccessTokenResponse, AuthStatus, User } from "./types";

interface MeWire {
  id: string;
  email: string;
  full_name: string;
  company: string | null;
  // Phase C widened the role enum to three tiers (see auth/types.ts).
  role: "user" | "admin" | "super_admin";
  // Phase A added the firm-tenant key. Older servers (pre-tenancy) omit it
  // → null, which the UI treats as the org-less holding state.
  org_id?: string | null;
}

function fromWire(record: MeWire): User {
  return {
    id: record.id,
    email: record.email,
    fullName: record.full_name,
    company: record.company,
    role: record.role,
    orgId: record.org_id ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  // Mounted ref so an in-flight refresh that resolves after unmount
  // (e.g., StrictMode double-mount in dev) cannot setState into a
  // disposed tree.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Subscribe to the apiFetch module's access-token reset so a
  // background refresh failure (token wiped by the wrapper) drops the
  // React tree into the `unauthenticated` state without us having to
  // poll.
  useEffect(() => {
    return onAccessTokenChange((tok) => {
      if (tok === null && mountedRef.current) {
        setUser(null);
        setStatus("unauthenticated");
      }
    });
  }, []);

  const refreshProfile = useCallback(async (): Promise<void> => {
    try {
      const me = await apiJson<MeWire>("/auth/me");
      if (!mountedRef.current) return;
      // Purge another account's cached localStorage (projects, conversations,
      // session ids, DDiQ report) BEFORE this user's UI mounts and rehydrates
      // from it. Same user (normal reload) keeps their data. See clientState.
      reconcileUserScope(me.id);
      setUser(fromWire(me));
      setStatus("authenticated");
    } catch {
      if (!mountedRef.current) return;
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  // Initial hydration. Gate the probe behind the "was logged in" hint:
  //   • Never-logged-in visitor → no auth network call at all (so the
  //     console shows no expected-401 noise), straight to unauthenticated.
  //   • Returning user → mint a token from the refresh cookie FIRST, then
  //     load the profile. This avoids the guaranteed token-less /auth/me
  //     401 the previous flow produced on every reload.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!hasStoredSession()) {
        if (!cancelled) {
          setUser(null);
          setStatus("unauthenticated");
        }
        return;
      }
      const token = await bootstrapAuth();
      if (cancelled) return;
      if (!token) {
        setUser(null);
        setStatus("unauthenticated");
        return;
      }
      await refreshProfile();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshProfile]);

  const login = useCallback(
    async (email: string): Promise<void> => {
      // DEMO MODE: real /auth/login call disabled — any email/password
      // combination signs in. To restore real authentication, uncomment
      // the block below and remove the mock-session block underneath it.
      //
      // const body = await apiJson<AccessTokenResponse>("/auth/login", {
      //   method: "POST",
      //   headers: { "content-type": "application/json" },
      //   body: JSON.stringify({ email, password, remember_me: rememberMe }),
      //   noRefresh: true,
      // });
      // setAccessToken(body.access_token);
      // await refreshProfile();

      setAccessToken("demo-access-token");
      reconcileUserScope("demo-user");
      setUser({
        id: "demo-user",
        email,
        fullName: "Demo User",
        company: null,
        role: "admin",
        orgId: "demo-org",
      });
      setStatus("authenticated");
    },
    [],
  );

  const signup = useCallback(
    async ({
      fullName,
      email,
      company,
    }: {
      fullName: string;
      email: string;
      password: string;
      company?: string;
    }): Promise<void> => {
      // DEMO MODE: real /auth/signup call disabled — any details succeed.
      // To restore real authentication, uncomment the block below and
      // remove the mock-session block underneath it.
      //
      // const body = await apiJson<AccessTokenResponse>("/auth/signup", {
      //   method: "POST",
      //   headers: { "content-type": "application/json" },
      //   body: JSON.stringify({
      //     email,
      //     password,
      //     full_name: fullName,
      //     company: company ?? null,
      //   }),
      //   noRefresh: true,
      // });
      // setAccessToken(body.access_token);
      // await refreshProfile();

      setAccessToken("demo-access-token");
      reconcileUserScope("demo-user");
      setUser({
        id: "demo-user",
        email,
        fullName,
        company: company ?? null,
        role: "admin",
        orgId: "demo-org",
      });
      setStatus("authenticated");
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiFetch("/auth/logout", { method: "POST", noRefresh: true });
    } finally {
      setAccessToken(null);
      // Drop this account's cached data so the next login on this browser
      // can't see the previous user's projects / chats / documents.
      clearUserScopeOnLogout();
      if (mountedRef.current) {
        setUser(null);
        setStatus("unauthenticated");
      }
    }
  }, []);

  const forgotPassword = useCallback(async (email: string): Promise<void> => {
    // Always-204 endpoint; we surface no result to the caller. Errors
    // propagate (network down, etc.) so the UI can show a generic
    // failure toast, but a 200/204 never reveals account existence.
    await apiFetch("/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
      noRefresh: true,
    });
  }, []);

  const resetPassword = useCallback(async (token: string, newPassword: string): Promise<void> => {
    await apiJson<void>("/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, new_password: newPassword }),
      noRefresh: true,
    });
  }, []);

  // Phase C.1 — public, token-authenticated. Mirrors login: on success the
  // backend has both minted the access token AND placed the new user inside
  // the inviting org, so we just plant the token and let refreshProfile()
  // hydrate the user.
  const acceptInvite = useCallback(
    async ({
      token,
      fullName,
      password,
    }: {
      token: string;
      fullName: string;
      password: string;
    }): Promise<void> => {
      const body = await apiJson<AccessTokenResponse>("/auth/accept-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, full_name: fullName, password }),
        noRefresh: true,
      });
      setAccessToken(body.access_token);
      await refreshProfile();
    },
    [refreshProfile],
  );

  const value = useMemo(
    () => ({
      status,
      user,
      login,
      signup,
      logout,
      forgotPassword,
      resetPassword,
      acceptInvite,
    }),
    [status, user, login, signup, logout, forgotPassword, resetPassword, acceptInvite],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
