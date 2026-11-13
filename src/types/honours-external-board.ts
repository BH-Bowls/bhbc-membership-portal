// src/types/honours-external-board.ts
// The printed external honours board — county, national and other competitions the club's
// members have won or reached, from website.honours_external (several entries a year).
//
// It uses the club boards' layouts, sheet sizes, title and heading sizes and row spacing
// (sheetForYear / sheetGeometry in src/types/honours-boards.ts, with the print page's row
// control and line spacing), so it hangs alongside them at the same size. The difference is
// what a row holds: not a year, but one line of an entry (Year · Competition · Winners). The
// year shows on an entry's first line, on the first entry of its year. A competition or
// winners too long for its column wraps onto further lines, each a row high.
//
// Every sheet says what it is: a sheet the club boards print without a title or headings
// (the bottom of a stacked pair, the right of a side-by-side pair) gets a one-line
// "(continued)" title and the headings here, like the A3 sheet of the A2-plus-A3 layout,
// and holds a few fewer rows to make room (externalGeometry).
//
// Sheets are worked out in "row numbers": sheetForYear(n, 1, layout, rowControl) gives the
// order of the sheets and where each hangs; how many rows each holds comes from its
// geometry (externalCapacity). The entries fill the sheets in order, a year's entries kept
// together where they fit. A single-sheet layout is fitted to however many rows the
// entries need. Drawn by buildExternalHonoursPdf
// in src/lib/honours-board-pdf.tsx, in the club's board style.

import { HEADER_H_MM, sheetForYear, sheetGeometry } from './honours-boards';
import type { BoardLayout, BoardSheet, LineSpacing, SheetGeometry } from './honours-boards';

// A continuation sheet's one-line title (mm, A3 base size)
const CONT_TITLE_MM = 10;

/** A sheet's measurements on the external board: the club board's, with a title and headings on every sheet. */
export function externalGeometry(layout: BoardLayout, sheet: BoardSheet, rowControl: number, spacing: LineSpacing): SheetGeometry {
  const g = sheetGeometry(layout, sheet, rowControl, spacing);
  if (g.titleHeightMm > 0 || g.contTitleHeightMm > 0) {
    return g.headerHeightMm > 0 ? g : { ...g, headerHeightMm: HEADER_H_MM * g.scale };
  }
  return { ...g, contTitleHeightMm: CONT_TITLE_MM * g.scale, headerHeightMm: HEADER_H_MM * g.scale };
}

/** Rows a sheet of the external board holds, once its title and headings are in. */
export function externalCapacity(layout: BoardLayout, sheet: BoardSheet, rowControl: number): number {
  if (layout === 'single') return sheet.lastYear - sheet.firstYear + 1;
  const g = externalGeometry(layout, sheet, rowControl, 'snug');
  const room = g.heightMm - g.marginYMm * 2 - g.titleHeightMm - g.contTitleHeightMm - g.headerHeightMm;
  // A hair of slack, so a sheet the club board fills exactly isn't a row short from rounding
  return Math.max(1, Math.floor(room / g.rowHeightMm + 1e-6));
}

/** One external result, as stored. */
export interface ExternalHonour {
  year: number;
  competition: string;
  detail: string | null;
}

export const DEFAULT_EXTERNAL_TITLE = 'County & National Honours';

/** One printed entry: the year is blank on all but the first entry of a year. */
export interface ExternalRow {
  year: number;
  showYear: boolean;
  competition: string;
  detail: string;
  // Filled in when it's measured for printing (src/lib/honours-board-pdf.tsx): the text as
  // printed, line by line, and the size it prints at. lines = rows it takes (1 until measured).
  competitionLines?: string[];
  detailLines?: string[];
  textPt?: number;
  lines: number;
}

/** One sheet of the external board: where it sits (in row numbers) and the entries on it. */
export interface ExternalSheet {
  sheet: BoardSheet;
  rows: ExternalRow[];
}

/** The entries in print order — oldest year first, then by competition. */
export function externalRows(entries: ExternalHonour[], fromYear: number, toYear: number): ExternalRow[] {
  const chosen: ExternalHonour[] = [];
  for (const e of entries) {
    if (e.year >= fromYear && e.year <= toYear) chosen.push(e);
  }
  chosen.sort((a, b) => a.year - b.year || a.competition.localeCompare(b.competition));
  const rows: ExternalRow[] = [];
  let lastYear = 0;
  for (const e of chosen) {
    rows.push({
      year: e.year,
      showYear: e.year !== lastYear,
      competition: e.competition.trim(),
      detail: e.detail ? e.detail.trim() : '',
      lines: 1,
    });
    lastYear = e.year;
  }
  return rows;
}

/** Rows taken by some entries. */
export function rowsUsed(entries: ExternalRow[]): number {
  let n = 0;
  for (const e of entries) n += e.lines;
  return n;
}

/** The sheet after this one, in row numbers. */
function nextSheet(after: BoardSheet | null, layout: BoardLayout, rowControl: number): BoardSheet | null {
  return sheetForYear(after ? after.lastYear + 1 : 1, 1, layout, rowControl);
}

/** The single-sheet layout's only sheet, fitted to this many rows. */
export function singleSheet(rowCount: number): BoardSheet {
  return { set: 1, position: 'Single', firstYear: 1, lastYear: Math.max(1, rowCount) };
}

/**
 * Splits the (measured) entries into sheets, by the rows each takes. A year's entries are
 * kept together on one sheet where they fit, so a year doesn't start at the foot of one
 * sheet and carry on at the top of the next; a year that moves on shows its year again at
 * the top of the new sheet. There's always at least one sheet; each is filled out with
 * blank rows when drawn. A single-sheet layout puts everything on one sheet.
 */
export function externalSheets(rows: ExternalRow[], layout: BoardLayout, rowControl: number): ExternalSheet[] {
  if (layout === 'single') {
    const only: ExternalRow[] = [];
    for (let k = 0; k < rows.length; k++) only.push({ ...rows[k], showYear: k === 0 || rows[k].year !== rows[k - 1].year });
    return [{ sheet: singleSheet(rowsUsed(rows)), rows: only }];
  }
  const firstSheet = nextSheet(null, layout, rowControl);
  if (!firstSheet) return [];
  const sheets: ExternalSheet[] = [{ sheet: firstSheet, rows: [] }];
  let current = sheets[0];
  let room = externalCapacity(layout, current.sheet, rowControl);

  /** Starts the next sheet; false if there isn't one (shouldn't happen). */
  function newSheet(): boolean {
    const next = nextSheet(current.sheet, layout, rowControl);
    if (!next) return false;
    current = { sheet: next, rows: [] };
    sheets.push(current);
    room = externalCapacity(layout, next, rowControl);
    return true;
  }

  let i = 0;
  while (i < rows.length) {
    // This year's entries, from row i
    let end = i;
    while (end < rows.length && rows[end].year === rows[i].year) end++;
    const group = rows.slice(i, end);
    const groupRows = rowsUsed(group);
    // Move the whole year on to the next sheet if it would split and would fit there
    if (groupRows > room && current.rows.length > 0) {
      const next = nextSheet(current.sheet, layout, rowControl);
      if (next && groupRows <= externalCapacity(layout, next, rowControl) && !newSheet()) break;
    }
    for (let k = 0; k < group.length; k++) {
      if (group[k].lines > room && current.rows.length > 0 && !newSheet()) break;
      // The year is shown on the first entry of a year on each sheet
      current.rows.push({ ...group[k], showYear: k === 0 || current.rows.length === 0 });
      room -= group[k].lines;
    }
    i = end;
  }
  return sheets;
}
