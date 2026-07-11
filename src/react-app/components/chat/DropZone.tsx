// src/react-app/components/chat/DropZone.tsx
//
// Drag-and-drop upload area. UI_GUIDE.md §5.8:
//   - Accept: .pdf, .docx, .txt, .md  (plus what the backend Docling
//     pipeline also handles: .doc, .csv, .xls/.xlsx)
//   - Max 50 MB
//   - On drop: POST /upload, show progress, surface errors inline
//
// Why a dedicated component when ChatInput already supports drag-drop
// inside the textarea container: STATUS.md #1 — the spec calls for a
// drop target the lawyer sees BEFORE they've typed anything. The chat
// page's empty state is the natural home for it (Day 0 of the demo:
// "drop a PDF on the left to start"). Keeping it as a reusable
// component means a future left-panel layout (UI_GUIDE.md §3.1) can
// reuse it unchanged.
//
// The upload itself goes through ``uploadDocument`` from ragApi — same
// path as ChatInput's file picker — so the session-creation /
// document-confirmation handling stays in one place (DashboardChat's
// ``handleSendMessage`` for the picker; this component's ``onUploaded``
// callback for the drop-zone). Both pathways end in the same UploadResponse.

import { useCallback, useRef, useState } from "react";
import { UploadCloud, X, FileText, Loader2 } from "lucide-react";

import { Button } from "@/react-app/components/ui/button";
import { cn } from "@/react-app/lib/utils";
import {
  uploadDocument,
  type UploadResponse,
} from "@/react-app/lib/ragApi";

// Mirrors the ChatInput file picker so the two upload paths accept the
// same set. Spec is .pdf/.docx/.txt/.md; the rest are what Docling can
// actually parse and what the backend ``/upload`` route accepts.
const ACCEPTED_EXTS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xlsx",
  ".xls",
  ".txt",
  ".csv",
  ".md",
] as const;
const ACCEPTED_EXTS_LOWER = ACCEPTED_EXTS.map((e) => e.toLowerCase());

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB per UI_GUIDE.md §5.8

export interface DropZoneProps {
  /** Active session id, or null to let the backend mint a fresh one. */
  sessionId: string | null;
  /**
   * Preferred path: hand dropped/picked files to the caller WITHOUT
   * uploading. The chat wires this to the composer's attachment list so the
   * lawyer can add a question and send one combined turn — instead of the
   * file uploading the instant it lands and appearing as a bare user turn
   * with no chance to type. When supplied, this component does no uploading
   * of its own (``onUploaded`` and the in-flight rows are unused).
   */
  onFiles?: (files: File[]) => void;
  /** Legacy path: upload here and fire after each success. Used only when
   *  ``onFiles`` is not supplied. */
  onUploaded?: (response: UploadResponse) => void;
  /** Optional — show a different message when no files have been
   *  uploaded yet (used in the chat empty state). */
  hint?: string;
  className?: string;
}

interface UploadingRow {
  id: string;
  filename: string;
  size: number;
  // ``progress`` is 0..1; we can't get a real upload progress out of
  // ``fetch`` without switching to XHR, so we just show an indeterminate
  // spinner with the filename pinned while in flight.
  status: "uploading" | "done" | "error";
  errorMessage?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOk(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTS_LOWER.some((ext) => lower.endsWith(ext));
}

function rowId(): string {
  // Avoid pulling utils/uuid for one ephemeral id — the rows live in
  // local state for at most one upload cycle.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function DropZone({
  sessionId,
  onFiles,
  onUploaded,
  hint,
  className,
}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [rows, setRows] = useState<UploadingRow[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Drag counter — naive ``onDragLeave`` flickers when crossing nested
  // children. Counting enter/leave pairs is the standard fix.
  const dragDepthRef = useRef(0);

  const startUpload = useCallback(
    async (files: File[]) => {
      // Validate first so we can show a single error row per rejected
      // file without firing the upload.
      const pending: UploadingRow[] = files.map((f) => {
        if (!extensionOk(f.name)) {
          return {
            id: rowId(),
            filename: f.name,
            size: f.size,
            status: "error",
            errorMessage: `Unsupported file type. Accepted: ${ACCEPTED_EXTS.join(", ")}`,
          };
        }
        if (f.size > MAX_SIZE_BYTES) {
          return {
            id: rowId(),
            filename: f.name,
            size: f.size,
            status: "error",
            errorMessage: `File exceeds the 50 MB limit (${formatBytes(f.size)}).`,
          };
        }
        return {
          id: rowId(),
          filename: f.name,
          size: f.size,
          status: "uploading",
        };
      });

      // Reserve the rows up front so the user sees feedback immediately,
      // even before the first network call resolves.
      setRows((prev) => [...prev, ...pending]);

      // Sequential — and we thread the session id from the FIRST upload's
      // response into the rest so every file in one drop joins ONE Matter
      // (data room). The ``sessionId`` prop is null on a new chat, so
      // without carrying ``result.session_id`` forward each file would mint
      // its OWN session and the data room would scatter across N sessions.
      let activeSid = sessionId;
      for (let i = 0; i < files.length; i++) {
        const row = pending[i];
        if (row.status === "error") continue;
        try {
          const result = await uploadDocument(files[i], activeSid);
          // First upload established (or confirmed) the session; pin it for
          // the remaining files.
          activeSid = result.session_id;
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id ? { ...r, status: "done" } : r,
            ),
          );
          onUploaded?.(result);
        } catch (e: unknown) {
          const message =
            e instanceof Error ? e.message : "Upload failed.";
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id
                ? { ...r, status: "error", errorMessage: message }
                : r,
            ),
          );
        }
      }
    },
    [sessionId, onUploaded],
  );

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    // Only count enters that actually carry files — text drags from
    // inside the page shouldn't paint the drop affordance.
    if (e.dataTransfer.types.includes("Files")) {
      dragDepthRef.current += 1;
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    // Prefer handing files to the composer; only upload here in legacy mode.
    if (onFiles) onFiles(files);
    else void startUpload(files);
  };

  const handlePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = ""; // allow re-picking the same file
    if (files.length === 0) return;
    if (onFiles) onFiles(files);
    else void startUpload(files);
  };

  const clearRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Drop target */}
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload a document by dropping it here or clicking to browse"
        className={cn(
          "relative rounded-xl border-2 border-dashed transition-all cursor-pointer",
          "px-6 py-8 flex flex-col items-center justify-center text-center",
          "outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border/60 hover:border-primary/50 hover:bg-muted/30",
        )}
      >
        <UploadCloud
          className={cn(
            "w-8 h-8 mb-3 transition-colors",
            isDragging ? "text-primary" : "text-muted-foreground",
          )}
        />
        <p className="text-sm font-medium text-foreground">
          {isDragging
            ? "Drop to upload"
            : "Drop a document here, or click to browse"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {hint ??
            `Accepted: ${ACCEPTED_EXTS.join(", ")} · Max 50 MB`}
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept={ACCEPTED_EXTS.join(",")}
          onChange={handlePickerChange}
        />
      </div>

      {/* In-flight + completed + errored rows */}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm",
                r.status === "error"
                  ? "bg-destructive/5 border-destructive/30 text-destructive"
                  : "bg-muted/40 border-border/40",
              )}
            >
              {r.status === "uploading" ? (
                <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
              ) : r.status === "done" ? (
                <span
                  className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"
                  aria-label="parsed"
                  title="parsed"
                />
              ) : (
                <span
                  className="w-2 h-2 rounded-full bg-destructive flex-shrink-0"
                  aria-label="failed"
                  title="failed"
                />
              )}

              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />

              <div className="flex-1 min-w-0">
                <p className="truncate text-foreground">{r.filename}</p>
                <p className="text-[0.7rem] text-muted-foreground">
                  {r.status === "uploading" && `Uploading · ${formatBytes(r.size)}`}
                  {r.status === "done" && `Parsed · ${formatBytes(r.size)}`}
                  {r.status === "error" && r.errorMessage}
                </p>
              </div>

              {r.status !== "uploading" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-60 hover:opacity-100"
                  onClick={() => clearRow(r.id)}
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
