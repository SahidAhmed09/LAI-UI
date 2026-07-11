// src/react-app/components/ConfidentialityBadge.tsx
//
// Top-of-screen trust pill — the five tokens a German lawyer needs to
// see in the first 5 seconds to believe LAI is safe to use with
// Mandanten-Daten. The wording matches the strategy doc (§2.1, §8):
//
//   On-Premise · BRAO § 43a · DSGVO · EU AI Act · No data leaves
//
// Static. No props, no state, no I/O — that's the point: it must be
// rendered identically on every page load and never depend on a
// network call that could fail and break the trust signal.
//
// Compact / icon-only variant is used in the collapsed sidebar so the
// signal survives even when the user squeezes the layout.

import { ShieldCheck } from "lucide-react";

import { cn } from "@/react-app/lib/utils";

export interface ConfidentialityBadgeProps {
  /** When true, renders just the shield icon (for the collapsed
   *  sidebar). When false (default), renders the full token list. */
  compact?: boolean;
  className?: string;
}

const TOKENS = [
  "On-Premise",
  "BRAO § 43a",
  "DSGVO",
  "EU AI Act",
  "No data leaves",
] as const;

const TOOLTIP =
  "LAI runs entirely on this server. No Mandanten-Daten is sent to " +
  "any external service. Compliant with BRAO § 43a Verschwiegenheit, " +
  "DSGVO, and the EU AI Act.";

export function ConfidentialityBadge({
  compact = false,
  className,
}: ConfidentialityBadgeProps) {
  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-md",
          "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
          className,
        )}
        title={TOOLTIP}
        aria-label={TOOLTIP}
      >
        <ShieldCheck className="w-4 h-4" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md",
        "text-[0.7rem] font-medium",
        "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
        "border border-emerald-200/60 dark:border-emerald-500/20",
        className,
      )}
      title={TOOLTIP}
      aria-label={TOOLTIP}
    >
      <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex items-center gap-1">
        {TOKENS.map((token, i) => (
          <span key={token} className="flex items-center">
            {i > 0 && (
              <span className="mx-1 text-emerald-400/70 dark:text-emerald-500/60">
                ·
              </span>
            )}
            <span className="whitespace-nowrap">{token}</span>
          </span>
        ))}
      </span>
    </div>
  );
}
