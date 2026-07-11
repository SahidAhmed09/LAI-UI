// src/react-app/components/HealthGate.tsx
//
// Boot-time gate that polls ``GET /health`` and blocks the dashboard UI
// until the backend reports ``loaded: true``. Implements UI_GUIDE.md
// §8.2 (cold-start splash) and §8.4 (offline blocking screen).
//
// Three render states:
//   - cold-start  : reachable, ``loaded: false``  → splash with progress dots
//   - offline     : unreachable (network error)   → "Contact the operator"
//   - ready       : reachable, ``loaded: true``   → render children, stop polling
//
// Why a gate and not an inline error: a half-rendered chat with a broken
// /query is a worse demo than a clean "Loading the legal corpus" screen.
// The lawyer's first 30 seconds determine whether they trust the tool —
// see strategy doc §2.
//
// Polling cadence: 5 s as specified in UI_GUIDE.md §8.2. AbortController
// cancels the in-flight fetch on unmount and on each new tick so a slow
// /health response can't pile up.

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";

import { Logo } from "@/react-app/components/Logo";
import { fetchHealth, type HealthStatus } from "@/react-app/lib/ragApi";

const POLL_INTERVAL_MS = 5_000;

type GateState =
  | { kind: "probing" }                            // first probe in flight
  | { kind: "cold"; status: HealthStatus }          // reachable, model warming
  | { kind: "offline" }                             // network/connection error
  | { kind: "ready" };                              // loaded — render children

export interface HealthGateProps {
  children: React.ReactNode;
}

export function HealthGate({ children }: HealthGateProps) {
  const [state, setState] = useState<GateState>({ kind: "probing" });
  // Bump to force a re-probe (used by the "Retry" button on the offline
  // screen so the user doesn't have to wait for the next 5s tick).
  const [tick, setTick] = useState(0);

  // Single in-flight probe at a time — cancel the previous one on every
  // tick so a stuck request can't shadow a fresh successful one.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Once the backend is ready we stop polling entirely — the dashboard
    // tolerates the backend going down mid-session (chat surfaces inline
    // errors); we only block on the boot path.
    if (state.kind === "ready") return;

    const probe = async () => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;

      const result = await fetchHealth();
      if (cancelled || ctl.signal.aborted) return;

      if (!result.reachable) {
        setState({ kind: "offline" });
        return;
      }
      if (result.status.loaded) {
        setState({ kind: "ready" });
        return;
      }
      setState({ kind: "cold", status: result.status });
    };

    probe();
    const handle = window.setInterval(probe, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
      abortRef.current?.abort();
    };
    // ``state.kind === "ready"`` is the only state-driven dependency that
    // matters (it tears down the interval). ``tick`` is the manual retry
    // signal from the offline screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind === "ready", tick]);

  if (state.kind === "ready") return <>{children}</>;

  if (state.kind === "offline") {
    return (
      <OfflineScreen onRetry={() => {
        setState({ kind: "probing" });
        setTick((t) => t + 1);
      }} />
    );
  }

  // "probing" and "cold" share the same splash — the only difference is
  // the model-name footnote, which we only have once a probe succeeds.
  const model = state.kind === "cold" ? state.status.llm_model : null;
  return <ColdStartSplash modelName={model ?? undefined} />;
}

// ─── Subviews ────────────────────────────────────────────────────────────

function ColdStartSplash({ modelName }: { modelName?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background text-foreground px-6">
      <div className="mb-6">
        <Logo size="lg" showText={false} />
      </div>
      <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
      <h1 className="text-xl font-semibold mb-2">Loading the legal corpus</h1>
      <p className="text-sm text-muted-foreground max-w-sm text-center">
        The 350&nbsp;GB German legal corpus is being mapped into memory.
        This usually takes about 5&nbsp;minutes on first boot.
      </p>
      <ProgressDots className="mt-6" />
      {modelName && (
        <p className="mt-8 text-[0.7rem] text-muted-foreground/70 font-mono">
          model: {modelName}
        </p>
      )}
    </div>
  );
}

function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background text-foreground px-6">
      <div className="mb-6">
        <Logo size="lg" showText={false} />
      </div>
      <div className="w-14 h-14 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-4">
        <ShieldAlert className="w-7 h-7" />
      </div>
      <h1 className="text-xl font-semibold mb-2">Backend is offline</h1>
      <p className="text-sm text-muted-foreground max-w-sm text-center">
        LAI couldn&apos;t reach the on-prem inference server. Please
        contact the operator and confirm the service is running.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

function ProgressDots({ className }: { className?: string }) {
  // Three dots that pulse in sequence — pure-CSS via Tailwind's
  // ``animate-bounce`` with staggered ``animation-delay`` inline styles.
  return (
    <div className={"flex items-center gap-1.5 " + (className ?? "")}>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-2 h-2 rounded-full bg-primary/60 animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
