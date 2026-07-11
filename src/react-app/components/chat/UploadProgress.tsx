// Live upload-progress panel shown above the composer while one or more
// documents are being uploaded.
//
// Before this, attaching several PDFs uploaded them silently one-by-one —
// the user saw bubbles appear with no indication of which file was in
// flight or whether it had landed. This panel renders the whole batch at
// once with a per-file status (uploading → done → error) and an overall
// "n of N" counter, so multi-file uploads are legible.

import { Loader2, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { cn } from "@/react-app/lib/utils";

export type UploadItemStatus = "pending" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  name: string;
  status: UploadItemStatus;
  error?: string;
}

export function UploadProgress({ items }: { items: UploadItem[] }) {
  if (items.length === 0) return null;

  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "error").length;
  const total = items.length;
  const finished = done + failed;
  const pct = Math.round((finished / total) * 100);
  const allDone = finished === total;

  return (
    <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0">
          {allDone ? (
            failed > 0 ? (
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            )
          ) : (
            <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
          )}
          <span className="text-sm font-medium truncate">
            {allDone
              ? failed > 0
                ? `Uploaded ${done} of ${total} · ${failed} failed`
                : total === 1
                  ? "Document uploaded"
                  : `All ${total} documents uploaded`
              : total === 1
                ? "Uploading document…"
                : `Uploading ${Math.min(finished + 1, total)} of ${total}…`}
          </span>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
          {pct}%
        </span>
      </div>

      {/* Overall progress bar */}
      <div className="h-1 w-full bg-muted">
        <div
          className={cn(
            "h-full transition-all duration-300",
            failed > 0 && allDone ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Per-file rows — only when uploading several, to keep it compact */}
      {total > 1 && (
        <ul className="px-2 py-1.5 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 px-2 py-1 rounded-md text-xs"
            >
              <span className="flex-shrink-0">
                {item.status === "done" && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                )}
                {item.status === "uploading" && (
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                )}
                {item.status === "error" && (
                  <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                )}
                {item.status === "pending" && (
                  <FileText className="w-3.5 h-3.5 text-muted-foreground/50" />
                )}
              </span>
              <span
                className={cn(
                  "truncate flex-1",
                  item.status === "error"
                    ? "text-destructive"
                    : item.status === "done"
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
                title={item.error ?? item.name}
              >
                {item.name}
              </span>
              <span className="flex-shrink-0 text-[0.65rem] text-muted-foreground/70">
                {item.status === "uploading"
                  ? "uploading…"
                  : item.status === "done"
                    ? "ready"
                    : item.status === "error"
                      ? "failed"
                      : "queued"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
