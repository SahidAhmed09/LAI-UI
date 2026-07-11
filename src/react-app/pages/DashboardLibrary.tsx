"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/react-app/components/ui/tabs";
import { Card, CardContent } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/react-app/components/ui/dropdown-menu";
import {
  FolderTree,
  FileBarChart2,
  ShieldAlert,
  History,
  FileText,
} from "lucide-react";
import {
  ProgressRing,
  formatProgressLabel,
} from "@/react-app/components/ui/ProgressRing";
import { useUploadQueue } from "@/react-app/hooks/UploadQueueProvider";
import {
  ManuscriptIcon,
  UploadIcon,
  SearchIcon,
  FilterIcon,
  PlusIcon,
  StorageIcon,
  LensIcon,
  SandglassIcon,
} from "@/react-app/components/icons";
import {
  fetchDocuments,
  deleteDocument as deleteDocumentApi,
  type ReportSummary,
} from "@/react-app/lib/ddiqApi";
import type { DocumentItem } from "@/react-app/lib/ddiqDemoData";
import { DocumentReportTree } from "@/react-app/components/DocumentReportTree";
import ReportDownloadPanel from "@/react-app/components/ReportDownloadPanel";
import { PastReportsSection } from "@/react-app/components/PastReportsSection";
import { RiskOverview } from "@/react-app/components/RiskOverview";

type Tab = "library" | "generate" | "reports" | "risk";

const statusColor: Record<DocumentItem["status"], string> = {
  analyzed:
    "text-emerald-600 bg-emerald-500/10 dark:text-emerald-500 dark:bg-emerald-500/20",
  pending:
    "text-amber-600 bg-amber-500/10 dark:text-amber-500 dark:bg-amber-500/20",
  archived:
    "text-slate-500 bg-slate-500/10 dark:text-slate-400 dark:bg-slate-500/20",
};

export default function DashboardLibraryPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deep-link support: /dashboard/documents?tab=generate|risk lands directly
  // on that tab (the dashboard's report/risk cards use this).
  const [searchParams] = useSearchParams();
  const paramTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(
    paramTab === "generate" || paramTab === "reports" || paramTab === "risk"
      ? paramTab
      : "library",
  );
  // A report the user chose to open from the Past Reports tab — handed to the
  // generator (which loads it into the preview), then cleared.
  const [reportToOpen, setReportToOpen] = useState<ReportSummary | null>(null);

  const openReport = (summary: ReportSummary) => {
    setReportToOpen(summary);
    setTab("generate");
  };
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Upload queue lives in the dashboard-wide ``UploadQueueProvider`` so the
  // rows + their AbortControllers survive Chat ↔ Documents ↔ Projects
  // navigation. Previously this was component-local state that vanished the
  // moment the user left the Documents tab, even though the XHRs were still
  // running. Naming preserved (``uploadQueue``, ``uploadError``, …) so the
  // render block below didn't need to change.
  const {
    queue: uploadQueue,
    error: uploadError,
    setError: setUploadError,
    processFiles,
    cancelUpload,
    dismissUploadRow,
    retryUpload,
  } = useUploadQueue();

  // ── Load documents ──
  const loadDocuments = async () => {
    try {
      const res = await fetchDocuments();
      setDocuments(res.documents);
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  // ── Filtering ──
  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      doc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = !filterStatus || doc.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // ── Drag & drop ──
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files);
  };

  // When uploads complete, refresh the documents grid so the new files
  // appear in the library list without the user having to reload. We watch
  // the SET of done-row ids (joined as a string for cheap dep comparison)
  // so the effect re-runs only on terminal transitions.
  const doneSignature = uploadQueue
    .filter((r) => r.status === "done")
    .map((r) => r.id)
    .join(",");
  useEffect(() => {
    if (doneSignature) {
      void loadDocuments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneSignature]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.currentTarget.files?.length) processFiles(e.currentTarget.files);
    e.currentTarget.value = "";
  };
  const triggerFileInput = () => fileInputRef.current?.click();

  // ── Document actions ──
  const deleteDocument = async (id: string) => {
    const prev = documents;
    setDocuments((docs) => docs.filter((d) => d.id !== id));
    try {
      await deleteDocumentApi(id);
    } catch (err) {
      console.error("Failed to delete document:", err);
      setUploadError(
        err instanceof Error ? err.message : "Failed to delete document",
      );
      setDocuments(prev);
      await loadDocuments();
    }
  };
  const archiveDocument = (id: string) =>
    setDocuments((docs) =>
      docs.map((d) => (d.id === id ? { ...d, status: "archived" as const } : d)),
    );
  const downloadDocument = (name: string) => {
    // TODO: GET /ddiq/documents/{id}/download when the endpoint exists.
    console.log(`Download: ${name}`);
  };

  const totalSize = documents.reduce((sum, doc) => sum + doc.size, 0);
  const analyzedCount = documents.filter((d) => d.status === "analyzed").length;

  return (
    <div className="space-y-6">
      {/* Compact cross-tab pill: only when uploads are active AND the user is
          on a tab that doesn't already show the full upload zone. Keeps the
          user oriented (something IS happening) without competing visually
          with the rich in-place upload zone on the Library tab. */}
      {uploadQueue.length > 0 && tab !== "library" && (
        <button
          onClick={() => setTab("library")}
          className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
        >
          <span className="flex items-center gap-2 text-sm text-foreground">
            <UploadIcon className="w-4 h-4 text-primary" />
            <span className="font-medium">
              {uploadQueue.filter((r) => r.status === "uploading" || r.status === "analyzing").length > 0
                ? `${uploadQueue.filter((r) => r.status === "uploading" || r.status === "analyzing").length} file(s) processing`
                : `${uploadQueue.length} upload(s) ready`}
            </span>
            <span className="text-xs text-muted-foreground">
              · Click to view in Library
            </span>
          </span>
          <span className="text-xs text-primary font-medium">Go to Library →</span>
        </button>
      )}

      {uploadError && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 flex items-center justify-between">
          <p className="text-sm text-rose-600 dark:text-rose-400">{uploadError}</p>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setUploadError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          <TabsTrigger value="library" className="flex items-center gap-2">
            <FolderTree className="w-4 h-4" />
            Library
            {documents.length > 0 && (
              <span className="text-[10px] font-medium ml-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                {documents.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="generate" className="flex items-center gap-2">
            <FileBarChart2 className="w-4 h-4" />
            Generate
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-2">
            <History className="w-4 h-4" />
            Past Reports
          </TabsTrigger>
          <TabsTrigger value="risk" className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            Risk Overview
          </TabsTrigger>
        </TabsList>

        {/* ── Library: documents → reports tree ── */}
        <TabsContent value="library" className="mt-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <SandglassIcon className="w-6 h-6 text-muted-foreground animate-pulse mr-3" />
              <span className="text-muted-foreground">Loading documents…</span>
            </div>
          ) : (
            <>
              {/* Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard
                  label="Total Documents"
                  value={documents.length}
                  Icon={ManuscriptIcon}
                />
                <StatCard
                  label="Total Size"
                  value={`${totalSize.toFixed(1)} MB`}
                  Icon={StorageIcon}
                />
                <StatCard label="Analyzed" value={analyzedCount} Icon={LensIcon} />
              </div>

              {/* ── Smart Upload Zone ──
                  One Card hosts BOTH the drop affordance and the live upload
                  rows. State drives the layout:
                    • empty queue → classic "Drag & drop" UI
                    • active queue → header summary + per-file rows + "+ Add
                      more" footer, all inside the same dashed-border card so
                      visually the uploads belong to the drop zone itself
                      (not a floating bar above the tabs).
                  Drag + drop + click all stay live in both states, so a user
                  can keep dropping files into the same zone to grow the
                  batch. The dashed border still highlights primary-color
                  while dragging, matching the empty-state behaviour. */}
              <Card
                className={`bg-card/50 backdrop-blur border-2 border-dashed transition-colors ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : uploadQueue.length > 0
                      ? "border-border/60"
                      : "border-border/50 hover:border-slate-400 dark:hover:border-slate-600 cursor-pointer"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={
                  uploadQueue.length === 0 ? triggerFileInput : undefined
                }
              >
                <CardContent className="p-6">
                  {uploadQueue.length === 0 ? (
                    // ── Empty state ──
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="p-3 rounded-md bg-muted">
                        <UploadIcon className="w-7 h-7 text-slate-600 dark:text-slate-400" />
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-foreground">
                          Drag & drop PDF files here
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          or click to select — PDFs are extracted, chunked,
                          and embedded for analysis
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerFileInput();
                        }}
                      >
                        <PlusIcon className="w-4 h-4 mr-2" />
                        Select Files
                      </Button>
                    </div>
                  ) : (
                    // ── Active queue ──
                    <div className="space-y-4">
                      {(() => {
                        const inFlight = uploadQueue.filter(
                          (r) => r.status === "uploading" || r.status === "analyzing",
                        ).length;
                        const done = uploadQueue.filter(
                          (r) => r.status === "done",
                        ).length;
                        const failed = uploadQueue.filter(
                          (r) => r.status === "error",
                        ).length;
                        const total = uploadQueue.length;
                        // Overall batch progress = average of per-row progress,
                        // with done rows counted as 100. Drives the slim
                        // progress bar shown for batches of 10+ files where
                        // the user can't see all rows at once on screen.
                        const overallPct = total === 0
                          ? 0
                          : Math.round(
                              uploadQueue.reduce(
                                (s, r) => s + (r.status === "done" ? 100 : r.progress),
                                0,
                              ) / total,
                            );
                        const showBatchBar = total >= 10;
                        return (
                          <>
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div className="p-2 rounded-md bg-primary/10">
                                  <UploadIcon className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-foreground">
                                    {inFlight > 0
                                      ? `Uploading ${inFlight} of ${total} file${total === 1 ? "" : "s"}`
                                      : `${total} file${total === 1 ? "" : "s"}`}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {[
                                      inFlight > 0 && `${inFlight} in progress`,
                                      done > 0 && `${done} analyzed`,
                                      failed > 0 && `${failed} failed`,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ") || "—"}
                                  </p>
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="shadow-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  triggerFileInput();
                                }}
                              >
                                <PlusIcon className="w-4 h-4 mr-1.5" />
                                Add more
                              </Button>
                            </div>
                            {/* Batch-level progress bar — only shown for
                                large batches (10+) where the per-row rings
                                aren't all visible at once on screen. Lets
                                the user see "we're 47 % through the 50
                                files" at a glance without scrolling. */}
                            {showBatchBar && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                                  <span>Batch progress</span>
                                  <span>{overallPct}% · {done}/{total} complete</span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                  <div
                                    className="h-full bg-primary rounded-full transition-all duration-300"
                                    style={{ width: `${overallPct}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* Per-file cards — each row is its own bordered chip with
                          subtle status-tinted backgrounds so a glance reveals
                          which files are mid-flight, done, or failed. */}
                      <div className="space-y-1.5">
                        {uploadQueue.map((row) => {
                          const ringState =
                            row.status === "done"
                              ? "done"
                              : row.status === "error"
                                ? "error"
                                : row.status === "analyzing"
                                  ? "processing"
                                  : "uploading";
                          const label =
                            row.status === "uploading"
                              ? `Uploading · ${Math.round(row.progress)}%`
                              : row.status === "analyzing"
                                ? `Analyzing · ${formatProgressLabel(row.progress)}`
                                : row.status === "done"
                                  ? "Analyzed"
                                  : "Failed";
                          const labelClass =
                            row.status === "done"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : row.status === "error"
                                ? "text-destructive"
                                : row.status === "analyzing"
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-primary";
                          const rowBg =
                            row.status === "done"
                              ? "bg-emerald-500/5 border-emerald-500/20"
                              : row.status === "error"
                                ? "bg-destructive/5 border-destructive/20"
                                : row.status === "analyzing"
                                  ? "bg-amber-500/5 border-amber-500/20"
                                  : "bg-primary/5 border-primary/20";
                          return (
                            <div
                              key={row.id}
                              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${rowBg}`}
                            >
                              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <span
                                className="text-sm text-foreground truncate flex-1"
                                title={row.name}
                              >
                                {row.name}
                              </span>
                              <span
                                className={`flex items-center gap-2 text-xs tabular-nums font-medium ${labelClass}`}
                                title={row.status === "error" ? row.error : undefined}
                              >
                                <ProgressRing
                                  size={18}
                                  value={row.progress}
                                  state={ringState}
                                />
                                {label}
                              </span>
                              {/* Retry button for failed rows — re-fires the
                                  same upload pipeline (with its own retry +
                                  backoff) using the File still held on the
                                  row. Only shown when status === "error". */}
                              {row.status === "error" && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    retryUpload(row.id);
                                  }}
                                  className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex-shrink-0 px-1.5 py-0.5 rounded hover:bg-primary/10"
                                  title="Retry upload"
                                >
                                  Retry
                                </button>
                              )}
                              {/* X is ALWAYS rendered now:
                                  • uploading/analyzing → cancels the XHR via
                                    AbortController, removes the row from the
                                    queue, and the backend stops streaming
                                    bytes for this file.
                                  • done/error → just dismisses the row from
                                    the queue (the file stays in the library). */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const inFlight =
                                    row.status === "uploading" ||
                                    row.status === "analyzing";
                                  if (inFlight) cancelUpload(row.id);
                                  else dismissUploadRow(row.id);
                                }}
                                className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                                title={
                                  row.status === "uploading" ||
                                  row.status === "analyzing"
                                    ? "Cancel upload"
                                    : "Dismiss"
                                }
                              >
                                <PlusIcon className="w-4 h-4 rotate-45" />
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {/* Footer drop-hint — invites the user to drag in more
                          PDFs without leaving the zone. The whole Card already
                          accepts drops; this is just signage. */}
                      <div
                        className={`border-t border-dashed pt-3 text-center text-xs transition-colors ${
                          dragActive
                            ? "border-primary/60 text-primary"
                            : "border-border/60 text-muted-foreground"
                        }`}
                      >
                        {dragActive
                          ? "Drop to add to this batch"
                          : "Drag & drop additional PDFs here to extend this batch"}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>


              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf"
                onChange={handleFileInputChange}
                style={{ display: "none" }}
              />

              {/* Search + filter */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <SearchIcon className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search documents…"
                    className="pl-10"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <FilterIcon className="w-4 h-4 mr-2" />
                      {filterStatus
                        ? filterStatus.charAt(0).toUpperCase() +
                          filterStatus.slice(1)
                        : "Status"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setFilterStatus(null)}>
                      All Statuses
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("analyzed")}>
                      Analyzed
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("pending")}>
                      Pending
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("archived")}>
                      Archived
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* The tree, or an empty state */}
              {documents.length === 0 ? (
                <div className="text-center py-12 rounded-xl border border-border/60 bg-card/40">
                  <ManuscriptIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-muted-foreground">No documents uploaded yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload a PDF above, then generate reports under the Generate
                    tab — they'll appear nested under their documents here.
                  </p>
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="text-center py-12 rounded-xl border border-border/60 bg-card/40">
                  <p className="text-muted-foreground">
                    No documents match your search
                  </p>
                </div>
              ) : (
                <DocumentReportTree
                  documents={documents}
                  visibleDocuments={filteredDocuments}
                  statusColor={statusColor}
                  onDownloadDoc={downloadDocument}
                  onArchiveDoc={archiveDocument}
                  onDeleteDoc={deleteDocument}
                  onOpenReport={openReport}
                />
              )}
            </>
          )}
        </TabsContent>

        {/* ── Generate Report (full DDiQ flow). Its built-in past-reports
            browser is hidden here because we surface it as its own tab.
            ``forceMount`` keeps the panel mounted across tab switches so an
            in-progress (or just-completed) report keeps its step — otherwise
            Radix unmounts it on tab change and a finished report would reset
            to the document picker instead of showing its preview/export. ── */}
        <TabsContent
          value="generate"
          className="mt-6 data-[state=inactive]:hidden"
          forceMount
        >
          <ReportDownloadPanel
            documents={documents}
            hidePastReports
            openReport={reportToOpen}
            onOpenHandled={() => setReportToOpen(null)}
          />
        </TabsContent>

        {/* ── Past Reports — dedicated browser; "Open" loads into Generate ── */}
        <TabsContent value="reports" className="mt-6">
          <PastReportsSection onOpen={openReport} />
        </TabsContent>

        {/* ── Risk Overview (aggregated findings, reused intact) ── */}
        <TabsContent value="risk" className="mt-6">
          <RiskOverview />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string | number;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-2">{value}</p>
          </div>
          <div className="p-2.5 rounded-md bg-muted">
            <Icon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
