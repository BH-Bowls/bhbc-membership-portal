// src/types/honours-external-board.ts
// The printed external honours board — county, national and other competitions the club's
// members have won or reached, from website.honours_external (several entries a year).
// Unlike the club boards (src/types/honours-boards.ts) it isn't one row per year: each entry
// is a row (Year · Competition · Winner/detail), the year shown on the first row of its year.
// The entries run on from sheet to sheet; the first sheet has the title, later ones a
// one-line "(continued)" title. Every sheet has the column headings, and all share one row
// height, set by how many rows the first sheet holds. Drawn by buildExternalHonoursPdf in
// src/lib/honours-board-pdf.tsx, in the club's board style.

import { HEADER_H_MM, SHEET_MARGIN_MM, namePointSize } from './honours-boards';
import type { LineSpacing } from './honours-boards';

/** One external result, as stored. */
export interface ExternalHonour {
  year: number;
  competition: string;
  detail: string | null;
}

export type ExternalPaper = 'a3_portrait' | 'a3_landscape' | 'a2_portrait';

export const EXTERNAL_PAPERS: { value: ExternalPaper; label: string }[] = [
  { value: 'a3_portrait', label: 'A3 portrait' },
  { value: 'a3_landscape', label: 'A3 landscape' },
  { value: 'a2_portrait', label: 'A2 portrait' },
];

export const DEFAULT_EXTERNAL_TITLE = 'County & National Honours';
export const MIN_EXTERNAL_ROWS = 10;
export const MAX_EXTERNAL_ROWS = 80;

/** A sensible number of rows on the first sheet, for each paper. */
export function defaultExternalRows(paper: ExternalPaper): number {
  if (paper === 'a3_landscape') return 18;
  if (paper === 'a2_portrait') return 40;
  return 28;
}

const TITLE_MM = 50;      // A3 base size
const CONT_TITLE_MM = 12; // A3 base size

/** Everything needed to draw the external board's sheets, in printed millimetres and points. */
export interface ExternalGeometry {
  paper: 'A2' | 'A3';
  orientation: 'portrait' | 'landscape';
  widthMm: number;
  heightMm: number;
  marginMm: number;
  scale: number;            // title, headings and year column, relative to the A3 base sizes
  titleHeightMm: number;    // first sheet
  contTitleHeightMm: number; // later sheets
  headerHeightMm: number;
  rowHeightMm: number;
  namePt: number;
  firstRows: number;        // rows on the first sheet
  laterRows: number;        // rows on each later sheet
}

export function externalGeometry(paper: ExternalPaper, rowsOnFirst: number, spacing: LineSpacing): ExternalGeometry {
  const isA2 = paper === 'a2_portrait';
  const s = isA2 ? Math.SQRT2 : 1;
  const widthMm = paper === 'a3_landscape' ? 420 : isA2 ? 420 : 297;
  const heightMm = paper === 'a3_landscape' ? 297 : isA2 ? 594 : 420;
  const marginMm = SHEET_MARGIN_MM * s;
  const titleHeightMm = TITLE_MM * s;
  const contTitleHeightMm = CONT_TITLE_MM * s;
  const headerHeightMm = HEADER_H_MM * s;
  const usable = heightMm - marginMm * 2;
  const rows = Math.min(MAX_EXTERNAL_ROWS, Math.max(MIN_EXTERNAL_ROWS, Math.round(rowsOnFirst)));
  const rowHeightMm = (usable - titleHeightMm - headerHeightMm) / rows;
  const laterRows = Math.max(1, Math.floor((usable - contTitleHeightMm - headerHeightMm) / rowHeightMm));
  return {
    paper: isA2 ? 'A2' : 'A3',
    orientation: paper === 'a3_landscape' ? 'landscape' : 'portrait',
    widthMm, heightMm, marginMm, scale: s,
    titleHeightMm, contTitleHeightMm, headerHeightMm,
    rowHeightMm, namePt: namePointSize(rowHeightMm, spacing),
    firstRows: rows, laterRows,
  };
}

/** One printed row: the year is blank on all but the first row of a year. */
export interface ExternalRow {
  year: number;
  showYear: boolean;
  competition: string;
  detail: string;
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
    });
    lastYear = e.year;
  }
  return rows;
}

/**
 * Splits the rows into sheets. A year's entries are kept together on one sheet where they
 * fit, so a year doesn't start at the foot of one sheet and carry on at the top of the
 * next; a year that moves on gets its year shown again at the top of the new sheet.
 * There's always at least one sheet; the last one is filled out with blank rows when drawn.
 */
export function externalSheets(rows: ExternalRow[], g: ExternalGeometry): ExternalRow[][] {
  const sheets: ExternalRow[][] = [[]];
  let i = 0;
  while (i < rows.length) {
    // This year's entries, from row i
    let end = i;
    while (end < rows.length && rows[end].year === rows[i].year) end++;
    const group = rows.slice(i, end);
    let current = sheets[sheets.length - 1];
    let room = (sheets.length === 1 ? g.firstRows : g.laterRows) - current.length;
    // Move the whole year on to a new sheet if it would split and would fit there
    if (group.length > room && current.length > 0 && group.length <= g.laterRows) {
      current = [];
      sheets.push(current);
      room = g.laterRows;
    }
    for (let k = 0; k < group.length; k++) {
      if (room === 0) {
        current = [];
        sheets.push(current);
        room = g.laterRows;
      }
      // The year is shown on the first row of a year on each sheet
      current.push({ ...group[k], showYear: k === 0 || current.length === 0 });
      room--;
    }
    i = end;
  }
  return sheets;
}
