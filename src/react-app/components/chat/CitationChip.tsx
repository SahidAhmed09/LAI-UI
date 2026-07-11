// src/react-app/components/chat/CitationChip.tsx
//
// Inline citation rendered in place of every [C-n] / [M-n] handle the LLM
// emitted (fabricated ones already stripped server-side). Clicking opens
// the right-side CitationPanel on the matching source.
//
// Design: a raw "M-1"/"C-1" tag is meaningless to a lawyer. We instead
// render a small, footnote-style pill with an ICON that says what the
// source IS — a document (📄, the user's uploaded file) vs. the legal
// corpus (⚖, statutes / rulings) — plus its number, and a plain-language
// tooltip. Colour still distinguishes the two families.
//
//   [M-n] matter → amber  · file icon  · "Dokument n"
//   [C-n] corpus → indigo · scale icon · "Recht n"

import type { MouseEvent } from "react";
import { FileText, Scale } from "lucide-react";

import { cn } from "@/react-app/lib/utils";

export interface CitationChipProps {
  /** The handle without brackets, e.g. ``"C-1"`` or ``"M-1"``. */
  handle: string;
  /** Drives chip colour/icon; matches the backend ``source_kind`` field. */
  sourceKind: "corpus" | "matter";
  /** Fires with the handle when the chip is clicked. */
  onClick: (handle: string) => void;
  /** When true, draws a ring to mark this as the chip open in the panel. */
  active?: boolean;
}

export function CitationChip({
  handle,
  sourceKind,
  onClick,
  active = false,
}: CitationChipProps) {
  const isCorpus = sourceKind === "corpus";
  // Trailing number of the handle ("M-3" → "3"); fall back to the raw
  // handle if it's not in the expected shape.
  const num = handle.split("-")[1] ?? handle;

  const Icon = isCorpus ? Scale : FileText;
  const label = isCorpus ? "Recht" : "Dok";
  const tooltip = isCorpus
    ? `Rechtsquelle ${num} aus dem Gesetzeskorpus — klicken zum Öffnen`
    : `Hochgeladenes Dokument ${num} — klicken zum Öffnen`;

  const palette = isCorpus
    ? "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30 dark:hover:bg-indigo-500/20"
    : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 dark:hover:bg-amber-500/20";

  const ring = active
    ? isCorpus
      ? "ring-2 ring-indigo-400/70 dark:ring-indigo-500/70"
      : "ring-2 ring-amber-400/70 dark:ring-amber-500/70"
    : "";

  return (
    <button
      type="button"
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        onClick(handle);
      }}
      className={cn(
        // Footnote-style: small, raised slightly off the baseline, with a
        // thin border so it reads as a distinct clickable reference rather
        // than body text. Sans (not mono) so it sits cleanly in prose.
        "inline-flex items-center gap-1 mx-0.5 px-1.5 py-[1px]",
        "rounded-full border text-[0.7rem] font-medium leading-none",
        "align-[0.05em] cursor-pointer select-none transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        palette,
        ring,
      )}
      aria-label={tooltip}
      title={tooltip}
    >
      <Icon className="w-3 h-3 flex-shrink-0" aria-hidden />
      <span className="tabular-nums">
        {label} {num}
      </span>
    </button>
  );
}
