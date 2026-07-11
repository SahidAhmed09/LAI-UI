// src/react-app/components/chat/DocumentList.tsx
//
// Per-document list with LIVE ingestion status. A Matter (data room) holds
// many documents, each ingested asynchronously by the backend: uploaded →
// queued → processing (OCR page-by-page + embed + index) → done | failed.
//
// This component polls ``GET /sessions/{id}/documents`` while any document
// is still ingesting and renders, per row:
//   • queued      → "In Warteschlange…"
//   • processing  → spinner + progress bar (Seite X/Y)
//   • done        → green checkmark + "N Seiten · M Abschnitte"
//   • failed      → red alert + error
// Polling self-stops once every document is done/failed, so an idle matter
// makes no requests.

import { useEffect, useState } from "react";
import { FileText, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";

import {
  listMatterDocuments,
  type MatterDocStatus,
} from "@/react-app/lib/ragApi";
import { cn } from "@/react-app/lib/utils";

export interface DocumentRow {
  filename: string;
  pages: number;
  // "uploading" is a client-only state for a row the parent is tracking
  // before the first poll lands; the rest mirror the backend status.
  status: MatterDocStatus | "uploading";
  citeId?: string;
  pagesDone?: number;
  pagesTotal?: number;
  nChunks?: number;
  error?: string | null;
}

export interface DocumentListProps {
  /** Session whose documents to list. ``null`` → empty list (no fetch). */
  sessionId: string | null;
  /** Rows the parent already knows about (e.g. an upload still in flight
   *  before the first poll). Merged on top of fetched rows by filename. */
  pendingRows?: DocumentRow[];
  /** Counter the parent bumps after each successful upload to force a
   *  refetch (and restart polling). */
  refreshKey?: number;
  className?: string;
  /** Fires whenever ingestion state changes: ``true`` while any document
   *  is queued/processing, ``false`` once all are done/failed. The parent
   *  uses this to gate the chat composer so a question isn't asked against
   *  a document that isn't searchable yet (otherwise the answer silently
   *  falls back to the corpus with a dangling [M-n]). */
  onIngestingChange?: (ingesting: boolean) => void;
}

const POLL_MS = 1500;

export function DocumentList({
  sessionId,
  pendingRows,
  refreshKey,
  className,
  onIngestingChange,
}: DocumentListProps) {
  const [fetched, setFetched] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setFetched([]);
      onIngestingChange?.(false);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      const docs = await listMatterDocuments(sessionId);
      if (cancelled) return;
      setFetched(
        docs.map((d) => ({
          filename: d.filename,
          pages: d.n_pages || 0,
          status: d.status ?? "done",
          citeId: d.cite_id,
          pagesDone: d.pages_done ?? 0,
          pagesTotal: d.pages_total ?? 0,
          nChunks: d.n_chunks ?? 0,
          error: d.error,
        })),
      );
      setLoading(false);
      // Keep polling only while something is still ingesting.
      const active = docs.some(
        (d) => d.status === "queued" || d.status === "processing",
      );
      // Surface the ingestion state so the parent can gate the composer.
      onIngestingChange?.(active);
      if (active && !cancelled) timer = window.setTimeout(poll, POLL_MS);
    };

    setLoading(true);
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, refreshKey, onIngestingChange]);

  const merged = mergeRows(fetched, pendingRows ?? []);

  if (merged.length === 0 && !loading) {
    return (
      <div
        className={cn(
          "px-3 py-2 text-xs text-muted-foreground italic",
          className,
        )}
      >
        No documents uploaded yet.
      </div>
    );
  }

  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {loading && merged.length === 0 && (
        <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading documents…
        </li>
      )}
      {merged.map((row) => (
        <DocumentRowItem
          key={`${row.filename}-${row.citeId ?? row.status}`}
          row={row}
        />
      ))}
    </ul>
  );
}

function DocumentRowItem({ row }: { row: DocumentRow }) {
  const isProcessing = row.status === "processing";
  const isQueued = row.status === "queued" || row.status === "uploading";
  const isFailed = row.status === "failed";
  const isDone = row.status === "done";

  const total = row.pagesTotal ?? 0;
  const done = row.pagesDone ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <li className="flex items-start gap-2.5 px-3 py-2 rounded-md bg-muted/30 border border-border/40">
      {/* Status icon */}
      <span className="flex-shrink-0 mt-0.5">
        {isDone && (
          <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-label="Fertig" />
        )}
        {isProcessing && (
          <Loader2
            className="w-4 h-4 text-amber-500 animate-spin"
            aria-label="Wird verarbeitet"
          />
        )}
        {isQueued && (
          <Clock className="w-4 h-4 text-muted-foreground" aria-label="In Warteschlange" />
        )}
        {isFailed && (
          <AlertCircle className="w-4 h-4 text-destructive" aria-label="Fehlgeschlagen" />
        )}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {row.citeId && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.65rem] font-mono font-semibold bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 flex-shrink-0">
              {row.citeId}
            </span>
          )}
          <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <p className="text-sm truncate text-foreground" title={row.filename}>
            {row.filename}
          </p>
        </div>

        {/* Status line */}
        {isDone && (
          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
            {row.pages > 0 ? `${row.pages} Seite${row.pages === 1 ? "" : "n"}` : "—"}
            {row.nChunks ? ` · ${row.nChunks} Abschnitte` : ""}
            {" · bereit"}
          </p>
        )}
        {isQueued && (
          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
            In Warteschlange…
          </p>
        )}
        {isFailed && (
          <p
            className="text-[0.7rem] text-destructive mt-0.5 truncate"
            title={row.error ?? undefined}
          >
            Fehlgeschlagen{row.error ? `: ${row.error}` : ""}
          </p>
        )}
        {isProcessing && (
          <div className="mt-1">
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-300"
                style={{ width: total > 0 ? `${pct}%` : "40%" }}
              />
            </div>
            <p className="text-[0.7rem] text-muted-foreground mt-0.5">
              {total > 0
                ? `Verarbeite Seite ${done}/${total} (${pct}%)`
                : "Wird verarbeitet…"}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

function mergeRows(fetched: DocumentRow[], pending: DocumentRow[]): DocumentRow[] {
  const byName = new Map<string, DocumentRow>();
  for (const r of fetched) byName.set(r.filename, r);
  // A pending (just-uploaded) row only wins if the backend hasn't returned
  // a row for that filename yet — once the server tracks it, the live
  // backend status (with real progress) takes over.
  for (const r of pending) {
    if (!byName.has(r.filename)) byName.set(r.filename, r);
  }
  return Array.from(byName.values());
}
