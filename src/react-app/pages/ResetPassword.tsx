import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import { Label } from "@/react-app/components/ui/label";
import { Logo } from "@/react-app/components/Logo";
import { ThemeToggle } from "@/react-app/components/ThemeToggle";
import { useAuth } from "@/react-app/auth";
import {
  LensIcon,
  LensOffIcon,
  PadlockIcon,
  ArrowRightIcon,
} from "@/react-app/components/icons";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { resetPassword } = useAuth();

  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Missing or invalid reset link.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    try {
      await resetPassword(token, password);
      setSuccess(true);
      // Brief pause so the user sees the confirmation, then route to login.
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Reset failed. Try requesting a new link.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="fixed top-6 right-6 z-50">
        <ThemeToggle />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10 space-y-8">
        <div className="text-center space-y-6">
          <Link to="/" className="inline-block">
            <Logo size="lg" />
          </Link>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
            <p className="text-muted-foreground text-sm">
              Pick something you don&apos;t use anywhere else.
            </p>
          </div>
        </div>

        <div className="bg-card border border-border/50 shadow-sm p-8 rounded-md space-y-6">
          {success ? (
            <div className="text-sm">
              <p>
                Your password has been updated. Redirecting you to sign in…
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label
                  htmlFor="password"
                  className="font-medium text-xs uppercase tracking-wider text-muted-foreground"
                >
                  New Password
                </Label>
                <div className="relative">
                  <PadlockIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="At least 12 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-11 pr-11 h-11 rounded-md bg-background border-input focus-visible:ring-1 focus-visible:ring-primary shadow-sm"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? (
                      <LensOffIcon className="w-4 h-4" />
                    ) : (
                      <LensIcon className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="confirmPassword"
                  className="font-medium text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Confirm Password
                </Label>
                <div className="relative">
                  <PadlockIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Repeat your new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-11 h-11 rounded-md bg-background border-input focus-visible:ring-1 focus-visible:ring-primary shadow-sm"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 text-sm font-semibold rounded-md shadow-sm bg-primary hover:bg-primary/90 text-primary-foreground transition-all"
                disabled={isLoading || !token}
              >
                {isLoading ? "Updating…" : "Update password"}
                {!isLoading && <ArrowRightIcon className="ml-2 w-4 h-4" />}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-primary hover:underline font-medium">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
