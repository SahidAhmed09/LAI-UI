"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Badge } from "@/react-app/components/ui/badge";
import { Separator } from "@/react-app/components/ui/separator";
import { cn } from "@/react-app/lib/utils";
import {
  DownloadIcon,
  ManuscriptIcon,
  CheckIcon,
  CheckRingIcon,
  SandglassIcon,
  ArrowRightIcon,
  LensIcon,
  ArchiveIcon,
  SearchIcon,
} from "@/react-app/components/icons";
import { Input } from "@/react-app/components/ui/input";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ReportProgressBar } from "@/react-app/components/ReportProgress";

import {
  PRESETS,
  FORMAT_OPTIONS,
  SECTION_META,
  type Ampel,
  type DDiQReportData,
  type AusgabeblattSection,
  type WEAStatus,
  type DocumentItem,
  type CadastralParcel,
  type ParcelStatus,
  type ReportPreset,
  type ExportFormat,
} from "@/react-app/lib/ddiqDemoData";

import {
  generateReportAsync,
  fetchReportStatus,
  fetchReport,
  listReports,
  deleteReport,
  type ReportStatus,
  type ReportSummary,
} from "@/react-app/lib/ddiqApi";

// localStorage key for the active report. Persisting it across refreshes
// is what stops the user losing their place during a 30-60 min run, and
// (combined with the backend fingerprint dedup) means the same input
// never burns GPU twice.
const ACTIVE_REPORT_KEY = "lai.ddiq.activeReport";

interface PersistedReport {
  report_id: string;
  status: ReportStatus;
  doc_ids: string[];
  preset: string;
  report?: DDiQReportData;       // full payload, populated when status='done'
  error?: string;
  ts: number;                    // last update, ms since epoch
}

function loadPersistedReport(): PersistedReport | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_REPORT_KEY);
    return raw ? JSON.parse(raw) as PersistedReport : null;
  } catch { return null; }
}

function savePersistedReport(r: PersistedReport | null): void {
  try {
    if (r) window.localStorage.setItem(ACTIVE_REPORT_KEY, JSON.stringify(r));
    else window.localStorage.removeItem(ACTIVE_REPORT_KEY);
  } catch { /* over-quota or storage disabled — silently drop */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const AmpelDot = ({
  status,
  size = "sm",
}: {
  status: Ampel;
  size?: "sm" | "md";
}) => (
  <span
    className={cn(
      "inline-block rounded-full flex-shrink-0",
      size === "md" ? "w-3 h-3" : "w-2 h-2",
      { green: "bg-emerald-500", yellow: "bg-amber-500", red: "bg-rose-500" }[
        status
      ],
    )}
  />
);

const AmpelBadge = ({ status }: { status: Ampel }) => {
  const c = {
    green: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-700 dark:text-emerald-400",
      l: "Secured",
    },
    yellow: {
      bg: "bg-amber-500/10",
      text: "text-amber-700 dark:text-amber-400",
      l: "Partial",
    },
    red: {
      bg: "bg-rose-500/10",
      text: "text-rose-700 dark:text-rose-400",
      l: "Open",
    },
  }[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium",
        c.bg,
        c.text,
      )}
    >
      <AmpelDot status={status} />
      {c.l}
    </span>
  );
};

const AusgabeblattTable = ({ section }: { section: AusgabeblattSection }) => (
  <div className="rounded-lg border border-border/60 overflow-hidden">
    <div className="bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 border-b border-border/40">
      <h4 className="text-sm font-semibold">{section.title}</h4>
    </div>
    <div className="divide-y divide-border/30">
      {section.rows.map((r, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground font-medium min-w-[200px] flex-shrink-0">
            {r.label}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              {r.ampel && <AmpelDot status={r.ampel} size="md" />}
              <span>{r.value}</span>
            </div>
            {r.note && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 italic">
                {r.note}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const StatusMap = ({ statuses }: { statuses: WEAStatus[] }) => {
  const c = {
    green: statuses.filter((s) => s.ampel === "green").length,
    yellow: statuses.filter((s) => s.ampel === "yellow").length,
    red: statuses.filter((s) => s.ampel === "red").length,
  };
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 border-b border-border/40">
        <h4 className="text-sm font-semibold">Land Security Status Map</h4>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-6 mb-4 text-xs">
          <span className="flex items-center gap-1.5">
            <AmpelDot status="green" size="md" />
            Fully Secured ({c.green})
          </span>
          <span className="flex items-center gap-1.5">
            <AmpelDot status="yellow" size="md" />
            In Negotiation ({c.yellow})
          </span>
          <span className="flex items-center gap-1.5">
            <AmpelDot status="red" size="md" />
            Open Issues ({c.red})
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {statuses.map((w) => (
            <div
              key={w.name}
              className={cn(
                "p-3 rounded-md border",
                {
                  green: "border-emerald-500/40 bg-emerald-500/5",
                  yellow: "border-amber-500/40 bg-amber-500/5",
                  red: "border-rose-500/40 bg-rose-500/5",
                }[w.ampel],
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <AmpelDot status={w.ampel} size="md" />
                <span className="text-sm font-semibold">{w.name}</span>
                <AmpelBadge status={w.ampel} />
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5 ml-5">
                <p>Owner: {w.owner}</p>
                <p>Parcel: {w.parcel}</p>
                <p>Contract: {w.contract}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const EvidenceChips = ({ evidence }: { evidence?: { doc_filename?: string | null; excerpt?: string }[] }) => {
  if (!evidence || evidence.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {evidence.map((e, i) => (
        <span
          key={i}
          title={e.excerpt || ""}
          className="text-[10px] px-2 py-0.5 rounded border border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/60 transition-colors cursor-help truncate max-w-[18rem]"
        >
          📎 {e.doc_filename || "source"}
        </span>
      ))}
    </div>
  );
};

const QuantBadges = ({ q }: { q?: { mw_affected?: number | null; eur_impact_estimate?: number | null; days_until_deadline?: number | null } | null }) => {
  if (!q) return null;
  const badges: Array<{ label: string; tone: string }> = [];
  if (q.mw_affected != null) badges.push({ label: `${q.mw_affected} MW affected`, tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300" });
  if (q.eur_impact_estimate != null) badges.push({ label: `≈ €${Math.round(q.eur_impact_estimate).toLocaleString("de-DE")} impact`, tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" });
  if (q.days_until_deadline != null) {
    const tone = q.days_until_deadline < 0
      ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
      : q.days_until_deadline <= 30
        ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
        : q.days_until_deadline <= 180
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "bg-slate-500/10 text-slate-700 dark:text-slate-300";
    const label = q.days_until_deadline < 0
      ? `${Math.abs(q.days_until_deadline)} days OVERDUE`
      : `${q.days_until_deadline} days to deadline`;
    badges.push({ label, tone });
  }
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {badges.map((b, i) => (
        <span key={i} className={cn("text-[10px] px-2 py-0.5 rounded font-medium", b.tone)}>
          {b.label}
        </span>
      ))}
    </div>
  );
};

const FindingsTable = ({
  findings,
  title = "Action Items & Open Issues",
}: {
  findings: DDiQReportData["findings"];
  title?: string;
}) => (
  <div className="rounded-lg border border-border/60 overflow-hidden">
    <div className="bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
      <h4 className="text-sm font-semibold">{title}</h4>
      <span className="text-[10px] text-muted-foreground">{findings.length} item{findings.length === 1 ? "" : "s"}</span>
    </div>
    <div className="divide-y divide-border/30">
      {findings.map((f, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <AmpelDot status={f.severity} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground">{f.domain}</span>
              {f.kind && f.kind !== "section" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium uppercase tracking-wide">
                  {f.kind.replace("_", " ")}
                </span>
              )}
              {f.legal_basis && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 font-mono">
                  {f.legal_basis}
                </span>
              )}
            </div>
            <p className="text-sm mt-0.5">{f.text}</p>
            {f.recommended_action && (
              <p className="text-xs text-muted-foreground mt-1.5 italic">
                → {f.recommended_action}
              </p>
            )}
            <QuantBadges q={f.quantification} />
            <EvidenceChips evidence={f.evidence} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const TimelinePanel = ({ entries }: { entries: NonNullable<DDiQReportData["timeline"]> }) => {
  if (!entries || entries.length === 0) return null;
  const tone = (u?: string | null) =>
    u === "expired" ? "border-rose-500/50 bg-rose-500/10" :
    u === "urgent"  ? "border-rose-500/30 bg-rose-500/5" :
    u === "soon"    ? "border-amber-500/30 bg-amber-500/5" :
                       "border-border/40 bg-card/40";
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 border-b border-border/40">
        <h4 className="text-sm font-semibold">Deadlines & Timeline</h4>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Date-bound milestones extracted from documents — expired and urgent items demand immediate action.
        </p>
      </div>
      <div className="divide-y divide-border/30">
        {entries.map((t, i) => (
          <div key={i} className={cn("flex items-start gap-3 px-4 py-3 border-l-4", tone(t.urgency))}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-semibold">{t.date}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t.kind.replace("_", " ")}
                </span>
                {t.legal_basis && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 font-mono">
                    {t.legal_basis}
                  </span>
                )}
                {t.urgency && (
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium uppercase",
                    t.urgency === "expired" || t.urgency === "urgent" ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" :
                    t.urgency === "soon" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" :
                    "bg-slate-500/10 text-slate-700 dark:text-slate-300",
                  )}>
                    {t.urgency}
                  </span>
                )}
              </div>
              <p className="text-sm mt-1">{t.description}</p>
              {t.days_from_now != null && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t.days_from_now < 0
                    ? `${Math.abs(t.days_from_now)} days ago`
                    : `in ${t.days_from_now} days`}
                </p>
              )}
              <EvidenceChips evidence={t.evidence} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const RueckbauPanel = ({ bond }: { bond?: DDiQReportData["rueckbauBond"] }) => {
  if (!bond) return null;
  const ok = bond.amount_eur != null && bond.sufficient !== false;
  return (
    <div className={cn(
      "rounded-lg border overflow-hidden",
      ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5",
    )}>
      <div className="px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          Rückbaubürgschaft (BauGB §35 Abs. 5)
        </h4>
        <span className={cn(
          "text-[10px] px-2 py-0.5 rounded font-medium",
          ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
        )}>
          {ok ? "in place" : "missing or insufficient"}
        </span>
      </div>
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div><span className="text-muted-foreground">Amount:</span><br/>{bond.amount_eur != null ? `€${bond.amount_eur.toLocaleString("de-DE")}` : "—"}</div>
        <div><span className="text-muted-foreground">Provider:</span><br/>{bond.provider || "—"}</div>
        <div><span className="text-muted-foreground">Beneficiary:</span><br/>{bond.beneficiary || "—"}</div>
        <div><span className="text-muted-foreground">Valid until:</span><br/>{bond.valid_until || "—"}</div>
        <div><span className="text-muted-foreground">Instrument:</span><br/>{bond.instrument_type || "—"}</div>
      </div>
      {bond.note && <p className="px-4 pb-3 text-xs text-muted-foreground italic">{bond.note}</p>}
      {bond.evidence && bond.evidence.length > 0 && (
        <div className="px-4 pb-3"><EvidenceChips evidence={bond.evidence} /></div>
      )}
    </div>
  );
};

const GrundbuchPanel = ({ checks }: { checks?: DDiQReportData["grundbuchChecks"] }) => {
  if (!checks || checks.length === 0) return null;
  const mismatches = checks.filter((c) => c.owner_match === false);
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
        <h4 className="text-sm font-semibold">Grundbuch Consistency (BGB §873)</h4>
        <span className="text-[10px] text-muted-foreground">
          {mismatches.length} mismatch{mismatches.length === 1 ? "" : "es"} of {checks.length} checked
        </span>
      </div>
      <div className="divide-y divide-border/30">
        {checks.map((g, i) => {
          const tone = g.owner_match === false ? "border-l-rose-500/60" :
                       g.owner_match === true  ? "border-l-emerald-500/60" :
                       "border-l-slate-500/30";
          return (
            <div key={i} className={cn("px-4 py-3 border-l-4", tone)}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-mono font-semibold">{g.parcel_id}</span>
                {g.owner_match === false && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 font-medium uppercase">
                    Owner ≠ Lessor
                  </span>
                )}
                {g.owner_match === true && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium uppercase">
                    Match
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1.5 text-xs">
                <div><span className="text-muted-foreground">Owner per Grundbuch:</span> {g.registered_owner || "—"}</div>
                <div><span className="text-muted-foreground">Lessor per Pachtvertrag:</span> {g.lessor_name || "—"}</div>
              </div>
              {g.encumbrances.length > 0 && (
                <div className="mt-2">
                  <span className="text-[11px] text-muted-foreground">Encumbrances:</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {g.encumbrances.map((e, j) => (
                      <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {g.note && <p className="text-[11px] text-muted-foreground italic mt-1">{g.note}</p>}
              <EvidenceChips evidence={g.evidence} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CadastralTable = ({ parcels }: { parcels: CadastralParcel[] }) => {
  const totalArea = parcels.reduce((s, p) => s + p.area, 0);
  const securedArea = parcels
    .filter(
      (p) =>
        p.status === "secured" ||
        p.status === "buffer" ||
        p.status === "easement",
    )
    .reduce((s, p) => s + p.area, 0);
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          Cadastral Parcels (Flurstücke)
        </h4>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>{parcels.length} parcels</span>
          <span>{totalArea.toFixed(1)} ha total</span>
          <span>{((securedArea / totalArea) * 100).toFixed(0)}% secured</span>
        </div>
      </div>
      <div className="divide-y divide-border/30">
        {parcels.map((p) => {
          const pc = PARCEL_STATUS_COLORS[p.status];
          return (
            <div
              key={p.id}
              className="flex items-start gap-3 px-4 py-2.5 text-sm"
            >
              <span
                style={{
                  width: 14,
                  height: 10,
                  borderRadius: 2,
                  background: pc.fill,
                  border: `1.5px solid ${pc.stroke}`,
                  flexShrink: 0,
                  marginTop: 4,
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">Flst. {p.parcelNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    Gemarkung {p.gemarkung}, Flur {p.flur}
                  </span>
                  <span
                    style={{ color: pc.stroke, background: `${pc.stroke}10` }}
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  >
                    {pc.label}
                  </span>
                  {p.linkedWEA && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {p.linkedWEA}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span>{p.owner}</span>
                  <span>{p.area} ha</span>
                  {p.contractRef && (
                    <span className="text-emerald-600 dark:text-emerald-500">
                      {p.contractRef}
                    </span>
                  )}
                </div>
                {p.notes && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 italic">
                    {p.notes}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// LOCATION MAP
// ═══════════════════════════════════════════════════════════════════════════════

import ProjectLocationMap from "@/react-app/components/ProjectLocationMap";

const AMPEL_HEX: Record<Ampel, string> = {
  green: "#059669",
  yellow: "#d97706",
  red: "#dc2626",
};
const AMPEL_LABEL: Record<Ampel, string> = {
  green: "Secured",
  yellow: "Partial",
  red: "Open",
};

const PARCEL_STATUS_COLORS: Record<
  ParcelStatus,
  { fill: string; stroke: string; label: string }
> = {
  secured: { fill: "#05966930", stroke: "#059669", label: "Secured" },
  negotiation: { fill: "#d9770630", stroke: "#d97706", label: "Negotiation" },
  open: { fill: "#dc262630", stroke: "#dc2626", label: "Open" },
  buffer: { fill: "#3b82f620", stroke: "#3b82f6", label: "Buffer Zone" },
  easement: { fill: "#6366f118", stroke: "#6366f1", label: "Easement" },
};

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT GENERATORS (unchanged — work on any DDiQReportData)
// ═══════════════════════════════════════════════════════════════════════════════

function generateHTML(d: DDiQReportData, a: string[]): string {
  const secs = d.sections.filter((s) => a.includes(s.id));
  const ac = (x: Ampel) =>
    ({ green: "#059669", yellow: "#d97706", red: "#dc2626" })[x];
  const al = (x: Ampel) =>
    ({ green: "Secured", yellow: "Partial", red: "Open" })[x];

  const secH = secs
    .map(
      (s) =>
        `<h2 style="font-size:15px;font-weight:700;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">${s.title}</h2>` +
        `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:#f8fafc;">` +
        `<th style="text-align:left;padding:8px 12px;border:1px solid #e2e8f0;width:220px;">Category</th>` +
        `<th style="text-align:left;padding:8px 12px;border:1px solid #e2e8f0;">Status / Details</th></tr></thead><tbody>` +
        s.rows
          .map(
            (r) =>
              `<tr><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:500;vertical-align:top;">${r.label}</td>` +
              `<td style="padding:8px 12px;border:1px solid #e2e8f0;">${r.ampel ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ac(r.ampel)};margin-right:6px;vertical-align:middle;"></span>` : ""}${r.value}${r.note ? `<br><em style="color:#d97706;font-size:12px;">${r.note}</em>` : ""}</td></tr>`,
          )
          .join("") +
        `</tbody></table>`,
    )
    .join("");

  const docList =
    d.analyzedDocuments.length > 0
      ? `<h2 style="font-size:15px;font-weight:700;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Analyzed Documents</h2><ul style="font-size:13px;color:#475569;">${d.analyzedDocuments.map((n) => `<li style="margin:4px 0;">${n}</li>`).join("")}</ul>`
      : "";

  const mapH = a.includes("statusmap")
    ? `<h2 style="font-size:15px;font-weight:700;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Land Security Status Map</h2>` +
      `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:#f8fafc;">` +
      `<th style="padding:8px 12px;border:1px solid #e2e8f0;">WEA</th><th style="padding:8px 12px;border:1px solid #e2e8f0;">Status</th>` +
      `<th style="padding:8px 12px;border:1px solid #e2e8f0;">Owner</th><th style="padding:8px 12px;border:1px solid #e2e8f0;">Parcel</th>` +
      `<th style="padding:8px 12px;border:1px solid #e2e8f0;">Contract</th></tr></thead><tbody>` +
      d.weaStatuses
        .map(
          (w) =>
            `<tr><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600;">${w.name}</td>` +
            `<td style="padding:8px 12px;border:1px solid #e2e8f0;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ac(w.ampel)};margin-right:6px;vertical-align:middle;"></span>${al(w.ampel)}</td>` +
            `<td style="padding:8px 12px;border:1px solid #e2e8f0;">${w.owner}</td>` +
            `<td style="padding:8px 12px;border:1px solid #e2e8f0;">${w.parcel}</td>` +
            `<td style="padding:8px 12px;border:1px solid #e2e8f0;">${w.contract}</td></tr>`,
        )
        .join("") +
      `</tbody></table>`
    : "";

  const PC: Record<string, { stroke: string; label: string }> = {
    secured: { stroke: "#059669", label: "Secured" },
    negotiation: { stroke: "#d97706", label: "Negotiation" },
    open: { stroke: "#dc2626", label: "Open" },
    buffer: { stroke: "#3b82f6", label: "Buffer Zone" },
    easement: { stroke: "#6366f1", label: "Easement" },
  };
  const cadastH =
    a.includes("cadastralmap") && d.parcels.length > 0
      ? `<h2 style="font-size:15px;font-weight:700;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Cadastral Parcels (Flurstücke)</h2>` +
        `<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:#f8fafc;">` +
        `<th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">Flurstück</th>` +
        `<th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">Gemarkung</th>` +
        `<th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">Owner</th>` +
        `<th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">Area</th>` +
        `<th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">WEA</th>` +
        `<th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">Contract</th>` +
        `<th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">Status</th></tr></thead><tbody>` +
        d.parcels
          .map((p) => {
            const pc = PC[p.status] || { stroke: "#64748b", label: p.status };
            return (
              `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;">${p.parcelNumber}</td>` +
              `<td style="padding:6px 10px;border:1px solid #e2e8f0;">${p.gemarkung}, Flur ${p.flur}</td>` +
              `<td style="padding:6px 10px;border:1px solid #e2e8f0;">${p.owner}</td>` +
              `<td style="padding:6px 10px;border:1px solid #e2e8f0;">${p.area} ha</td>` +
              `<td style="padding:6px 10px;border:1px solid #e2e8f0;">${p.linkedWEA || "—"}</td>` +
              `<td style="padding:6px 10px;border:1px solid #e2e8f0;">${p.contractRef || "—"}</td>` +
              `<td style="padding:6px 10px;border:1px solid #e2e8f0;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${pc.stroke};margin-right:4px;vertical-align:middle;"></span>${pc.label}</td></tr>`
            );
          })
          .join("") +
        `</tbody></table>`
      : "";

  // ── Location Map with Turbines/Parcels toggle ──
  const hasLocMap = a.includes("locationmap");
  const hasCadast = a.includes("cadastralmap") && d.parcels.length > 0;
  const leafletHead = hasLocMap
    ? `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>`
    : "";

  const locH = hasLocMap
    ? (() => {
        const center = {
          lat:
            d.weaStatuses.reduce((s, w) => s + w.lat, 0) /
            (d.weaStatuses.length || 1),
          lng:
            d.weaStatuses.reduce((s, w) => s + w.lng, 0) /
            (d.weaStatuses.length || 1),
        };
        const cableStart = d.infrastructure.find(
          (p) => p.type === "cable_start",
        );
        const cableEnd = d.infrastructure.find((p) => p.type === "cable_end");
        const PCS: Record<string, string> = {
          secured: "#059669",
          negotiation: "#d97706",
          open: "#dc2626",
          buffer: "#3b82f6",
          easement: "#8b5cf6",
        };
        const PCL: Record<string, string> = {
          secured: "Secured",
          negotiation: "In Negotiation",
          open: "Not Secured",
          buffer: "Buffer Zone",
          easement: "Cable Easement",
        };

        const toggleHTML = hasCadast
          ? `<div id="ddiq-toggle" style="display:flex;gap:0;background:#f1f5f9;border-radius:6px;padding:2px;border:1px solid #e2e8f0;margin-bottom:12px;width:fit-content;">
      <button id="btn-turbines" onclick="switchView('turbines')" style="font:600 12px/1 system-ui;padding:7px 16px;border-radius:4px;border:none;cursor:pointer;background:#fff;color:#0f172a;box-shadow:0 1px 3px rgba(0,0,0,.08);transition:all .15s;">Turbines</button>
      <button id="btn-parcels" onclick="switchView('parcels')" style="font:600 12px/1 system-ui;padding:7px 16px;border-radius:4px;border:none;cursor:pointer;background:transparent;color:#64748b;transition:all .15s;">Parcels</button>
    </div>`
          : "";

        return (
          `<h2 style="font-size:15px;font-weight:700;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Project Location Map</h2>` +
          toggleHTML +
          `<div id="ddiq-map" style="width:100%;height:480px;border-radius:10px;border:1px solid #cbd5e1;margin-bottom:16px;"></div>` +
          `<script>
(function(){
  var map = L.map('ddiq-map', { zoomControl: true }).setView([${center.lat}, ${center.lng}], 14);
  var street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 });
  var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 18 });
  var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '© OpenTopoMap', maxZoom: 17 });
  street.addTo(map);
  L.control.layers({ 'Street': street, 'Satellite': satellite, 'Topographic': topo }, {}, { position: 'topright' }).addTo(map);
  var sharedGroup = L.layerGroup().addTo(map);
  ${cableStart && cableEnd ? `L.polyline([[${cableStart.lat},${cableStart.lng}],[${cableEnd.lat},${cableEnd.lng}]], { color: '#6366f1', weight: 2.5, dashArray: '10 6', opacity: 0.7 }).addTo(sharedGroup);` : ""}
  ${d.infrastructure
    .filter((p) => p.type !== "cable_start")
    .map((p) => {
      const emoji =
        {
          substation: "⚡",
          cable_end: "⚡",
          access_road: "🛤",
          cable_start: "·",
        }[p.type] || "·";
      const bg =
        p.type === "substation" || p.type === "cable_end"
          ? "#6366f1"
          : "#64748b";
      return `L.marker([${p.lat},${p.lng}], { icon: L.divIcon({ className:'', iconSize:[26,26], iconAnchor:[13,13], popupAnchor:[0,-14], html:'<div style="width:26px;height:26px;background:${bg}15;border:1.5px solid ${bg};border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:12px;">${emoji}</div>' })}).addTo(sharedGroup).bindPopup('<b>${p.name}</b>');`;
    })
    .join("\n  ")}
  var turbineGroup = L.layerGroup().addTo(map);
  ${d.weaStatuses
    .map((w) => {
      const c = AMPEL_HEX[w.ampel];
      return `(function(){ var ic = L.divIcon({ className:'', iconSize:[30,30], iconAnchor:[15,15], popupAnchor:[0,-17], html:'<div style="width:30px;height:30px;"><div style="position:absolute;inset:0;background:${c};border:2.5px solid #fff;border-radius:50%;box-shadow:0 2px 8px ${c}55;display:flex;align-items:center;justify-content:center;"><span style="color:#fff;font-size:11px;font-weight:800;font-family:system-ui;">${w.name.replace("WEA ", "")}</span></div></div>' });
    L.marker([${w.lat},${w.lng}], { icon: ic }).addTo(turbineGroup).bindPopup('<div style="font:12px/1.6 system-ui;min-width:200px;padding:10px 12px;"><strong style="font-size:13px;">${w.name}</strong> <span style="font-size:9px;font-weight:700;padding:1px 7px;border-radius:4px;background:${c}10;color:${c};">${AMPEL_LABEL[w.ampel]}</span><div style="font-size:11px;color:#475569;margin-top:6px;"><div><b>Owner</b> ${w.owner}</div><div><b>Parcel</b> ${w.parcel}</div><div><b>Address</b> ${w.address}</div><div><b>Contract</b> ${w.contract}</div></div></div>').bindTooltip('${w.name}', { direction:'top', offset:[0,-17], permanent:true, className:'plm-wea-tt' }); })();`;
    })
    .join("\n  ")}
  ${
    hasCadast
      ? `var parcelGroup = L.layerGroup();
  ${d.parcels
    .map((p) => {
      const c = PCS[p.status] || "#64748b";
      const lb = PCL[p.status] || p.status;
      const isE = p.status === "easement";
      const tlIdx = p.polygon.reduce(
        (bi: number, pt: number[], i: number, arr: number[][]) =>
          pt[0] > arr[bi][0] || (pt[0] === arr[bi][0] && pt[1] < arr[bi][1])
            ? i
            : bi,
        0,
      );
      const tl = p.polygon[tlIdx];
      return `(function(){ L.polygon([${p.polygon.map((pt) => `[${pt[0]},${pt[1]}]`).join(",")}], { fillColor:'${c}', fillOpacity:0.2, color:'${c}', weight:${isE ? 1.5 : 2.5}, ${isE ? "dashArray:'6 4'," : ""} opacity:0.9 }).addTo(parcelGroup).bindPopup('<div style="font:12px/1.6 system-ui;min-width:200px;padding:10px 12px;"><strong>Flst. ${p.parcelNumber}</strong> <span style="font-size:9px;font-weight:700;padding:1px 7px;border-radius:4px;background:${c}10;color:${c};">${lb}</span><div style="font-size:11px;color:#475569;margin-top:6px;"><div><b>Gemarkung</b> ${p.gemarkung}, Flur ${p.flur}</div><div><b>Owner</b> ${p.owner}</div><div><b>Area</b> ${p.area} ha</div>${p.linkedWEA ? `<div><b>Turbine</b> ${p.linkedWEA}</div>` : ""}${p.contractRef ? `<div><b>Contract</b> ${p.contractRef}</div>` : ""}</div></div>');
    L.marker([${tl[0]},${tl[1]}], { interactive:false, icon: L.divIcon({ className:'', iconSize:[0,0], iconAnchor:[-4,14], html:'<div style="font:800 11px/1 system-ui;color:${c};white-space:nowrap;pointer-events:none;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 6px #fff,0 0 6px #fff,1px 1px 2px rgba(0,0,0,.15);">${p.parcelNumber}</div>' })}).addTo(parcelGroup); })();`;
    })
    .join("\n  ")}
  ${d.weaStatuses
    .map((w) => {
      const c = AMPEL_HEX[w.ampel];
      return `L.marker([${w.lat},${w.lng}], { icon: L.divIcon({ className:'', iconSize:[12,12], iconAnchor:[6,6], html:'<div style="width:12px;height:12px;background:${c};border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.25);opacity:.8;"></div>' })}).addTo(parcelGroup).bindTooltip('${w.name}', { direction:'top', offset:[0,-8] });`;
    })
    .join("\n  ")}
  `
      : ""
  }
  var currentLegend = null;
  function buildLegend(mode) {
    if (currentLegend) map.removeControl(currentLegend);
    currentLegend = L.control({ position: 'bottomright' });
    currentLegend.onAdd = function() { var d = L.DomUtil.create('div');
      var dot = function(c) { return '<span style="width:8px;height:8px;border-radius:50%;background:'+c+';flex-shrink:0;"></span>'; };
      var sw = function(c,ds) { return '<span style="width:16px;height:8px;border-radius:2px;border:1.5px '+(ds?'dashed':'solid')+' '+c+';background:'+c+'20;flex-shrink:0;"></span>'; };
      var row = function(i,t) { return '<div style="display:flex;align-items:center;gap:7px;padding:1px 0;">'+i+'<span>'+t+'</span></div>'; };
      var b = '';
      if (mode === 'turbines') { b += row(dot('#059669'),'Secured (${d.weaStatuses.filter((w) => w.ampel === "green").length})'); b += row(dot('#d97706'),'Negotiation (${d.weaStatuses.filter((w) => w.ampel === "yellow").length})'); b += row(dot('#dc2626'),'Open (${d.weaStatuses.filter((w) => w.ampel === "red").length})'); }
      else { b += row(sw('#059669'),'Secured'); b += row(sw('#d97706'),'In Negotiation'); b += row(sw('#dc2626'),'Not Secured'); b += row(sw('#3b82f6'),'Buffer Zone'); b += row(sw('#8b5cf6',true),'Cable Easement'); }
      b += '<div style="height:1px;background:#e2e8f0;margin:4px 0;"></div>'; b += row('<span style="width:16px;height:0;border-top:2px dashed #6366f1;flex-shrink:0;"></span>','Cable Route');
      d.innerHTML = '<div style="background:rgba(255,255,255,.96);backdrop-filter:blur(8px);padding:9px 12px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.08);border:1px solid #e2e8f0;font:10px/1.6 system-ui;color:#475569;">'+b+'</div>'; return d; };
    currentLegend.addTo(map); }
  buildLegend('turbines');
  ${
    hasCadast
      ? `window.switchView = function(mode) { var btnT=document.getElementById('btn-turbines'), btnP=document.getElementById('btn-parcels');
    if(mode==='turbines'){map.removeLayer(parcelGroup);turbineGroup.addTo(map);btnT.style.background='#fff';btnT.style.color='#0f172a';btnT.style.boxShadow='0 1px 3px rgba(0,0,0,.08)';btnP.style.background='transparent';btnP.style.color='#64748b';btnP.style.boxShadow='none';}
    else{map.removeLayer(turbineGroup);parcelGroup.addTo(map);btnP.style.background='#fff';btnP.style.color='#0f172a';btnP.style.boxShadow='0 1px 3px rgba(0,0,0,.08)';btnT.style.background='transparent';btnT.style.color='#64748b';btnT.style.boxShadow='none';}
    buildLegend(mode); };`
      : ""
  }
  var bounds = L.latLngBounds([${d.weaStatuses.map((w) => `[${w.lat},${w.lng}]`).join(",")}]);
  if(bounds.isValid()) map.fitBounds(bounds.pad(0.15));
  var style = document.createElement('style'); style.textContent = '.plm-wea-tt{background:none!important;border:none!important;box-shadow:none!important;font:700 9.5px/1 system-ui;color:#0f172a;padding:0!important;text-shadow:0 0 4px #fff,0 0 4px #fff,0 0 8px #fff}.plm-wea-tt::before{display:none}';
  document.head.appendChild(style);
})();
<\/script>` +
          `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px;"><thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">WEA</th><th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">Lat</th><th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">Lng</th><th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">Address</th><th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0;">Status</th></tr></thead>` +
          `<tbody>${d.weaStatuses.map((w) => `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;">${w.name}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;">${w.lat.toFixed(4)}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;">${w.lng.toFixed(4)}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;">${w.address}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ac(w.ampel)};margin-right:4px;vertical-align:middle;"></span>${al(w.ampel)}</td></tr>`).join("")}</tbody></table>`
        );
      })()
    : "";

  const findH = a.includes("findings")
    ? `<h2 style="font-size:15px;font-weight:700;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;">Action Items</h2>` +
      `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:#f8fafc;">` +
      `<th style="width:24px;border:1px solid #e2e8f0;padding:8px;"></th><th style="text-align:left;padding:8px 12px;border:1px solid #e2e8f0;width:140px;">Domain</th><th style="text-align:left;padding:8px 12px;border:1px solid #e2e8f0;">Recommendation</th></tr></thead><tbody>` +
      d.findings
        .map(
          (f) =>
            `<tr><td style="text-align:center;padding:8px;border:1px solid #e2e8f0;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ac(f.severity)};"></span></td>` +
            `<td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:500;">${f.domain}</td>` +
            `<td style="padding:8px 12px;border:1px solid #e2e8f0;">${f.text}</td></tr>`,
        )
        .join("") +
      `</tbody></table>`
    : "";

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>DDiQ Report – ${d.projectName}</title>` +
    `${leafletHead}` +
    `<style>@media print{body{font-size:12px}h1{font-size:18px}h2{font-size:14px}table{page-break-inside:avoid}#ddiq-map{height:360px!important}.leaflet-control-layers,.leaflet-control-zoom{display:none!important}}</style></head>` +
    `<body style="max-width:900px;margin:40px auto;padding:0 24px;font-family:system-ui,-apple-system,sans-serif;color:#1e293b;line-height:1.5;">` +
    `<div style="border-bottom:3px solid #1e293b;padding-bottom:16px;margin-bottom:32px;">` +
    `<h1 style="font-size:22px;font-weight:800;margin:0;">DDiQ Due Diligence Report</h1>` +
    `<p style="font-size:18px;font-weight:600;color:#475569;margin:4px 0 0;">${d.projectName}</p>` +
    `<div style="display:flex;gap:24px;margin-top:12px;font-size:12px;color:#64748b;">` +
    `<span>Prepared for: ${d.preparedFor}</span><span>By: ${d.preparedBy}</span><span>Date: ${d.date}</span></div></div>` +
    `${docList}${secH}${mapH}${cadastH}${locH}${findH}` +
    `<div style="margin-top:40px;padding-top:16px;border-top:2px solid #e2e8f0;font-size:11px;color:#94a3b8;">Auto-generated by LAI · DDiQ v1. Does not substitute legal review.</div>` +
    `</body></html>`
  );
}

function generateCSV(d: DDiQReportData, a: string[]): string {
  const l = ["Section,Category,Value,Status,Latitude,Longitude"];
  d.sections
    .filter((s) => a.includes(s.id))
    .forEach((s) =>
      s.rows.forEach((r) =>
        l.push(
          `"${s.title}","${r.label}","${r.value.replace(/"/g, '""')}","${r.ampel || ""}","",""`,
        ),
      ),
    );
  if (a.includes("statusmap"))
    d.weaStatuses.forEach((w) =>
      l.push(
        `"Status Map","${w.name}","Owner: ${w.owner} | Parcel: ${w.parcel} | Contract: ${w.contract}","${w.ampel}","${w.lat}","${w.lng}"`,
      ),
    );
  if (a.includes("locationmap"))
    d.weaStatuses.forEach((w) =>
      l.push(
        `"Location Map","${w.name}","${w.address}","${w.ampel}","${w.lat}","${w.lng}"`,
      ),
    );
  if (a.includes("cadastralmap"))
    d.parcels.forEach((p) =>
      l.push(
        `"Cadastral Parcel","Flst. ${p.parcelNumber}","${p.gemarkung} Flur ${p.flur} | ${p.owner} | ${p.area} ha | ${p.contractRef || "No contract"}","${p.status}","",""`,
      ),
    );
  if (a.includes("findings"))
    d.findings.forEach((f) =>
      l.push(
        `"Action Items","${f.domain}","${f.text.replace(/"/g, '""')}","${f.severity}","",""`,
      ),
    );
  return l.join("\n");
}

function generateTXT(d: DDiQReportData, a: string[]): string {
  const l = [
    "=".repeat(72),
    `  DDiQ Due Diligence Report`,
    `  ${d.projectName}`,
    "=".repeat(72),
    "",
    `  For: ${d.preparedFor}`,
    `  By: ${d.preparedBy}`,
    `  Date: ${d.date}`,
    "",
  ];
  if (d.analyzedDocuments.length) {
    l.push("  Analyzed Documents:");
    d.analyzedDocuments.forEach((n) => l.push(`    - ${n}`));
    l.push("");
  }
  d.sections
    .filter((s) => a.includes(s.id))
    .forEach((s) => {
      l.push(
        "",
        `--- ${s.title.toUpperCase()} ${"─".repeat(Math.max(0, 58 - s.title.length))}`,
        "",
      );
      s.rows.forEach((r) => {
        l.push(
          `  ${r.label.padEnd(28)} ${r.value}${r.ampel ? ` [${r.ampel.toUpperCase()}]` : ""}`,
        );
        if (r.note) l.push(`  ${"".padEnd(28)} >> ${r.note}`);
      });
    });
  if (a.includes("statusmap")) {
    l.push(
      "",
      "--- STATUS MAP ────────────────────────────────────────────────────",
      "",
    );
    d.weaStatuses.forEach((w) =>
      l.push(
        `  [${w.ampel.toUpperCase().padEnd(6)}] ${w.name}  |  ${w.owner}  |  ${w.parcel}  |  ${w.contract}`,
      ),
    );
  }
  if (a.includes("locationmap")) {
    l.push(
      "",
      "--- LOCATION MAP (COORDINATES) ────────────────────────────────────",
      "",
    );
    d.weaStatuses.forEach((w) =>
      l.push(
        `  ${w.name.padEnd(8)} ${w.lat.toFixed(4)}°N, ${w.lng.toFixed(4)}°E  |  ${w.address}  [${w.ampel.toUpperCase()}]`,
      ),
    );
    l.push("", "  Infrastructure:");
    d.infrastructure.forEach((p) =>
      l.push(
        `  ${p.name.padEnd(28)} ${p.lat.toFixed(4)}°N, ${p.lng.toFixed(4)}°E`,
      ),
    );
  }
  if (a.includes("cadastralmap") && d.parcels.length > 0) {
    const statusLabel: Record<string, string> = {
      secured: "SECURED",
      negotiation: "NEGOTIATION",
      open: "OPEN",
      buffer: "BUFFER",
      easement: "EASEMENT",
    };
    l.push(
      "",
      "--- CADASTRAL PARCELS (FLURSTÜCKE) ────────────────────────────────",
      "",
    );
    d.parcels.forEach((p) => {
      l.push(
        `  [${(statusLabel[p.status] || p.status).padEnd(11)}] Flst. ${p.parcelNumber.padEnd(6)} | Gemarkung ${p.gemarkung}, Flur ${p.flur} | ${p.owner} | ${p.area} ha`,
      );
      if (p.linkedWEA)
        l.push(
          `  ${"".padEnd(16)} → ${p.linkedWEA}  Contract: ${p.contractRef || "None"}`,
        );
      if (p.notes) l.push(`  ${"".padEnd(16)} >> ${p.notes}`);
    });
    const totalArea = d.parcels.reduce((s, p) => s + p.area, 0);
    const securedArea = d.parcels
      .filter((p) => ["secured", "buffer", "easement"].includes(p.status))
      .reduce((s, p) => s + p.area, 0);
    l.push(
      "",
      `  Total: ${d.parcels.length} parcels, ${totalArea.toFixed(1)} ha, ${((securedArea / totalArea) * 100).toFixed(0)}% secured`,
    );
  }
  if (a.includes("findings")) {
    l.push(
      "",
      "--- ACTION ITEMS ──────────────────────────────────────────────────",
      "",
    );
    d.findings.forEach((f, i) =>
      l.push(
        `  ${i + 1}. [${f.severity.toUpperCase()}] ${f.domain}: ${f.text}`,
      ),
    );
  }
  l.push("", "=".repeat(72), "  LAI DDiQ v1", "=".repeat(72));
  return l.join("\n");
}

function downloadFile(content: string, filename: string, mime: string) {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(u);
  document.body.removeChild(a);
}

// Open the generated HTML report in a new tab and trigger the browser's
// print dialog, where the user picks "Save as PDF". Real PDF, no fake
// extension trickery, no extra runtime deps. Works in every modern
// browser. The new tab stays open afterwards so the user can re-print
// or close manually.
function printAsPdf(html: string) {
  // Use a Blob URL instead of the deprecated document.write — same effect
  // (HTML loads into a new tab) without the deprecation warning. The
  // Blob URL is revoked after the print dialog has had time to open.
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    // Pop-up blocked — fall back to downloading the HTML so the user
    // still gets the report and can print to PDF from there.
    URL.revokeObjectURL(url);
    return false;
  }
  // Give the browser a tick to lay out the document before printing.
  // window.print() is synchronous and blocks the print dialog until
  // closed, which is what we want.
  const trigger = () => { try { w.focus(); w.print(); } catch { /* ignore */ } };
  w.addEventListener("load", () => setTimeout(trigger, 150));
  // Revoke generously after the print dialog should be open; the new
  // tab keeps the document loaded regardless.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

async function downloadFormat(fmt: ExportFormat, d: DDiQReportData, a: string[]) {
  const s = `DDiQ_${d.projectName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}`;
  const html = () => generateHTML(d, a);
  switch (fmt) {
    case "pdf": {
      // Real PDF via browser print-to-PDF. If the popup is blocked,
      // fall back to delivering the HTML so the user can print it
      // themselves.
      if (!printAsPdf(html())) {
        downloadFile(html(), `${s}.html`, "text/html;charset=utf-8");
      }
      return;
    }
    case "docx": {
      // Real Word document (letterhead format) built with the `docx`
      // library — see lib/ddiqDocx.ts. Lazy-imported so the heavy `docx`
      // dependency only loads when the user actually exports a Word file,
      // keeping it out of the main bundle.
      const { buildReportDocxBlob } = await import("@/react-app/lib/ddiqDocx");
      const blob = await buildReportDocxBlob(d, a);
      return downloadBlob(blob, `${s}.docx`);
    }
    case "html":
      return downloadFile(html(), `${s}.html`, "text/html;charset=utf-8");
    case "csv":
      return downloadFile(generateCSV(d, a), `${s}.csv`, "text/csv;charset=utf-8");
    case "txt":
      return downloadFile(generateTXT(d, a), `${s}.txt`, "text/plain;charset=utf-8");
    // xlsx export is intentionally not offered — the CSV output opens in
    // Excel directly.
    case "xlsx":
      return;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Past Reports browser ───────────────────────────────────────────────────
// Lists historical reports from the backend so the user can re-open one
// without re-running the 30-90 min pipeline. Click a card → fetch the
// full report_data → render in the existing preview view (no GPU spent
// since this is a pure DB read).

interface PastReportsPanelProps {
  refreshKey: number;
  onLoad: (summary: ReportSummary) => void;
  /** Called after a successful deletion. Lets the parent clear localStorage
   *  if the deleted report was the currently-active one. */
  onAfterDelete?: (deletedId: string) => void;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 0) return null;
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  } catch { return null; }
}

function PastReportsPanel({ refreshKey, onLoad, onAfterDelete }: PastReportsPanelProps) {
  const [items, setItems] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listReports(50)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const handleDelete = async (r: ReportSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const label = r.project_name || "this report";
    const confirmed = window.confirm(
      `Delete "${label}"?\n\nThis will permanently remove the report and its cadastral artifacts. Cannot be undone.`,
    );
    if (!confirmed) return;
    setDeletingId(r.report_id);
    setError(null);
    try {
      await deleteReport(r.report_id);
      // Drop locally first for instant feedback; then refetch to stay in
      // sync with any concurrent changes.
      setItems((prev) => prev.filter((x) => x.report_id !== r.report_id));
      onAfterDelete?.(r.report_id);
      try {
        const fresh = await listReports(50);
        setItems(fresh);
      } catch { /* stay with optimistic state */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete report");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4 text-xs text-muted-foreground flex items-center gap-2">
        <SandglassIcon className="w-3.5 h-3.5 animate-pulse" />
        Loading past reports…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-xs text-rose-600 dark:text-rose-400">
        Failed to load past reports: {error}
      </div>
    );
  }

  if (items.length === 0) {
    return null; // No prior reports — don't clutter the new-report flow.
  }

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">Past Reports</h4>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Open a previously generated report — no GPU re-run needed.
          </p>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {items.length} report{items.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="divide-y divide-border/30 max-h-72 overflow-y-auto">
        {items.map((r) => {
          const dur = formatDuration(r.started_at, r.finished_at);
          const isLoading = loadingId === r.report_id;
          const statusTone =
            r.status === "done" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" :
            r.status === "running" || r.status === "queued" ? "bg-blue-500/10 text-blue-700 dark:text-blue-300" :
            "bg-rose-500/10 text-rose-700 dark:text-rose-300";
          const isDeleting = deletingId === r.report_id;
          const canOpen = r.status === "done" && !isDeleting;
          const onRowClick = canOpen
            ? () => {
                setLoadingId(r.report_id);
                try { onLoad(r); } finally { setLoadingId(null); }
              }
            : undefined;
          return (
            <div
              key={r.report_id}
              role={canOpen ? "button" : undefined}
              tabIndex={canOpen ? 0 : -1}
              onClick={onRowClick}
              onKeyDown={canOpen ? (e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick?.(); }
              } : undefined}
              className={cn(
                "px-4 py-3 flex items-start gap-3 transition-colors",
                canOpen ? "hover:bg-muted/40 cursor-pointer" : "cursor-default opacity-70",
                isDeleting && "opacity-40 pointer-events-none",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">
                    {r.project_name || "Untitled report"}
                  </span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium uppercase", statusTone)}>
                    {r.status}
                  </span>
                  {r.preset && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300">
                      {r.preset}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                  <span>{formatTimestamp(r.created_at || r.started_at)}</span>
                  <span>•</span>
                  <span>{r.doc_count} doc{r.doc_count === 1 ? "" : "s"}</span>
                  {r.status === "done" && (
                    <>
                      <span>•</span>
                      <span>{r.finding_count} finding{r.finding_count === 1 ? "" : "s"}</span>
                    </>
                  )}
                  {dur && (
                    <>
                      <span>•</span>
                      <span>{dur}</span>
                    </>
                  )}
                </div>
                {r.error && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 truncate">
                    {r.error}
                  </p>
                )}
              </div>
              {canOpen && (
                <span className="text-[11px] text-primary font-medium self-center flex-shrink-0">
                  {isLoading ? "Loading…" : "Open →"}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => handleDelete(r, e)}
                disabled={isDeleting}
                aria-label={`Delete report ${r.project_name || ""}`}
                title="Delete report"
                className={cn(
                  "self-center flex-shrink-0 p-1.5 rounded text-muted-foreground transition-colors",
                  "hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Step = "select-docs" | "configure" | "preview" | "exporting";

interface Props {
  documents: DocumentItem[];
  className?: string;
  /** Hide the built-in "Past Reports" browser — used when the host page
   *  surfaces past reports in its own dedicated tab/section instead, so the
   *  generator stays focused on creating a report. */
  hidePastReports?: boolean;
  /** When set, the panel opens this report in the preview (a pure DB read,
   *  no GPU). Lets an external Past Reports section deep-link into the
   *  preview. Cleared via ``onOpenHandled`` once consumed. */
  openReport?: ReportSummary | null;
  onOpenHandled?: () => void;
}

export default function ReportDownloadPanel({
  documents: rawDocs,
  className,
  hidePastReports = false,
  openReport = null,
  onOpenHandled,
}: Props) {
  const documents = rawDocs ?? [];
  const analyzedDocs = useMemo(
    () => documents.filter((d) => d.status === "analyzed"),
    [documents],
  );

  // ── Rehydrate from localStorage on first render. Lazy initializers
  // run once before the first paint, so the user never sees a flash of
  // "select-docs" while we're really mid-rehydrate.
  const persistedAtMount = useRef<PersistedReport | null>(loadPersistedReport());

  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(
    () => new Set(persistedAtMount.current?.doc_ids ?? []),
  );
  const [docSearch, setDocSearch] = useState("");
  // Always enter at the first step (document selection) so the flow reads
  // forward: select-docs → configure → preview. A persisted report still
  // rehydrates — its documents and preset are pre-selected and the cached
  // payload is restored — but we no longer jump straight to the preview on
  // open. In-flight jobs resume polling and surface their result on
  // completion (see the mount effect below); the past-reports browser lets
  // the user reopen any completed report directly.
  const [step, setStep] = useState<Step>("select-docs");
  const [selectedPreset, setSelectedPreset] = useState<ReportPreset>(() => {
    const id = persistedAtMount.current?.preset;
    return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
  });
  const [activeSections, setActiveSections] = useState<string[]>(() => {
    const id = persistedAtMount.current?.preset;
    return (PRESETS.find((p) => p.id === id) ?? PRESETS[0]).sections;
  });
  const [selectedFormats, setSelectedFormats] = useState<ExportFormat[]>([
    "pdf",
  ]);

  // ── Report generation state ──
  const [reportData, setReportData] = useState<DDiQReportData | null>(
    () => persistedAtMount.current?.report ?? null,
  );
  const [activeReportId, setActiveReportId] = useState<string | null>(
    () => persistedAtMount.current?.report_id ?? null,
  );
  const [reportStatus, setReportStatus] = useState<ReportStatus | null>(
    () => persistedAtMount.current?.status ?? null,
  );
  const [reportProgress, setReportProgress] = useState<{step: string | null; percent: number; startedAt?: string | null}>(
    { step: null, percent: 0 },
  );
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(
    () => persistedAtMount.current?.error ?? null,
  );

  // ── Persist whenever any tracked field changes. We never auto-trigger
  // generation from this effect — it only mirrors state to localStorage.
  useEffect(() => {
    if (!activeReportId) {
      savePersistedReport(null);
      return;
    }
    savePersistedReport({
      report_id: activeReportId,
      status: reportStatus ?? "done",
      doc_ids: [...selectedDocIds],
      preset: selectedPreset.id,
      report: reportData ?? undefined,
      error: generateError ?? undefined,
      ts: Date.now(),
    });
  }, [activeReportId, reportStatus, reportData, generateError, selectedDocIds, selectedPreset]);

  // ── If we rehydrated an in-flight job (queued/running), resume polling.
  // If we rehydrated a `done` row but don't have the payload cached
  // locally (e.g. localStorage quota dropped it), fetch the full report
  // once. Triggered only on mount; the user has to click Generate to
  // start fresh work. */
  useEffect(() => {
    const initial = persistedAtMount.current;
    if (!initial) return;
    if (initial.status === "done") {
      if (!initial.report) {
        // Cached metadata only — pull the full payload back.
        fetchReport(initial.report_id)
          .then((res) => setReportData(res.report))
          .catch((err) => setGenerateError(
            err instanceof Error ? err.message : "Failed to load saved report",
          ));
      }
    } else if (initial.status === "queued" || initial.status === "running") {
      setGenerating(true);
      pollReportRef.current?.(initial.report_id);
    }
    // Intentionally only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pollReport is wrapped in a ref so the mount-only effect above can
  // call it without being a dependency (it's stable per instance).
  const pollReportRef = useRef<((id: string) => void) | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    pollReportRef.current = function poll(id: string) {
      if (cancelled) return;
      fetchReportStatus(id)
        .then((s) => {
          if (cancelled) return;
          setReportStatus(s.status);
          setReportProgress({ step: s.step, percent: s.percent, startedAt: s.started_at });
          if (s.status === "done") {
            fetchReport(id)
              .then((r) => {
                if (cancelled) return;
                setReportData(r.report);
                setGenerating(false);
                setStep("preview");
              })
              .catch((err) => {
                if (cancelled) return;
                setGenerateError(err instanceof Error ? err.message : "Fetch failed");
                setGenerating(false);
              });
          } else if (s.status === "failed") {
            setGenerateError(s.error || "Report generation failed");
            setGenerating(false);
          } else {
            timer = setTimeout(() => poll(id), 5000);
          }
        })
        .catch(() => {
          // Transient network error — back off and retry.
          if (!cancelled) timer = setTimeout(() => poll(id), 5000);
        });
    };
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const selectedDocs = useMemo(
    () => documents.filter((d) => selectedDocIds.has(d.id)),
    [documents, selectedDocIds],
  );
  const filteredAnalyzed = useMemo(() => {
    if (!docSearch) return analyzedDocs;
    const q = docSearch.toLowerCase();
    return analyzedDocs.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q),
    );
  }, [analyzedDocs, docSearch]);

  const statusCfg = {
    analyzed: {
      Icon: CheckRingIcon,
      color: "text-emerald-600 dark:text-emerald-500",
      bg: "bg-emerald-500/10 dark:bg-emerald-500/20",
      label: "Analyzed",
    },
    pending: {
      Icon: SandglassIcon,
      color: "text-amber-600 dark:text-amber-500",
      bg: "bg-amber-500/10 dark:bg-amber-500/20",
      label: "Pending",
    },
    archived: {
      Icon: ArchiveIcon,
      color: "text-slate-500 dark:text-slate-400",
      bg: "bg-slate-500/10 dark:bg-slate-500/20",
      label: "Archived",
    },
  };

  const toggleDoc = (id: string) =>
    setSelectedDocIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const selectAll = () =>
    setSelectedDocIds(new Set(analyzedDocs.map((d) => d.id)));
  const deselectAll = () => setSelectedDocIds(new Set());
  const toggleSection = (id: string) =>
    setActiveSections((p) =>
      p.includes(id) ? p.filter((s) => s !== id) : [...p, id],
    );
  const toggleFormat = (id: ExportFormat) =>
    setSelectedFormats((p) =>
      p.includes(id)
        ? p.length > 1
          ? p.filter((f) => f !== id)
          : p
        : [...p, id],
    );
  const pickPreset = (p: ReportPreset) => {
    setSelectedPreset(p);
    setActiveSections([...p.sections]);
  };

  const resetToStart = () => {
    setStep("select-docs");
    setReportData(null);
    setActiveReportId(null);
    setReportStatus(null);
    setReportProgress({ step: null, percent: 0 });
    setGenerateError(null);
    savePersistedReport(null);
  };

  // ── Generate report via backend API ──
  // This is the ONLY path that POSTs to /generate/async. Mounting,
  // rehydrating, switching tabs, and refreshing the page never trigger a
  // new run — the user has to click Generate. The backend dedups by
  // request fingerprint anyway, so a re-click on the same docs+preset
  // returns the cached row instead of recomputing on the GPU.
  const handleGenerateAndPreview = async () => {
    setGenerating(true);
    setGenerateError(null);
    setReportData(null);
    setReportProgress({ step: "queued", percent: 0 });
    try {
      const res = await generateReportAsync({
        document_ids: [...selectedDocIds],
        preset: selectedPreset.id,
      });
      setActiveReportId(res.report_id);
      setReportStatus(res.status);
      if (res.status === "done") {
        // Backend hit on cached fingerprint — pull payload, no GPU spent,
        // no email is being sent. No toast either.
        const r = await fetchReport(res.report_id);
        setReportData(r.report);
        setStep("preview");
        setGenerating(false);
      } else {
        // queued/running — show progress UI and poll until done. Also tell
        // the user they can close the tab: the worker will email them on
        // completion (or failure). Only show the toast for non-trivial
        // runs (≥3 min estimate) — short runs the user will just wait for.
        const estimate = res.estimated_minutes ?? 0;
        if (estimate >= 3) {
          toast.success("Generating your report", {
            description: `We'll email you when it's ready — typically about ${estimate} minute${estimate === 1 ? "" : "s"}. You can safely close this tab.`,
            duration: 8000,
          });
        }
        pollReportRef.current?.(res.report_id);
      }
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Report generation failed",
      );
      setGenerating(false);
    }
  };

  const doExport = () => {
    // The report is already in memory — no work to do, just switch to the
    // format-picker view. The old fake-progress animation was theater.
    setStep("exporting");
  };

  const handleDownloadAll = () => {
    if (!reportData) return;
    selectedFormats.forEach((f) =>
      void downloadFormat(f, reportData, activeSections),
    );
  };
  const handleDownloadOne = (fmt: ExportFormat) => {
    if (!reportData) return;
    void downloadFormat(fmt, reportData, activeSections);
  };

  // Bumped after a fresh generation completes so the Past Reports panel
  // re-fetches and shows the new entry at the top.
  const [pastRefreshKey, setPastRefreshKey] = useState(0);
  useEffect(() => {
    if (reportStatus === "done" && activeReportId) setPastRefreshKey((k) => k + 1);
  }, [reportStatus, activeReportId]);

  // Load a past report from the listing — pure DB read, no GPU spent.
  // Switches the panel to the preview step with the historical payload.
  const loadPastReport = async (summary: ReportSummary) => {
    if (summary.status !== "done") return;
    setGenerating(false);
    setGenerateError(null);
    try {
      const r = await fetchReport(summary.report_id);
      setActiveReportId(summary.report_id);
      setReportStatus("done");
      setReportData(r.report);
      // Restore preset / selected docs if we can match — best-effort, since
      // the summary doesn't carry the original document_ids array.
      const presetId = summary.preset || "full";
      const matched = PRESETS.find((p) => p.id === presetId);
      if (matched) {
        setSelectedPreset(matched);
        setActiveSections([...matched.sections]);
      }
      setStep("preview");
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to load report");
    }
  };

  // External deep-link: when the host hands us a report to open (e.g. from a
  // Past Reports section in another tab), load it into the preview, then tell
  // the host it's been consumed so re-mounts don't reopen it.
  useEffect(() => {
    if (openReport && openReport.status === "done") {
      void loadPastReport(openReport);
      onOpenHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReport]);

  // ═══════════ STEP 1: SELECT DOCUMENTS ═══════════════════════════════════

  if (step === "select-docs")
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">DDiQ Report Builder</h2>
            <p className="text-sm text-muted-foreground">
              Select documents for due diligence analysis, then configure your
              report
            </p>
          </div>
        </div>

        {!hidePastReports && (
        <PastReportsPanel
          refreshKey={pastRefreshKey}
          onLoad={loadPastReport}
          onAfterDelete={(deletedId) => {
            // If the user deleted the report they were currently viewing,
            // clear the active state and the localStorage cache so the
            // next refresh doesn't try to rehydrate a ghost id.
            if (deletedId === activeReportId) {
              setReportData(null);
              setActiveReportId(null);
              setReportStatus(null);
              setReportProgress({ step: null, percent: 0 });
              savePersistedReport(null);
            }
          }}
        />
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Total Uploaded
                  </p>
                  <p className="text-2xl font-bold mt-2">{documents.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    From Documents page & Chat
                  </p>
                </div>
                <div className="p-2.5 rounded-md bg-slate-100 dark:bg-slate-800">
                  <ManuscriptIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur border-border/50 border-l-4 border-l-emerald-500/50">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Ready for Report
                  </p>
                  <p className="text-2xl font-bold mt-2 text-emerald-600 dark:text-emerald-500">
                    {analyzedDocs.length}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Analyzed documents
                  </p>
                </div>
                <div className="p-2.5 rounded-md bg-emerald-500/10">
                  <CheckRingIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur border-border/50 border-l-4 border-l-blue-500/50">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Selected</p>
                  <p className="text-2xl font-bold mt-2 text-blue-600 dark:text-blue-500">
                    {selectedDocIds.size}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    For this report
                  </p>
                </div>
                <div className="p-2.5 rounded-md bg-blue-500/10">
                  <DownloadIcon className="w-5 h-5 text-blue-600 dark:text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Select Documents for Analysis
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={selectAll}
                  className="text-xs h-7"
                >
                  Select All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={deselectAll}
                  className="text-xs h-7"
                >
                  Clear
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative mb-3">
              <SearchIcon className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search analyzed documents..."
                className="pl-10 h-9 text-sm"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
              />
            </div>
            {analyzedDocs.length === 0 ? (
              <div className="text-center py-8">
                <ManuscriptIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-sm text-muted-foreground">
                  No analyzed documents available
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload and analyze documents on the Documents page first
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredAnalyzed.map((doc) => {
                  const isSelected = selectedDocIds.has(doc.id);
                  return (
                    <div
                      key={doc.id}
                      onClick={() => toggleDoc(doc.id)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                        isSelected
                          ? "border-primary/40 bg-primary/5"
                          : "border-transparent hover:bg-muted/40",
                      )}
                    >
                      <div
                        className={cn(
                          "w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors",
                          isSelected
                            ? "bg-primary border-primary"
                            : "border-border",
                        )}
                      >
                        {isSelected && (
                          <CheckIcon className="w-3 h-3 text-primary-foreground" />
                        )}
                      </div>
                      <div className="p-1.5 rounded-md bg-emerald-500/10">
                        <CheckRingIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm font-medium truncate",
                            !isSelected && "text-muted-foreground",
                          )}
                        >
                          {doc.name}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span>{doc.size.toFixed(1)} MB</span>
                          <span>{doc.uploadDate}</span>
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px]">
                            {doc.category}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {documents.filter((d) => d.status !== "analyzed").length > 0 && (
              <>
                <Separator className="my-4" />
                <p className="text-xs text-muted-foreground mb-2">
                  Not available for report (pending or archived):
                </p>
                <div className="space-y-1 opacity-50">
                  {documents
                    .filter((d) => d.status !== "analyzed")
                    .map((doc) => {
                      const sc = statusCfg[doc.status];
                      return (
                        <div
                          key={doc.id}
                          className="flex items-center gap-3 p-2.5 rounded-lg"
                        >
                          <div className="w-5 h-5 rounded border border-border flex items-center justify-center flex-shrink-0" />
                          <div className={cn("p-1.5 rounded-md", sc.bg)}>
                            <sc.Icon className={cn("w-4 h-4", sc.color)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-muted-foreground truncate">
                              {doc.name}
                            </p>
                            <span
                              className={cn(
                                "text-[10px] font-medium px-1.5 py-0.5 rounded",
                                sc.bg,
                                sc.color,
                              )}
                            >
                              {sc.label}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={() => setStep("configure")}
            disabled={selectedDocIds.size === 0}
            className="shadow-sm"
          >
            Continue to Configure <ArrowRightIcon className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    );

  // ═══════════ STEP 2: CONFIGURE ══════════════════════════════════════════

  if (step === "configure")
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep("select-docs")}
            className="text-xs h-7 px-2"
          >
            ← Back
          </Button>
          <div>
            <h2 className="text-lg font-semibold">Configure Report</h2>
            <p className="text-sm text-muted-foreground">
              {selectedDocIds.size} document
              {selectedDocIds.size !== 1 ? "s" : ""} selected:{" "}
              {selectedDocs
                .map((d) => d.name)
                .slice(0, 2)
                .join(", ")}
              {selectedDocs.length > 2
                ? ` +${selectedDocs.length - 2} more`
                : ""}
            </p>
          </div>
        </div>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              Report Template
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickPreset(p)}
                  className={cn(
                    "text-left p-3 rounded-lg border transition-all",
                    selectedPreset.id === p.id
                      ? "border-primary bg-primary/5"
                      : "border-border/50 hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {selectedPreset.id === p.id && (
                      <CheckIcon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    )}
                    <span className="text-sm font-semibold">{p.name}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {p.description}
                  </p>
                  <Badge variant="outline" className="text-[9px] mt-2">
                    ~{p.estimatedPages} pages
                  </Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              Customize Sections ({activeSections.length}/{SECTION_META.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {SECTION_META.map((sm) => {
              const active = activeSections.includes(sm.id);
              return (
                <div
                  key={sm.id}
                  onClick={() => toggleSection(sm.id)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-all",
                    active
                      ? "border-primary/30 bg-primary/5"
                      : "border-transparent hover:bg-muted/40",
                  )}
                >
                  <div
                    className={cn(
                      "w-5 h-5 rounded border flex items-center justify-center flex-shrink-0",
                      active ? "bg-primary border-primary" : "border-border",
                    )}
                  >
                    {active && (
                      <CheckIcon className="w-3 h-3 text-primary-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        !active && "text-muted-foreground",
                      )}
                    >
                      {sm.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {sm.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Export-format selection used to live here, but picking a format
            BEFORE the report exists is premature — the user can't judge
            what to pick. The picker now lives in the preview step, after
            content is on screen. */}

        {/* In-flight progress (shown while generating; survives refresh
            because we re-poll on mount when status is queued/running). */}
        {generating && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <ReportProgressBar
              status={reportStatus ?? "running"}
              step={reportProgress.step}
              value={(reportProgress.percent || 0) * 100}
              startedAt={reportProgress.startedAt}
            />
          </div>
        )}

        {/* Error display */}
        {generateError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4">
            <p className="text-sm text-rose-600 dark:text-rose-400 font-medium">
              Report generation failed
            </p>
            <p className="text-xs text-rose-500 mt-1">{generateError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 text-xs"
              onClick={() => setGenerateError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={resetToStart}
          >
            Back
          </Button>
          <Button
            onClick={handleGenerateAndPreview}
            disabled={activeSections.length === 0 || generating}
            className="shadow-sm"
          >
            {generating ? (
              <SandglassIcon className="w-4 h-4 mr-2 animate-pulse" />
            ) : (
              <LensIcon className="w-4 h-4 mr-2" />
            )}
            {generating ? "Generating Report..." : "Preview Report"}
          </Button>
        </div>
      </div>
    );

  // ═══════════ STEP 3: PREVIEW ════════════════════════════════════════════

  if (step === "preview" && reportData) {
    const rd = reportData;
    const visSec = rd.sections.filter((s) => activeSections.includes(s.id));
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep("configure")}
              className="text-xs h-7 px-2"
            >
              ← Configure
            </Button>
            <div>
              <h2 className="text-lg font-semibold">Report Preview</h2>
              <p className="text-sm text-muted-foreground">
                {selectedPreset.name} · {selectedDocIds.size} document
                {selectedDocIds.size !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Format choice happens AFTER clicking Export Report — the
                exporting step shows the picker + download buttons. */}
            <Button onClick={doExport} className="shadow-sm">
              <DownloadIcon className="w-4 h-4 mr-2" />
              Export Report
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 p-6 bg-card">
          <div className="border-b-2 border-foreground pb-4 mb-4">
            <h1 className="text-xl font-bold">DDiQ Due Diligence Report</h1>
            <p className="text-lg font-semibold text-muted-foreground mt-1">
              {rd.projectName}
            </p>
            <div className="flex items-center gap-6 mt-3 text-xs text-muted-foreground">
              <span>For: {rd.preparedFor}</span>
              <span>By: {rd.preparedBy}</span>
              <span>Date: {rd.date}</span>
            </div>
          </div>

          {/* Header facts + contextual notes (Path B). Renders the canonical
              ProjectFacts the backend reconciled, with notes that turn any
              honest "unknown" into a transparent attribution (e.g. "not
              stated for Windpark Zodel; documents mention Windpark Lamstedt
              separately"). Falls back gracefully on older reports without
              projectFacts. */}
          <ProjectFactsHeader rd={rd} />

          {/* Per-park breakdown — fires only when the documents cover more
              than one wind park. Shows each park's count/capacity/models/
              status separately so a multi-park room never reads as a single
              merged total. */}
          <ParksBreakdown rd={rd} />

          {rd.analyzedDocuments.length > 0 && (
            <div className="mb-6 p-3 rounded-lg bg-muted/30 border border-border/30">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                Analyzed Documents ({rd.analyzedDocuments.length})
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {rd.analyzedDocuments.map((n) => (
                  <span
                    key={n}
                    className="text-xs px-2 py-1 rounded bg-primary/10 text-primary font-medium"
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-6">
            {visSec.map((sec) => (
              <AusgabeblattTable key={sec.id} section={sec} />
            ))}
            {activeSections.includes("statusmap") && (
              <StatusMap statuses={rd.weaStatuses} />
            )}
            {activeSections.includes("cadastralmap") &&
              rd.parcels.length > 0 && <CadastralTable parcels={rd.parcels} />}
            {activeSections.includes("locationmap") && (
              <ProjectLocationMap
                statuses={rd.weaStatuses}
                infrastructure={rd.infrastructure}
                parcels={
                  activeSections.includes("cadastralmap") ? rd.parcels : []
                }
                projectName={rd.projectName}
              />
            )}
            {activeSections.includes("findings") && (
              <>
                {rd.crossDocFindings && rd.crossDocFindings.length > 0 && (
                  <FindingsTable
                    findings={rd.crossDocFindings}
                    title="Cross-Document Inconsistencies"
                  />
                )}
                {rd.timeline && rd.timeline.length > 0 && (
                  <TimelinePanel entries={rd.timeline} />
                )}
                {rd.rueckbauBond && <RueckbauPanel bond={rd.rueckbauBond} />}
                {rd.grundbuchChecks && rd.grundbuchChecks.length > 0 && (
                  <GrundbuchPanel checks={rd.grundbuchChecks} />
                )}
                <FindingsTable findings={rd.findings} />
              </>
            )}
          </div>
          <div className="mt-8 pt-4 border-t border-border/40 text-[11px] text-muted-foreground">
            Auto-generated by LAI · DDiQ v1. Source-linked evidence under each
            finding lets you jump back to the originating document. Statutory
            citations are best-effort — does not substitute formal legal review.
          </div>
        </div>
      </div>
    );
  }

  // ═══════════ STEP 4: EXPORT (format picker + downloads) ════════════════
  // The report is already in memory; this step is just the format chooser
  // and the actual download buttons. No fake progress — the pipeline ran
  // long ago, downloading is local.

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStep("preview")}
          className="text-xs h-7 px-2"
        >
          ← Preview
        </Button>
        <h2 className="text-lg font-semibold">Export Report</h2>
      </div>
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="py-10">
          <div className="max-w-lg mx-auto space-y-6">
            <div className="text-center space-y-1">
              <h3 className="text-base font-semibold">
                {reportData?.projectName || "Report"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {selectedPreset.name} · {activeSections.length} sections · {reportData?.findings.length || 0} action items
              </p>
            </div>

            {/* Format picker — interactive, lets the user pick before download. */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Choose format(s)
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {FORMAT_OPTIONS.map((fmt) => {
                  const active = selectedFormats.includes(fmt.id);
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => toggleFormat(fmt.id)}
                      className={cn(
                        "flex items-center gap-2 p-3 rounded-md border text-left transition-all",
                        active
                          ? `${fmt.colorCls} border`
                          : "border-border/50 hover:bg-muted/40",
                      )}
                    >
                      <div
                        className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0",
                          active ? "bg-primary border-primary" : "border-border",
                        )}
                      >
                        {active && <CheckIcon className="w-3 h-3 text-primary-foreground" />}
                      </div>
                      <div className="min-w-0">
                        <p className={cn("text-sm font-semibold", !active && "text-muted-foreground")}>
                          .{fmt.label}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {fmt.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Per-format download buttons — one click = one download. */}
            <div className="flex justify-center gap-2 flex-wrap pt-1">
              {selectedFormats.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Select at least one format to download.
                </p>
              ) : (
                selectedFormats.map((fmt) => {
                  const fo = FORMAT_OPTIONS.find((x) => x.id === fmt)!;
                  return (
                    <button
                      key={fmt}
                      onClick={() => handleDownloadOne(fmt)}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold border cursor-pointer hover:opacity-80 transition-opacity",
                        fo.colorCls,
                      )}
                    >
                      <DownloadIcon className="w-3.5 h-3.5" />
                      Download .{fmt.toUpperCase()}
                    </button>
                  );
                })
              )}
            </div>

            {selectedFormats.length > 1 && (
              <div className="flex justify-center">
                <Button onClick={handleDownloadAll} className="shadow-sm">
                  <DownloadIcon className="w-4 h-4 mr-2" />
                  Download all {selectedFormats.length} files
                </Button>
              </div>
            )}

            <div className="flex justify-center gap-3 pt-2 border-t border-border/40 mt-2">
              {/* The "Overview" is the report preview — go back to it (keeping
                  the loaded report), NOT all the way to the document picker. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("preview")}
              >
                Back to Overview
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Keep selected docs/preset so the user can tweak and
                  // re-generate, but drop the cached report so a new
                  // fingerprint takes a fresh run (unless backend dedup
                  // short-circuits it).
                  setReportData(null);
                  setActiveReportId(null);
                  setReportStatus(null);
                  setReportProgress({ step: null, percent: 0 });
                  savePersistedReport(null);
                  setStep("configure");
                }}
              >
                Generate Another
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


// ── Path B: ProjectFactsHeader + ParksBreakdown ──────────────────────
//
// These two components surface the canonical per-park breakdown the backend
// produces. The DDiQReportData TS interface is intentionally loose, so we
// access the new fields via cast and degrade gracefully on older reports.

interface ParkFactsT {
  name: string;
  projectCompany?: string | null;
  bundesland?: string | null;
  location?: string | null;
  turbineCount: number;
  totalCapacityMw?: number | null;
  models?: string[];
  statusCounts?: Record<string, number>;
  turbineNames?: string[];
  isPrimary?: boolean;
}

interface ProjectFactsT {
  projectName?: string;
  projectCompany?: string | null;
  bundesland?: string | null;
  turbineCount?: number;
  totalCapacityMw?: number | null;
  commissionedWeaCount?: number;
  notes?: Record<string, string> | null;
}

type ReportDataWithParks = DDiQReportData & {
  parks?: ParkFactsT[];
  multiParkDetected?: boolean;
  projectFacts?: ProjectFactsT | null;
  bundesland?: string | null;
  turbineCount?: number;
};

function _fmtMw(v: number | null | undefined): string {
  return typeof v === "number" ? `${v.toFixed(1)} MW` : "—";
}

function _fmtCount(v: number | null | undefined): string {
  return typeof v === "number" && v > 0 ? String(v) : "—";
}

function ProjectFactsHeader({ rd }: { rd: ReportDataWithParks }) {
  const facts = rd.projectFacts;
  if (!facts) return null;
  const notes = facts.notes ?? {};
  const items: { label: string; value: string; note?: string }[] = [
    {
      label: "Turbinen",
      value: _fmtCount(facts.turbineCount ?? rd.turbineCount),
      note: notes.turbineCount,
    },
    {
      label: "Gesamtleistung",
      value: _fmtMw(facts.totalCapacityMw),
      note: notes.totalCapacityMw,
    },
    {
      label: "Projektgesellschaft",
      value: facts.projectCompany || "—",
      note: notes.projectCompany,
    },
    {
      label: "Bundesland",
      value: facts.bundesland
        ? facts.bundesland.charAt(0).toUpperCase() + facts.bundesland.slice(1)
        : "—",
    },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-md border border-border/40 bg-muted/20 px-3 py-2"
        >
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            {it.label}
          </p>
          <p className="text-sm font-semibold text-foreground mt-0.5">{it.value}</p>
          {it.note && (
            <p className="text-[11px] text-muted-foreground italic mt-1 leading-snug">
              {it.note}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ParksBreakdown({ rd }: { rd: ReportDataWithParks }) {
  const parks = rd.parks ?? [];
  if (parks.length === 0) return null;
  const multi = rd.multiParkDetected === true || parks.length > 1;
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-muted-foreground">
          Park-Aufteilung{multi ? " (Mehrere Parks im Datenraum)" : ""}
        </h4>
        {multi && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
            Multi-Park
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {parks.map((p) => {
          const isUnattributed = p.name.startsWith("(");
          return (
            <div
              key={p.name}
              className={`rounded-lg border p-3 ${
                p.isPrimary
                  ? "border-primary/40 bg-primary/5"
                  : isUnattributed
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-border/40 bg-muted/20"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground truncate">
                  {p.name}
                </p>
                {p.isPrimary && (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 shrink-0">
                    Gegenstand
                  </span>
                )}
                {isUnattributed && (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 shrink-0">
                    nicht zugeordnet
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">
                    Turbinen
                  </p>
                  <p className="text-sm font-medium">{p.turbineCount}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">
                    Leistung
                  </p>
                  <p className="text-sm font-medium">{_fmtMw(p.totalCapacityMw)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">
                    Typ
                  </p>
                  <p className="text-sm font-medium truncate" title={(p.models ?? []).join(", ")}>
                    {(p.models ?? []).join(", ") || "—"}
                  </p>
                </div>
              </div>
              {p.statusCounts && Object.keys(p.statusCounts).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {Object.entries(p.statusCounts).map(([k, v]) => (
                    <span
                      key={k}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                    >
                      {k}: {v}
                    </span>
                  ))}
                </div>
              )}
              {p.turbineNames && p.turbineNames.length > 0 && (
                <p
                  className="text-[11px] text-muted-foreground mt-2 truncate"
                  title={p.turbineNames.join(", ")}
                >
                  {p.turbineNames.slice(0, 6).join(", ")}
                  {p.turbineNames.length > 6 ? ` (+${p.turbineNames.length - 6})` : ""}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
