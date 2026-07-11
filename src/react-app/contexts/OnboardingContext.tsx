import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "@/react-app/auth";

// ─── Tour step model ──────────────────────────────────────────────────────────
//
// The walkthrough spans the whole authenticated app. Each step optionally
// anchors to a DOM element (by `selector`) and a `route`; the tour
// navigates to that route, waits for the element to mount, then spotlights
// it. Steps without a selector render as a centered welcome / finish card.

export type TourPlacement = "right" | "left" | "top" | "bottom" | "center";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  selector?: string;
  route?: string;
  placement?: TourPlacement;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to LAI 👋",
    body: "Your AI workspace for German wind-energy legal due diligence. This 60-second tour shows you around. You can skip anytime and restart later from the sidebar.",
    placement: "center",
  },
  {
    id: "dashboard",
    title: "Dashboard",
    body: "Your live command center — documents, reports, conversations and risk findings at a glance. Every metric links straight to the detail.",
    selector: '[data-tour="tour-dashboard"]',
    route: "/dashboard",
    placement: "right",
  },
  {
    id: "chat",
    title: "AI Chat",
    body: "Ask the legal AI about permits, contracts or regulations and get answers grounded in cited sources. Upload a contract here for clause-by-clause review.",
    selector: '[data-tour="tour-chat"]',
    route: "/dashboard/chat",
    placement: "right",
  },
  {
    id: "documents",
    title: "Documents & Reports",
    body: "Your hub for everything document-related: upload PDFs (drag & drop or browse), see the reports generated from each document in a tree, generate new DDiQ reports, and review project-specific risks grouped by domain — all in one place.",
    selector: '[data-tour="tour-documents"]',
    route: "/dashboard/documents",
    placement: "right",
  },
  {
    id: "projects",
    title: "Projects",
    body: "Group related matters, files and conversations into dedicated project workspaces so each due-diligence engagement stays organized.",
    selector: '[data-tour="tour-projects"]',
    route: "/dashboard/projects",
    placement: "right",
  },
  {
    id: "settings",
    title: "Settings",
    body: "Manage your account, answer language and preferences. You can relaunch this tour anytime from the “Guided Tour” button in the sidebar.",
    selector: '[data-tour="tour-settings"]',
    route: "/dashboard/settings",
    placement: "right",
  },
  {
    id: "finish",
    title: "You're all set 🎉",
    body: "That's the grand tour. Start by uploading a document or asking the AI a question — your dashboard fills in as you work.",
    placement: "center",
  },
];

// Bump the suffix if the tour changes materially and you want returning
// users to see it again. The full key is scoped per-user id so a brand-new
// login on any browser still triggers the tour on first visit, while existing
// users on a shared device don't keep retriggering each other's flags.
const STORAGE_KEY_PREFIX = "lai.onboarding.v1.done";

function storageKeyFor(userId: string | null | undefined): string {
  return userId ? `${STORAGE_KEY_PREFIX}.${userId}` : `${STORAGE_KEY_PREFIX}.anon`;
}

interface OnboardingContextValue {
  isActive: boolean;
  stepIndex: number;
  steps: TourStep[];
  step: TourStep | null;
  start: () => void;
  next: () => void;
  back: () => void;
  finish: () => void;
  skip: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function hasCompleted(userId: string | null | undefined): boolean {
  try {
    return window.localStorage.getItem(storageKeyFor(userId)) === "1";
  } catch {
    return false;
  }
}

function markCompleted(userId: string | null | undefined): void {
  try {
    window.localStorage.setItem(storageKeyFor(userId), "1");
  } catch {
    /* localStorage unavailable — no-op */
  }
}

export function OnboardingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [isActive, setIsActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Auto-start once per user. Keyed by user.id so a brand-new login on a
  // browser where another user already completed the tour still gets it,
  // and the same user doesn't see it again after finishing. The short
  // delay lets the dashboard layout paint (sidebar links must exist
  // before we spotlight them) and avoids a jarring overlay flash.
  useEffect(() => {
    if (!userId) return;
    if (hasCompleted(userId)) return;
    const t = window.setTimeout(() => {
      setStepIndex(0);
      setIsActive(true);
    }, 700);
    return () => window.clearTimeout(t);
  }, [userId]);

  const start = useCallback(() => {
    setStepIndex(0);
    setIsActive(true);
  }, []);

  const finish = useCallback(() => {
    setIsActive(false);
    markCompleted(userId);
  }, [userId]);

  const skip = finish;

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= TOUR_STEPS.length - 1) {
        setIsActive(false);
        markCompleted(userId);
        return i;
      }
      return i + 1;
    });
  }, [userId]);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      isActive,
      stepIndex,
      steps: TOUR_STEPS,
      step: isActive ? TOUR_STEPS[stepIndex] ?? null : null,
      start,
      next,
      back,
      finish,
      skip,
    }),
    [isActive, stepIndex, start, next, back, finish, skip],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return ctx;
}
