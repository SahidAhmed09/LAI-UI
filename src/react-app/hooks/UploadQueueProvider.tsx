// src/react-app/hooks/UploadQueueProvider.tsx
//
// App-level upload queue for the DDiQ document library. Lives ABOVE the
// per-page state so that switching between dashboard sub-routes (Chat /
// Projects / Documents / Settings) doesn't unmount the upload tracker. Two
// failure modes this fixes:
//
//   1. The user starts uploading 3 files in Documents → switches to Chat
//      to ask something → comes back. Previously the rich upload zone in
//      DashboardLibrary was empty because its component-local state had
//      been destroyed on unmount. The XHRs were still running (or had
//      finished) but the UI had no record.
//   2. AbortControllers used to live in a ``useRef`` inside DashboardLibrary
//      that died with the component, so a row "in flight" at the moment of
//      navigation lost its cancel affordance — the X became a no-op and the
//      bytes kept flowing with no way to stop them.
//
// Mounting the provider inside the dashboard's route layout (which stays
// alive across all dashboard navigation) cures both: the state survives,
// and the AbortControllers stay reachable, so the cancel ✕ keeps working
// across page switches.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import {
  uploadDDiQDocumentWithProgress,
  UploadAbortError,
} from "@/react-app/lib/ddiqApi";
import {
  estimateProcessingMs,
  naturalProgressPct,
} from "@/react-app/components/ui/ProgressRing";

export type UploadRowStatus = "uploading" | "analyzing" | "done" | "error";

export interface UploadRow {
  id: string;
  name: string;
  /** Byte size of the source file. Combined with ``name`` to fingerprint a
   *  row for dedup detection so the user can't double-upload a file by
   *  dropping + selecting it twice. */
  size: number;
  status: UploadRowStatus;
  progress: number;
  error?: string;
  analyzingStartedAt?: number;
  analyzingEstimatedMs?: number;
  /** Original File handle, retained on the row so a failed upload can be
   *  retried in-place without the user having to re-attach. Cleared on
   *  ``done`` to free the OS file descriptor sooner. */
  file?: File;
  /** DDiQ category passed to the upload endpoint. Kept on the row so retry
   *  reuses the same value (avoids re-categorising twice on a flaky network). */
  category?: string;
}

interface UploadQueueValue {
  queue: UploadRow[];
  error: string | null;
  setError: (e: string | null) => void;
  /** Add a batch of files to the upload queue. Duplicates (same name+size
   *  already uploading/analyzing/done) are silently skipped with a banner;
   *  duplicates of FAILED rows replace those rows (auto-retry semantics).
   *  Non-PDFs are rejected with an error banner. Uploads run in parallel
   *  with a small concurrency cap. */
  processFiles: (files: FileList) => void;
  /** Abort an in-flight upload and remove the row from the queue. */
  cancelUpload: (id: string) => void;
  /** Remove a settled (done/error) row from the queue. */
  dismissUploadRow: (id: string) => void;
  /** Retry a previously-failed upload using the File still held on the row.
   *  Restarts the same retry-with-backoff pipeline from scratch. */
  retryUpload: (id: string) => void;
}

const UploadQueueCtx = createContext<UploadQueueValue | null>(null);

const MAX_CONCURRENT = 3;

function categorizeFilename(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("vertrag") || n.includes("contract") || n.includes("lease"))
    return "Legal";
  if (n.includes("permit") || n.includes("genehmigung") || n.includes("bimsch"))
    return "Permits";
  if (
    n.includes("umwelt") ||
    n.includes("environment") ||
    n.includes("uva") ||
    n.includes("eia")
  )
    return "Environmental";
  if (n.includes("techni") || n.includes("spec")) return "Technical";
  if (n.includes("grid") || n.includes("netz")) return "Grid";
  if (n.includes("financ") || n.includes("finanz") || n.includes("bank"))
    return "Financial";
  return "Uncategorized";
}

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<UploadRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Per-row AbortControllers, outside React state so they don't churn
  // re-renders and can't leak through to a localStorage round-trip.
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const cancelUpload = useCallback((rowId: string) => {
    const controller = abortControllersRef.current.get(rowId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(rowId);
    }
    setQueue((q) => q.filter((r) => r.id !== rowId));
  }, []);

  const dismissUploadRow = useCallback((id: string) => {
    setQueue((q) => q.filter((r) => r.id !== id));
  }, []);

  // Snapshot of the live queue, kept in a ref so ``processFiles`` /
  // ``retryUpload`` can read it synchronously inside their callback without
  // re-subscribing the effect on every queue change. The setter mirrors into
  // the ref before any read.
  const queueRef = useRef<UploadRow[]>(queue);
  queueRef.current = queue;

  /** Run one upload to completion. Reused by both the initial batch and
   *  manual retry — keeping the body in one place means a fix here (retry,
   *  backoff, progress, cancellation) lands consistently everywhere. */
  const runUpload = useCallback(
    async (row: { file: File; rowId: string; category: string }) => {
      const controller = new AbortController();
      abortControllersRef.current.set(row.rowId, controller);
      try {
        const estimatedMs = estimateProcessingMs(row.file.size);
        await uploadDDiQDocumentWithProgress(
          row.file,
          row.category,
          (pct) => {
            if (controller.signal.aborted) return;
            if (pct >= 101) {
              setQueue((q) =>
                q.map((r) =>
                  r.id === row.rowId
                    ? {
                        ...r,
                        status: "analyzing",
                        progress: 0,
                        analyzingStartedAt: Date.now(),
                        analyzingEstimatedMs: estimatedMs,
                      }
                    : r,
                ),
              );
            } else {
              setQueue((q) =>
                q.map((r) =>
                  r.id === row.rowId ? { ...r, progress: pct } : r,
                ),
              );
            }
          },
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        // Done — drop the File reference so the OS file descriptor is freed
        // sooner. A retry from this point would never be needed since we're
        // done; the user dismisses the green row when they're satisfied.
        setQueue((q) =>
          q.map((r) =>
            r.id === row.rowId
              ? { ...r, status: "done", progress: 100, file: undefined }
              : r,
          ),
        );
      } catch (err) {
        if (err instanceof UploadAbortError || controller.signal.aborted) return;
        const msg =
          err instanceof Error ? err.message : `Upload failed for ${row.file.name}`;
        setError(msg);
        setQueue((q) =>
          q.map((r) =>
            r.id === row.rowId ? { ...r, status: "error", error: msg } : r,
          ),
        );
      } finally {
        abortControllersRef.current.delete(row.rowId);
      }
    },
    [],
  );

  const processFiles = useCallback(
    (files: FileList) => {
      setError(null);

      // 1. Filter to PDFs + collect rejection names for a single grouped error.
      const incoming: File[] = [];
      const rejected: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".pdf")) {
          rejected.push(file.name);
          continue;
        }
        incoming.push(file);
      }

      // 2. Dedup against the current queue, AND against this same batch (a
      //    user can drag two copies of the same file in one drop event,
      //    rare but happens). The fingerprint is ``name + size`` — exact
      //    byte-content hashing would be authoritative but is overkill for
      //    a 100-file batch (a same-name-same-size collision across two
      //    actually-different files is vanishingly unlikely in a legal VDR).
      //
      // Behaviour:
      //   • Same file already uploading / analyzing / done → SKIP, count
      //     into a single banner message.
      //   • Same file already failed → REPLACE the failed row (auto-retry
      //     on re-drop, which is the natural user mental model).
      //   • Otherwise → fresh row.
      const accepted: { file: File; rowId: string; category: string }[] = [];
      const replacedRowIds: string[] = [];
      let skippedDupes = 0;
      const batchFingerprints = new Set<string>();

      for (const file of incoming) {
        const fp = `${file.name}::${file.size}`;
        // Same file twice inside this drop → skip the second occurrence.
        if (batchFingerprints.has(fp)) {
          skippedDupes++;
          continue;
        }
        batchFingerprints.add(fp);

        const existing = queueRef.current.find(
          (r) => `${r.name}::${r.size}` === fp,
        );
        if (existing) {
          if (existing.status === "error") {
            // Replace the failed row's id and let the runner take it.
            replacedRowIds.push(existing.id);
            accepted.push({
              file,
              rowId: existing.id, // keep id so render order is preserved
              category: existing.category ?? categorizeFilename(file.name),
            });
            continue;
          }
          // Already in flight or already done → skip.
          skippedDupes++;
          continue;
        }
        accepted.push({
          file,
          rowId: `${file.name}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 7)}`,
          category: categorizeFilename(file.name),
        });
      }

      // 3. Banner messaging. Combine reject + dupe counts into one message
      //    so we don't ping-pong two banners in a row.
      const notes: string[] = [];
      if (rejected.length > 0) {
        notes.push(
          rejected.length === 1
            ? `"${rejected[0]}" skipped — only PDF files are supported`
            : `${rejected.length} non-PDF files skipped`,
        );
      }
      if (skippedDupes > 0) {
        notes.push(
          skippedDupes === 1
            ? `1 duplicate skipped — same file is already in the queue`
            : `${skippedDupes} duplicates skipped — already in the queue`,
        );
      }
      if (notes.length > 0) setError(notes.join(" · "));
      if (accepted.length === 0) return;

      // 4. Apply queue changes in ONE setState: replace failed rows in place,
      //    append fresh rows. Reduces React commit churn for big batches.
      setQueue((q) => {
        const next = q.map((r) =>
          replacedRowIds.includes(r.id)
            ? {
                ...r,
                status: "uploading" as const,
                progress: 0,
                error: undefined,
                file: accepted.find((a) => a.rowId === r.id)?.file,
                category: accepted.find((a) => a.rowId === r.id)?.category,
                analyzingStartedAt: undefined,
                analyzingEstimatedMs: undefined,
              }
            : r,
        );
        const fresh = accepted
          .filter((a) => !replacedRowIds.includes(a.rowId))
          .map<UploadRow>((a) => ({
            id: a.rowId,
            name: a.file.name,
            size: a.file.size,
            status: "uploading",
            progress: 0,
            file: a.file,
            category: a.category,
          }));
        return [...next, ...fresh];
      });

      // 5. Concurrency-capped worker pool. The pool size adapts to the batch
      //    so a 1-file drop doesn't spawn 3 idle workers, while a 100-file
      //    batch caps at MAX_CONCURRENT.
      let cursor = 0;
      const worker = async () => {
        while (cursor < accepted.length) {
          const idx = cursor++;
          await runUpload(accepted[idx]);
        }
      };
      void Promise.all(
        Array.from(
          { length: Math.min(MAX_CONCURRENT, accepted.length) },
          () => worker(),
        ),
      );
    },
    [runUpload],
  );

  /** Retry a previously-failed upload using the File still held on the row.
   *  No-op if the row doesn't exist, isn't failed, or has no File handle
   *  (e.g. lost across a localStorage round-trip). */
  const retryUpload = useCallback(
    (rowId: string) => {
      const row = queueRef.current.find((r) => r.id === rowId);
      if (!row || row.status !== "error" || !row.file) return;
      const file = row.file;
      const category = row.category ?? categorizeFilename(row.name);
      // Reset the row to "uploading 0%" so the user sees the retry start.
      setQueue((q) =>
        q.map((r) =>
          r.id === rowId
            ? {
                ...r,
                status: "uploading" as const,
                progress: 0,
                error: undefined,
                analyzingStartedAt: undefined,
                analyzingEstimatedMs: undefined,
              }
            : r,
        ),
      );
      void runUpload({ file, rowId, category });
    },
    [runUpload],
  );

  // Analyzing-phase ticker. The natural curve is anchored on
  // ``analyzingStartedAt`` so the % climbs smoothly through the long server
  // side OCR/embed phase. Self-stops once nothing's analyzing.
  const anyAnalyzing = queue.some((r) => r.status === "analyzing");
  useEffect(() => {
    if (!anyAnalyzing) return;
    const id = window.setInterval(() => {
      setQueue((q) =>
        q.map((r) => {
          if (
            r.status !== "analyzing" ||
            !r.analyzingStartedAt ||
            !r.analyzingEstimatedMs
          )
            return r;
          const elapsed = Date.now() - r.analyzingStartedAt;
          const next = naturalProgressPct(elapsed, r.analyzingEstimatedMs);
          return next === r.progress ? r : { ...r, progress: next };
        }),
      );
    }, 300);
    return () => clearInterval(id);
  }, [anyAnalyzing]);

  return (
    <UploadQueueCtx.Provider
      value={{
        queue,
        error,
        setError,
        processFiles,
        cancelUpload,
        retryUpload,
        dismissUploadRow,
      }}
    >
      {children}
    </UploadQueueCtx.Provider>
  );
}

export function useUploadQueue(): UploadQueueValue {
  const v = useContext(UploadQueueCtx);
  if (!v) {
    throw new Error("useUploadQueue must be used inside UploadQueueProvider");
  }
  return v;
}
