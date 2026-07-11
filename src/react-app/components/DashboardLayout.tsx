import { useState, useEffect, useCallback } from "react";
import {
  listSessions,
  deleteSession as apiDeleteSession,
  renameSession as apiRenameSession,
} from "@/react-app/lib/ragApi";
import { Link, useLocation, Outlet, useNavigate } from "react-router";
import {
  LayoutDashboard,
  FolderKanban,
  MessageSquare,
  FileText,
  SquarePen,
  Settings,
  Compass,
  MoreHorizontal,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { HealthGate } from "@/react-app/components/HealthGate";
import { Logo } from "@/react-app/components/Logo";
import { AppHeader } from "@/react-app/components/AppHeader";
import { OrgLessNotice } from "@/react-app/components/OrgLessNotice";
import { useAuth } from "@/react-app/auth";
import { cn } from "@/react-app/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/react-app/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/react-app/components/ui/avatar";
import {
  PanelCollapseIcon,
  PanelExpandIcon,
} from "@/react-app/components/icons";
import OnboardingTour from "@/react-app/components/OnboardingTour";
import { useOnboarding } from "@/react-app/contexts/OnboardingContext";
import { UploadQueueProvider } from "@/react-app/hooks/UploadQueueProvider";
import { ComposerAttachmentsProvider } from "@/react-app/hooks/ComposerAttachmentsProvider";

// Primary workspace destinations, in the order the product wants them read:
// Dashboard → Projects → Chat → Documents & Reports. (Documents and Risk
// Assessment were merged into one "Documents & Reports" hub.)
const primaryNav: { name: string; href: string; Icon: LucideIcon; tour: string }[] = [
  { name: "Dashboard", href: "/dashboard", Icon: LayoutDashboard, tour: "tour-dashboard" },
  { name: "Projects", href: "/dashboard/projects", Icon: FolderKanban, tour: "tour-projects" },
  { name: "Chat", href: "/dashboard/chat", Icon: MessageSquare, tour: "tour-chat" },
  { name: "Documents & Reports", href: "/dashboard/documents", Icon: FileText, tour: "tour-documents" },
];

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  timestamp: Date;
}

// localStorage key for the active conversation. Persisting this across
// refreshes is what lets the user land back inside their last chat
// instead of an empty "new chat" state. The per-message thread itself
// is rehydrated by DashboardChat from `lai.session.<convId>`.
const ACTIVE_CONV_KEY = "lai.activeConversation";

// ── Small presentational helpers ───────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1.5 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground/70 select-none">
      {children}
    </div>
  );
}

// One row in the rail — renders as a <Link> (navigation) or a <button>
// (actions). Collapsed mode shows the icon only, centered.
function SidebarItem({
  Icon,
  label,
  active = false,
  collapsed,
  to,
  onClick,
  tour,
  accent = false,
}: {
  Icon: LucideIcon;
  label: string;
  active?: boolean;
  collapsed: boolean;
  to?: string;
  onClick?: () => void;
  tour?: string;
  // Tints the icon with the brand colour even when inactive (used for the
  // "New chat" affordance so it reads as the primary action of the rail).
  accent?: boolean;
}) {
  const cls = cn(
    "group flex items-center rounded-lg text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-3 px-3 h-9 w-full",
    active
      ? "bg-sidebar-accent text-foreground font-medium"
      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
  );
  const inner = (
    <>
      <Icon
        className={cn(
          "w-[18px] h-[18px] flex-shrink-0 transition-colors",
          active || accent
            ? "text-primary"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      {!collapsed && <span className="truncate">{label}</span>}
    </>
  );
  if (to) {
    return (
      <Link to={to} title={label} data-tour={tour} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} title={label} data-tour={tour} className={cls}>
      {inner}
    </button>
  );
}

// The single "New Chat" entry — clicking anywhere on it (label or pencil)
// always starts a NEW chat (clears the active conversation and lands on the
// chat page). Previous conversations are still one click away in the Recents
// list below.
function ChatNavRow({
  active,
  collapsed,
  onNewChat,
}: {
  active: boolean;
  collapsed: boolean;
  onNewChat: () => void;
}) {
  if (collapsed) {
    return (
      <SidebarItem
        Icon={MessageSquare}
        label="New Chat"
        active={active}
        collapsed
        onClick={onNewChat}
        tour="tour-chat"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onNewChat}
      title="New Chat"
      data-tour="tour-chat"
      className={cn(
        "group flex items-center gap-3 w-full rounded-lg px-3 h-9 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active
          ? "bg-sidebar-accent text-foreground font-medium"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <MessageSquare
        className={cn(
          "w-[18px] h-[18px] flex-shrink-0 transition-colors",
          active
            ? "text-primary"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      <span className="truncate flex-1 text-left">New Chat</span>
      <SquarePen
        className="w-4 h-4 flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors"
        aria-hidden="true"
      />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { start: startTour } = useOnboarding();
  const [collapsed, setCollapsed] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(() => {
    // Deep-link takes precedence over the localStorage cache: a fresh
    // demo URL like ``?session_id=lamstedt-demo`` should always land in
    // the seeded matter regardless of which chat this browser had open
    // last. ``load_demo_matter.py`` documents this contract in its
    // header — see STATUS.md #6 / UI_GUIDE.md §9 Day 8.
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("session_id");
      if (fromUrl && fromUrl.trim()) return fromUrl.trim();
      return window.localStorage.getItem(ACTIVE_CONV_KEY);
    } catch {
      return null;
    }
  });
  const location = useLocation();

  // After consuming the ``session_id`` query param above, drop it from
  // the URL so a refresh on the dashboard doesn't keep overriding the
  // user's later conversation switches. We replace (not push) the
  // history entry so the back button doesn't return to the deep-link.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (!params.has("session_id")) return;
      params.delete("session_id");
      const qs = params.toString();
      const next = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState(null, "", next);
    } catch {
      /* history API unavailable — leave the URL alone */
    }
    // Run once on mount only.
  }, []);

  // Mirror activeConversationId to localStorage so a refresh restores it.
  useEffect(() => {
    try {
      if (activeConversationId) {
        window.localStorage.setItem(ACTIVE_CONV_KEY, activeConversationId);
      } else {
        window.localStorage.removeItem(ACTIVE_CONV_KEY);
      }
    } catch { /* localStorage unavailable — no-op */ }
  }, [activeConversationId]);

  // ── Sidebar list ──────────────────────────────────────────────────────
  // Pull the persisted session list from the backend on mount, and expose
  // refresh() so child views can trigger a re-fetch after upload/chat.
  const refreshConversations = useCallback(async () => {
    const sessions = await listSessions(50);
    setConversations(
      sessions.map((s) => ({
        // Backend computes a sensible display title via COALESCE chain
        // (user-set title → filename → first user message → "Untitled chat").
        id: s.id,
        title: s.title,
        preview: s.has_analysis
          ? `${s.n_pages} pages · analyzed · ${s.n_messages} msgs`
          : `${s.n_messages} message${s.n_messages === 1 ? "" : "s"}`,
        timestamp: new Date((s.updated_at || s.uploaded_at) * 1000),
      })),
    );
    // If the persisted active id no longer exists on the server (deleted
    // elsewhere, or the DB was wiped), drop it instead of pointing at a
    // ghost session.
    setActiveConversationId((prev) => {
      if (!prev) return prev;
      return sessions.some((s) => s.id === prev) ? prev : null;
    });
  }, []);

  const handleRename = useCallback(
    async (id: string, currentTitle: string) => {
      const next = window.prompt("Rename conversation:", currentTitle);
      if (next === null) return; // user cancelled
      const trimmed = next.trim();
      // Empty string is allowed → backend clears the override and the
      // display title falls back to the COALESCE chain.
      const ok = await apiRenameSession(id, trimmed);
      if (ok) await refreshConversations();
    },
    [refreshConversations],
  );

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") return location.pathname === "/dashboard";
    return (
      location.pathname === href || location.pathname.startsWith(href + "/")
    );
  };

  const isOnChatPage = location.pathname === "/dashboard/chat";
  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId,
  );

  const userInitials =
    user?.email
      ?.split("@")[0]
      .split("")
      .slice(0, 2)
      .map((c) => c.toUpperCase())
      .join("") || "JD";

  // New Chat — clear the active conversation and land on the chat page. The
  // session row is created server-side on the first /upload or /query and
  // pulled into the rail by refreshConversations() then, so we don't litter
  // the list with empty placeholders.
  const handleNewChat = () => {
    setActiveConversationId(null);
    navigate("/dashboard/chat");
  };

  // Open a previous chat — select it and ensure we're on the chat page so the
  // thread actually renders (the rail is visible from every page now).
  const openConversation = (id: string) => {
    setActiveConversationId(id);
    if (!isOnChatPage) navigate("/dashboard/chat");
  };

  const deleteConversation = async (id: string) => {
    // Optimistic remove — the refresh below confirms or restores it.
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) setActiveConversationId(null);
    try {
      localStorage.removeItem("lai.session." + id);
    } catch {
      /* ignore */
    }
    await apiDeleteSession(id);
    await refreshConversations();
  };

  return (
    <HealthGate>
    {/* UploadQueueProvider sits above every dashboard sub-route so the upload
        rows (and their AbortControllers) survive Chat ↔ Documents ↔ Projects
        navigation. Previously the queue lived in DashboardLibrary's local
        state, so coming back to Documents after a quick detour wiped the
        rows even though the XHRs were still running. */}
    <UploadQueueProvider>
    <ComposerAttachmentsProvider>
    <div
      className="h-screen bg-background flex overflow-hidden"
      style={
        {
          "--sidebar-width": `${collapsed ? 64 : 264}px`,
        } as React.CSSProperties
      }
    >
      {/* ── Sidebar ── */}
      <aside
        className={cn(
          "flex-shrink-0 h-full bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 z-40",
          collapsed ? "w-16" : "w-[264px]",
        )}
      >
        {/* ── Logo + Collapse ── */}
        <div
          className={cn(
            "h-16 flex items-center flex-shrink-0",
            collapsed ? "justify-center px-3" : "justify-between px-4",
          )}
        >
          {collapsed ? (
            <Link
              to="/dashboard"
              className="w-8 h-8 flex-shrink-0 overflow-hidden"
              style={{ minWidth: "2rem" }}
              title="LAI — home"
            >
              <Logo size="sm" showText={false} />
            </Link>
          ) : (
            <Link to="/dashboard" title="LAI — home">
              <Logo size="sm" />
            </Link>
          )}
        </div>

        {/* Collapse toggle */}
        <div className="px-3 pb-1 flex-shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "flex items-center rounded-lg text-sm font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground transition-colors",
              collapsed ? "w-10 h-10 justify-center mx-auto" : "w-full gap-3 px-3 h-9",
            )}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelExpandIcon className="w-[18px] h-[18px] flex-shrink-0" />
            ) : (
              <>
                <PanelCollapseIcon className="w-[18px] h-[18px] flex-shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>

        {/* ── Middle: primary nav + new chat + scrollable recents ── */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Primary navigation — Chat is one combined entry (label opens the
              chat, the compose icon starts a new one). */}
          <div className="px-3 pt-1 space-y-0.5">
            {primaryNav.map((item) =>
              item.href === "/dashboard/chat" ? (
                <ChatNavRow
                  key={item.name}
                  active={isActive(item.href)}
                  collapsed={collapsed}
                  onNewChat={handleNewChat}
                />
              ) : (
                <SidebarItem
                  key={item.name}
                  Icon={item.Icon}
                  label={item.name}
                  active={isActive(item.href)}
                  collapsed={collapsed}
                  to={item.href}
                  tour={item.tour}
                />
              ),
            )}
            {/* Admin link — visible to firm-admin AND super-admin. The page
                itself further differentiates super-admin (org list + create)
                from firm-admin (just their own org's members). */}
            {(user?.role === "admin" || user?.role === "super_admin") && (
              <SidebarItem
                Icon={Shield}
                label="Admin"
                active={isActive("/dashboard/admin")}
                collapsed={collapsed}
                to="/dashboard/admin"
                tour="tour-admin"
              />
            )}
          </div>

          {/* Recents — scrollable, titles only (Claude-style) */}
          {!collapsed && (
            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
              <div className="border-t border-sidebar-border/60 mt-2 mb-1" />
              <SectionLabel>Recents</SectionLabel>
              {conversations.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground/70">
                  No conversations yet. Start a new chat to see it here.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {conversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => openConversation(conv.id)}
                      className={cn(
                        "group relative flex items-center gap-2 rounded-lg px-3 h-9 text-sm cursor-pointer transition-colors",
                        activeConversationId === conv.id
                          ? "bg-sidebar-accent text-foreground font-medium"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                      )}
                    >
                      <span className="flex-1 min-w-0 truncate">
                        {conv.title}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity flex-shrink-0 text-muted-foreground hover:text-foreground rounded p-0.5"
                            title="More"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleRename(conv.id, conv.title)}
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => deleteConversation(conv.id)}
                            className="text-destructive"
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Collapsed: no recents list — keep the rail to icons only */}
          {collapsed && <div className="flex-1 min-h-0" />}
        </div>

        {/* ── Bottom: Support + account (pinned) ── */}
        <div className="flex-shrink-0 border-t border-sidebar-border px-3 py-2 space-y-0.5">
          {!collapsed && <SectionLabel>Support</SectionLabel>}
          <SidebarItem
            Icon={Settings}
            label="Settings"
            active={isActive("/dashboard/settings")}
            collapsed={collapsed}
            to="/dashboard/settings"
            tour="tour-settings"
          />
          <SidebarItem
            Icon={Compass}
            label="Guided Tour"
            collapsed={collapsed}
            onClick={startTour}
          />

          {/* Account */}
          <div className="pt-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "flex items-center gap-3 w-full rounded-lg hover:bg-sidebar-accent/60 transition-colors",
                    collapsed ? "justify-center p-1.5" : "p-2",
                  )}
                >
                  <Avatar className="w-8 h-8 border border-sidebar-border">
                    <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  {!collapsed && (
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-medium truncate">
                        {user?.email || "User"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Logged in
                      </p>
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={handleLogout}
                >
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 h-full flex flex-col">
        {/* Global top header — present on every page. On chat it shows the
            active conversation's title. */}
        <AppHeader
          title={
            isOnChatPage ? activeConversation?.title || "New chat" : undefined
          }
          subtitle={isOnChatPage ? "Legal due-diligence assistant" : undefined}
        />
        {/* Persistent notice for users not yet placed in a firm — explains why
            the workspace is empty and what to do (MULTIUSER_PLAN §7). */}
        <OrgLessNotice />
        <div
          className={cn(
            "flex-1 min-h-0",
            isOnChatPage ? "overflow-hidden" : "overflow-auto p-6",
          )}
        >
          <Outlet
            context={{
              activeConversationId,
              setActiveConversationId,
              conversations,
              setConversations,
              refreshConversations,
            }}
          />
        </div>
      </main>

      {/* First-time guided walkthrough (auto-starts once, relaunchable). */}
      <OnboardingTour />
    </div>
    </ComposerAttachmentsProvider>
    </UploadQueueProvider>
    </HealthGate>
  );
}
