// src/lib/honours-board-pdf.tsx
// Builds one printed honours board sheet as a PDF, in the browser, fonts embedded, with a
// margin all round. Colours, stripes, lines and fonts come from the board style
// (src/types/honours-board-style.ts); a coloured sheet can add 3mm of bleed for the print
// shop to trim off, so the colour runs to the edge. The page size, title, headings and row
// spacing come from the board's layout (sheetGeometry in src/types/honours-boards.ts):
// an A2 portrait sheet with an A3 continuation sheet, two stacked A2 or A3 landscape
// sheets, two A3 portrait sheets side by side, or one A3 portrait sheet fitted to the
// years so far.
//
// Client-only — import this with a dynamic import() so @react-pdf/renderer stays
// out of the server bundle.

import { Document, Font, Image, Page, Text, View, pdf } from '@react-pdf/renderer';
import { sheetGeometry, sheetLabel } from '@/types/honours-boards';
import type { BoardSheet, HonoursBoard, LineSpacing } from '@/types/honours-boards';
import { FONT_OPTIONS, customFontUrl, lookupCustomFont, nearestWeight, titlePictures } from '@/types/honours-board-style';
import type { BoardStyleSettings, FontChoice, FontSlot, TitlePicture } from '@/types/honours-board-style';

/** One season's honours: year, plus winner names keyed by website.honours_internal column. */
export type HonoursYearRow = { year: number } & Record<string, string | number | null>;

// ── Measurements (mm, A3 base sizes — multiplied by the sheet's scale) ──
const MM = 72 / 25.4; // points per millimetre
const YEAR_COL_W = 18;
const CELL_PAD = 1.5;

/** Extra background round the edge for the print shop to trim off (mm). */
export const BLEED_MM = 3;
// Line above each new decade, and under the title (pt, A3 base size). Anything much thinner
// is under a pixel on screen, so previews show it faint in some places and darker in others.
const DECADE_LINE_PT = 1;
const ROW_RULE_PT = 0.4;

// Long names are measured in their own font and shrunk to fit their column. The measuring
// (in the browser) and the PDF can differ by a hair, so names are fitted to 97% of the room.
const FIT_SAFETY = 0.97;
const MIN_NAME_PT = 7;

// The fonts' natural line spacing (ascender to descender), set explicitly so a name's line
// is never taller than its row — react-pdf leaves out text that doesn't fit, and anything
// tighter lets descenders run into the next row. namePointSize keeps names within this.
const ROW_LINE_HEIGHT = 1.3;

// White panel round a title picture: padding (mm, A3 base size) and corner rounding
const PICTURE_PAD_MM = 2;
const PICTURE_RADIUS_MM = 2;

/** Height (mm) a title picture is drawn at, in a space this tall. */
function pictureHeight(picture: TitlePicture, spaceMm: number): number {
  return spaceMm * picture.heightShare;
}

/** Width (mm) a title picture takes up, panel included, in a space this tall. */
function pictureWidth(picture: TitlePicture, spaceMm: number, panel: boolean, scale: number): number {
  const pad = panel ? PICTURE_PAD_MM * scale : 0;
  return (pictureHeight(picture, spaceMm) - pad * 2) * picture.aspect + pad * 2;
}

/** A picture beside the title (the crest or the centenary pin), on a white panel if asked for. */
function TitlePictureView({ picture, spaceMm, panel, scale }: { picture: TitlePicture; spaceMm: number; panel: boolean; scale: number }) {
  // With a panel, the picture shrinks so picture and panel together are the height
  const pad = panel ? PICTURE_PAD_MM * scale : 0;
  const imageH = pictureHeight(picture, spaceMm) - pad * 2;
  return (
    <View style={{ padding: pad * MM, backgroundColor: panel ? '#ffffff' : undefined, borderRadius: panel ? PICTURE_RADIUS_MM * scale * MM : 0 }}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF picture has no alt text */}
      <Image src={`${window.location.origin}${picture.file}`} style={{ height: imageH * MM, width: imageH * picture.aspect * MM }} />
    </View>
  );
}

/** Thrown when a font can't be found or loaded — its message is shown on the print page. */
export class HonoursFontError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HonoursFontError';
  }
}

/** A font ready to print with: the PDF's family name and weight, and how to measure text in it. */
interface ResolvedFont {
  family: string;
  weight: number;
  measureFamily: string; // the same file loaded into the browser, for measuring
}

type ResolvedFonts = Record<FontSlot, ResolvedFont>;

let hyphenationOff = false;
// Font files already registered with the PDF library / loaded for measuring, by "family|weight"
const registered = new Set<string>();
const measureLoaded = new Map<string, string>();

/** Registers one font file with the PDF library and loads it for measuring — each file only once. */
async function loadFontFile(family: string, weight: number, url: string): Promise<ResolvedFont> {
  const key = `${family}|${weight}`;
  // The PDF library fetches the file itself when it first draws text in it
  if (!registered.has(key)) {
    Font.register({ family, fonts: [{ src: url, fontWeight: weight }] });
    registered.add(key);
  }
  // The browser loads the same file under its own name, so names can be measured before drawing
  let measureFamily = measureLoaded.get(key);
  if (!measureFamily) {
    measureFamily = `honours-measure-${measureLoaded.size + 1}`;
    try {
      const face = new FontFace(measureFamily, `url(${url})`);
      await face.load();
      document.fonts.add(face);
    } catch {
      throw new HonoursFontError(`Couldn't load the font ${family}. Check the internet connection and try again.`);
    }
    measureLoaded.set(key, measureFamily);
  }
  return { family, weight, measureFamily };
}

/** Works out and loads the font for one place on the sheet: bundled, or a Google font by name. */
async function resolveFont(choice: FontChoice): Promise<ResolvedFont> {
  // A Google font, fetched from the free Fontsource catalogue
  if (choice.font === 'custom') {
    const name = choice.customName.trim();
    if (!name) throw new HonoursFontError('A font is set to Custom but no Google font name has been given.');
    let info;
    try {
      info = await lookupCustomFont(name);
    } catch {
      throw new HonoursFontError(`Couldn't look up the font "${name}". Check the internet connection and try again.`);
    }
    if (!info) throw new HonoursFontError(`"${name}" isn't a Google font. Check the spelling on fonts.google.com.`);
    const weight = nearestWeight(info.weights, choice.bold);
    // A prefix keeps a custom font apart from a bundled one of the same name
    return loadFontFile(`Custom ${info.family}`, weight, customFontUrl(info, weight));
  }
  // A font bundled in /public/fonts/honours-boards (licences alongside)
  const option = FONT_OPTIONS.find((f) => f.key === choice.font) ?? FONT_OPTIONS[0];
  const weight = choice.bold ? option.bold : option.regular;
  return loadFontFile(option.family, weight, `${window.location.origin}/fonts/honours-boards/${option.file}-${weight}-normal.woff`);
}

/** Loads the fonts for titles, years and names. */
async function resolveFonts(style: BoardStyleSettings): Promise<ResolvedFonts> {
  // Never hyphenate — a name split across lines with a hyphen reads like a different name
  if (!hyphenationOff) {
    Font.registerHyphenationCallback((word) => [word]);
    hyphenationOff = true;
  }
  const [titles, years, names] = await Promise.all([
    resolveFont(style.fonts.titles),
    resolveFont(style.fonts.years),
    resolveFont(style.fonts.names),
  ]);
  return { titles, years, names };
}

let measureContext: CanvasRenderingContext2D | null = null;

/** Width of some text in a font, as a multiple of the font size. */
function textWidthEm(font: ResolvedFont, text: string): number {
  if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
  // No canvas (shouldn't happen in a browser): a generous guess, so names never clip
  if (!measureContext) return text.length * 0.6;
  measureContext.font = `100px "${font.measureFamily}"`;
  return measureContext.measureText(text).width / 100;
}

/** Font size (pt) for some text: the standard size, shrunk if it's too wide for the room (mm). */
function fitSize(font: ResolvedFont, text: string, roomMm: number, standardPt: number): number {
  const em = textWidthEm(font, text);
  if (em === 0) return standardPt;
  const room = roomMm * MM * FIT_SAFETY;
  if (em * standardPt <= room) return standardPt;
  return Math.max(MIN_NAME_PT, room / em);
}

interface SheetProps {
  board: HonoursBoard;
  sheet: BoardSheet;
  yearsPerSet: number;
  lineSpacing: LineSpacing;
  rowsByYear: Map<number, HonoursYearRow>;
  lastYearShown: number;
  style: BoardStyleSettings;
  fonts: ResolvedFonts;
  clubName: string;
}

function BoardSheetDocument({ board, sheet, yearsPerSet, lineSpacing, rowsByYear, lastYearShown, style, fonts, clubName }: SheetProps) {
  const g = sheetGeometry(board.layout, sheet, yearsPerSet, lineSpacing);
  // Title, headings and year column grow with the sheet (1 at A3 base size, √2 at A2 size)
  const s = g.scale;
  const tableW = g.widthMm - g.marginXMm * 2;
  const yearColW = YEAR_COL_W * s;
  const pad = CELL_PAD * s;
  // Names sit left, centred or right in their column; the cell lines its text box up the same way
  const nameBoxAlign = style.nameAlign === 'left' ? 'flex-start' : style.nameAlign === 'right' ? 'flex-end' : 'center';
  // A hair under the exact height, so rounding can't push the last row past the margin
  const rowH = g.rowHeightMm - 0.01;
  // Headings a little smaller than names, and small enough for two lines in the heading band
  const headingPt = Math.min(g.namePt * 0.85, 12.5 * s);
  // The title (club name, board name, gaps and any line under it) needs about this much height;
  // in a tighter title area — e.g. sheet 1 of an A3 trial print — it's shrunk to fit, since
  // react-pdf leaves out text that doesn't fit
  const titleNeedsMm = (style.underline ? 27 : 23.5) * s;
  const t = s * Math.min(1, g.titleHeightMm / titleNeedsMm);
  // Room left below the title to balance the page margin above it (as much as the title area spares)
  const titleBottomPadMm = Math.min(g.marginYMm, Math.max(0, g.titleHeightMm - titleNeedsMm * (t / s)));
  // Pictures beside the title fill its height (less a little room), sitting in from the edge
  const pictures = titlePictures(style.logo);
  const pictureSpaceMm = Math.min(g.titleHeightMm - 4 * s, 48 * s);
  const pictureInsetMm = 12 * s;
  /** Distance from the top of the title area that centres a picture in it. */
  const pictureTop = (p: TitlePicture) => (g.titleHeightMm - pictureHeight(p, pictureSpaceMm)) / 2;
  // The board name stays on one line, however wide the chosen font — and clear of the pictures
  // (the title is centred, so the wider picture sets the room on both sides)
  let pictureRoomMm = 0;
  for (const p of [pictures.left, pictures.right]) {
    if (p) pictureRoomMm = Math.max(pictureRoomMm, pictureInsetMm + pictureWidth(p, pictureSpaceMm, style.logoPanel, s) + 4 * s);
  }
  const boardNamePt = fitSize(fonts.titles, board.name, tableW - pictureRoomMm * 2, 30 * t);
  // With bleed the page grows by BLEED_MM all round and the margins grow with it, so the
  // design sits exactly where it would on the trimmed sheet. The size is given already the
  // right way round, so no orientation then (react-pdf would swap it)
  const bleedMm = style.bleed ? BLEED_MM : 0;
  const pageSize = style.bleed ? { width: (g.widthMm + bleedMm * 2) * MM, height: (g.heightMm + bleedMm * 2) * MM } : g.paper;

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
      <Page size={pageSize} orientation={style.bleed ? undefined : g.orientation} wrap={false} style={{ paddingHorizontal: (g.marginXMm + bleedMm) * MM, paddingVertical: (g.marginYMm + bleedMm) * MM, backgroundColor: style.background }}>
        {/* The title, on the first sheet of a set (or the only sheet) */}
        {g.titleHeightMm > 0 && (
          // The page margin already sits above the title, so the same again is left below it —
          // otherwise the gap above the club name looks much bigger than the one under the title
          <View style={{ height: g.titleHeightMm * MM, paddingBottom: titleBottomPadMm * MM, justifyContent: 'center', alignItems: 'center' }}>
            {/* The crest and/or centenary pin either side, if chosen and there's room */}
            {pictures.left && pictureSpaceMm > 0 && (
              <View style={{ position: 'absolute', top: pictureTop(pictures.left) * MM, left: pictureInsetMm * MM }}>
                <TitlePictureView picture={pictures.left} spaceMm={pictureSpaceMm} panel={style.logoPanel} scale={s} />
              </View>
            )}
            {pictures.right && pictureSpaceMm > 0 && (
              <View style={{ position: 'absolute', top: pictureTop(pictures.right) * MM, right: pictureInsetMm * MM }}>
                <TitlePictureView picture={pictures.right} spaceMm={pictureSpaceMm} panel={style.logoPanel} scale={s} />
              </View>
            )}
            <Text style={{ fontFamily: fonts.titles.family, fontWeight: fonts.titles.weight, fontSize: 13 * t, letterSpacing: 3 * t, color: style.title }}>
              {clubName.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: fonts.titles.family, fontWeight: fonts.titles.weight, fontSize: boardNamePt, color: style.title, marginTop: 3 * MM * t, textAlign: 'center' }}>
              {board.name}
            </Text>
            {style.underline && (
              <View style={{ width: 60 * MM * t, height: DECADE_LINE_PT * t, backgroundColor: style.underline, marginTop: 3 * MM * t }} />
            )}
          </View>
        )}

        {/* A one-line title on a continuation sheet, so it still says what it is in its own frame */}
        {g.contTitleHeightMm > 0 && (
          <View style={{ height: g.contTitleHeightMm * MM, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.titles.family, fontWeight: fonts.titles.weight, fontSize: 11.5 * s, lineHeight: 1.2, color: style.title }}>
              {board.name} (continued)
            </Text>
          </View>
        )}

        {/* Column headings — every sheet except the bottom one of a stacked pair */}
        {g.headerHeightMm > 0 && (
          <View style={{ flexDirection: 'row', height: g.headerHeightMm * MM, backgroundColor: style.headingBand }}>
            <View style={{ width: yearColW * MM, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.titles.family, fontWeight: fonts.titles.weight, fontSize: fitSize(fonts.titles, 'Year', yearColW, headingPt), color: style.headingText }}>Year</Text>
            </View>
            {board.columns.map((col, i) => (
              <View key={col.field} style={{ width: columnWidths[i] * MM, paddingHorizontal: pad * MM, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontFamily: fonts.titles.family, fontWeight: fonts.titles.weight, fontSize: headingPt, color: style.headingText, textAlign: 'center' }}>{col.heading}</Text>
              </View>
            ))}
          </View>
        )}

        {/* One row per year on this sheet; years not yet played are left as blank rows */}
        {years.map((year) => {
          const played = year <= lastYearShown;
          const record = played ? rowsByYear.get(year) : undefined;
          // Stripes go by year rather than row position, so they carry on across sheets and every reprint
          const striped = style.stripes !== null && year % 2 === 1;
          // A stronger line above each new decade helps find a year
          const decade = style.decadeLines !== null && year % 10 === 0 && year !== sheet.firstYear;
          // A fine line above every other row (the headings or a decade line mark the rest)
          const ruled = style.yearLines !== null && !decade && year !== sheet.firstYear;
          return (
            <View
              key={year}
              style={{
                flexDirection: 'row',
                height: rowH * MM,
                backgroundColor: striped && style.stripes ? style.stripes : style.background,
              }}
            >
              {/* Lines are drawn over the row rather than as a border, which would take height from the text */}
              {decade && style.decadeLines && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: DECADE_LINE_PT * s, backgroundColor: style.decadeLines }} />}
              {ruled && style.yearLines && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_RULE_PT * s, backgroundColor: style.yearLines }} />}
              <View style={{ width: yearColW * MM, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontFamily: fonts.years.family, fontWeight: fonts.years.weight, fontSize: fitSize(fonts.years, String(year), yearColW, g.namePt), lineHeight: ROW_LINE_HEIGHT, color: style.text }}>{played ? String(year) : ''}</Text>
              </View>
              {board.columns.map((col, i) => {
                const raw = record ? record[col.field] : null;
                const name = typeof raw === 'string' ? raw.trim() : '';
                return (
                  <View key={col.field} style={{ width: columnWidths[i] * MM, paddingHorizontal: pad * MM, justifyContent: 'center', alignItems: nameBoxAlign, overflow: 'hidden' }}>
                    <Text style={{ fontFamily: fonts.names.family, fontWeight: fonts.names.weight, fontSize: fitSize(fonts.names, name, columnWidths[i] - pad * 2, g.namePt), lineHeight: ROW_LINE_HEIGHT, color: style.text, textAlign: style.nameAlign }}>
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
 * Throws HonoursFontError if a font can't be found or loaded.
 */
export async function buildHonoursBoardPdf(options: {
  board: HonoursBoard;
  sheet: BoardSheet;
  yearsPerSet: number;
  lineSpacing: LineSpacing;
  rows: HonoursYearRow[];
  lastYearShown: number;
  style: BoardStyleSettings;
  clubName: string;
}): Promise<Blob> {
  const fonts = await resolveFonts(options.style);
  const rowsByYear = new Map<number, HonoursYearRow>();
  for (const row of options.rows) rowsByYear.set(Number(row.year), row);
  return pdf(
    <BoardSheetDocument
      board={options.board}
      sheet={options.sheet}
      yearsPerSet={options.yearsPerSet}
      lineSpacing={options.lineSpacing}
      rowsByYear={rowsByYear}
      lastYearShown={options.lastYearShown}
      style={options.style}
      fonts={fonts}
      clubName={options.clubName}
    />
  ).toBlob();
}

/** Download filename, e.g. "BHBC Honours - Singles - Set 1 Sheet 3 2027-2052 (A3 landscape).pdf". */
export function honoursBoardFileName(board: HonoursBoard, sheet: BoardSheet, yearsPerSet: number, bleed = false): string {
  const safeName = board.name.replace(/[\\/:*?"<>|]/g, '-');
  // Only the paper size is used, which the line spacing doesn't change
  const g = sheetGeometry(board.layout, sheet, yearsPerSet, 'snug');
  // e.g. "Sheet 1" or "Sheets 1+2" — the paper size is added at the end anyway
  const label = sheetLabel(board.layout, sheet).replace(/ \(.*\)$/, '');
  const where = sheet.position === 'Single' ? '' : `Set ${sheet.set} ${label} `;
  return `BHBC Honours - ${safeName} - ${where}${sheet.firstYear}-${sheet.lastYear} (${g.paper} ${g.orientation}${bleed ? ' with 3mm bleed' : ''}).pdf`;
}
