// Risk Overview — the detail behind the dashboard's "Risk Findings" card.
//
// Aggregates the findings of every completed DDiQ report into one register.
// The total (combined across all documents) sits at the top; a document
// selector lets the lawyer drill into the risks of one specific document, each
// shown concisely (severity, the risk, where it came from).

import { useEffect, useMemo, useState } from "react";
import { FileText, Files } from "lucide-react";
import { Card, CardContent } from "@/react-app/components/ui/card";
import { cn } from "@/react-app/lib/utils";
import { listReports, fetchReport } from "@/react-app/lib/ddiqApi";
import type { Finding, Ampel } from "@/react-app/lib/ddiqDemoData";
import { SignalTowerIcon, SandglassIcon } from "@/react-app/components/icons";

interface AggFinding extends Finding {
  reportId: string;
  projectName: string;
}

const ALL = "__all__";
const UNATTRIBUTED = "Document not specified";

const SEV_ORDER: Record<Ampel, number> = { red: 0, yellow: 1, green: 2 };
const SEV_DOT: Record<Ampel, string> = {
  red: "bg-rose-500",
  yellow: "bg-amber-500",
  green: "bg-emerald-500",
};
const SEV_LABEL: Record<Ampel, string> = {
  red: "High",
  yellow: "Medium",
  green: "Low",
};
const SEV_BADGE: Record<Ampel, string> = {
  red: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  yellow: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

// Documents a finding is grounded in (from its evidence). Findings with no
// document evidence fall into a single "not specified" bucket so nothing is
// silently dropped.
function docsOf(f: Finding): string[] {
  const set = new Set<string>();
  for (const e of f.evidence ?? []) {
    const n = e.doc_filename?.trim();
    if (n) set.add(n);
  }
  return set.size ? [...set] : [UNATTRIBUTED];
}

// First page number cited for a given document, if any.
function pageForDoc(f: Finding, doc: string): number | null {
  for (const e of f.evidence ?? []) {
    if (e.doc_filename?.trim() === doc && e.page != null) return e.page;
  }
  return null;
}

function AmpelDot({ status }: { status: Ampel }) {
  return (
    <span
      className={cn(
        "inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1",
        SEV_DOT[status],
      )}
    />
  );
}

// One concise risk row: severity dot · the risk · meta (domain, page, basis) ·
// severity badge. In the "All documents" view the source file is shown inline;
// in a single-document view the document is the section header so we show the
// page instead.
function RiskRow({
  f,
  doc,
}: {
  f: AggFinding;
  doc: string; // ALL or a specific document name
}) {
  const showDoc = doc === ALL;
  const page = showDoc ? null : pageForDoc(f, doc);
  const fileNames = docsOf(f).filter((d) => d !== UNATTRIBUTED);

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <AmpelDot status={f.severity} />
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">{f.text}</p>
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mt-1 text-[10px] text-muted-foreground">
          {f.domain && (
            <span className="font-medium text-foreground/70">{f.domain}</span>
          )}
          {page != null && <span>· p. {page}</span>}
          {f.legal_basis && (
            <span className="font-mono">· {f.legal_basis}</span>
          )}
          {showDoc &&
            (fileNames.length > 0 ? (
              <span
                className="inline-flex items-center gap-1 text-foreground/70"
                title={fileNames.join(", ")}
              >
                <FileText className="w-3 h-3 text-primary" />
                <span className="truncate max-w-[16rem]">{fileNames[0]}</span>
                {fileNames.length > 1 && <span>+{fileNames.length - 1}</span>}
              </span>
            ) : (
              <span className="italic">document not specified</span>
            ))}
        </div>
      </div>
      <span
        className={cn(
          "text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide shrink-0",
          SEV_BADGE[f.severity],
        )}
      >
        {SEV_LABEL[f.severity]}
      </span>
    </div>
  );
}

export function RiskOverview() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<AggFinding[]>([]);
  const [reportCount, setReportCount] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<string>(ALL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reports = await listReports(50);
        const done = reports.filter((r) => r.status === "done");
        if (cancelled) return;
        setReportCount(done.length);

        const results = await Promise.allSettled(
          done.map((r) => fetchReport(r.report_id)),
        );
        if (cancelled) return;

        const agg: AggFinding[] = [];
        results.forEach((res, idx) => {
          if (res.status !== "fulfilled") return;
          const rep = res.value.report;
          const projectName =
            rep.projectName || done[idx].project_name || "Untitled report";
          for (const f of [
            ...(rep.findings ?? []),
            ...(rep.crossDocFindings ?? []),
          ]) {
            agg.push({ ...f, reportId: done[idx].report_id, projectName });
          }
        });
        agg.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
        setFindings(agg);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load risks");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-document tallies for the selector (a finding citing N documents counts
  // toward each of them).
  const docOptions = useMemo(() => {
    const map = new Map<string, { count: number; red: number }>();
    for (const f of findings) {
      for (const d of docsOf(f)) {
        const cur = map.get(d) ?? { count: 0, red: 0 };
        cur.count += 1;
        if (f.severity === "red") cur.red += 1;
        map.set(d, cur);
      }
    }
    // Worst-first (most red, then most total), with the "not specified" bucket
    // pushed to the end.
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => {
        if (a.name === UNATTRIBUTED) return 1;
        if (b.name === UNATTRIBUTED) return -1;
        return b.red - a.red || b.count - a.count;
      });
  }, [findings]);

  const counts: Record<Ampel, number> = useMemo(
    () => ({
      red: findings.filter((f) => f.severity === "red").length,
      yellow: findings.filter((f) => f.severity === "yellow").length,
      green: findings.filter((f) => f.severity === "green").length,
    }),
    [findings],
  );

  const visible = useMemo(
    () =>
      selectedDoc === ALL
        ? findings
        : findings.filter((f) => docsOf(f).includes(selectedDoc)),
    [findings, selectedDoc],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <SandglassIcon className="w-6 h-6 text-muted-foreground animate-pulse mr-3" />
        <span className="text-muted-foreground">Aggregating risks…</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="p-8 text-center text-sm text-destructive">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (findings.length === 0) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="p-12 text-center space-y-3">
          <SignalTowerIcon className="w-10 h-10 text-muted-foreground mx-auto opacity-60" />
          <h3 className="text-base font-semibold">No risks aggregated yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Risk areas are derived from the findings of generated DDiQ reports.
            Once you produce a report under{" "}
            <span className="font-medium">DDiQ Reports</span>, its findings will
            appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Total across all documents ── */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="p-5 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-3xl font-bold leading-none">{findings.length}</p>
            <p className="text-xs text-muted-foreground mt-1">
              total risk finding{findings.length === 1 ? "" : "s"} across{" "}
              {docOptions.length} document
              {docOptions.length === 1 ? "" : "s"} · {reportCount} report
              {reportCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {(["red", "yellow", "green"] as Ampel[]).map((sev) => (
              <div key={sev} className="flex items-center gap-2">
                <span className={cn("w-2.5 h-2.5 rounded-full", SEV_DOT[sev])} />
                <span className="text-sm font-medium tabular-nums">
                  {counts[sev]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {SEV_LABEL[sev]}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Document selector ── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Filter by document
        </p>
        <div className="flex flex-wrap gap-2">
          <DocPill
            active={selectedDoc === ALL}
            onClick={() => setSelectedDoc(ALL)}
            icon={<Files className="w-3.5 h-3.5" />}
            label="All documents"
            count={findings.length}
          />
          {docOptions.map((d) => (
            <DocPill
              key={d.name}
              active={selectedDoc === d.name}
              onClick={() => setSelectedDoc(d.name)}
              icon={<FileText className="w-3.5 h-3.5" />}
              label={d.name}
              count={d.count}
              hasRed={d.red > 0}
            />
          ))}
        </div>
      </div>

      {/* ── Risks for the selection ── */}
      <div className="rounded-lg border border-border/60 overflow-hidden bg-card/40">
        <div className="bg-muted/40 px-4 py-2.5 border-b border-border/40 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold truncate">
            {selectedDoc === ALL ? "All documents" : selectedDoc}
          </h4>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {visible.length} risk{visible.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="divide-y divide-border/30">
          {visible.map((f, i) => (
            <RiskRow key={`${f.reportId}-${i}`} f={f} doc={selectedDoc} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DocPill({
  active,
  onClick,
  icon,
  label,
  count,
  hasRed = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  hasRed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex items-center gap-1.5 max-w-[16rem] px-3 h-8 rounded-full border text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "shrink-0 inline-flex items-center gap-1 px-1.5 rounded-full text-[10px] tabular-nums",
          active ? "bg-primary-foreground/20" : "bg-muted",
        )}
      >
        {hasRed && !active && (
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
        )}
        {count}
      </span>
    </button>
  );
}
