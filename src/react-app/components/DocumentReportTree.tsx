// Document → Reports tree.
//
// The merged "Documents & Reports" library's centerpiece: each uploaded
// document is a node, expandable to reveal the DDiQ reports generated from it.
// Reports are linked to documents by matching a report's ``analyzedDocuments``
// (filenames) to ``document.name`` — the only reliable cross-session link the
// API exposes (the report list summary carries no doc ids). Reports that match
// no current document fall into an "Unlinked reports" group so nothing is
// hidden, and we never fabricate a link.

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  FileText,
  FileBarChart2,
  MoreHorizontal,
  Download,
  Archive,
  Trash2,
  Loader2,
  Eye,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/react-app/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/react-app/components/ui/dropdown-menu";
import { Button } from "@/react-app/components/ui/button";
import {
  listReports,
  fetchReport,
  type ReportStatus,
  type ReportSummary,
} from "@/react-app/lib/ddiqApi";
import { PRESETS, type DocumentItem } from "@/react-app/lib/ddiqDemoData";

interface ReportNode {
  reportId: string;
  title: string;
  preset: string | null;
  findingCount: number;
  status: ReportStatus;
  finishedAt: string | null;
  summary: ReportSummary; // full summary so "View" can open it in the preview
}

interface FetchedReport {
  node: ReportNode;
  docs: string[]; // analyzedDocuments filenames
}

interface DocumentReportTreeProps {
  /** Full document list (used to resolve report links). */
  documents: DocumentItem[];
  /** Which documents to actually render (post search/filter). */
  visibleDocuments: DocumentItem[];
  statusColor: Record<DocumentItem["status"], string>;
  onDownloadDoc: (name: string) => void;
  onArchiveDoc: (id: string) => void;
  onDeleteDoc: (id: string) => void;
  /** Open a generated report in the report preview (host loads it). */
  onOpenReport: (summary: ReportSummary) => void;
}

function presetLabel(preset: string | null): string {
  if (!preset) return "DDiQ Report";
  return PRESETS.find((p) => p.id === preset)?.name ?? preset;
}

function formatDate(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ReportRow({
  r,
  onOpenReport,
}: {
  r: ReportNode;
  onOpenReport: (summary: ReportSummary) => void;
}) {
  const date = formatDate(r.finishedAt);
  return (
    <div className="flex items-center gap-2.5 pl-11 pr-3 py-2 hover:bg-muted/40 transition-colors group/r">
      <FileBarChart2 className="w-4 h-4 text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{r.title}</p>
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
          <span>{presetLabel(r.preset)}</span>
          <span>· {r.findingCount} finding{r.findingCount === 1 ? "" : "s"}</span>
          {date && (
            <span className="inline-flex items-center gap-1">
              · <CalendarDays className="w-3 h-3" /> {date}
            </span>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs opacity-0 group-hover/r:opacity-100 transition-opacity"
        onClick={() => onOpenReport(r.summary)}
        title="Open report preview"
      >
        <Eye className="w-3.5 h-3.5" />
        View
      </Button>
    </div>
  );
}

export function DocumentReportTree({
  documents,
  visibleDocuments,
  statusColor,
  onDownloadDoc,
  onArchiveDoc,
  onDeleteDoc,
  onOpenReport,
}: DocumentReportTreeProps) {
  const [fetched, setFetched] = useState<FetchedReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [unlinkedOpen, setUnlinkedOpen] = useState(false);

  // Fetch completed reports once and resolve their analyzed documents. Only
  // "done" reports carry full data (analyzedDocuments); in-flight reports live
  // in the Generate tab until they complete.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingReports(true);
      try {
        const reports = await listReports(50);
        const done = reports.filter((r) => r.status === "done");
        const fulls = await Promise.allSettled(
          done.map((r) => fetchReport(r.report_id)),
        );
        if (cancelled) return;
        const out: FetchedReport[] = [];
        fulls.forEach((res, i) => {
          if (res.status !== "fulfilled") return;
          const summary = done[i];
          const rep = res.value.report;
          out.push({
            node: {
              reportId: summary.report_id,
              title:
                rep.projectName ||
                summary.project_name ||
                "DDiQ Report",
              preset: summary.preset,
              findingCount: summary.finding_count,
              status: summary.status,
              finishedAt: summary.finished_at,
              summary,
            },
            docs: rep.analyzedDocuments ?? [],
          });
        });
        setFetched(out);
      } catch {
        /* leave the tree document-only if reports can't be loaded */
      } finally {
        if (!cancelled) setLoadingReports(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Map reports onto documents by filename; collect the rest as "unlinked".
  const { byDoc, unlinked } = useMemo(() => {
    const names = new Set(documents.map((d) => d.name));
    const m = new Map<string, ReportNode[]>();
    const un: ReportNode[] = [];
    for (const fr of fetched) {
      const matched = fr.docs.filter((n) => names.has(n));
      if (matched.length === 0) {
        un.push(fr.node);
        continue;
      }
      for (const n of matched) {
        const list = m.get(n) ?? [];
        list.push(fr.node);
        m.set(n, list);
      }
    }
    return { byDoc: m, unlinked: un };
  }, [fetched, documents]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
      {visibleDocuments.map((doc) => {
        const reports = byDoc.get(doc.name) ?? [];
        const isOpen = expanded.has(doc.id);
        const hasReports = reports.length > 0;
        return (
          <div key={doc.id} className="border-b border-border/30 last:border-b-0">
            {/* Document row */}
            <div className="flex items-center gap-2 px-3 py-3 hover:bg-muted/30 transition-colors group">
              <button
                onClick={() => hasReports && toggle(doc.id)}
                className={cn(
                  "flex-shrink-0 p-0.5 rounded transition-transform",
                  hasReports
                    ? "text-muted-foreground hover:text-foreground"
                    : "opacity-0 pointer-events-none",
                  isOpen && "rotate-90",
                )}
                title={isOpen ? "Collapse" : "Expand"}
                aria-label={isOpen ? "Collapse" : "Expand"}
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <div className="p-2 rounded-lg bg-muted/60 flex-shrink-0">
                <FileText className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium truncate text-sm">{doc.name}</p>
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                  <span>{doc.size.toFixed(1)} MB</span>
                  <span>· {doc.uploadDate}</span>
                  <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {doc.category}
                  </span>
                  {hasReports && (
                    <span className="inline-flex items-center gap-1 text-foreground/70">
                      · <FileBarChart2 className="w-3 h-3 text-primary" />
                      {reports.length} report{reports.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>

              <span
                className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded-md flex-shrink-0",
                  statusColor[doc.status],
                )}
              >
                {doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
              </span>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity flex-shrink-0"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onDownloadDoc(doc.name)}>
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onArchiveDoc(doc.id)}>
                    <Archive className="w-4 h-4 mr-2" />
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDeleteDoc(doc.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Report children */}
            {isOpen && hasReports && (
              <div className="bg-muted/20 border-t border-border/30 divide-y divide-border/20 animate-in fade-in slide-in-from-top-1 duration-150">
                {reports.map((r) => (
                  <ReportRow
                    key={r.reportId}
                    r={r}
                    onOpenReport={onOpenReport}
                  />
                ))}
              </div>
            )}

            {/* "No reports" hint when expanded with none — only reachable if a
                doc had its report unlinked; defensive. */}
            {isOpen && !hasReports && (
              <div className="bg-muted/20 border-t border-border/30 pl-11 pr-3 py-2 text-xs text-muted-foreground italic">
                No reports generated from this document yet.
              </div>
            )}
          </div>
        );
      })}

      {/* Reports analysing now-removed documents */}
      {!loadingReports && unlinked.length > 0 && (
        <div className="border-t border-border/40 bg-muted/10">
          <button
            onClick={() => setUnlinkedOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight
              className={cn(
                "w-4 h-4 transition-transform",
                unlinkedOpen && "rotate-90",
              )}
            />
            <FileBarChart2 className="w-4 h-4 text-primary" />
            <span className="font-medium">Unlinked reports</span>
            <span className="text-[11px] px-1.5 rounded-full bg-muted">
              {unlinked.length}
            </span>
            <span className="text-[11px] text-muted-foreground/70 ml-1">
              (their source documents are no longer in the library)
            </span>
          </button>
          {unlinkedOpen && (
            <div className="divide-y divide-border/20 border-t border-border/30">
              {unlinked.map((r) => (
                <ReportRow key={r.reportId} r={r} onOpenReport={onOpenReport} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loading reports footer */}
      {loadingReports && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border/30 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          Linking generated reports…
        </div>
      )}
    </div>
  );
}
