// src/lib/honours-board-pdf.tsx
// Builds one printed honours board sheet as a PDF, in the browser, fonts embedded, with a
// white margin all round (so no bleed is needed). The page size, title, headings and row
// spacing come from the board's layout (sheetGeometry in src/types/honours-boards.ts):
// two stacked A2 landscape sheets, two A3 portrait sheets side by side, or one A3 portrait
// sheet fitted to the years so far.
//
// Client-only — import this with a dynamic import() so @react-pdf/renderer stays
// out of the server bundle.

import { Document, Font, Page, Text, View, pdf } from '@react-pdf/renderer';
import { sheetGeometry } from '@/types/honours-boards';
import type { BoardSheet, HonoursBoard } from '@/types/honours-boards';

export type BodyFont = 'Atkinson Hyperlegible Next' | 'Inter' | 'Lora';

export const BODY_FONTS: BodyFont[] = ['Atkinson Hyperlegible Next', 'Inter', 'Lora'];

/** One season's honours: year, plus winner names keyed by website.honours_internal column. */
export type HonoursYearRow = { year: number } & Record<string, string | number | null>;

// ── Measurements (mm, A3 base sizes — multiplied by the sheet's scale) ──
const MM = 72 / 25.4; // points per millimetre
const YEAR_COL_W = 18;
const CELL_PAD = 1.5;

// ── Colours: club palette (config/theme.ts on bhbc-website) ──
const GREEN_DARK = '#14532d';
// Line above each new decade (pt, A3 base size). Anything much thinner is under a pixel
// on screen, so previews show it faint in some places and darker in others.
const DECADE_LINE_PT = 1;
const STRIPE = '#e6f2ea';
const TEXT = '#111827';

// Rough average character width as a fraction of font size, used to shrink a long
// name so it fits its column. Deliberately generous so names never clip.
const CHAR_WIDTH = 0.55;
const MIN_NAME_PT = 7;

// The fonts' natural line spacing (ascender to descender), set explicitly so a name's line
// is never taller than its row — react-pdf leaves out text that doesn't fit, and anything
// tighter lets descenders run into the next row. namePointSize keeps names within this.
const ROW_LINE_HEIGHT = 1.3;

let fontsRegistered = false;

/** Registers the fonts once, from /public/fonts/honours-boards (licences alongside). */
function registerFonts() {
  if (fontsRegistered) return;
  const base = `${window.location.origin}/fonts/honours-boards`;
  Font.register({
    family: 'Atkinson Hyperlegible Next',
    fonts: [
      { src: `${base}/atkinson-hyperlegible-next-latin-500-normal.woff`, fontWeight: 500 },
      { src: `${base}/atkinson-hyperlegible-next-latin-600-normal.woff`, fontWeight: 600 },
    ],
  });
  Font.register({
    family: 'Inter',
    fonts: [
      { src: `${base}/inter-latin-500-normal.woff`, fontWeight: 500 },
      { src: `${base}/inter-latin-600-normal.woff`, fontWeight: 600 },
    ],
  });
  Font.register({
    family: 'Lora',
    fonts: [
      { src: `${base}/lora-latin-500-normal.woff`, fontWeight: 500 },
      { src: `${base}/lora-latin-600-normal.woff`, fontWeight: 600 },
    ],
  });
  // Never hyphenate — a name split across lines with a hyphen reads like a different name
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

/** Font size (pt) for a name: the standard size, shrunk if the name is too long for its column. */
function fitNameSize(text: string, columnWidthMm: number, padMm: number, standardPt: number): number {
  const available = (columnWidthMm - padMm * 2) * MM;
  const needed = text.length * standardPt * CHAR_WIDTH;
  if (needed <= available) return standardPt;
  return Math.max(MIN_NAME_PT, available / (text.length * CHAR_WIDTH));
}

interface SheetProps {
  board: HonoursBoard;
  sheet: BoardSheet;
  yearsPerSet: number;
  rowsByYear: Map<number, HonoursYearRow>;
  lastYearShown: number;
  bodyFont: BodyFont;
  clubName: string;
}

function BoardSheetDocument({ board, sheet, yearsPerSet, rowsByYear, lastYearShown, bodyFont, clubName }: SheetProps) {
  const g = sheetGeometry(board.layout, sheet, yearsPerSet);
  // Title, headings and year column grow with the sheet (1 at A3 base size, √2 at A2 size)
  const s = g.scale;
  const tableW = g.widthMm - g.marginMm * 2;
  const yearColW = YEAR_COL_W * s;
  const pad = CELL_PAD * s;
  // A hair under the exact height, so rounding can't push the last row past the margin
  const rowH = g.rowHeightMm - 0.01;
  // Headings a little smaller than names, and small enough for two lines in the heading band
  const headingPt = Math.min(g.namePt * 0.85, 12.5 * s);

  // Share the width left after the year column between the columns, by relative width
  let totalWeight = 0;
  for (const col of board.columns) totalWeight += col.width;
  const columnWidths = board.columns.map((col) => ((tableW - yearColW) * col.width) / totalWeight);

  const years: number[] = [];
  for (let y = sheet.firstYear; y <= sheet.lastYear; y++) years.push(y);

  return (
    <Document title={`${clubName} — ${board.name} — ${sheet.firstYear}–${sheet.lastYear}`} author={clubName}>
      {/* wrap={false}: one sheet is always exactly one page — rows that fill it to the last
          fraction of a millimetre must never spill a blank second page */}
      <Page size={g.paper} orientation={g.orientation} wrap={false} style={{ padding: g.marginMm * MM, backgroundColor: '#ffffff' }}>
        {/* The title, on the first sheet of a set (or the only sheet) */}
        {g.titleHeightMm > 0 && (
          <View style={{ height: g.titleHeightMm * MM, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Lora', fontWeight: 600, fontSize: 13 * s, letterSpacing: 3 * s, color: GREEN_DARK }}>
              {clubName.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: 'Lora', fontWeight: 600, fontSize: 30 * s, color: GREEN_DARK, marginTop: 3 * MM * s, textAlign: 'center' }}>
              {board.name}
            </Text>
          </View>
        )}

        {/* Column headings — every sheet except the bottom one of a stacked pair */}
        {g.headerHeightMm > 0 && (
          <View style={{ flexDirection: 'row', height: g.headerHeightMm * MM, backgroundColor: GREEN_DARK }}>
            <View style={{ width: yearColW * MM, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ fontFamily: 'Lora', fontWeight: 600, fontSize: headingPt, color: '#ffffff' }}>Year</Text>
            </View>
            {board.columns.map((col, i) => (
              <View key={col.field} style={{ width: columnWidths[i] * MM, paddingHorizontal: pad * MM, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontFamily: 'Lora', fontWeight: 600, fontSize: headingPt, color: '#ffffff', textAlign: 'center' }}>{col.heading}</Text>
              </View>
            ))}
          </View>
        )}

        {/* One row per year on this sheet; years not yet played are left as blank ruled rows */}
        {years.map((year) => {
          const played = year <= lastYearShown;
          const record = played ? rowsByYear.get(year) : undefined;
          // Shade by year (odd years), not row position, so stripes continue across sheets and every reprint
          const shaded = year % 2 === 1;
          // A darker line above each new decade helps find a year
          const decade = year % 10 === 0 && year !== sheet.firstYear;
          return (
            <View
              key={year}
              style={{
                flexDirection: 'row',
                height: rowH * MM,
                backgroundColor: shaded ? STRIPE : '#ffffff',
              }}
            >
              {/* Drawn over the row rather than as a border, which would take height from the text */}
              {decade && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: DECADE_LINE_PT * s, backgroundColor: GREEN_DARK }} />}
              <View style={{ width: yearColW * MM, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontFamily: bodyFont, fontWeight: 600, fontSize: fitNameSize('0000', yearColW, 0, g.namePt), lineHeight: ROW_LINE_HEIGHT, color: TEXT }}>{played ? String(year) : ''}</Text>
              </View>
              {board.columns.map((col, i) => {
                const raw = record ? record[col.field] : null;
                const name = typeof raw === 'string' ? raw.trim() : '';
                return (
                  <View key={col.field} style={{ width: columnWidths[i] * MM, paddingHorizontal: pad * MM, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                    <Text style={{ fontFamily: bodyFont, fontWeight: 500, fontSize: fitNameSize(name, columnWidths[i], pad, g.namePt), lineHeight: ROW_LINE_HEIGHT, color: TEXT, textAlign: 'center' }}>
                      {name}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })}
      </Page>
    </Document>
  );
}

/**
 * Renders one sheet to a PDF Blob.
 * `lastYearShown` is the latest season to print a year number for — later rows stay blank.
 */
export async function buildHonoursBoardPdf(options: {
  board: HonoursBoard;
  sheet: BoardSheet;
  yearsPerSet: number;
  rows: HonoursYearRow[];
  lastYearShown: number;
  bodyFont: BodyFont;
  clubName: string;
}): Promise<Blob> {
  registerFonts();
  const rowsByYear = new Map<number, HonoursYearRow>();
  for (const row of options.rows) rowsByYear.set(Number(row.year), row);
  return pdf(
    <BoardSheetDocument
      board={options.board}
      sheet={options.sheet}
      yearsPerSet={options.yearsPerSet}
      rowsByYear={rowsByYear}
      lastYearShown={options.lastYearShown}
      bodyFont={options.bodyFont}
      clubName={options.clubName}
    />
  ).toBlob();
}

/** Download filename, e.g. "BHBC Honours - Singles - Set 1 Bottom 2007-2046 (A2 landscape).pdf". */
export function honoursBoardFileName(board: HonoursBoard, sheet: BoardSheet, yearsPerSet: number): string {
  const safeName = board.name.replace(/[\\/:*?"<>|]/g, '-');
  const g = sheetGeometry(board.layout, sheet, yearsPerSet);
  const where = sheet.position === 'Single' ? '' : `Set ${sheet.set} ${sheet.position} `;
  return `BHBC Honours - ${safeName} - ${where}${sheet.firstYear}-${sheet.lastYear} (${g.paper} ${g.orientation}).pdf`;
}
