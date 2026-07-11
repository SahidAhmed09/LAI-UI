// src/react-app/pages/AcceptInvite.tsx
//
// Public page reached via the link in the invitation email. The token in
// the URL IS the authentication — no login required. Flow:
//
//   1. On mount, GET /auth/invite?token=… to learn which org and as-what
//      role the recipient is being invited (so the page can show
//      "You're invited to «Firm» as Member" before they type).
//   2. Show a small form: Full name + Password.
//   3. POST /auth/accept-invite — backend creates the user inside the
//      inviting org and mints a session. We redirect to /dashboard.
//
// Failure modes (server-side):
//   * invitation missing / expired / consumed → 404 on preview, 400 on accept.
//   * password too short → 400 with the policy message.
//   * email already maps to an account (race) → 409.
// All surfaced verbatim under the form so the recipient can see what to fix.

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Loader2, Shield } from "lucide-react";

import { useAuth } from "@/react-app/auth/useAuth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import { Label } from "@/react-app/components/ui/label";
import { previewInvite, type InvitePreview } from "@/react-app/lib/adminApi";

function roleLabel(role: InvitePreview["role"]): string {
  return role === "admin" ? "Firm-Admin" : "Member";
}

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { acceptInvite, status } = useAuth();

  const token = params.get("token") ?? "";

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Preview the invitation on mount ──────────────────────────────────
  useEffect(() => {
    if (!token) {
      setPreviewLoading(false);
      setPreviewError(
        "This link is missing its invitation token. Ask your firm admin to send the email again.",
      );
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    previewInvite(token)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewError(
          err instanceof Error
            ? err.message
            : "This invitation is invalid or has expired.",
        );
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // If a user is already signed in, accepting an invite would replace
  // their session. That's actually fine — but we surface a brief notice
  // so they don't lose the active session by accident.
  const alreadyAuthenticated = status === "authenticated";

  const canSubmit =
    !!preview &&
    !submitting &&
    fullName.trim().length > 0 &&
    password.length >= 12;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await acceptInvite({
        token,
        fullName: fullName.trim(),
        password,
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Could not accept the invitation.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <CardTitle>Accept your invitation</CardTitle>
              <CardDescription>
                Finish setting up your LAI account.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {previewLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Verifying invitation…
            </div>
          ) : previewError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{previewError}</p>
              <p className="text-xs text-muted-foreground">
                If you believe this is a mistake, ask the person who invited
                you to send a new link.
              </p>
            </div>
          ) : preview ? (
            <>
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p>
                  You’ve been invited to{" "}
                  <span className="font-semibold text-foreground">
                    «{preview.org_name}»
                  </span>{" "}
                  as{" "}
                  <span className="font-medium text-foreground">
                    {roleLabel(preview.role)}
                  </span>
                  .
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Account email:{" "}
                  <span className="font-mono">{preview.email}</span>
                </p>
              </div>

              {alreadyAuthenticated && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  You’re currently signed in to another account. Accepting this
                  invitation will replace that session.
                </p>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="full-name">Full name</Label>
                  <Input
                    id="full-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Schiller"
                    autoFocus
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Choose a password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 12 characters"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    12 characters minimum. Choose something memorable — you’ll
                    sign in with{" "}
                    <span className="font-mono">{preview.email}</span> after.
                  </p>
                </div>
                {submitError && (
                  <p className="text-xs text-destructive">{submitError}</p>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!canSubmit}
                >
                  {submitting && (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  )}
                  Accept &amp; sign in
                </Button>
              </form>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
