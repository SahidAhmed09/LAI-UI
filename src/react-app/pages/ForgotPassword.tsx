import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import { Label } from "@/react-app/components/ui/label";
import { Logo } from "@/react-app/components/Logo";
import { ThemeToggle } from "@/react-app/components/ThemeToggle";
import { useAuth } from "@/react-app/auth";
import { EnvelopeIcon, ArrowRightIcon } from "@/react-app/components/icons";

export default function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();

  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await forgotPassword(email);
      // Backend always responds 204; we deliberately show the same
      // confirmation whether or not the email existed (no enumeration).
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to start the reset flow. Please try again.",
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
            <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
            <p className="text-muted-foreground text-sm">
              Enter your email and we&apos;ll send you a link to reset it.
            </p>
          </div>
        </div>

        <div className="bg-card border border-border/50 shadow-sm p-8 rounded-md space-y-6">
          {submitted ? (
            <div className="space-y-4 text-sm">
              <p>
                If an account exists for <span className="font-medium">{email}</span>, a reset link
                is on its way. The link expires in 30 minutes.
              </p>
              <p className="text-muted-foreground">
                Didn&apos;t get an email? Check your spam folder, or{" "}
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setSubmitted(false)}
                >
                  try again
                </button>
                .
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
                  htmlFor="email"
                  className="font-medium text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Email Address
                </Label>
                <div className="relative">
                  <EnvelopeIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@firm.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-11 h-11 rounded-md bg-background border-input focus-visible:ring-1 focus-visible:ring-primary shadow-sm"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 text-sm font-semibold rounded-md shadow-sm bg-primary hover:bg-primary/90 text-primary-foreground transition-all"
                disabled={isLoading}
              >
                {isLoading ? "Sending…" : "Send reset link"}
                {!isLoading && <ArrowRightIcon className="ml-2 w-4 h-4" />}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link to="/login" className="text-primary hover:underline font-medium">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
