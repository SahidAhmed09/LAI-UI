// Real .docx export for DDiQ reports, in a clean letterhead format.
//
// Built with the `docx` library (not the old HTML-as-.doc trick) so the file
// is a genuine Word document Word/Pages/Google Docs open and edit natively.
// A repeating letterhead header (firm mark + report kind) and a footer with a
// confidentiality line + page numbers frame every page; the structured report
// data (sections → label/value tables, status map, findings) maps directly to
// Word tables and styled paragraphs.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Header,
  Footer,
  PageNumber,
  TabStopType,
  type ISectionOptions,
} from "docx";
import type {
  DDiQReportData,
  AusgabeblattRow,
  Ampel,
  Finding,
} from "@/react-app/lib/ddiqDemoData";

const ACCENT = "2563EB"; // brand blue
const INK = "0F172A";
const MUTED = "64748B";
const HAIR = "E2E8F0";

const AMPEL_HEX: Record<Ampel, string> = {
  green: "10B981",
  yellow: "D97706",
  red: "DC2626",
};
const AMPEL_LABEL: Record<Ampel, string> = {
  green: "OK",
  yellow: "Attention",
  red: "Risk",
};

function p(
  text: string,
  opts: {
    bold?: boolean;
    italics?: boolean;
    size?: number; // half-points
    color?: string;
    spacingAfter?: number;
    spacingBefore?: number;
  } = {},
): Paragraph {
  return new Paragraph({
    spacing: { after: opts.spacingAfter ?? 80, before: opts.spacingBefore ?? 0 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        italics: opts.italics,
        size: opts.size ?? 22,
        color: opts.color ?? INK,
      }),
    ],
  });
}

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: HAIR },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function rowsTable(rows: AusgabeblattRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: rows.map(
      (r) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 36, type: WidthType.PERCENTAGE },
              margins: { top: 40, bottom: 40, left: 60, right: 60 },
              children: [p(r.label, { bold: true, size: 20, spacingAfter: 0 })],
            }),
            new TableCell({
              width: { size: 64, type: WidthType.PERCENTAGE },
              margins: { top: 40, bottom: 40, left: 60, right: 60 },
              children: [
                new Paragraph({
                  spacing: { after: r.note ? 20 : 0 },
                  children: [
                    new TextRun({ text: r.value, size: 20, color: INK }),
                    ...(r.ampel
                      ? [
                          new TextRun({
                            text: `  [${AMPEL_LABEL[r.ampel]}]`,
                            size: 18,
                            bold: true,
                            color: AMPEL_HEX[r.ampel],
                          }),
                        ]
                      : []),
                  ],
                }),
                ...(r.note
                  ? [p(r.note, { italics: true, size: 18, color: MUTED, spacingAfter: 0 })]
                  : []),
              ],
            }),
          ],
        }),
    ),
  });
}

function sectionHeading(title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: HAIR, space: 4 } },
    children: [new TextRun({ text: title, bold: true, size: 26, color: INK })],
  });
}

function findingParagraphs(findings: Finding[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const f of findings) {
    out.push(
      new Paragraph({
        spacing: { before: 120, after: 20 },
        children: [
          new TextRun({
            text: `[${AMPEL_LABEL[f.severity]}] `,
            bold: true,
            size: 20,
            color: AMPEL_HEX[f.severity],
          }),
          new TextRun({ text: `${f.domain}  `, bold: true, size: 20, color: INK }),
          ...(f.legal_basis
            ? [new TextRun({ text: `· ${f.legal_basis}`, size: 16, color: MUTED })]
            : []),
        ],
      }),
      p(f.text, { size: 20, spacingAfter: f.recommended_action ? 20 : 120 }),
    );
    if (f.recommended_action) {
      out.push(
        p(`→ ${f.recommended_action}`, {
          italics: true,
          size: 18,
          color: MUTED,
          spacingAfter: 120,
        }),
      );
    }
  }
  return out;
}

export async function buildReportDocxBlob(
  d: DDiQReportData,
  activeSections: string[],
): Promise<Blob> {
  const body: (Paragraph | Table)[] = [];

  // ── Title block ──
  body.push(
    new Paragraph({
      spacing: { before: 120, after: 40 },
      children: [
        new TextRun({ text: d.projectName, bold: true, size: 40, color: INK }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: "Due-Diligence Report",
          size: 24,
          color: ACCENT,
          allCaps: true,
        }),
      ],
    }),
  );

  // Metadata table (For / By / Date)
  const meta: [string, string][] = [];
  if (d.preparedFor) meta.push(["Prepared for", d.preparedFor]);
  if (d.preparedBy) meta.push(["Prepared by", d.preparedBy]);
  if (d.date) meta.push(["Date", d.date]);
  if (meta.length)
    body.push(
      rowsTable(meta.map(([label, value]) => ({ label, value }) as AusgabeblattRow)),
    );

  // ── Analyzed documents ──
  if (d.analyzedDocuments.length) {
    body.push(sectionHeading("Analyzed Documents"));
    for (const name of d.analyzedDocuments) {
      body.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 20 },
          children: [new TextRun({ text: name, size: 20, color: INK })],
        }),
      );
    }
  }

  // ── Report sections (label/value tables) ──
  for (const s of d.sections.filter((sec) => activeSections.includes(sec.id))) {
    if (!s.rows?.length) continue;
    body.push(sectionHeading(s.title));
    body.push(rowsTable(s.rows));
  }

  // ── Status map ──
  if (activeSections.includes("statusmap") && d.weaStatuses.length) {
    body.push(sectionHeading("Status Map"));
    body.push(
      rowsTable(
        d.weaStatuses.map(
          (w) =>
            ({
              label: w.name,
              value: `${w.owner} · ${w.parcel} · ${w.contract}`,
              ampel: w.ampel,
            }) as AusgabeblattRow,
        ),
      ),
    );
  }

  // ── Findings ──
  const allFindings = [...(d.findings ?? []), ...(d.crossDocFindings ?? [])];
  if (allFindings.length) {
    body.push(sectionHeading(`Findings (${allFindings.length})`));
    body.push(...findingParagraphs(allFindings));
  }

  const section: ISectionOptions = {
    properties: {
      page: { margin: { top: 1440, bottom: 1200, left: 1200, right: 1200 } },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            spacing: { after: 0 },
            children: [
              new TextRun({ text: "LAI", bold: true, size: 26, color: ACCENT }),
              new TextRun({
                text: "   Legal AI for Wind-Energy Due Diligence",
                size: 18,
                color: MUTED,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 160 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 2 },
            },
            children: [
              new TextRun({
                text: "DDiQ — Confidential",
                size: 14,
                color: "94A3B8",
                allCaps: true,
              }),
            ],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
            border: {
              top: { style: BorderStyle.SINGLE, size: 4, color: HAIR, space: 4 },
            },
            children: [
              new TextRun({
                text: "Auto-generated by LAI · not a substitute for formal legal review",
                size: 14,
                color: "94A3B8",
              }),
              new TextRun({ text: "\tPage ", size: 14, color: "94A3B8" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 14, color: "94A3B8" }),
              new TextRun({ text: " / ", size: 14, color: "94A3B8" }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: "94A3B8" }),
            ],
          }),
        ],
      }),
    },
    children: body,
  };

  const doc = new Document({
    creator: "LAI",
    title: `DDiQ — ${d.projectName}`,
    description: "DDiQ due-diligence report",
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22, color: INK },
        },
      },
    },
    sections: [section],
  });

  return Packer.toBlob(doc);
}
