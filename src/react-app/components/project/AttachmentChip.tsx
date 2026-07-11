// src/react-app/components/project/AttachmentChip.tsx
//
// A composer attachment shown as a document PREVIEW CARD (à la Claude): a
// page-thumbnail with a file-type badge, reflecting the upload-on-attach
// lifecycle as a single clockwise progress ring that grows in real time:
//   uploading  → primary ring filling with the live byte percentage
//   processing → amber ring filling with the backend OCR / chunk / embed %
//   done       → emerald ring (full) with a check inside
//   error      → red alert
// The green check appears ONLY when the backend has fully parsed the document.

import { X } from "lucide-react";

import { cn } from "@/react-app/lib/utils";
import { ProgressRing } from "@/react-app/components/ui/ProgressRing";
import type { ChatAttachment } from "./types";

function badgeColor(type: string): string {
  switch (type.toUpperCase()) {
    case "PDF":
      return "bg-rose-600";
    case "DOC":
    case "DOCX":
      return "bg-blue-600";
    case "XLS":
    case "XLSX":
    case "CSV":
      return "bg-emerald-600";
    case "TXT":
    case "MD":
      return "bg-slate-600";
    default:
      return "bg-slate-600";
  }
}

export function AttachmentChip({
  att,
  onRemove,
}: {
  att: ChatAttachment;
  onRemove: () => void;
}) {
  const status = att.uploadStatus;
  const uploading = status === "uploading";
  const processing = status === "processing";
  const error = status === "error";
  const done = status === "done";
  // Always removable now. The parent hook (`useComposerAttachments`) aborts
  // the in-flight XHR via its AbortController when ``removeAttachment`` is
  // called, so cancelling a mid-upload chip genuinely halts the upload
  // rather than leaving bytes flowing to the server in the background.
  const removable = true;

  // One percentage drives the ring across the whole lifecycle:
  //  • uploading  → live XHR byte %
  //  • processing → backend pages_done/pages_total (clamped 5..99 by the hook)
  //  • done/error → ignored (ring renders its terminal icon)
  const ringPct = uploading
    ? (att.uploadProgress ?? 0)
    : processing
      ? (att.processingProgress ?? 0)
      : 0;
  const ringState = error
    ? "error"
    : done
      ? "done"
      : processing
        ? "processing"
        : "uploading";
  const showOverlay = uploading || processing || error;
  const statusLabel = uploading
    ? "Hochladen"
    : processing
      ? "Verarbeite"
      : error
        ? "Fehler"
        : null;

  return (
    <div className="relative w-36 group" title={att.uploadError || att.name}>
      {/* Thumbnail */}
      <div
        className={cn(
          "relative aspect-[4/3] rounded-xl border overflow-hidden flex items-center justify-center",
          error
            ? "border-destructive/40 bg-destructive/5"
            : "border-border/60 bg-muted/40",
        )}
      >
        {/* Faux document page */}
        <div className="absolute inset-3 rounded-md bg-background shadow-sm border border-border/40 p-2.5 flex flex-col gap-1.5">
          {["w-3/4", "w-full", "w-5/6", "w-full", "w-2/3"].map((w, i) => (
            <span
              key={i}
              className={cn("h-1 rounded-full bg-muted-foreground/15", w)}
            />
          ))}
        </div>

        {/* File-type badge (bottom-left, as in the reference) */}
        <span
          className={cn(
            "absolute bottom-1.5 left-1.5 text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded text-white",
            badgeColor(att.type),
          )}
        >
          {att.type}
        </span>

        {/* Lifecycle overlay — single clockwise ring + status word. The ring
            renders the green check itself once status === "done". */}
        {showOverlay ? (
          <div className="absolute inset-0 bg-background/85 backdrop-blur-[1px] flex flex-col items-center justify-center gap-1.5">
            <ProgressRing size={42} value={ringPct} state={ringState} showLabel />
            {statusLabel && (
              <span className="text-[10px] font-medium text-muted-foreground">
                {statusLabel}
              </span>
            )}
          </div>
        ) : done ? (
          <div className="absolute top-1.5 right-1.5">
            <ProgressRing size={18} value={100} state="done" />
          </div>
        ) : null}
      </div>

      {/* Filename */}
      <p className="mt-1 text-[11px] text-foreground truncate px-0.5">
        {att.name}
      </p>

      {/* Remove */}
      {removable && (
        <button
          onClick={onRemove}
          title="Entfernen"
          aria-label={`Entfernen ${att.name}`}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-background border border-border shadow flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
