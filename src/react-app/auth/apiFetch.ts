// The single fetch wrapper the rest of the SPA must route through.
//
// One job: attach the Bearer access token, send the refresh cookie, and
// transparently exchange a 401 for a fresh access token + retry. Lives
// outside any React tree on purpose — chat, DDiQ, and any future client
// import this directly without needing a hook.
//
// The access token lives in module-scope memory. NEVER localStorage,
// NEVER a JS-readable cookie. On page reload the in-memory token is
// gone; the AuthProvider re-hydrates by calling /auth/me, which
// triggers a refresh-via-cookie. See AUTH_PLAN §5.3.

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

let accessToken: string | null = null;

// "Was this browser ever logged in?" hint. The access token lives only in
// memory (gone on reload) and the refresh token is an httpOnly cookie we
// can't read from JS — so on boot we have no JS-visible way to know if a
// session exists WITHOUT making a network call. This flag is that hint:
// set when a token is minted (login / refresh), cleared when it's dropped
// (logout / refresh-failure). It lets the AuthProvider skip the auth
// probe entirely for a never-logged-in visitor, so the browser console
// shows no expected-401 noise.
const SESSION_HINT_KEY = "lai.auth.session";

export function hasStoredSession(): boolean {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function setSessionHint(present: boolean): void {
  try {
    if (present) window.localStorage.setItem(SESSION_HINT_KEY, "1");
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* localStorage unavailable — no-op */
  }
}

// Subscribers (the AuthProvider) so a forced sign-out (refresh-failed)
// propagates into React state cleanly without reaching into the DOM.
type AuthChangeListener = (token: string | null) => void;
const listeners = new Set<AuthChangeListener>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
  // Mirror the token's presence into the persisted hint so a reload knows
  // whether it's worth probing for a session.
  setSessionHint(token !== null);
  for (const fn of listeners) fn(token);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function onAccessTokenChange(fn: AuthChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function buildUrl(input: RequestInfo): RequestInfo {
  if (typeof input !== "string") return input;
  if (/^https?:\/\//i.test(input)) return input;
  if (!API_BASE_URL) return input; // dev fallback: same-origin
  return `${API_BASE_URL}${input.startsWith("/") ? "" : "/"}${input}`;
}

function authHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers ?? {});
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return headers;
}

// Single-flight refresh: when many parallel 401s arrive (the first
// reload of a stale tab can trigger several concurrent calls), we only
// want one /auth/refresh round trip. The others await the in-flight
// promise.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(buildUrl("/auth/refresh"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const body = (await res.json()) as { access_token: string };
      setAccessToken(body.access_token);
      return body.access_token;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Mint an access token from the refresh cookie. Called once on app boot
 * to rehydrate a returning user's session BEFORE any protected request,
 * so `/auth/me` is issued with a token in hand instead of firing a
 * guaranteed token-less 401 first. Returns the new token, or null if
 * there's no valid refresh cookie (→ treat as logged out).
 */
export async function bootstrapAuth(): Promise<string | null> {
  return refreshAccessToken();
}

export interface ApiFetchOptions extends RequestInit {
  // When `true`, do not attempt a refresh on 401 — used by login/signup
  // themselves so a wrong-password 401 doesn't trigger a pointless refresh.
  noRefresh?: boolean;
}

export async function apiFetch(input: RequestInfo, init: ApiFetchOptions = {}): Promise<Response> {
  const { noRefresh, ...rest } = init;
  const url = buildUrl(input);

  let response = await fetch(url, {
    ...rest,
    headers: authHeaders(rest),
    credentials: "include",
  });
  if (response.status !== 401 || noRefresh) return response;

  const newToken = await refreshAccessToken();
  if (!newToken) return response; // caller will see the original 401

  response = await fetch(url, {
    ...rest,
    headers: authHeaders(rest),
    credentials: "include",
  });
  return response;
}

// Small helper: parse JSON or surface the server's `detail` field as an
// Error. Used by AuthProvider; callers elsewhere can keep using
// `apiFetch` directly and parse however they like.
export async function apiJson<T>(input: RequestInfo, init: ApiFetchOptions = {}): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // Non-JSON error body; keep the status-line fallback.
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
