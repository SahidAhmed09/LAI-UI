// src/react-app/components/ui/ProgressRing.tsx
//
// A clockwise circular progress indicator used by every upload affordance
// (chat attachment, project Files panel, library row). Drives the ring with
// SVG stroke-dashoffset so the fill animates smoothly from 0 → 100 going
// clockwise from the 12 o'clock position. State controls the colour and the
// inner icon — a green checkmark replaces the ring when status === "done".

import { Check, AlertCircle } from "lucide-react";

import { cn } from "@/react-app/lib/utils";

/**
 * Heuristic for how long server-side OCR + chunk + embed takes for a PDF of
 * a given byte size. Calibrated to *slightly overestimate* typical wall-time
 * on the current analyzer (~7 s per MB) — this way 90% of the natural curve
 * lines up with actual completion under normal conditions, instead of being
 * reached early and stranding the user at 99% while the work finishes. The
 * floor/ceiling keeps tiny PDFs from sprinting and huge ones from looking
 * frozen at the start.
 */
export function estimateProcessingMs(sizeBytes: number): number {
  const mb = sizeBytes / (1024 * 1024);
  return Math.max(15_000, Math.min(240_000, Math.round(mb * 7_000)));
}

// Initial-burst window: how long the ring spends climbing from 0 → BURST_TARGET
// before it settles into the linear climb. Without this, a 20+ MB PDF whose
// estimated T is 100s+ would spend the first ~10s in single-digit % — which
// reads as "stuck" even though it's technically correct. A short, visible
// burst at the start signals "we're working" immediately, regardless of size.
const BURST_MS = 1500;
const BURST_TARGET = 8;

/**
 * Natural progress curve for the "still working" phase where we have no
 * real per-step feedback (e.g. a synchronous server call doing chunk+embed).
 *
 * Returns a FLOAT — callers that need an integer for the ring fill should
 * `Math.round` it; the label can render decimals (see ``formatProgressLabel``)
 * to keep the displayed % visibly ticking even past 90, where integer
 * rounding would otherwise park the user at "99%".
 *
 * Three phases stitched together so the ring always feels alive:
 *   1. 0 → BURST_TARGET (8 %) over the first BURST_MS (1.5 s). A confidence
 *      bump so big files don't look frozen at 1–2 % for the first 10 seconds.
 *   2. BURST_TARGET → 90 % linearly through the rest of the estimated window.
 *      Steady, predictable climb — reaching 90 % means the work is *about*
 *      to finish under the estimate.
 *   3. 90 → 99.5 % asymptotic past T, with a VERY slow decay (10T window).
 *      Combined with one-decimal label rendering, this gives the user a
 *      steadily climbing tail (94.2 → 94.5 → 94.8…) instead of "stuck at 99".
 *
 *   t = 0          →  0
 *   t = 0.75 s     →  4
 *   t = 1.5 s      →  8     ← end of burst
 *   t = T/2        → 46
 *   t = T          → 90     ← "almost done" under the estimate
 *   t = 2T         → 90.9
 *   t = 5T         → 93.1
 *   t = 10T        → 95.6
 *   t = 30T        → 99.0
 *   t = ∞          → 99.5   ← never crosses; 100 always comes from real completion
 */
export function naturalProgressPct(elapsedMs: number, estimatedMs: number): number {
  const t = Math.max(0, elapsedMs);
  const T = Math.max(1, estimatedMs);

  // Phase 1: opening burst.
  if (t < BURST_MS) return (t / BURST_MS) * BURST_TARGET;

  // Phase 2: linear climb to 90 over the remainder of the estimate.
  const denom = Math.max(1, T - BURST_MS);
  const r = (t - BURST_MS) / denom;
  if (r <= 1) return BURST_TARGET + (90 - BURST_TARGET) * r;

  // Phase 3: very slow asymptote past the estimate. 10T decay means even
  // reality 30× the estimate doesn't park the curve at 99 — every 300ms tick
  // still moves the float by a measurable fraction, which one-decimal label
  // rendering surfaces as visible motion.
  return Math.min(99.5, 90 + 9.5 * (1 - Math.exp(-(r - 1) / 10)));
}

/**
 * Format a progress percentage for display alongside a ring. Below 90 the
 * integer reads fine ("47%"); past 90 we surface one decimal so the user
 * sees a continuously updating value through the long tail of the natural
 * curve ("97.3%") instead of an apparently-frozen integer "99%".
 */
export function formatProgressLabel(pct: number): string {
  if (pct >= 100) return "100%";
  if (pct >= 90) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

export type ProgressRingState = "uploading" | "processing" | "done" | "error";

interface ProgressRingProps {
  /** 0–100. Ignored when state === "done" (always 100). */
  value: number;
  /** Lifecycle stage — drives the colour and the inner icon. */
  state: ProgressRingState;
  /** Outer diameter in px. Stroke thickness scales with size. */
  size?: number;
  /** Render the percentage inside the ring. Only sensible at size ≥ 36. */
  showLabel?: boolean;
  className?: string;
}

export function ProgressRing({
  value,
  state,
  size = 28,
  showLabel = false,
  className,
}: ProgressRingProps) {
  const stroke = Math.max(2, Math.round(size / 10));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = state === "done" ? 100 : Math.max(0, Math.min(100, value));
  const offset = c * (1 - pct / 100);

  const ringColor =
    state === "done"
      ? "stroke-emerald-500"
      : state === "error"
        ? "stroke-destructive"
        : state === "processing"
          ? "stroke-amber-500"
          : "stroke-primary";

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-label={
        state === "done"
          ? "Bereit"
          : state === "error"
            ? "Fehler"
            : `${Math.round(pct)} Prozent`
      }
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        // Rotate so the arc starts at 12 o'clock and grows clockwise.
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={cn(
            ringColor,
            "transition-[stroke-dashoffset] duration-300 ease-out",
          )}
        />
      </svg>
      {state === "done" ? (
        <Check
          className="absolute text-emerald-500"
          strokeWidth={3}
          style={{ width: size * 0.55, height: size * 0.55 }}
        />
      ) : state === "error" ? (
        <AlertCircle
          className="absolute text-destructive"
          style={{ width: size * 0.55, height: size * 0.55 }}
        />
      ) : showLabel ? (
        <span
          className="absolute font-semibold tabular-nums text-foreground"
          style={{ fontSize: Math.max(9, Math.round(size * 0.28)) }}
        >
          {formatProgressLabel(pct)}
        </span>
      ) : null}
    </div>
  );
}
