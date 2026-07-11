// src/react-app/components/chat/CitedMarkdown.tsx
//
// Drop-in replacement for MarkdownRenderer that ALSO recognises citation
// handles (``[C-n]`` / ``[M-n]``) and "(unbelegt)" / "(unverified)" markers
// inside paragraph text and renders them as inline chips / pills.
//
// Why a separate file (rather than extending MarkdownRenderer):
//   - MarkdownRenderer is used in places (e.g. the contract-analyze flow)
//     that have no chunk-lookup context. CitedMarkdown requires `chunks`
//     to know each handle's source_kind. Keeping them separate avoids a
//     "chunks is optional but really matters" footgun.
//   - The text-node post-processor is non-trivial; isolating it here keeps
//     MarkdownRenderer's signature unchanged.

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CitationChip } from "@/react-app/components/chat/CitationChip";
import { UnverifiedBadge } from "@/react-app/components/chat/UnverifiedBadge";
import type { Chunk } from "@/react-app/lib/ragApi";

export interface CitedMarkdownProps {
  /** Raw markdown text (the assistant's answer). */
  content: string;
  /** Chunks returned alongside the answer. Drives chip lookups. */
  chunks?: Chunk[];
  /** The handle currently focused in the side panel (renders ring). */
  activeHandle?: string | null;
  /** Fires when a chip is clicked. Omit to render chips as plain text. */
  onCiteClick?: (handle: string) => void;
}

// Mirrors the Python pattern in lai.common.citation.validator.CITATION_PATTERN.
// Matches either a citation handle (capture groups 1,2) or one of the
// "no underlying source" markers (whole match, no capture groups).
const HANDLE_OR_UNVERIFIED =
  /\[(C|M)-(\d+)\]|\(unbelegt\)|\(unverified\)/g;

// Clean up bold-emphasis artifacts the model emits around citation handles.
// The validator and chip-rendering can leave unbalanced `**` markers behind
// (e.g. the model writes ``**Note on Doc [M-4]:**`` with extra `**` floating
// after the chip, producing visible ":**" in the rendered text). We don't
// try to *parse* markdown here — that's react-markdown's job — but we do
// strip the patterns we know the model gets wrong and that leak through.
//
// ``balanceBoldsInBlock`` is the heaviest pass: walks each markdown block
// (paragraph / list item) and strips a `**` whenever the count is odd. The
// closer-shape heuristic (preceded by a word char, followed by whitespace
// or punctuation) is preferred so a dropped OPENER — the common LLM glitch
// — gets cleaned up surgically instead of damaging the rest of the text.
function balanceBoldsInBlock(block: string): string {
  let cur = block;
  // Bounded loop: at most one strip per iteration, terminates when count
  // is even (every pair valid, or all orphans removed). Guarded against a
  // fixed-point loop just in case.
  for (let safety = 0; safety < 16; safety++) {
    const stars: number[] = [];
    let idx = 0;
    while ((idx = cur.indexOf("**", idx)) !== -1) {
      stars.push(idx);
      idx += 2;
    }
    if (stars.length % 2 === 0) return cur;
    // Find the most-orphan-looking `**`: closer-shape preferred (word
    // before, space/punctuation after — the screenshot case).
    let toStrip = -1;
    for (const i of stars) {
      const before = i > 0 ? cur[i - 1] : " ";
      const afterPos = i + 2;
      const after = afterPos < cur.length ? cur[afterPos] : " ";
      const looksLikeCloser =
        /\S/.test(before) && /[\s.,;:!?)\]}'"]/.test(after);
      if (looksLikeCloser) {
        toStrip = i;
        break;
      }
    }
    if (toStrip === -1) toStrip = stars[stars.length - 1];
    cur = cur.slice(0, toStrip) + cur.slice(toStrip + 2);
  }
  return cur;
}

function scrubArtifacts(text: string): string {
  const stripped = text
    // Empty-bold artifacts left when the validator strips inner content:
    // "****" or "** **".
    .replace(/\*\*\s*\*\*/g, " ")
    // Bold wrapped around a single citation handle: "**[M-2]**" → "[M-2]".
    // The chip already renders with emphasis, the surrounding bold becomes
    // a visible "**" if it goes orphaned by the validator pass.
    .replace(/\*\*\s*(\[[CM]-\d+\])\s*\*\*/g, "$1")
    // Tighten malformed-after-validator bold: ``**Heading [M-x]**`` becomes
    // ``**Heading **`` after the validator strips a fabricated handle, and
    // CommonMark refuses to render bold when the closing ``**`` touches
    // whitespace. Without this tightening we either show literal ``**``
    // markers or — once the orphan-balancer kicks in — silently lose the
    // bold styling. Re-pull the spaces inside so the bold survives.
    .replace(/\*\*[ \t]+([^*\n]+?)[ \t]+\*\*/g, "**$1**")
    // Same idea for the half-malformed cases (one side has whitespace).
    .replace(/\*\*[ \t]+([^*\n]+?)\*\*/g, "**$1**")
    .replace(/\*\*([^*\n]+?)[ \t]+\*\*/g, "**$1**")
    // A bold marker stuck right after a citation handle (the screenshot's
    // ":**" / "Dok 4 :**" leak): handle followed by optional punctuation
    // then a stray "**".
    .replace(/(\[[CM]-\d+\])([:,;.\s]*)\*\*(?=\s|$|[^*])/g, "$1$2")
    // Same shape but BEFORE a handle: "**[M-2]".
    .replace(/\*\*(\s*)(\[[CM]-\d+\])/g, "$1$2")
    // A lone "**" with whitespace on both sides — no partner left.
    .replace(/(^|\s)\*\*(\s|$)/g, "$1$2");

  // Numbered-list reflow: the model sometimes emits
  //   "1.\nHeading text" (number on its own line, content on the next)
  // CommonMark sees that as an empty list item followed by a separate
  // paragraph — each such block starts a FRESH list at 1, which is why
  // the user sees ``1, 1, 2, 3`` instead of ``1, 2, 3, 4``. Re-join the
  // number with the content so we get a proper continuous list. We only
  // match when the next line has NO leading indentation, so a properly
  // indented continuation (valid markdown) is left alone.
  const reflowed = stripped.replace(
    /^(\d+)\.[ \t]*\n(?![ \t])(\S)/gm,
    "$1. $2",
  );

  // Final pass: paragraph-level orphan `**` detection. The model often
  // drops the OPENING `**` of a heading-style bold (e.g. emits
  // "Verfassungsrechtliche Prüfung**" with no matching opener), and
  // CommonMark renders the orphan as literal asterisks. We split on
  // blank-line block boundaries so a stray `**` in one paragraph never
  // gets paired with a valid `**` in another. Lists' numbered items are
  // separated by blank lines in well-formed markdown, which is what the
  // RAG_SYSTEM prompt asks for.
  const balanced = reflowed
    .split(/(\n[ \t]*\n)/) // keep separators so .join preserves spacing
    .map((part) => (/\S/.test(part) ? balanceBoldsInBlock(part) : part))
    .join("");

  // Collapse the double-spaces our replacements may have introduced.
  return balanced.replace(/[ \t]{2,}/g, " ");
}

interface LookupEntry {
  sourceKind: "corpus" | "matter";
}

function buildChunkLookup(chunks: Chunk[] | undefined): Map<string, LookupEntry> {
  const m = new Map<string, LookupEntry>();
  for (const c of chunks ?? []) {
    if (c.cite_id) m.set(c.cite_id, { sourceKind: c.source_kind });
  }
  return m;
}

function linkifyText(
  text: string,
  lookup: Map<string, LookupEntry>,
  activeHandle: string | null | undefined,
  onCiteClick: ((handle: string) => void) | undefined,
  keyPrefix = "",
): ReactNode[] {
  // Fast path: no special tokens at all → return as-is so we don't churn
  // React keys for plain text.
  if (!HANDLE_OR_UNVERIFIED.test(text)) {
    HANDLE_OR_UNVERIFIED.lastIndex = 0;
    return [text];
  }
  HANDLE_OR_UNVERIFIED.lastIndex = 0;

  const out: ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = HANDLE_OR_UNVERIFIED.exec(text)) !== null) {
    if (match.index > lastIdx) out.push(text.slice(lastIdx, match.index));

    const [whole, citeType, citeNum] = match;
    if (citeType && citeNum) {
      const handle = `${citeType}-${citeNum}`;
      const entry = lookup.get(handle);
      // If we have lookup data, the chip is clickable. If we don't (e.g.
      // the model emitted a handle that survived the validator but isn't
      // in this turn's chunks — shouldn't happen, but be defensive), we
      // still render a chip but no-op the click.
      const sourceKind =
        entry?.sourceKind ?? (citeType === "M" ? "matter" : "corpus");
      out.push(
        <CitationChip
          key={`${keyPrefix}${handle}-${match.index}`}
          handle={handle}
          sourceKind={sourceKind}
          active={activeHandle === handle}
          onClick={onCiteClick ?? (() => {})}
        />,
      );
    } else {
      // "(unbelegt)" or "(unverified)"
      out.push(
        <UnverifiedBadge key={`${keyPrefix}unverified-${match.index}`} label={whole} />,
      );
    }
    lastIdx = HANDLE_OR_UNVERIFIED.lastIndex;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}

function processChildren(
  children: ReactNode,
  lookup: Map<string, LookupEntry>,
  activeHandle: string | null | undefined,
  onCiteClick: ((handle: string) => void) | undefined,
): ReactNode {
  // react-markdown delivers children as: a string (most common), an array
  // of mixed string + node (when the paragraph contains markdown emphasis
  // / links / etc.), or a single node. We only transform strings; nested
  // nodes are left alone — their own component overrides handle them on
  // the next recursion.
  if (typeof children === "string") {
    return linkifyText(children, lookup, activeHandle, onCiteClick);
  }
  if (Array.isArray(children)) {
    // Namespace each segment's keys with its array index — otherwise two
    // text segments under the same parent that both start with the same
    // handle (e.g. "[C-1] …") produce the same key ("C-1-1") and React
    // warns about duplicate keys / may drop a chip.
    return children.flatMap((c, i) =>
      typeof c === "string"
        ? linkifyText(c, lookup, activeHandle, onCiteClick, `s${i}-`)
        : [c],
    );
  }
  return children;
}

export function CitedMarkdown({
  content,
  chunks,
  activeHandle = null,
  onCiteClick,
}: CitedMarkdownProps) {
  const lookup = buildChunkLookup(chunks);
  const proc = (children: ReactNode) =>
    processChildren(children, lookup, activeHandle, onCiteClick);
  const cleaned = scrubArtifacts(content);

  return (
    <ReactMarkdown
      // GFM gives us tables, strikethrough, task-list checkboxes, and
      // autolinks — react-markdown's default parser leaves all of these as
      // literal pipes and dashes, which is why "give me a table" answers
      // were rendering as plaintext.
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-xl font-bold text-foreground mb-3 mt-4">
            {proc(children)}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold text-foreground mb-2 mt-3">
            {proc(children)}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold text-foreground mb-2 mt-3">
            {proc(children)}
          </h3>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">
            {proc(children)}
          </strong>
        ),
        em: ({ children }) => <em>{proc(children)}</em>,
        ul: ({ children }) => (
          <ul className="list-disc list-inside space-y-1 my-2 text-foreground">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside space-y-1 my-2 text-foreground">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="text-sm leading-relaxed">{proc(children)}</li>
        ),
        p: ({ children }) => (
          <p className="text-sm leading-relaxed mb-2 text-foreground">
            {proc(children)}
          </p>
        ),
        code: ({ children }) => (
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-primary">
            {children}
          </code>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary pl-3 my-2 text-muted-foreground italic">
            {proc(children)}
          </blockquote>
        ),
        // Tables — wrap in a scroll container so a wide table doesn't break
        // the chat bubble layout on a narrow viewport, and style each cell
        // distinctively so the table reads as a table, not a wall of text.
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-muted/60 text-foreground">{children}</thead>
        ),
        tbody: ({ children }) => (
          <tbody className="divide-y divide-border/50">{children}</tbody>
        ),
        tr: ({ children }) => (
          <tr className="hover:bg-muted/30 transition-colors">{children}</tr>
        ),
        th: ({ children, style }) => (
          <th
            className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border/60"
            style={style}
          >
            {proc(children)}
          </th>
        ),
        td: ({ children, style }) => (
          <td
            className="px-3 py-2 align-top text-foreground"
            style={style}
          >
            {proc(children)}
          </td>
        ),
        hr: () => <hr className="my-3 border-border/60" />,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            {proc(children)}
          </a>
        ),
      }}
    >
      {cleaned}
    </ReactMarkdown>
  );
}
