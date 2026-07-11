// src/react-app/components/chat/UnverifiedBadge.tsx
//
// Inline amber pill rendered wherever the assistant's answer contains
// ``(unbelegt)`` / ``(unverified)``. The text comes from the backend
// citation validator (lai/common/citation/validator.py): when the model
// emits a citation handle that wasn't in the prompt, the validator
// strips the handle and rewrites the surrounding sentence to end with
// ``(unbelegt)`` — this badge is how the lawyer sees that signal.
//
// UI_GUIDE.md §5.4 specifies the German tooltip verbatim. The tooltip
// is rendered via the native ``title`` attribute so it works in all
// browsers without pulling in a tooltip library — accessibility is via
// ``aria-label``.

import { cn } from "@/react-app/lib/utils";

export interface UnverifiedBadgeProps {
  /** The literal token from the answer — typically ``"(unbelegt)"`` for
   *  German output or ``"(unverified)"`` when the answer is in English. */
  label: string;
  className?: string;
}

const TOOLTIP =
  "Diese Aussage konnte nicht durch die hochgeladenen Dokumente oder " +
  "den Rechtskorpus belegt werden.";

export function UnverifiedBadge({ label, className }: UnverifiedBadgeProps) {
  return (
    <span
      className={cn(
        "inline-block mx-0.5 px-1.5 py-0.5 rounded-md align-baseline",
        "text-[0.72rem] font-semibold",
        "bg-amber-100 text-amber-800",
        "dark:bg-amber-500/15 dark:text-amber-300",
        "cursor-help",
        className,
      )}
      title={TOOLTIP}
      aria-label={`${label} — ${TOOLTIP}`}
      role="note"
    >
      {label}
    </span>
  );
}
