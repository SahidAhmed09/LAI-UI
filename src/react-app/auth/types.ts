// Shared shapes for the auth subsystem. Mirrors the wire contract in
// `LAI/src/lai/api/auth_router.py` — when one moves, this moves.

// Three-tier role model (MULTIUSER_PLAN §10.4 / Phase C):
//   user         — regular member of one org
//   admin        — firm admin (manages members of *their* org only)
//   super_admin  — platform admin (creates orgs, places users across any org)
export type Role = "user" | "admin" | "super_admin";

export interface User {
  id: string;
  email: string;
  fullName: string;
  company: string | null;
  role: Role;
  // Firm-tenant key. ``null`` for an org-less user awaiting placement by an
  // admin (open signup creates org-less users; they see an empty workspace
  // until placed). Drives the "Admin" sidebar gating + the empty state.
  orgId: string | null;
}

export interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: "Bearer";
}

// AuthProvider exposes one of three states. Consumers (ProtectedRoute,
// the dashboard layout, the login redirect) branch on `status` —
// rendering /login while `status === 'loading'` is a flash-of-login
// regression we explicitly guard against.
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  signup: (params: {
    fullName: string;
    email: string;
    password: string;
    company?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  // Phase C.1 — public accept-invite flow. Token authenticates; the user
  // picks their own ``fullName`` + ``password``. On success the new account
  // is created already inside the inviting org and an access token is set,
  // so the SPA can navigate to /dashboard without a second round-trip.
  acceptInvite: (params: {
    token: string;
    fullName: string;
    password: string;
  }) => Promise<void>;
}
