// src/react-app/components/chat/CitationPanel.tsx
//
// Right-side drawer that shows the full text + metadata of the chunk
// behind the currently-open citation chip. Opens when a CitationChip is
// clicked anywhere in the chat thread; closes via the × button, the ESC
// key, or by clicking outside.
//
// Matter ([M-n]) handles now render the uploaded document inline via
// the browser's native PDF viewer — fetched from
// ``GET /sessions/{session_id}/document`` as a blob, wrapped in
// ``URL.createObjectURL``, handed to an ``<object>`` tag. No pdfjs
// dependency: Chrome / Firefox / Safari ship excellent built-in PDF
// renderers and the v1 demo only needs "open the right document",
// not page-precise highlighting (deferred to v1.1 per the strategy
// doc).
//
// Corpus ([C-n]) handles render the chunk excerpt as plain text in a
// scrollable card, same as before.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Scale, FileText } from "lucide-react";

import { Button } from "@/react-app/components/ui/button";
import { cn } from "@/react-app/lib/utils";
import {
  fetchSessionDocument,
  fetchMatterDocument,
  type Chunk,
  type SessionDocumentResult,
} from "@/react-app/lib/ragApi";

export interface CitationPanelProps {
  /** Currently-open handle, or null when the panel is closed. */
  openHandle: string | null;
  /** Chunks from the same RAG response the chip belongs to. */
  chunks: Chunk[];
  /** Fires when the panel should close. */
  onClose: () => void;
  /** Session id — needed so the matter [M-n] preview can fetch the
   *  uploaded document bytes from ``GET /sessions/{id}/document``.
   *  When ``null`` the matter preview falls back to the chunk excerpt. */
  sessionId: string | null;
}

export function CitationPanel({
  openHandle,
  chunks,
  onClose,
  sessionId,
}: CitationPanelProps) {
  // ── ESC-to-close ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!openHandle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openHandle, onClose]);

  const chunk = openHandle
    ? chunks.find((c) => c.cite_id === openHandle)
    : undefined;
  // Prefer the chunk's source_kind; fall back to the handle prefix so the
  // header is labelled correctly even if the chunk isn't in this turn.
  const isCorpus = chunk
    ? chunk.source_kind !== "matter"
    : (openHandle?.startsWith("C-") ?? true);
  // Friendly label + number for the header (matches CitationChip naming).
  const handleNum = openHandle?.split("-")[1] ?? "";
  const sourceLabel = isCorpus
    ? `Rechtsquelle ${handleNum}`
    : `Dokument ${handleNum}`;

  // ── Matter document fetch ────────────────────────────────────────────
  // Only fired when the panel opens on a matter ([M-n]) handle AND we
  // have a session id. The fetched blob URL must be revoked when the
  // panel closes (or the chunk handle changes) to avoid memory leaks.
  const [docResult, setDocResult] = useState<SessionDocumentResult | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  useEffect(() => {
    if (!openHandle || isCorpus || !sessionId) {
      setDocResult(null);
      return;
    }
    let cancelled = false;
    let lastObjectUrl: string | null = null;
    setDocLoading(true);
    setDocResult(null);
    // Route to the specific document behind this [M-n] handle. Parse the
    // n from "M-3" → 3 and fetch that document; fall back to the legacy
    // single-document endpoint if the handle isn't an M-n (shouldn't
    // happen for matter chunks, but keeps the panel robust).
    const m = /^M-(\d+)$/.exec(openHandle);
    const fetchPromise = m
      ? fetchMatterDocument(sessionId, Number(m[1]))
      : fetchSessionDocument(sessionId);
    fetchPromise.then((result) => {
      if (cancelled) {
        // Component unmounted before fetch completed — revoke the
        // newly-minted blob URL to avoid leaking memory for a panel
        // the user already closed.
        if (result.ok) URL.revokeObjectURL(result.objectUrl);
        return;
      }
      if (result.ok) lastObjectUrl = result.objectUrl;
      setDocResult(result);
      setDocLoading(false);
    });
    return () => {
      cancelled = true;
      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    };
  }, [openHandle, isCorpus, sessionId]);

  if (!openHandle) return null;

  // Render through a portal to <body> so the fixed-position drawer is anchored
  // to the VIEWPORT, not to a transformed ancestor. The project detail view
  // wraps the chat in an ``animate-in slide-in-from-right`` element whose
  // ``transform`` would otherwise become the containing block for our
  // ``position: fixed`` backdrop/aside — trapping the panel inside the chat
  // column and overlapping the content instead of covering the screen.
  return createPortal(
    <>
      {/* Backdrop — fades the chat area and catches outside clicks. Sits
          beneath the panel z-wise. */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[1px] z-40"
        onClick={onClose}
        aria-hidden
      />

      {/* The panel itself — slides in from the right. Fixed width on
          desktop; full-width on mobile. */}
      <aside
        className={cn(
          "fixed right-0 top-0 bottom-0 w-full max-w-md z-50",
          "bg-background border-l border-border shadow-xl",
          "flex flex-col overflow-hidden",
          "animate-in slide-in-from-right duration-200",
        )}
        role="dialog"
        aria-label={`Source ${openHandle}`}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium",
                isCorpus
                  ? "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30"
                  : "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
              )}
            >
              {isCorpus ? <Scale className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
              {sourceLabel}
            </span>
            <span className="text-sm text-muted-foreground truncate">
              {isCorpus ? "Gesetzeskorpus" : "Hochgeladenes Dokument"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Matter ([M-n]) document preview — rendered for ANY matter handle
              that has a session, EVEN when this turn's chunks don't include the
              handle. We fetch the document by its index (parsed from "M-n") in
              the effect above, not via the chunk, so a summarised answer's
              "Dok n" chips still open the underlying file. The <object> tag is
              the most reliable cross-browser way to embed a PDF without pdfjs —
              Chrome, Firefox, and Safari all ship full PDF renderers. */}
          {!isCorpus && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Dokumentvorschau
                {chunk?.page ? (
                  <span className="ml-1 normal-case font-normal text-foreground">
                    · Seite {chunk.page}
                  </span>
                ) : null}
              </div>
              {docLoading && (
                <div className="h-64 flex items-center justify-center text-sm text-muted-foreground border border-border rounded-md bg-muted/30">
                  Lade Dokument…
                </div>
              )}
              {!docLoading && docResult?.ok && docResult.mediaType.startsWith("application/pdf") && (
                <object
                  // ``#page=N`` scrolls the browser's native PDF viewer to
                  // the cited page (Chrome/Firefox/Edge honour it on blob
                  // URLs). Omitted when the page is unknown.
                  data={chunk?.page ? `${docResult.objectUrl}#page=${chunk.page}` : docResult.objectUrl}
                  type="application/pdf"
                  className="w-full h-[28rem] rounded-md border border-border"
                  aria-label={docResult.filename || "Uploaded document"}
                >
                  {/* Fallback when the browser can't render PDFs inline. */}
                  <div className="text-sm text-muted-foreground p-3">
                    Ihr Browser kann diese PDF nicht inline anzeigen.{" "}
                    <a
                      href={docResult.objectUrl}
                      download={docResult.filename || "document.pdf"}
                      className="text-primary underline"
                    >
                      Herunterladen
                    </a>
                  </div>
                </object>
              )}
              {!docLoading && docResult?.ok && !docResult.mediaType.startsWith("application/pdf") && (
                <div className="text-sm text-muted-foreground border border-border rounded-md p-3 bg-muted/30">
                  Vorschau für {docResult.mediaType} nicht verfügbar.{" "}
                  <a
                    href={docResult.objectUrl}
                    download={docResult.filename || "document"}
                    className="text-primary underline"
                  >
                    Herunterladen
                  </a>
                </div>
              )}
              {!docLoading && docResult && !docResult.ok && (
                <div className="text-sm text-muted-foreground border border-border rounded-md p-3 bg-muted/30">
                  {docResult.reason === "not-attached" &&
                    "Diesem Chat ist kein Dokument angehängt."}
                  {docResult.reason === "missing-file" &&
                    "Das hochgeladene Dokument ist serverseitig nicht mehr verfügbar."}
                  {docResult.reason === "unreachable" &&
                    "Dokument konnte nicht geladen werden (Netzwerkfehler). Auszug unten."}
                </div>
              )}
              {!docLoading && !docResult && !sessionId && (
                <div className="text-sm text-muted-foreground border border-border rounded-md p-3 bg-muted/30">
                  Keine Session-ID verfügbar — nur Auszug wird angezeigt.
                </div>
              )}
            </div>
          )}

          {chunk ? (
            <>
              {/* Section / source label */}
              {chunk.section && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    Quelle
                  </div>
                  <div className="text-sm text-foreground">{chunk.section}</div>
                </div>
              )}

              {/* Law references (corpus only — matter chunks rarely have these) */}
              {chunk.law_refs && chunk.law_refs.length > 0 && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    Gesetzliche Bezüge
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {chunk.law_refs.map((ref) => (
                      <code
                        key={ref}
                        className="text-xs px-1.5 py-0.5 rounded bg-muted font-mono"
                      >
                        {ref}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {/* The chunk body */}
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  Auszug
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground border border-border rounded-md p-3 bg-muted/30">
                  {chunk.text}
                </div>
              </div>

              {/* Retrieval scores — useful for debugging, low-key styled */}
              {(chunk.similarity > 0 || chunk.rerank_score > 0) && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>
                    Vector similarity: {chunk.similarity.toFixed(3)}
                  </div>
                  <div>
                    Reranker score: {chunk.rerank_score.toFixed(3)}
                  </div>
                  {chunk.sources && chunk.sources.length > 0 && (
                    <div>Sources: {chunk.sources.join(", ")}</div>
                  )}
                </div>
              )}
            </>
          ) : isCorpus ? (
            // Corpus handle with no chunk in this turn — nothing to fetch.
            <div className="text-sm text-muted-foreground">
              Quelle {openHandle} ist in den Chunks dieser Antwort nicht
              enthalten — kein Auszug verfügbar.
            </div>
          ) : null}
        </div>
      </aside>
    </>,
    document.body,
  );
}
