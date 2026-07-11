// Notifications dropdown for the chat header bell.
//
// There is no server-side notification feed yet, so this surfaces local,
// honest app notices (onboarding tips + any runtime events the chat pushes
// in via ``pushNotification``) rather than fabricated "someone commented"
// noise. State is persisted to localStorage so dismissals and the read
// state survive a reload. The unread count drives the red dot on the bell.

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { BellIcon } from "@/react-app/components/icons";
import { Button } from "@/react-app/components/ui/button";
import { Check, X, Sparkles } from "lucide-react";
import { cn } from "@/react-app/lib/utils";

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  ts: number;
  read: boolean;
}

const STORAGE_KEY = "lai.notifications.v1";

// Seeded once per browser so a first-time user sees the bell do something
// useful instead of an empty panel. These are real product tips, not
// placeholder data.
function seedNotifications(): AppNotification[] {
  const now = Date.now();
  return [
    {
      id: "welcome",
      title: "Welcome to LAI",
      body: "Ask questions about wind-energy permits and contracts, grounded in the German legal corpus. Answers cite their sources — click any [C-n] chip to see the passage.",
      ts: now,
      read: false,
    },
    {
      id: "upload-tip",
      title: "Upload a data room",
      body: "Drag one or several PDFs into the chat. Each is ingested in the background — watch the per-document progress and ask once the green checkmark appears.",
      ts: now - 1000,
      read: false,
    },
    {
      id: "feedback-tip",
      title: "Rate the answers",
      body: "Use 👍 / 👎 under any answer. Your verdict is saved per message and helps tune retrieval quality.",
      ts: now - 2000,
      read: false,
    },
  ];
}

function load(): AppNotification[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppNotification[];
  } catch {
    /* ignore corrupt/unavailable storage */
  }
  const seeded = seedNotifications();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  } catch {
    /* ignore */
  }
  return seeded;
}

function persist(items: AppNotification[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function NotificationsMenu() {
  const [items, setItems] = useState<AppNotification[]>(() => load());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Viewport-fixed coordinates for the portalled panel, measured from the
  // bell button each time the menu opens (and on resize/scroll). The panel
  // is rendered into document.body so the chat's ``overflow-hidden`` root
  // can't clip it and it always paints above the thread.
  const [pos, setPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });

  const unread = items.filter((n) => !n.read).length;

  const reposition = useCallback(() => {
    const btn = rootRef.current?.querySelector("button");
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPos({
      top: r.bottom + 8,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  // Close on outside-click and Escape; keep aligned on resize/scroll.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(t) &&
        panelRef.current &&
        !panelRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  const update = useCallback((next: AppNotification[]) => {
    setItems(next);
    persist(next);
  }, []);

  const markAllRead = () =>
    update(items.map((n) => ({ ...n, read: true })));
  const dismiss = (id: string) => update(items.filter((n) => n.id !== id));
  const clearAll = () => update([]);

  // Opening the panel marks everything read (clears the red dot) — standard
  // notification-tray behaviour.
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markAllRead();
  };

  return (
    <div className="relative" ref={rootRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative h-9 w-9"
        onClick={toggleOpen}
        aria-label="Notifications"
        aria-expanded={open}
        title="Notifications"
      >
        <BellIcon className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-1 flex items-center justify-center text-[0.6rem] font-bold leading-none bg-primary text-primary-foreground rounded-full">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open &&
        createPortal(
          <>
            {/* Soft backdrop so the panel reads as a distinct layer ABOVE
                the chat instead of appearing to bleed into the thread (the
                "overlaps the chat" complaint). Clicking it closes the menu. */}
            <div
              className="fixed inset-0 z-[90] bg-black/20 animate-in fade-in duration-150"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div
              ref={panelRef}
              style={{ top: pos.top, right: pos.right }}
              className="fixed w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/5 z-[100] animate-in fade-in slide-in-from-top-2 duration-150 overflow-hidden"
            >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <span className="text-sm font-semibold">Notifications</span>
            {items.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
                <Sparkles className="w-6 h-6 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  You're all caught up
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className={cn(
                      "group relative px-4 py-3 hover:bg-muted/40 transition-colors",
                      !n.read && "bg-primary/[0.04]",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {!n.read && (
                            <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                          )}
                          <p className="text-sm font-medium truncate">
                            {n.title}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {n.body}
                        </p>
                        <p className="text-[0.65rem] text-muted-foreground/70 mt-1">
                          {relativeTime(n.ts)}
                        </p>
                      </div>
                      <button
                        onClick={() => dismiss(n.id)}
                        className="flex-shrink-0 p-1 rounded-md text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-all"
                        aria-label="Dismiss notification"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

            {items.length > 0 && unread === 0 && (
              <div className="px-4 py-2 border-t border-border flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                All read
              </div>
            )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
