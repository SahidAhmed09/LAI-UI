// Shared, enhanced progress UI for DDiQ report generation.
//
// One component used both in the report builder (Generate tab) and on the
// dashboard so the look and the stage vocabulary stay identical. The backend
// emits terse step keys (``classifying``, ``analyzing_clause``, …); we map
// them to readable labels, animate the bar with a moving sheen while running,
// and show live elapsed time.

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/react-app/lib/utils";
import type { ReportStatus } from "@/react-app/lib/ddiqApi";

// Maps the pipeline's raw step keys (see analyzer/pipeline.py `_emit`) to
// human-readable stage labels.
const REPORT_STEP_LABELS: Record<string, string> = {
  queued: "Queued — waiting for a worker",
  segmenting: "Segmenting documents",
  starting: "Starting analysis",
  classifying: "Classifying contract type",
  classify_done: "Contract type identified",
  preparing_context: "Preparing document context",
  preparing_context_done: "Context prepared",
  tables_reconciled: "Reconciling tables & figures",
  extracting_parcels: "Extracting cadastral parcels",
  parcels_done: "Parcels extracted",
  analyzing_clause: "Analyzing clauses",
  clauses_done: "Clause analysis complete",
  whole_contract: "Reviewing the whole contract",
  done: "Finalizing report",
  error: "Generation failed",
};

function reportStepLabel(step?: string | null): string {
  if (!step) return "Working…";
  return REPORT_STEP_LABELS[step] ?? step.replace(/_/g, " ");
}

function elapsedLabel(startedAt?: string | null): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface ReportProgressBarProps {
  status: ReportStatus;
  /** Raw backend step key (optional). */
  step?: string | null;
  /** Progress as a percentage, 0–100. */
  value: number;
  /** ISO start time — drives the live elapsed clock. */
  startedAt?: string | null;
  /** Dashboard variant: tighter, no reassurance footnote. */
  compact?: boolean;
  className?: string;
}

export function ReportProgressBar({
  status,
  step,
  value,
  startedAt,
  compact = false,
  className,
}: ReportProgressBarProps) {
  const running = status === "running" || status === "queued";
  const done = status === "done";
  const failed = status === "failed";

  // Tick once a second while running so the elapsed clock advances smoothly
  // between backend polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running || !startedAt) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [running, startedAt]);

  const rawPct = Math.min(100, Math.max(0, Math.round(value || 0)));
  // Show a little movement for queued/0% so the bar never looks dead.
  const pct = done ? 100 : status === "queued" ? Math.max(rawPct, 4) : rawPct;
  const label = failed
    ? "Generation failed"
    : done
      ? "Report ready"
      : reportStepLabel(step);
  const elapsed = running ? elapsedLabel(startedAt) : null;

  const fillClass = failed
    ? "bg-destructive"
    : done
      ? "bg-emerald-500"
      : "bg-gradient-to-r from-primary to-primary/70";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {failed ? (
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
          ) : done ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          ) : (
            <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
          )}
          <span
            className={cn(
              "font-medium truncate",
              compact ? "text-xs" : "text-sm",
            )}
          >
            {label}
          </span>
          {elapsed && (
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1 flex-shrink-0">
              <Clock className="w-3 h-3" />
              {elapsed}
            </span>
          )}
        </div>
        <span
          className={cn(
            "font-semibold tabular-nums flex-shrink-0",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {pct}%
        </span>
      </div>

      <div
        className={cn(
          "relative w-full rounded-full bg-muted overflow-hidden",
          compact ? "h-2" : "h-2.5",
        )}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full overflow-hidden transition-[width] duration-700 ease-out",
            fillClass,
          )}
          style={{ width: `${pct}%` }}
        >
          {running && (
            <div className="absolute inset-0 -skew-x-12 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-progress-shimmer" />
          )}
        </div>
      </div>

      {!compact && running && (
        <p className="text-xs text-muted-foreground">
          You can leave this page — the run continues on the server and resumes
          here when you return.
        </p>
      )}
    </div>
  );
}
