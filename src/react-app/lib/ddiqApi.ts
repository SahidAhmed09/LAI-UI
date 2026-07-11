// src/react-app/lib/ddiqApi.ts
// DDiQ Report API — connects to the lai-backend microservice's /ddiq/* endpoints.
//
// The DDiQ backend lives on a SEPARATE port from the conversational
// backend (`serve_rag` on :18000). Default :18001 here. Override with
// VITE_DDIQ_URL for non-default deployments.
//
// Requests go through the auth-aware fetch wrapper so the Bearer token is
// attached (these /ddiq/* endpoints are protected and 401 without it).
// apiFetch passes absolute URLs through unchanged.
import { apiFetch, getAccessToken, bootstrapAuth } from "@/react-app/auth/apiFetch";

const BACKEND_URL =
  import.meta.env.VITE_DDIQ_URL ||
  // Fallback derives sibling port from VITE_BACKEND_URL (same host, swap port).
  (import.meta.env.VITE_BACKEND_URL || "http://192.168.178.82:18001").replace(
    /:(?:\d+)$/,
    ":18001",
  );

// ─── Types (match backend Pydantic models exactly) ──────────────────────────

import type {
    DDiQReportData,
    DocumentItem,
} from "@/react-app/lib/ddiqDemoData";

export interface DocumentListResponse {
    documents: DocumentItem[];
    total: number;
}

export interface UploadDocResponse {
    id: string;
    filename: string;
    pages: number;
    chunks: number;
    status: string;
    message: string;
}

export interface GenerateReportResponse {
    report_id: string;
    report: DDiQReportData;
    timings: Record<string, number>;
}

export interface GenerateReportRequest {
    document_ids: string[];
    preset?: string;
    project_name?: string;
    prepared_for?: string;
}

export type ReportStatus = "queued" | "running" | "done" | "failed";

export interface GenerateReportAsyncResponse {
    report_id: string;
    status: ReportStatus;
    poll_url: string;
    cached?: boolean;
    // Heuristic backend estimate (median of recent similar runs) used to
    // populate the "we'll email you when this finishes — ~N minutes"
    // toast on submit. Zero for cache hits (instant response, no email).
    estimated_minutes?: number;
}

export interface ReportStatusResponse {
    report_id: string;
    status: ReportStatus;
    step: string | null;
    percent: number;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
    project_name: string | null;
}

/** Lightweight summary for the Past Reports browser. The /ddiq/reports
 *  endpoint returns these without the full report_data payload, so the
 *  list is cheap even with hundreds of historical reports. */
export interface ReportSummary {
    report_id: string;
    project_name: string | null;
    status: ReportStatus;
    created_at: string | null;
    started_at: string | null;
    finished_at: string | null;
    progress_percent: number;
    error: string | null;
    doc_count: number;
    finding_count: number;
    preset: string | null;
}

// ─── API Functions ──────────────────────────────────────────────────────────

/** List all uploaded DDiQ documents */
export async function fetchDocuments(): Promise<DocumentListResponse> {
    const res = await apiFetch(`${BACKEND_URL}/ddiq/documents`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to fetch documents: ${res.status}`);
    }
    return res.json();
}

/** Upload a PDF for DDiQ analysis */
export async function uploadDDiQDocument(
    file: File,
    category: string = "Uncategorized",
    sessionId?: string,
): Promise<UploadDocResponse> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    if (sessionId) formData.append("session_id", sessionId);

    const res = await apiFetch(`${BACKEND_URL}/ddiq/documents/upload`, {
        method: "POST",
        body: formData,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Upload failed: ${res.status}`);
    }
    return res.json();
}

type _XhrOutcome =
    | { kind: "http"; status: number; text: string }
    | { kind: "network" }
    | { kind: "timeout" }
    | { kind: "aborted" };

/** Thrown when a caller's AbortSignal fired mid-upload. The library upload
 *  loop swallows these so cancelled rows don't surface as errors. */
export class UploadAbortError extends Error {
    constructor() {
        super("Upload cancelled");
        this.name = "UploadAbortError";
    }
}

function _ddiqXhrOnce(
    url: string,
    formData: FormData,
    token: string | null,
    onProgress: (percent: number) => void,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<_XhrOutcome> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve({ kind: "aborted" });
            return;
        }
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.withCredentials = true;
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        // Generous wall-clock — long enough for a 100 MB upload over a slow
        // tether, short enough that a truly dead connection fails clearly.
        xhr.timeout = timeoutMs;
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
            }
        };
        xhr.upload.onload = () => onProgress(101); // bytes fully sent → analyzing
        xhr.onload = () =>
            resolve({ kind: "http", status: xhr.status, text: xhr.responseText });
        xhr.onerror = () => resolve({ kind: "network" });
        xhr.ontimeout = () => resolve({ kind: "timeout" });
        xhr.onabort = () => resolve({ kind: "aborted" });

        // Bridge the AbortSignal to the XHR. Removing the listener on settle
        // would be tidier, but signals are typically short-lived per upload
        // so we let GC clean up after both promises resolve.
        if (signal) {
            signal.addEventListener("abort", () => xhr.abort(), { once: true });
        }
        xhr.send(formData);
    });
}

/**
 * Byte-progress variant of {@link uploadDDiQDocument} — uses XHR so the
 * library upload row can show a real clockwise ring while the file is
 * actually being transferred. ``onProgress`` is called with the byte
 * percentage 0–100 during the upload phase and is invoked once with the
 * sentinel value ``101`` the moment the bytes are fully on the wire, so the
 * caller can flip the ring into "analyzing" mode while the server runs
 * extract → chunk → embed (no further byte progress after that).
 *
 * Reliability: mirrors {@link uploadDocumentWithProgress}. Auto-refreshes
 * the access token on 401, retries up to 2 extra times on transient
 * failures (network, timeout, 5xx) with exponential backoff (1.5s, 4s),
 * and never retries 4xx — those are size/auth/type errors the user must
 * resolve. The progress bar resets to 0 on retry so a re-attempt is
 * visible. 4xx and 5xx detail strings flow through to the row's error
 * tooltip so the user sees *why*.
 */
export async function uploadDDiQDocumentWithProgress(
    file: File,
    category: string,
    onProgress: (percent: number) => void,
    sessionId?: string,
    signal?: AbortSignal,
): Promise<UploadDocResponse> {
    const TIMEOUT_MS = 10 * 60 * 1000;
    const url = `${BACKEND_URL}/ddiq/documents/upload`;
    const build = () => {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", category);
        if (sessionId) fd.append("session_id", sessionId);
        return fd;
    };

    let lastDetail = "Upload failed";
    for (let attempt = 1; attempt <= 3; attempt++) {
        if (signal?.aborted) throw new UploadAbortError();
        if (attempt > 1) {
            onProgress(0);
            await new Promise((r) => setTimeout(r, attempt === 2 ? 1500 : 4000));
            if (signal?.aborted) throw new UploadAbortError();
        }

        let res = await _ddiqXhrOnce(
            url, build(), getAccessToken(), onProgress, TIMEOUT_MS, signal,
        );
        if (res.kind === "http" && res.status === 401) {
            const fresh = await bootstrapAuth();
            if (fresh) {
                res = await _ddiqXhrOnce(
                    url, build(), fresh, onProgress, TIMEOUT_MS, signal,
                );
            }
        }

        if (res.kind === "aborted") throw new UploadAbortError();

        if (res.kind === "http" && res.status >= 200 && res.status < 300) {
            try {
                return JSON.parse(res.text) as UploadDocResponse;
            } catch {
                throw new Error("Malformed upload response");
            }
        }

        if (res.kind === "http") {
            lastDetail = `Upload failed: ${res.status}`;
            try {
                lastDetail =
                    (JSON.parse(res.text) as { detail?: string }).detail || lastDetail;
            } catch {
                /* keep status-line fallback */
            }
            if (res.status < 500) throw new Error(lastDetail);
        } else if (res.kind === "timeout") {
            lastDetail = "Upload timed out — network too slow or server unresponsive";
        } else {
            lastDetail = "Network error during upload — check your connection";
        }
    }
    throw new Error(lastDetail);
}

/** Generate a DDiQ report from selected documents */
export async function generateReport(
    req: GenerateReportRequest,
): Promise<GenerateReportResponse> {
    const res = await apiFetch(`${BACKEND_URL}/ddiq/report/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Report generation failed: ${res.status}`);
    }
    return res.json();
}

/** List recent DDiQ reports (newest first) for the Past Reports browser. */
export async function listReports(limit = 50): Promise<ReportSummary[]> {
    const res = await apiFetch(`${BACKEND_URL}/ddiq/reports?limit=${limit}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to list reports: ${res.status}`);
    }
    const data = await res.json();
    return data.reports as ReportSummary[];
}

/** Hard-delete a report and its cadastral artifacts. Idempotent — 404 if
 *  the id is unknown. */
export async function deleteReport(reportId: string): Promise<void> {
    const res = await apiFetch(`${BACKEND_URL}/ddiq/report/${reportId}`, {
        method: "DELETE",
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to delete report: ${res.status}`);
    }
}

/** Hard-delete an uploaded document and its chunks. Idempotent — 404 if
 *  the id is unknown or owned by another user. */
export async function deleteDocument(documentId: string): Promise<void> {
    const res = await apiFetch(`${BACKEND_URL}/ddiq/documents/${documentId}`, {
        method: "DELETE",
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to delete document: ${res.status}`);
    }
}

/** Retrieve a previously generated report */
export async function fetchReport(reportId: string): Promise<{
    report_id: string;
    created_at: string;
    project_name: string;
    report: DDiQReportData;
}> {
    const res = await apiFetch(`${BACKEND_URL}/ddiq/report/${reportId}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Report not found: ${res.status}`);
    }
    return res.json();
}

/** Kick off report generation in the background. Returns immediately
 *  with a report_id to poll. The backend dedups via a request fingerprint
 *  (sorted doc_ids + preset + project_name): if a matching report already
 *  exists or is in flight, the same report_id comes back with `cached:true`
 *  and no new compute happens. */
export async function generateReportAsync(
    req: GenerateReportRequest,
): Promise<GenerateReportAsyncResponse> {
    const res = await apiFetch(`${BACKEND_URL}/ddiq/report/generate/async`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Report generation failed to start: ${res.status}`);
    }
    return res.json();
}

/** Poll the status of an in-flight async report. Cheap — only reads
 *  the row's status fields, not the full payload. */
export async function fetchReportStatus(reportId: string): Promise<ReportStatusResponse> {
    const res = await apiFetch(`${BACKEND_URL}/ddiq/report/${reportId}/status`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Status not found: ${res.status}`);
    }
    return res.json();
}