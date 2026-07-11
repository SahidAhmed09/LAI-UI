// ═══════════════════════════════════════════════════════════════════════════════
// DDiQ Report Types & UI Config
// (Demo report / parcels / documents removed — all data now comes from the
// lai-backend microservice via ddiqApi.ts. Filename kept for import stability.)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Core Types ─────────────────────────────────────────────────────────────

export type Ampel = "green" | "yellow" | "red";

export interface AusgabeblattRow { label: string; value: string; ampel?: Ampel; note?: string; }
export interface AusgabeblattSection { id: string; title: string; rows: AusgabeblattRow[]; }

export interface WEAStatus {
  name: string; ampel: Ampel; owner: string; parcel: string;
  contract: string; lat: number; lng: number; address: string;
  // Technical attrs (P1 #7) — populated by the LLM extraction; null when
  // the docs don't mention. Hub-height drives the 10H clearance for Bayern/Hessen.
  hub_height_m?: number | null;
  rotor_diameter_m?: number | null;
  rated_power_kw?: number | null;
  manufacturer?: string | null;
  model?: string | null;
  status_code?: "errichtet" | "genehmigt" | "geplant" | "abgenommen" | null;
  permit_ref?: string | null;
  warranty_end?: string | null;
  clearance_radius_m?: number | null;
}

// ─── P0/P1 lawyer-grade additions ──────────────────────────────────────────
// Every Finding/TimelineEntry/check carries Evidence so a lawyer can click
// through to source PDF + page + clause to verify the LLM's claim.
export interface Evidence {
  doc_id?: string | null;
  doc_filename?: string | null;
  page?: number | null;
  excerpt: string;
  clause?: string | null;
}

export interface Quantification {
  mw_affected?: number | null;
  eur_impact_estimate?: number | null;
  days_until_deadline?: number | null;
  rationale?: string | null;
}

export type FindingKind = "section" | "cross_document" | "deadline" | "grundbuch" | "rueckbau" | "regulatory";

export interface Finding {
  domain: string;
  severity: Ampel;
  text: string;
  evidence?: Evidence[];
  quantification?: Quantification | null;
  legal_basis?: string | null;
  recommended_action?: string | null;
  kind?: FindingKind;
}

export interface TimelineEntry {
  kind: string;     // permit_expiry | lease_term_end | renewal_deadline | warranty_end | bond_validity | construction_milestone | objection_window | other
  date: string;     // ISO YYYY-MM-DD or free text
  description: string;
  legal_basis?: string | null;
  evidence?: Evidence[];
  days_from_now?: number | null;
  urgency?: "expired" | "urgent" | "soon" | "future" | null;
}

export interface GrundbuchCheck {
  parcel_id: string;
  registered_owner?: string | null;
  lessor_name?: string | null;
  owner_match?: boolean | null;
  match_confidence: number;
  encumbrances: string[];
  evidence?: Evidence[];
  note?: string | null;
}

export interface RueckbauBond {
  amount_eur?: number | null;
  provider?: string | null;
  beneficiary?: string | null;
  valid_until?: string | null;
  instrument_type?: string | null;
  sufficient?: boolean | null;
  evidence?: Evidence[];
  note?: string | null;
}

export interface InfraPoint {
  name: string; type: "substation" | "cable_start" | "cable_end" | "access_road";
  lat: number; lng: number;
}

// ─── Cadastral Parcel Type ──────────────────────────────────────────────────

export type ParcelStatus = "secured" | "negotiation" | "open" | "buffer" | "easement";

export interface CadastralParcel {
  id: string;
  parcelNumber: string;           // Flurstück (e.g. "12/4")
  gemarkung: string;              // Cadastral district name
  flur: number;                   // Section number
  polygon: [number, number][];    // [[lat, lng], ...] boundary ring
  status: ParcelStatus;
  owner: string;
  area: number;                   // hectares
  contractRef: string | null;
  linkedWEA: string | null;       // WEA name or null
  notes?: string;
}

// ─── Report Data ────────────────────────────────────────────────────────────

export interface DDiQReportData {
  projectName: string; preparedBy: string; preparedFor: string; date: string;
  projectCenter: { lat: number; lng: number };
  sections: AusgabeblattSection[];
  weaStatuses: WEAStatus[];
  infrastructure: InfraPoint[];
  parcels: CadastralParcel[];
  findings: Finding[];
  analyzedDocuments: string[];
  // P0/P1 additions
  timeline?: TimelineEntry[];
  crossDocFindings?: Finding[];
  grundbuchChecks?: GrundbuchCheck[];
  rueckbauBond?: RueckbauBond | null;
  documentMap?: Array<{ id: string; filename: string }>;
  // Existing optional fields kept loose to match backend shape
  projectArea?: unknown;
  clearanceZones?: unknown[];
  validation?: unknown;
  geojson?: unknown;
}

export interface ReportPreset { id: string; name: string; description: string; sections: string[]; estimatedPages: string; }
export type ExportFormat = "pdf" | "docx" | "html" | "xlsx" | "csv" | "txt";
export interface FormatOption { id: ExportFormat; label: string; description: string; colorCls: string; }
export interface SectionMeta { id: string; label: string; desc: string; }
export interface DocumentItem {
  id: string; name: string; size: number; uploadDate: string;
  type: string; status: "analyzed" | "pending" | "archived"; category: string;
}


// ─── Presets ────────────────────────────────────────────────────────────────

export const PRESETS: ReportPreset[] = [
  { id: "full", name: "Full DDiQ Report", description: "All tables, status map, cadastral map, and action items", sections: ["overview","land","permits","economics","statusmap","cadastralmap","locationmap","findings"], estimatedPages: "16–22" },
  { id: "executive", name: "Executive Summary", description: "Overview, risk summary, location map", sections: ["overview","statusmap","locationmap","findings"], estimatedPages: "5–7" },
  { id: "land", name: "Land Security Audit", description: "Contracts, cadastral parcels, traffic-light map", sections: ["overview","land","statusmap","cadastralmap","locationmap","findings"], estimatedPages: "12–16" },
  { id: "permit", name: "Permit & Compliance", description: "BImSchG, environment, authority consultations", sections: ["overview","permits","findings"], estimatedPages: "6–8" },
  { id: "economics", name: "Economic Review", description: "EEG/PPA, financing, operations, insurance", sections: ["overview","economics","findings"], estimatedPages: "6–8" },
];

// ─── Formats ────────────────────────────────────────────────────────────────

// PDF is produced via browser print-to-PDF (window.print) on the generated
// HTML, which is why we don't ship a separate XLSX/DOCX exporter — the
// previous DOCX path was HTML-with-a-.doc-extension and the XLSX path was
// CSV-with-an-Excel-label, both lying about the format. If the user wants
// Word / Excel they can open the HTML / CSV outputs directly in those tools.
export const FORMAT_OPTIONS: FormatOption[] = [
  { id: "pdf", label: "PDF", description: "Print-ready (uses browser Save as PDF)", colorCls: "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30" },
  { id: "docx", label: "Word (.docx)", description: "Editable letterhead document", colorCls: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/30" },
  { id: "html", label: "HTML", description: "Interactive, shareable", colorCls: "text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/30" },
  { id: "csv", label: "CSV", description: "Plain data, opens in Excel", colorCls: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30" },
  { id: "txt", label: "TXT", description: "Plain text, lightweight", colorCls: "text-slate-600 dark:text-slate-400 bg-slate-500/10 border-slate-500/30" },
];

// ─── Section Metadata ───────────────────────────────────────────────────────

export const SECTION_META: SectionMeta[] = [
  { id: "overview", label: "Project Overview", desc: "Name, location, WEA specs, companies" },
  { id: "land", label: "Land Security & Ownership", desc: "Contracts, land registry, error rate" },
  { id: "permits", label: "Permits & Conditions", desc: "BImSchG, EIA, species protection" },
  { id: "economics", label: "Economics & Operations", desc: "EEG, PPA, financing, maintenance" },
  { id: "statusmap", label: "Status Map (Traffic Light)", desc: "Green / Yellow / Red per WEA" },
  { id: "cadastralmap", label: "Cadastral Parcel Map", desc: "Color-coded parcel boundaries with contract status" },
  { id: "locationmap", label: "Location Map", desc: "Interactive map with WEA positions & infrastructure" },
  { id: "findings", label: "Action Items & Recommendations", desc: "Prioritized issues and risks" },
];

