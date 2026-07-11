// Past Reports — a dedicated browser for every DDiQ report generated, shown
// as its own section/tab in the Documents & Reports hub.
//
// "Open" hands the report up to the host (which loads it into the report
// preview, a pure DB read — no GPU re-run); "Delete" removes it. Kept
// self-contained and decoupled from the heavy report-builder so it can live
// in its own tab without dragging the generation flow along.

import { useEffect, useState } from "react";
import { FileBarChart2, Trash2, Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/react-app/components/ui/card";
import { cn } from "@/react-app/lib/utils";
import {
  listReports,
  deleteReport,
  type ReportSummary,
} from "@/react-app/lib/ddiqApi";

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

const STATUS_TONE: Record<string, string> = {
  done: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  queued: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  failed: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export function PastReportsSection({
  onOpen,
}: {
  onOpen: (summary: ReportSummary) => void;
}) {
  const [items, setItems] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listReports(50)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load reports");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = async (r: ReportSummary) => {
    const label = r.project_name || "this report";
    if (
      !window.confirm(
        `Delete "${label}"?\n\nThis permanently removes the report and its cadastral artifacts. This cannot be undone.`,
      )
    )
      return;
    setDeletingId(r.report_id);
    try {
      await deleteReport(r.report_id);
      setItems((prev) => prev.filter((x) => x.report_id !== r.report_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete report");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-3 text-primary" />
        Loading reports…
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="p-8 text-center text-sm text-destructive">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="p-12 text-center space-y-3">
          <FileBarChart2 className="w-10 h-10 text-muted-foreground mx-auto opacity-60" />
          <h3 className="text-base font-semibold">No reports yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Generate a DDiQ report under the{" "}
            <span className="font-medium">Generate Report</span> tab — completed
            reports appear here, ready to reopen without re-running the
            pipeline.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
      <div className="bg-muted/40 px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">Past Reports</h4>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Reopen a previously generated report — no GPU re-run needed.
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {items.length} report{items.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="divide-y divide-border/30">
        {items.map((r) => {
          const dur = formatDuration(r.started_at, r.finished_at);
          const canOpen = r.status === "done" && deletingId !== r.report_id;
          const isDeleting = deletingId === r.report_id;
          return (
            <div
              key={r.report_id}
              className={cn(
                "flex items-start gap-3 px-4 py-3 transition-colors",
                isDeleting && "opacity-40 pointer-events-none",
                canOpen && "hover:bg-muted/40",
              )}
            >
              <div className="p-2 rounded-lg bg-muted/60 flex-shrink-0">
                <FileBarChart2 className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">
                    {r.project_name || "Untitled report"}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-medium uppercase",
                      STATUS_TONE[r.status] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {r.status}
                  </span>
                  {r.preset && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300">
                      {r.preset}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1 text-[11px] text-muted-foreground">
                  <span>{formatTimestamp(r.created_at || r.started_at)}</span>
                  <span>·</span>
                  <span>
                    {r.doc_count} doc{r.doc_count === 1 ? "" : "s"}
                  </span>
                  {r.status === "done" && (
                    <>
                      <span>·</span>
                      <span>
                        {r.finding_count} finding
                        {r.finding_count === 1 ? "" : "s"}
                      </span>
                    </>
                  )}
                  {dur && (
                    <>
                      <span>·</span>
                      <span>{dur}</span>
                    </>
                  )}
                </div>
                {r.error && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 truncate">
                    {r.error}
                  </p>
                )}
              </div>

              {canOpen && (
                <button
                  type="button"
                  onClick={() => onOpen(r)}
                  className="self-center flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  Open <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDelete(r)}
                disabled={isDeleting}
                title="Delete report"
                aria-label={`Delete report ${r.project_name || ""}`}
                className="self-center flex-shrink-0 p-1.5 rounded text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
