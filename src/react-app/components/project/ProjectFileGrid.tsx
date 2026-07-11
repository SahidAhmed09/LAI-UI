import { useRef, useEffect, useState } from "react";
import {
  Plus,
  FileText,
  FileStack,
  Upload,
  X,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/react-app/components/ui/card";
import {
  ProgressRing,
  estimateProcessingMs,
  naturalProgressPct,
} from "@/react-app/components/ui/ProgressRing";
import { listMatterDocuments, type MatterDocStatus } from "@/react-app/lib/ragApi";
import { cn } from "@/react-app/lib/utils";
import { ProjectFile } from "./types";

interface ProjectFileGridProps {
  files: ProjectFile[];
  projectId: string;
  /** The project's backend matter session — drives live ingestion status. */
  sessionId?: string | null;
  onAddFiles: (projectId: string, files: FileList) => void;
  onDeleteFile: (projectId: string, fileId: string) => void;
}

const POLL_MS = 1500;

function getTypeBadgeClass(type: string): string {
  switch (type.toUpperCase()) {
    case "PDF":
      return "bg-red-500/15 text-red-500 dark:text-red-400 border border-red-500/25";
    case "DOCX":
    case "DOC":
      return "bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/25";
    case "XLSX":
    case "XLS":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25";
    case "TXT":
    case "MD":
    case "CSV":
      return "bg-slate-500/15 text-slate-500 dark:text-slate-400 border border-slate-500/25";
    default:
      return "bg-muted text-muted-foreground border border-border/50";
  }
}

/** Human-readable total size for the file count badge. ``files`` carries
 *  ``size`` already in MB (set in DashboardProjects.handleAddFiles), so we
 *  switch to GB once that exceeds 1024. No fake "capacity %" framing: the
 *  backend enforces per-file (100 MB) and per-session (pgvector) limits,
 *  not a per-project quota. The old ``totalMB / 200`` formula implied a
 *  cap that does not exist. */
function formatTotalSize(files: ProjectFile[]): string {
  const totalMB = files.reduce((acc, f) => acc + f.size, 0);
  if (totalMB >= 1024) return `${(totalMB / 1024).toFixed(2)} GB`;
  if (totalMB >= 10) return `${Math.round(totalMB)} MB`;
  return `${totalMB.toFixed(1)} MB`;
}

interface LiveStatus {
  status: MatterDocStatus;
  pagesDone: number;
  pagesTotal: number;
  nChunks: number;
}

export function ProjectFileGrid({
  files,
  projectId,
  sessionId,
  onAddFiles,
  onDeleteFile,
}: ProjectFileGridProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const totalSizeLabel = formatTotalSize(files);
  const [dragging, setDragging] = useState(false);

  // Live, backend-truth ingestion status keyed by filename. The green
  // checkmark must reflect ACTUAL searchability (status === "done"), not the
  // moment the upload POST returned — chat-side ingestion (OCR → chunk →
  // embed → index) runs in the background after that. We poll the matter
  // session while anything is still ingesting and self-stop once settled.
  const [live, setLive] = useState<Record<string, LiveStatus>>({});
  // When each filename first entered the processing phase. Used to drive the
  // client-side ring estimator so the % ticks smoothly between backend polls.
  const [startedAt, setStartedAt] = useState<Record<string, number>>({});
  // 300ms heartbeat so the asymptotic curve re-renders on every tick (no
  // network), keeping the ring visibly moving even when the backend hasn't
  // emitted a new pages_done yet. Re-evaluated only against state already in
  // scope, so no extra fetches.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setLive({});
      return;
    }
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      const docs = await listMatterDocuments(sessionId).catch(() => []);
      if (cancelled) return;
      const next: Record<string, LiveStatus> = {};
      for (const d of docs) {
        next[d.filename] = {
          status: d.status ?? "done",
          pagesDone: d.pages_done ?? 0,
          pagesTotal: d.pages_total ?? 0,
          nChunks: d.n_chunks ?? 0,
        };
      }
      setLive(next);
      // Stamp each filename the first time we see it processing so the
      // estimator anchor lines up with real backend start, not page-load.
      setStartedAt((prev) => {
        const out = { ...prev };
        let changed = false;
        for (const d of docs) {
          if (
            (d.status === "processing" || d.status === "queued") &&
            !out[d.filename]
          ) {
            out[d.filename] = Date.now();
            changed = true;
          }
        }
        return changed ? out : prev;
      });
      const active = docs.some(
        (d) => d.status === "queued" || d.status === "processing",
      );
      if (active && !cancelled) timer = window.setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, files.length]);

  // Fast heartbeat for the estimator — only while something is still in flight.
  useEffect(() => {
    const active = Object.values(live).some(
      (l) => l.status === "queued" || l.status === "processing",
    );
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 300);
    return () => clearInterval(id);
  }, [live]);

  const openPicker = () => fileInputRef.current?.click();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) onAddFiles(projectId, e.dataTransfer.files);
  };

  return (
    <Card
      className={cn(
        "bg-card/50 backdrop-blur border-border/50 transition-colors",
        dragging && "border-primary/60 ring-2 ring-primary/20",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the cursor actually leaves the card, not when it
        // moves over a child element.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Files</CardTitle>
        <button
          onClick={openPicker}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-md hover:bg-muted/50"
          title="Add files"
        >
          <Plus className="w-4 h-4" />
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Honest size + file count — no fake "% of capacity" framing, the
            backend has per-file (100 MB) and per-session (pgvector) limits,
            not a per-project quota. Empty until something's uploaded. */}
        {files.length > 0 && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums px-0.5">
            <span>
              {files.length} {files.length === 1 ? "file" : "files"}
            </span>
            <span>{totalSizeLabel}</span>
          </div>
        )}

        {/* Empty state — Claude-style: friendly illustration + copy, the
            whole panel is a click + drag-drop target. */}
        {files.length === 0 ? (
          <button
            onClick={openPicker}
            className={cn(
              "w-full flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
              dragging
                ? "border-primary/60 bg-primary/5"
                : "border-border/60 hover:border-primary/40 hover:bg-muted/30",
            )}
          >
            <div className="relative">
              <FileStack className="w-9 h-9 text-muted-foreground/70" strokeWidth={1.4} />
              <span className="absolute -bottom-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground">
                <Plus className="w-2.5 h-2.5" strokeWidth={3} />
              </span>
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">
                {dragging ? "Drop to add" : "Add files to this matter"}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-[16rem]">
                Add PDFs, contracts, permits, or other documents to ground the
                chat in this data room. Drag & drop or click to upload.
              </p>
            </div>
          </button>
        ) : (
          <div className="relative">
            {/* Drop overlay while dragging onto a populated panel */}
            {dragging && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/60 bg-primary/5 backdrop-blur-sm">
                <Upload className="w-5 h-5 text-primary" />
                <p className="text-xs font-medium text-primary">Drop to add files</p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {files.map((file) => {
                const baseName = file.name.includes(".")
                  ? file.name.substring(0, file.name.lastIndexOf("."))
                  : file.name;
                const ext = file.name.includes(".")
                  ? file.name.substring(file.name.lastIndexOf(".") + 1)
                  : "";

                // Status resolution: BACKEND IS THE SOURCE OF TRUTH. The
                // local ``file.status`` is just a hint while the row is fresh
                // (uploading/ready/error) — once the live poll has an entry
                // for this filename, that entry wins.
                //
                // Why this matters: a file the user added in a previous
                // session can end up with local ``status:"ready"`` but no
                // entry in the project's CURRENT backend session. Previously
                // we'd fall back to ``"queued"`` and the row stuck in
                // "Warteschlange…" forever (verified: session drift). And a
                // file that genuinely succeeded but had an earlier failed
                // attempt could keep local ``status:"error"`` even after the
                // backend ingested it cleanly — we'd show a red failed icon
                // for a fully-done file. Both cases are fixed by letting the
                // backend speak when it has data, and only falling back to
                // local state when it truly has nothing to say.
                const ls = live[file.name];
                type DisplayStatus = MatterDocStatus | "missing";
                let status: DisplayStatus;
                if (ls) {
                  status = ls.status;
                } else if (file.status === "uploading") {
                  status = "queued";
                } else if (file.status === "error") {
                  status = "failed";
                } else if (file.status === "ready") {
                  // Local says "ready" but the project's current session has
                  // no entry — the file was uploaded into a DIFFERENT session
                  // and is unreachable for this project's chat. Surface that
                  // honestly instead of pretending it's queued.
                  status = "missing";
                } else {
                  // No local status, no backend entry — treat as a seed /
                  // imported row and don't pretend something's happening.
                  status = "done";
                }

                const realPct =
                  ls && ls.pagesTotal > 0
                    ? Math.min(99, Math.round((ls.pagesDone / ls.pagesTotal) * 100))
                    : 0;
                // Linear estimator anchored on the moment we first saw this
                // file in flight — keeps the ring moving between backend polls
                // and during the gap before the first page is reported. Same
                // natural curve as the chat composer + library row.
                const t0 = startedAt[file.name];
                const T = estimateProcessingMs(file.size || 1_000_000);
                const elapsed = t0 ? Date.now() - t0 : 0;
                const estPct = t0 ? naturalProgressPct(elapsed, T) : 0;
                // Read `tick` so React keeps re-rendering this row while the
                // heartbeat is ticking (no-op otherwise — value isn't displayed).
                void tick;
                const pct =
                  status === "done" ? 100 : Math.max(realPct, estPct);
                const pctLabel =
                  pct >= 100 ? "100%" : `${pct.toFixed(2)}%`;

                const isDone = status === "done";
                const isFailed = status === "failed";
                const isProcessing = status === "processing";
                const isQueued = status === "queued";
                const isMissing = status === "missing";

                return (
                  <div
                    key={file.id}
                    className="group relative bg-background/60 rounded-xl border border-border/50 p-2.5 hover:border-border hover:shadow-sm transition-all"
                    title={
                      isFailed
                        ? file.error || "Ingestion failed"
                        : isMissing
                          ? "Diese Datei ist nicht in der aktuellen Projekt-Sitzung verfügbar — bitte erneut hochladen oder entfernen."
                          : isProcessing
                            ? `Verarbeite Seite ${ls?.pagesDone ?? 0}/${ls?.pagesTotal ?? 0}`
                            : isDone
                              ? `${file.name} · ${ls?.nChunks ?? 0} Abschnitte · bereit`
                              : "In Warteschlange…"
                    }
                  >
                    {(isDone || isFailed || isMissing) && (
                      <button
                        onClick={() => onDeleteFile(projectId, file.id)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-destructive-foreground rounded-full items-center justify-center hidden group-hover:flex shadow"
                        title="Remove file"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}

                    <div className="flex items-center gap-1.5">
                      {/* Lifecycle indicator: clockwise ring whose fill mirrors the
                          backend pages_done/pages_total, flipping to a green check
                          ring on "done" and to an alert icon on "failed". */}
                      {isDone && (
                        <ProgressRing
                          size={14}
                          value={100}
                          state="done"
                          className="flex-shrink-0"
                        />
                      )}
                      {isProcessing && (
                        <ProgressRing
                          size={14}
                          value={pct}
                          state="processing"
                          className="flex-shrink-0"
                        />
                      )}
                      {isQueued && (
                        <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 animate-pulse" aria-label="In Warteschlange" />
                      )}
                      {isFailed && (
                        <ProgressRing
                          size={14}
                          value={0}
                          state="error"
                          className="flex-shrink-0"
                        />
                      )}
                      {isMissing && (
                        <AlertTriangle
                          className="w-3.5 h-3.5 text-amber-500 flex-shrink-0"
                          aria-label="Nicht in aktueller Sitzung"
                        />
                      )}
                      <FileText className="w-3.5 h-3.5 text-muted-foreground/70 flex-shrink-0" />
                      <p className="text-xs font-medium text-foreground leading-tight truncate">
                        {baseName}
                        {ext && <span className="text-muted-foreground">.{ext}</span>}
                      </p>
                    </div>

                    <div className="mt-2 flex items-center gap-1.5">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${getTypeBadgeClass(file.type)}`}
                      >
                        {file.type}
                      </span>
                      {isQueued && (
                        <span className="text-[10px] text-muted-foreground">Warteschlange…</span>
                      )}
                      {isProcessing && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                          {pct > 0 ? pctLabel : "verarbeite…"}
                        </span>
                      )}
                      {isMissing && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400">
                          Nicht in dieser Sitzung — erneut hochladen
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Inline "add more" row, mirroring Claude's persistent
                  add affordance once files exist. */}
              <button
                onClick={openPicker}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/60 px-3 py-2 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/30 transition-colors"
                title="Add files"
              >
                <Plus className="w-4 h-4" />
                <span className="text-xs font-medium">Add files</span>
              </button>
            </div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xlsx,.xls,.txt,.csv,.md"
          onChange={(e) => {
            if (e.currentTarget.files) {
              onAddFiles(projectId, e.currentTarget.files);
              e.currentTarget.value = "";
            }
          }}
        />
      </CardContent>
    </Card>
  );
}
