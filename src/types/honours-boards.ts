// src/types/honours-boards.ts
// Printed honours boards for the clubhouse wall (supabase/migrations/0078_honours_boards.sql
// to 0080_honours_boards_layouts.sql). Each board picks a layout — two stacked A2 sheets,
// two A3 sheets side by side, or one A3 sheet fitted to the years so far. Every board
// shares the start year and the years per set (which sets the row spacing), as config keys.

/** Config keys shared by every board. */
export const START_YEAR_KEY = 'honours_board_start_year';
export const YEARS_PER_SET_KEY = 'honours_board_years_per_set';

/**
 * The website.honours_internal columns a board can show, with a default heading.
 * Labels match the honours-internal admin page (app/admin/website/honours-internal).
 */
export const HONOURS_BOARD_FIELDS: { field: string; label: string }[] = [
  { field: 'president', label: 'President' },
  { field: 'mens_captain', label: "Men's Captain" },
  { field: 'ladies_captain', label: 'Ladies Captain' },
  { field: 'mens_championship', label: "Men's Championship" },
  { field: 'mens_two_woods', label: "Men's Two Woods" },
  { field: 'ladies_maynard', label: 'Ladies Maynard' },
  { field: 'ladies_two_woods', label: 'Ladies Two Woods' },
  { field: 'mixed_handicap', label: 'Mixed Handicap' },
  { field: 'oldland', label: 'Oldland' },
  { field: 'veterans_cup', label: 'Veterans Cup' },
  { field: 'centenary_cup', label: 'Centenary Cup' },
  { field: 'drawn_pairs', label: 'Drawn Pairs' },
  { field: 'drawn_triples', label: 'Drawn Triples' },
  { field: 'married_pairs', label: 'Married Pairs' },
  { field: 'australian_pairs', label: 'Australian Pairs' },
];

/** The admin label for a field, e.g. "Drawn Pairs" for drawn_pairs. */
export function fieldLabel(field: string): string {
  const match = HONOURS_BOARD_FIELDS.find((f) => f.field === field);
  return match ? match.label : field;
}

/** How a board's sheets are printed and hung. */
export type BoardLayout = 'stacked' | 'side_by_side' | 'single';

export const BOARD_LAYOUTS: { value: BoardLayout; label: string; hint: string }[] = [
  {
    value: 'stacked',
    label: 'Two A2 landscape sheets, one above the other',
    hint: 'Title and headings on the top sheet. The bottom sheet is reprinted each year.',
  },
  {
    value: 'side_by_side',
    label: 'Two A3 portrait sheets, side by side',
    hint: 'Fits one A2 landscape frame. Title on the left sheet, headings on both. The right sheet is reprinted each year. Best for up to 4 columns.',
  },
  {
    value: 'single',
    label: 'One A3 portrait sheet, fitted to the years so far',
    hint: 'No spare rows. Reprinted each year, with the text a little smaller each time. Best for up to 4 columns.',
  },
];

/** True for one of the layouts above — used to check what comes back from the database or a form. */
export function isBoardLayout(value: unknown): value is BoardLayout {
  return BOARD_LAYOUTS.some((l) => l.value === value);
}

/** The admin label for a layout. */
export function layoutLabel(layout: BoardLayout): string {
  const match = BOARD_LAYOUTS.find((l) => l.value === layout);
  return match ? match.label : layout;
}

export interface HonoursBoardColumn {
  field: string;
  heading: string;
  // Relative width: 1 suits a single name, ~1.5 a pair, ~2 a triple
  width: number;
}

export interface HonoursBoard {
  id: string;
  name: string;
  displayOrder: number;
  layout: BoardLayout;
  columns: HonoursBoardColumn[];
}

/** A board as entered in the admin form (everything but the id). */
export type HonoursBoardInput = Omit<HonoursBoard, 'id'>;

export const MAX_COLUMNS = 16;
export const MIN_COLUMN_WIDTH = 0.5;
export const MAX_COLUMN_WIDTH = 5;

/** Checks a board makes sense; returns an error message or null. */
export function validateBoard(board: HonoursBoardInput): string | null {
  if (!board.name || !board.name.trim()) return 'Name is required';
  if (!Number.isInteger(board.displayOrder)) return 'Order must be a whole number';
  if (!isBoardLayout(board.layout)) return 'Choose a layout';
  if (!Array.isArray(board.columns) || board.columns.length === 0) return 'Add at least one column';
  if (board.columns.length > MAX_COLUMNS) return `A board can have at most ${MAX_COLUMNS} columns`;

  const seen = new Set<string>();
  // Check each column in turn, numbering them from 1 for the message
  for (let i = 0; i < board.columns.length; i++) {
    const col = board.columns[i];
    const n = i + 1;
    if (!HONOURS_BOARD_FIELDS.some((f) => f.field === col.field)) return `Column ${n}: choose a competition`;
    if (seen.has(col.field)) return `${fieldLabel(col.field)} is on this board twice`;
    seen.add(col.field);
    if (!col.heading || !col.heading.trim()) return `Column ${n}: heading is required`;
    if (col.heading.trim().length > 40) return `Column ${n}: heading must be 40 characters or fewer`;
    if (!Number.isFinite(col.width) || col.width < MIN_COLUMN_WIDTH || col.width > MAX_COLUMN_WIDTH) {
      return `Column ${n}: width must be between ${MIN_COLUMN_WIDTH} and ${MAX_COLUMN_WIDTH}`;
    }
  }
  return null;
}

// ── Sheet measurements ──
// The base measurements are for an A3 landscape sheet. A2 is the same layout scaled up by
// √2 (A-sizes keep their proportions); the side-by-side A3 portrait sheets use the A2
// scale for text and rows too, so every two-sheet board prints at the same size.

const MM = 72 / 25.4; // points per millimetre
const SQRT2 = Math.SQRT2;

export const SHEET_MARGIN_MM = 10;
export const HEADER_H_MM = 12;
const A3_LONG_MM = 420;
const A3_SHORT_MM = 297;
const TITLE_TARGET_MM = 50;
const TITLE_MIN_MM = 30;

// Names fill this share of the row height: the fonts need about 1.3× their size for
// letters with descenders (g, y, p), so this is as large as a name can go without its
// descenders running into the next row. At A2 that's about 21pt — the same apparent size
// as the 24pt Times on the Blizzard Graphics boards, since Times is small for its size.
const NAME_FILL = 0.76;
const MAX_NAME_PT = 28;

/** Below this a single-sheet board is getting hard to read, and the print page says so. */
export const MIN_READABLE_PT = 11;

/** Standard name size (pt) for a printed row height (mm), before long names are shrunk to fit. */
export function namePointSize(rowHeightMm: number): number {
  return Math.min(MAX_NAME_PT, rowHeightMm * MM * NAME_FILL);
}

interface StackedSplit {
  topYears: number;     // rows on the top sheet, under the title and headings
  bottomYears: number;  // rows on the bottom sheet
  rowHeightMm: number;  // shared by both sheets (A3 base measurement)
  titleHeightMm: number; // title area on the top sheet, above the headings (A3 base measurement)
}

/** Stacked layout: splits a set's years between top and bottom sheets so both share one row height. */
function stackedSplit(yearsPerSet: number): StackedSplit {
  const usable = A3_SHORT_MM - SHEET_MARGIN_MM * 2;
  // Row height if the title were exactly its target height, then the nearest whole number of bottom rows
  const idealRow = (usable * 2 - TITLE_TARGET_MM - HEADER_H_MM) / yearsPerSet;
  let bottomYears = Math.min(yearsPerSet - 1, Math.max(1, Math.round(usable / idealRow)));
  let rowHeightMm = usable / bottomYears;
  let titleHeightMm = usable - HEADER_H_MM - (yearsPerSet - bottomYears) * rowHeightMm;
  // Too little room for the title: move years onto the bottom sheet until there is
  while (titleHeightMm < TITLE_MIN_MM && bottomYears < yearsPerSet - 1) {
    bottomYears++;
    rowHeightMm = usable / bottomYears;
    titleHeightMm = usable - HEADER_H_MM - (yearsPerSet - bottomYears) * rowHeightMm;
  }
  return { topYears: yearsPerSet - bottomYears, bottomYears, rowHeightMm, titleHeightMm };
}

interface SideBySideSplit {
  leftYears: number;
  rightYears: number;
  rowHeightMm: number;   // as printed
  titleHeightMm: number; // as printed, left sheet only
}

/**
 * Side-by-side layout: two A3 portrait sheets at the same row spacing as the stacked A2
 * boards. The left sheet has the title and headings, the right sheet headings only, so the
 * right sheet holds more years.
 */
function sideBySideSplit(yearsPerSet: number): SideBySideSplit {
  const usable = A3_LONG_MM - SHEET_MARGIN_MM * 2;
  const header = HEADER_H_MM * SQRT2;
  const rowHeightMm = stackedSplit(yearsPerSet).rowHeightMm * SQRT2;
  // As many rows on the left as leave about the target title height, but never less than the minimum
  let leftYears = Math.max(1, Math.round((usable - header - TITLE_TARGET_MM * SQRT2) / rowHeightMm));
  while (leftYears > 1 && usable - header - leftYears * rowHeightMm < TITLE_MIN_MM * SQRT2) leftYears--;
  const rightYears = Math.max(1, Math.floor((usable - header) / rowHeightMm));
  return { leftYears, rightYears, rowHeightMm, titleHeightMm: usable - header - leftYears * rowHeightMm };
}

/** Years on the first and second sheet of a set, for the two-sheet layouts. */
export function twoSheetSplit(layout: BoardLayout, yearsPerSet: number): { firstYears: number; secondYears: number } {
  if (layout === 'side_by_side') {
    const split = sideBySideSplit(yearsPerSet);
    return { firstYears: split.leftYears, secondYears: split.rightYears };
  }
  const split = stackedSplit(yearsPerSet);
  return { firstYears: split.topYears, secondYears: split.bottomYears };
}

/** Checks the shared settings; returns an error message or null. */
export function validateSheetSettings(startYear: number, yearsPerSet: number): string | null {
  if (!Number.isInteger(startYear) || startYear < 1900 || startYear > 2200) return 'Start year must be a year, e.g. 1976';
  if (!Number.isInteger(yearsPerSet) || yearsPerSet < 20 || yearsPerSet > 90) return 'Years per set must be a whole number from 20 to 90';
  return null;
}

export type SheetPosition = 'Top' | 'Bottom' | 'Left' | 'Right' | 'Single';

/** One printed sheet: a block of years, and where it hangs. */
export interface BoardSheet {
  set: number;               // 1 = the first pair of sheets, 2 = the pair added when that fills
  position: SheetPosition;
  firstYear: number;
  lastYear: number;
}

/**
 * The sheet a year belongs on, or null if it's before the start year.
 * A single-sheet board has one sheet, running from the start year to `year`.
 */
export function sheetForYear(year: number, startYear: number, layout: BoardLayout, yearsPerSet: number): BoardSheet | null {
  if (year < startYear || !Number.isInteger(yearsPerSet) || yearsPerSet < 2) return null;
  if (layout === 'single') return { set: 1, position: 'Single', firstYear: startYear, lastYear: year };

  const { firstYears, secondYears } = twoSheetSplit(layout, yearsPerSet);
  const setLength = firstYears + secondYears;
  // Which set (numbered from 0), and where in it this year falls
  const setIndex = Math.floor((year - startYear) / setLength);
  const setFirstYear = startYear + setIndex * setLength;
  const onFirst = year - setFirstYear < firstYears;
  const names: [SheetPosition, SheetPosition] = layout === 'side_by_side' ? ['Left', 'Right'] : ['Top', 'Bottom'];
  return {
    set: setIndex + 1,
    position: onFirst ? names[0] : names[1],
    firstYear: onFirst ? setFirstYear : setFirstYear + firstYears,
    lastYear: onFirst ? setFirstYear + firstYears - 1 : setFirstYear + setLength - 1,
  };
}

/** Every sheet from the start year up to and including the one holding `upToYear`. */
export function sheetsUpTo(upToYear: number, startYear: number, layout: BoardLayout, yearsPerSet: number): BoardSheet[] {
  const sheets: BoardSheet[] = [];
  // Without a sensible set size the loop below would never advance
  if (!Number.isInteger(yearsPerSet) || yearsPerSet < 2) return sheets;
  if (layout === 'single') {
    const only = sheetForYear(upToYear, startYear, layout, yearsPerSet);
    return only ? [only] : sheets;
  }
  // Step from sheet to sheet: each one starts the year after the previous one ends
  let year = startYear;
  while (year <= upToYear) {
    const sheet = sheetForYear(year, startYear, layout, yearsPerSet);
    if (!sheet) break;
    sheets.push(sheet);
    year = sheet.lastYear + 1;
  }
  return sheets;
}

/** Everything needed to draw one sheet, in printed millimetres and points. */
export interface SheetGeometry {
  paper: 'A2' | 'A3';
  orientation: 'landscape' | 'portrait';
  widthMm: number;
  heightMm: number;
  marginMm: number;
  scale: number;          // title, headings and year column, relative to the A3 base sizes
  titleHeightMm: number;  // 0 = no title on this sheet
  headerHeightMm: number; // 0 = no column headings on this sheet
  rowHeightMm: number;
  namePt: number;         // standard name size, before long names are shrunk to fit
}

/** Page size and measurements for one sheet of a board. */
export function sheetGeometry(layout: BoardLayout, sheet: BoardSheet, yearsPerSet: number): SheetGeometry {
  if (layout === 'stacked') {
    const split = stackedSplit(yearsPerSet);
    const isTop = sheet.position === 'Top';
    const rowHeightMm = split.rowHeightMm * SQRT2;
    return {
      paper: 'A2', orientation: 'landscape', widthMm: A3_LONG_MM * SQRT2, heightMm: A3_SHORT_MM * SQRT2,
      marginMm: SHEET_MARGIN_MM * SQRT2, scale: SQRT2,
      titleHeightMm: isTop ? split.titleHeightMm * SQRT2 : 0,
      headerHeightMm: isTop ? HEADER_H_MM * SQRT2 : 0,
      rowHeightMm, namePt: namePointSize(rowHeightMm),
    };
  }

  if (layout === 'side_by_side') {
    const split = sideBySideSplit(yearsPerSet);
    return {
      paper: 'A3', orientation: 'portrait', widthMm: A3_SHORT_MM, heightMm: A3_LONG_MM,
      marginMm: SHEET_MARGIN_MM, scale: SQRT2,
      titleHeightMm: sheet.position === 'Left' ? split.titleHeightMm : 0,
      headerHeightMm: HEADER_H_MM * SQRT2,
      rowHeightMm: split.rowHeightMm, namePt: namePointSize(split.rowHeightMm),
    };
  }

  // Single sheet: every year so far shares whatever height the title and headings leave
  const years = Math.max(1, sheet.lastYear - sheet.firstYear + 1);
  const rowHeightMm = (A3_LONG_MM - SHEET_MARGIN_MM * 2 - TITLE_TARGET_MM - HEADER_H_MM) / years;
  return {
    paper: 'A3', orientation: 'portrait', widthMm: A3_SHORT_MM, heightMm: A3_LONG_MM,
    marginMm: SHEET_MARGIN_MM, scale: 1,
    titleHeightMm: TITLE_TARGET_MM, headerHeightMm: HEADER_H_MM,
    rowHeightMm, namePt: namePointSize(rowHeightMm),
  };
}
