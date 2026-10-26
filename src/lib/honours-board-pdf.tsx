// src/lib/honours-board-pdf.tsx
// Builds one printed honours board sheet as a PDF, in the browser, fonts embedded, with a
// white margin all round (so no bleed is needed). The page size, title, headings and row
// spacing come from the board's layout (sheetGeometry in src/types/honours-boards.ts):
// an A2 portrait sheet with an A3 continuation sheet, two stacked A2 or A3 landscape
// sheets, two A3 portrait sheets side by side, or one A3 portrait sheet fitted to the
// years so far.
//
// Client-only — import this with a dynamic import() so @react-pdf/renderer stays
// out of the server bundle.

import { Document, Font, Page, Text, View, pdf } from '@react-pdf/renderer';
import { sheetGeometry, sheetLabel } from '@/types/honours-boards';
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
const GREEN_DARK = '#14532d'; // the website's darkest green
const GOLD = '#d97706';       // the website's gold accent
const TEXT = '#111827';
// Line above each new decade (pt, A3 base size). Anything much thinner is under a pixel
// on screen, so previews show it faint in some places and darker in others.
const DECADE_LINE_PT = 1;
const ROW_RULE_PT = 0.4;

/** How the rows are told apart — a choice on the print page while the club decides. */
export type BoardStyle = 'rules' | 'decades' | 'stone' | 'grey' | 'ivory' | 'green';

interface StyleSpec {
  page: string;                          // page background
  shade: string | null;                  // tint for shaded rows; null = none
  shadeRow: (year: number) => boolean;   // which rows get the tint
  rule: string | null;                   // thin line between rows; null = none
  titleUnderline: boolean;               // short gold line under the board name
}

// Shading goes by year rather than row position, so it carries on across sheets and every reprint
const oddYears = (year: number) => year % 2 === 1;
const altDecades = (year: number) => Math.floor(year / 10) % 2 === 0; // the 1980s, 2000s, 2020s…

const STYLES: Record<BoardStyle, StyleSpec> = {
  rules: { page: '#ffffff', shade: null, shadeRow: oddYears, rule: '#d6d3d1', titleUnderline: false },
  decades: { page: '#ffffff', shade: '#edf4ef', shadeRow: altDecades, rule: null, titleUnderline: false },
  stone: { page: '#ffffff', shade: '#f2eee6', shadeRow: oddYears, rule: null, titleUnderline: false },
  grey: { page: '#ffffff', shade: '#f3f4f6', shadeRow: oddYears, rule: null, titleUnderline: false },
  ivory: { page: '#faf7f0', shade: null, shadeRow: oddYears, rule: '#ddd6c8', titleUnderline: true },
  green: { page: '#ffffff', shade: '#e6f2ea', shadeRow: oddYears, rule: null, titleUnderline: false },
};

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
  boardStyle: BoardStyle;
  clubName: string;
}

function BoardSheetDocument({ board, sheet, yearsPerSet, rowsByYear, lastYearShown, bodyFont, boardStyle, clubName }: SheetProps) {
  const g = sheetGeometry(board.layout, sheet, yearsPerSet);
  const style = STYLES[boardStyle];
  // Title, headings and year column grow with the sheet (1 at A3 base size, √2 at A2 size)
  const s = g.scale;
  const tableW = g.widthMm - g.marginXMm * 2;
  const yearColW = YEAR_COL_W * s;
  const pad = CELL_PAD * s;
  // A hair under the exact height, so rounding can't push the last row past the margin
  const rowH = g.rowHeightMm - 0.01;
  // Headings a little smaller than names, and small enough for two lines in the heading band
  const headingPt = Math.min(g.namePt * 0.85, 12.5 * s);
  // The title (club name, board name, gaps and any gold line) needs about this much height;
  // in a tighter title area — e.g. sheet 1 of an A3 trial print — it's shrunk to fit, since
  // react-pdf leaves out text that doesn't fit
  const titleNeedsMm = (style.titleUnderline ? 27 : 23.5) * s;
  const t = s * Math.min(1, g.titleHeightMm / titleNeedsMm);

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
      <Page size={g.paper} orientation={g.orientation} wrap={false} style={{ paddingHorizontal: g.marginXMm * MM, paddingVertical: g.marginYMm * MM, backgroundColor: style.page }}>
        {/* The title, on the first sheet of a set (or the only sheet) */}
        {g.titleHeightMm > 0 && (
          <View style={{ height: g.titleHeightMm * MM, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Lora', fontWeight: 600, fontSize: 13 * t, letterSpacing: 3 * t, color: GREEN_DARK }}>
              {clubName.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: 'Lora', fontWeight: 600, fontSize: 30 * t, color: GREEN_DARK, marginTop: 3 * MM * t, textAlign: 'center' }}>
              {board.name}
            </Text>
            {style.titleUnderline && (
              <View style={{ width: 60 * MM * t, height: DECADE_LINE_PT * t, backgroundColor: GOLD, marginTop: 3 * MM * t }} />
            )}
          </View>
        )}

        {/* A one-line title on a continuation sheet, so it still says what it is in its own frame */}
        {g.contTitleHeightMm > 0 && (
          <View style={{ height: g.contTitleHeightMm * MM, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Lora', fontWeight: 600, fontSize: 11.5 * s, lineHeight: 1.2, color: GREEN_DARK }}>
              {board.name} (continued)
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
          const shaded = style.shade !== null && style.shadeRow(year);
          // A darker line above each new decade helps find a year
          const decade = year % 10 === 0 && year !== sheet.firstYear;
          // Styles with row rules draw one above every other row (the headings or the decade line mark the rest)
          const ruled = style.rule !== null && !decade && year !== sheet.firstYear;
          return (
            <View
              key={year}
              style={{
                flexDirection: 'row',
                height: rowH * MM,
                backgroundColor: shaded && style.shade ? style.shade : style.page,
              }}
            >
              {/* Lines are drawn over the row rather than as a border, which would take height from the text */}
              {decade && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: DECADE_LINE_PT * s, backgroundColor: GREEN_DARK }} />}
              {ruled && style.rule && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_RULE_PT * s, backgroundColor: style.rule }} />}
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
  boardStyle: BoardStyle;
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
      boardStyle={options.boardStyle}
      clubName={options.clubName}
    />
  ).toBlob();
}

/** Download filename, e.g. "BHBC Honours - Singles - Set 1 Sheet 3 2027-2052 (A3 landscape).pdf". */
export function honoursBoardFileName(board: HonoursBoard, sheet: BoardSheet, yearsPerSet: number): string {
  const safeName = board.name.replace(/[\\/:*?"<>|]/g, '-');
  const g = sheetGeometry(board.layout, sheet, yearsPerSet);
  // e.g. "Sheet 1" or "Sheets 1+2" — the paper size is added at the end anyway
  const label = sheetLabel(board.layout, sheet).replace(/ \(.*\)$/, '');
  const where = sheet.position === 'Single' ? '' : `Set ${sheet.set} ${label} `;
  return `BHBC Honours - ${safeName} - ${where}${sheet.firstYear}-${sheet.lastYear} (${g.paper} ${g.orientation}).pdf`;
}
