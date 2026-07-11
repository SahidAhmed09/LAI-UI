import { useEffect, useLayoutEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/react-app/components/ui/button";
import { useOnboarding } from "@/react-app/contexts/OnboardingContext";

// Padding around the spotlighted element, in px.
const SPOT_PAD = 8;
// Approximate tooltip card footprint, used for viewport clamping.
const CARD_W = 340;
const CARD_H = 230;
const GAP = 16;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Guided product tour. Renders a dimming backdrop with a "spotlight" hole
 * over the current step's target element and a tooltip card with
 * Back / Next controls. Navigates between routes as the steps demand and
 * polls for the target to mount before positioning.
 */
export default function OnboardingTour() {
  const { isActive, step, stepIndex, steps, next, back, skip, finish } =
    useOnboarding();
  const navigate = useNavigate();
  const location = useLocation();
  const [rect, setRect] = useState<Rect | null>(null);

  const isLast = stepIndex === steps.length - 1;
  const isFirst = stepIndex === 0;

  // Navigate to the step's route if we're not already there.
  useEffect(() => {
    if (!isActive || !step?.route) return;
    if (location.pathname !== step.route) {
      navigate(step.route);
    }
  }, [isActive, step, location.pathname, navigate]);

  // Resolve and track the target element's bounding box. Polls briefly
  // because a route change may not have mounted the element yet.
  useLayoutEffect(() => {
    if (!isActive || !step) {
      setRect(null);
      return;
    }
    // Centered steps (welcome / finish) have no anchor.
    if (!step.selector) {
      setRect(null);
      return;
    }

    let raf = 0;
    let attempts = 0;
    let cancelled = false;

    const measure = () => {
      const el = document.querySelector(step.selector!);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        return true;
      }
      return false;
    };

    const poll = () => {
      if (cancelled) return;
      if (measure()) return;
      attempts += 1;
      if (attempts < 60) raf = requestAnimationFrame(poll);
      else setRect(null); // give up → fall back to centered card
    };
    poll();

    const onReflow = () => measure();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [isActive, step, stepIndex, location.pathname]);

  // Lock background scroll while the tour is open.
  useEffect(() => {
    if (!isActive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isActive]);

  // Keyboard: Esc to skip, arrows to navigate.
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, next, back, skip]);

  if (!isActive || !step) return null;

  const centered = !rect;

  // ── Tooltip card placement ──
  let cardStyle: React.CSSProperties;
  if (centered) {
    cardStyle = {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  } else {
    const placement = step.placement ?? "right";
    let top = rect.top;
    let left = rect.left;
    if (placement === "right") {
      left = rect.left + rect.width + GAP;
      top = rect.top;
    } else if (placement === "left") {
      left = rect.left - CARD_W - GAP;
      top = rect.top;
    } else if (placement === "bottom") {
      top = rect.top + rect.height + GAP;
      left = rect.left;
    } else if (placement === "top") {
      top = rect.top - CARD_H - GAP;
      left = rect.left;
    }
    // Clamp into the viewport.
    left = Math.max(GAP, Math.min(left, window.innerWidth - CARD_W - GAP));
    top = Math.max(GAP, Math.min(top, window.innerHeight - CARD_H - GAP));
    cardStyle = { top, left };
  }

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
      {/* Backdrop — dims everything except the spotlight hole. A huge
          box-shadow spread on the spotlight rect produces the cut-out
          without SVG masking. For centered steps we just dim the screen. */}
      {centered ? (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" />
      ) : (
        <div
          className="absolute rounded-lg ring-2 ring-primary transition-all duration-300 pointer-events-none"
          style={{
            top: rect.top - SPOT_PAD,
            left: rect.left - SPOT_PAD,
            width: rect.width + SPOT_PAD * 2,
            height: rect.height + SPOT_PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />
      )}

      {/* Click-catcher so the app behind the overlay isn't interactive. */}
      <div className="absolute inset-0" onClick={() => {}} />

      {/* Tooltip card */}
      <div
        className="absolute w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-200"
        style={cardStyle}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            Step {stepIndex + 1} of {steps.length}
          </span>
          <button
            onClick={skip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip tour
          </button>
        </div>

        <h3 className="text-base font-semibold mb-1.5">{step.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {step.body}
        </p>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mt-4 mb-4">
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex
                  ? "w-5 bg-primary"
                  : i < stepIndex
                    ? "w-1.5 bg-primary/50"
                    : "w-1.5 bg-muted-foreground/25"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={back}
            disabled={isFirst}
            className={isFirst ? "invisible" : ""}
          >
            Back
          </Button>
          {isLast ? (
            <Button size="sm" onClick={finish}>
              Get started
            </Button>
          ) : (
            <Button size="sm" onClick={next}>
              {isFirst ? "Take the tour" : "Next"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
