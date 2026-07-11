import { Fragment } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/react-app/auth";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

// Renders a thin loader while the AuthProvider hydrates from /auth/me.
// Without this, every reload of an authenticated route flashes /login
// while the refresh-via-cookie round trip is in flight.
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (status === "unauthenticated") {
    // Preserve the deep link so post-login we can land the user back
    // where they were trying to go.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Key the authenticated subtree by user id. If the logged-in user changes
  // in the same browser — including a login as B *without* an explicit logout,
  // where ``status`` stays "authenticated" and nothing would otherwise remount
  // — React discards the whole tree and mounts it fresh, so the previous
  // account's IN-MEMORY state (chat conversations + messages, etc.) cannot
  // bleed into the new session. localStorage is separately cleared/namespaced
  // by auth/clientState.reconcileUserScope (which runs before setUser, so the
  // purge completes before this remount re-reads storage).
  return <Fragment key={user?.id ?? "anon"}>{children}</Fragment>;
}
