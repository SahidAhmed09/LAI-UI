// Global top header — one consistent bar across every dashboard page.
//
// Left: a page glyph + title (+ subtitle). On the chat page the title is the
// active conversation so the user always knows which thread they're in.
// Right: the live controls that used to be scattered (notification bell in the
// chat header, theme toggle in the sidebar) now collected in one place.
//
// Kept deliberately neutral/clean so it can be re-skinned to a specific
// template without touching the pages it sits above.

import { useLocation } from "react-router";
import {
  FolderKanban,
  MessageSquare,
  FileText,
  Settings,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/react-app/components/ThemeToggle";
import { NotificationsMenu } from "@/react-app/components/chat/NotificationsMenu";

const PAGE_META: {
  prefix: string;
  title: string;
  subtitle: string;
  Icon: LucideIcon;
}[] = [
  {
    prefix: "/dashboard/chat",
    title: "Chat",
    subtitle: "Legal due-diligence assistant",
    Icon: MessageSquare,
  },
  {
    prefix: "/dashboard/documents",
    title: "Documents & Reports",
    subtitle: "Documents, generated reports & risk overview",
    Icon: FileText,
  },
  {
    prefix: "/dashboard/projects",
    title: "Projects",
    subtitle: "Matters & data rooms",
    Icon: FolderKanban,
  },
  {
    prefix: "/dashboard/settings",
    title: "Settings",
    subtitle: "Preferences & account",
    Icon: Settings,
  },
  // Catch-all last so the longest specific prefix wins above.
  {
    prefix: "/dashboard",
    title: "Dashboard",
    subtitle: "Your workspace at a glance",
    Icon: LayoutDashboard,
  },
];

export function AppHeader({
  title,
  subtitle,
}: {
  // Per-page overrides — the chat page passes the active conversation title.
  title?: string;
  subtitle?: string;
}) {
  const { pathname } = useLocation();
  const meta =
    PAGE_META.find(
      (m) => pathname === m.prefix || pathname.startsWith(m.prefix + "/"),
    ) ?? PAGE_META[PAGE_META.length - 1];
  const Icon = meta.Icon;

  return (
    <header className="flex-shrink-0 h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between gap-4 px-6 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
          <Icon className="w-[18px] h-[18px] text-primary" />
        </div>
        <div className="min-w-0 leading-tight">
          <h1 className="text-sm font-semibold truncate">
            {title ?? meta.title}
          </h1>
          <p className="text-xs text-muted-foreground truncate">
            {subtitle ?? meta.subtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <NotificationsMenu />
        <ThemeToggle />
      </div>
    </header>
  );
}
