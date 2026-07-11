import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Skeleton } from "@/react-app/components/ui/skeleton";
import { ReportProgressBar } from "@/react-app/components/ReportProgress";
import { useAuth } from "@/react-app/auth";
import {
  fetchDocuments,
  listReports,
  fetchReportStatus,
  type ReportSummary,
  type ReportStatusResponse,
} from "@/react-app/lib/ddiqApi";
import { listSessions, type SessionSummary } from "@/react-app/lib/ragApi";
import type { DocumentItem } from "@/react-app/lib/ddiqDemoData";
import {
  FileText,
  FolderOpen,
  MessageSquare,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  Zap,
  Plus,
  Upload,
  FileBarChart,
  Clock,
  Inbox,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize the various timestamp shapes the backends return to epoch ms.
 *  Sessions use unix-seconds numbers; reports/documents use ISO strings. */
function toMillis(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Compact "5m ago" / "3h ago" / "2d ago" relative-time label. */
function timeAgo(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Map a report's finding count to a risk band. The report summary only
 *  carries a total finding count (no severity split), so we bucket by
 *  volume — a defensible heuristic for an at-a-glance dashboard. */
function riskFromFindings(count: number): "low" | "medium" | "high" {
  if (count <= 0) return "low";
  if (count <= 5) return "medium";
  return "high";
}

const riskIndicator = {
  low: {
    color: "text-emerald-600 dark:text-emerald-500",
    bg: "bg-emerald-500/10",
    Icon: CheckCircle2,
    label: "Low Risk",
  },
  medium: {
    color: "text-amber-600 dark:text-amber-500",
    bg: "bg-amber-500/10",
    Icon: AlertTriangle,
    label: "Medium Risk",
  },
  high: {
    color: "text-rose-600 dark:text-rose-500",
    bg: "bg-rose-500/10",
    Icon: XCircle,
    label: "High Risk",
  },
} as const;


type ActivityItem = {
  action: string;
  item: string;
  ms: number;
  Icon: typeof Upload;
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // Live status for reports still generating, keyed by report_id. Polled
  // below so the dashboard's progress bars actually move.
  const [liveReports, setLiveReports] = useState<
    Record<string, ReportStatusResponse>
  >({});

  const loadData = useCallback(async () => {
    // Each backend is independent — one being down shouldn't blank the
    // whole dashboard. allSettled lets every panel render what it can.
    const [docsRes, sessRes, repRes] = await Promise.allSettled([
      fetchDocuments(),
      listSessions(50),
      listReports(50),
    ]);
    if (docsRes.status === "fulfilled") setDocuments(docsRes.value.documents);
    if (sessRes.status === "fulfilled") setSessions(sessRes.value);
    if (repRes.status === "fulfilled") setReports(repRes.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Live progress polling ──
  // Poll any queued/running report's status so its bar advances in real time.
  // When one finishes, refresh the whole dashboard so counts and the done
  // state settle. Self-stops once nothing is in flight.
  useEffect(() => {
    const active = reports.filter(
      (r) => r.status === "running" || r.status === "queued",
    );
    if (active.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const results = await Promise.allSettled(
        active.map((r) => fetchReportStatus(r.report_id)),
      );
      if (cancelled) return;
      let anyFinished = false;
      setLiveReports((prev) => {
        const next = { ...prev };
        results.forEach((res, i) => {
          if (res.status === "fulfilled") {
            next[active[i].report_id] = res.value;
            if (res.value.status === "done" || res.value.status === "failed")
              anyFinished = true;
          }
        });
        return next;
      });
      const stillActive = results.some(
        (res) =>
          res.status === "fulfilled" &&
          (res.value.status === "running" || res.value.status === "queued"),
      );
      if (anyFinished) void loadData();
      if (stillActive && !cancelled) timer = setTimeout(poll, 4000);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reports, loadData]);

  // ── Derived metrics ──
  const analyzedDocs = documents.filter((d) => d.status === "analyzed").length;
  const doneReports = reports.filter((r) => r.status === "done");
  const totalFindings = reports.reduce(
    (sum, r) => sum + (r.finding_count || 0),
    0,
  );

  const stats = [
    {
      title: "Documents",
      value: documents.length,
      sub: `${analyzedDocs} analyzed`,
      icon: FileText,
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-50 dark:bg-blue-950/50",
      to: "/dashboard/documents",
    },
    {
      title: "DDiQ Reports",
      value: reports.length,
      sub: `${doneReports.length} completed`,
      icon: FileBarChart,
      color: "text-violet-600 dark:text-violet-400",
      bgColor: "bg-violet-50 dark:bg-violet-950/50",
      to: "/dashboard/documents?tab=generate",
    },
    {
      title: "AI Conversations",
      value: sessions.length,
      sub: `${sessions.filter((s) => s.has_analysis).length} with analysis`,
      icon: MessageSquare,
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor: "bg-emerald-50 dark:bg-emerald-950/50",
      to: "/dashboard/chat",
    },
    {
      title: "Risk Findings",
      value: totalFindings,
      sub: `across ${doneReports.length} report${doneReports.length === 1 ? "" : "s"}`,
      icon: ShieldAlert,
      color: "text-amber-600 dark:text-amber-400",
      bgColor: "bg-amber-50 dark:bg-amber-950/50",
      to: "/dashboard/documents?tab=risk",
    },
  ];

  // ── Recent reports → "Active Reports" panel ──
  const recentReports = useMemo(
    () =>
      [...reports]
        .sort(
          (a, b) =>
            toMillis(b.finished_at || b.created_at) -
            toMillis(a.finished_at || a.created_at),
        )
        .slice(0, 4),
    [reports],
  );

  // ── Merged activity feed (reports + chats + uploads) ──
  const activity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];
    for (const r of reports) {
      items.push({
        action: r.status === "done" ? "Report generated" : "Report started",
        item: r.project_name || "Untitled report",
        ms: toMillis(r.finished_at || r.started_at || r.created_at),
        Icon: FileBarChart,
      });
    }
    for (const s of sessions) {
      items.push({
        action: s.has_analysis ? "Document analyzed" : "Conversation",
        item: s.title,
        ms: toMillis(s.updated_at || s.uploaded_at),
        Icon: s.has_analysis ? Zap : MessageSquare,
      });
    }
    for (const d of documents) {
      items.push({
        action: "Document uploaded",
        item: d.name,
        ms: toMillis(d.uploadDate),
        Icon: Upload,
      });
    }
    return items
      .filter((i) => i.ms > 0)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 6);
  }, [reports, sessions, documents]);

  const isEmpty =
    !loading &&
    documents.length === 0 &&
    sessions.length === 0 &&
    reports.length === 0;

  const greetingName =
    user?.fullName?.split(" ")[0] || user?.email?.split("@")[0] || "back";

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back, {greetingName}
          </h1>
          <p className="text-muted-foreground">
            Here's a live overview of your legal due-diligence workspace.
          </p>
        </div>
        <Link to="/dashboard/chat">
          <Button className="shadow-sm" data-tour="new-chat">
            <Plus className="w-4 h-4 mr-2" />
            New Chat
          </Button>
        </Link>
      </div>

      {/* Stats Grid */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        data-tour="dashboard-stats"
      >
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="border-border/50">
                <CardContent className="p-5 space-y-4">
                  <Skeleton className="w-10 h-10 rounded-lg" />
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))
          : stats.map((stat) => (
              <Link key={stat.title} to={stat.to} className="group">
                <Card className="bg-card/50 backdrop-blur border-border/50 transition-all group-hover:border-primary/40 group-hover:shadow-md">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div className={`p-2.5 rounded-lg ${stat.bgColor}`}>
                        <stat.icon className={`w-5 h-5 ${stat.color}`} />
                      </div>
                      <ArrowUpRight className="w-4 h-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                    </div>
                    <div className="mt-4">
                      <p className="text-2xl font-bold tabular-nums">
                        {stat.value.toLocaleString()}
                      </p>
                      <p className="text-sm font-medium">{stat.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {stat.sub}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
      </div>

      {/* Empty-state banner for a brand-new workspace */}
      {isEmpty && (
        <Card className="border-dashed border-border/70 bg-muted/20">
          <CardContent className="p-10 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Inbox className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">Your workspace is empty</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Upload your first document or start a chat with the legal AI to
              see your reports, conversations, and risk findings appear here.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Link to="/dashboard/documents">
                <Button variant="outline">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Documents
                </Button>
              </Link>
              <Link to="/dashboard/chat">
                <Button>
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Start a Chat
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {!isEmpty && (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Active Reports */}
          <div className="lg:col-span-2">
            <Card className="bg-card/50 backdrop-blur border-border/50 h-full">
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle className="text-lg font-semibold">
                  Recent Reports
                </CardTitle>
                <Link to="/dashboard/documents?tab=generate">
                  <Button variant="ghost" size="sm" className="text-primary">
                    View all
                    <ArrowUpRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full rounded-md" />
                  ))
                ) : recentReports.length === 0 ? (
                  <div className="text-center py-10 text-sm text-muted-foreground">
                    No reports yet.{" "}
                    <Link
                      to="/dashboard/documents?tab=generate"
                      className="text-primary font-medium hover:underline"
                    >
                      Generate your first DDiQ report
                    </Link>
                    .
                  </div>
                ) : (
                  recentReports.map((report) => {
                    const risk =
                      riskIndicator[riskFromFindings(report.finding_count)];
                    // Prefer live status while a report is generating.
                    const ls = liveReports[report.report_id];
                    const status = ls?.status ?? report.status;
                    const value = ls
                      ? ls.percent * 100
                      : status === "done" || status === "failed"
                        ? 100
                        : report.progress_percent;
                    return (
                      <div
                        key={report.report_id}
                        className="p-4 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-3 gap-3">
                          <div className="min-w-0">
                            <h4 className="font-medium truncate">
                              {report.project_name || "Untitled report"}
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              {report.doc_count} document
                              {report.doc_count === 1 ? "" : "s"} ·{" "}
                              {report.finding_count} finding
                              {report.finding_count === 1 ? "" : "s"}
                            </p>
                          </div>
                          <div
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${risk.bg} ${risk.color}`}
                          >
                            <risk.Icon className="w-3 h-3" />
                            {risk.label}
                          </div>
                        </div>
                        <ReportProgressBar
                          status={status}
                          step={ls?.step}
                          value={value}
                          startedAt={ls?.started_at ?? report.started_at}
                          compact
                        />
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="w-8 h-8 rounded-lg" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-28" />
                        <Skeleton className="h-3 w-36" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activity.length === 0 ? (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  <Clock className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  No activity yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {activity.map((a, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-muted/50 flex-shrink-0">
                        <a.Icon className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{a.action}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {a.item}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {timeAgo(a.ms)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quick Actions */}
      <Card className="bg-slate-900 border-slate-800 text-white shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-md bg-slate-800 border border-slate-700">
                <Zap className="w-6 h-6 text-slate-300" />
              </div>
              <div>
                <h3 className="font-semibold">Quick Due Diligence</h3>
                <p className="text-sm text-slate-400">
                  Upload documents and get precision AI analysis in minutes
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/dashboard/documents">
                <Button
                  variant="outline"
                  className="border-slate-700 hover:bg-slate-800 bg-slate-900 text-slate-300"
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Upload Documents
                </Button>
              </Link>
              <Link to="/dashboard/chat">
                <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm border-0">
                  Start AI Chat
                </Button>

              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
