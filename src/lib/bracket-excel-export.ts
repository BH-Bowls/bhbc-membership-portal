// src/lib/bracket-excel-export.ts
// Builds an .xlsx workbook rendering a competition bracket as boxes + connector lines —
// replaces sheet-export.ts (which wrote the same diagram into a Google Sheet tab via
// COMPETITIONS_SPREADSHEET_ID). All bracket geometry (match/connector positions) is
// unchanged from that version; only the rendering calls differ (exceljs cell-by-cell
// border/fill/merge instead of Google Sheets batchUpdate requests).
//
// Column layout:
//   col 0               : spare left margin (same width as connector cols)
//   col 1 + 4*ri        : match boxes for round ri
//   col 1 + 4*ri+1      : connector col A — left stub  (BOTTOM border at child divider row)
//   col 1 + 4*ri+2      : connector col B — vertical   (LEFT border; starts at child stub level)
//   col 1 + 4*ri+3      : connector col C — right stub (BOTTOM border at parent divider row)
//
// Row layout:
//   Row 0               : competition title (bold, merged across all match columns)
//   Row 1               : round headers (bold, centred)
//   Row 2               : play-by dates ("Play by dd/mm/yy", or just date for Final)
//   Row 3               : spare blank row (8 px)
//   Rows 4+             : firstRoundCount × rowsPerSlot bracket rows
//
// Connector alignment:
//   dividerRow = last row of side1 in match box.
//   A bottom border on row R draws a horizontal line between rows R and R+1.
//   The vertical's left border starts at sr(vTop)+1 so it meets the top stub exactly.

import ExcelJS from 'exceljs';
import type { Competition, CompMatch, CompMemberInfo, CompRound } from '@/types/competitions';
import { ROUND_ORDER, COMP_ROUND_LABELS } from '@/types/competitions';
import type { SheetExportConfig } from './sheet-export-config';
export type { SheetExportConfig } from './sheet-export-config';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toArgb(hex: string): string {
  return 'FF' + hex.replace('#', '').toUpperCase();
}

const BLACK_ARGB = 'FF262626';
const GRAY_ARGB = 'FF8C8C8C';

type BorderStyle = 'thin' | 'medium' | 'thick' | 'double';

function lineStyleToExcel(style: SheetExportConfig['lineStyle']): BorderStyle {
  if (style === 'SOLID_THICK') return 'thick';
  if (style === 'SOLID_MEDIUM') return 'medium';
  return 'thin';
}

function inferFirstRoundCount(matches: CompMatch[]): number {
  // Use ALL matches (including bye matches) so the bracket geometry is always
  // derived from the full draw size, not just visible entries.
  const firstRound = matches.filter(m => m.round === 'R1' || m.round === 'Prelim');
  const pool = firstRound.length > 0 ? firstRound : matches;
  if (pool.length === 0) return 2;
  const maxPos = Math.max(...pool.map(m => m.position));
  let p = 1;
  while (p < maxPos) p *= 2;
  return p;
}

/**
 * When exportPrelimByes=false the bracket still has a Prelim round (because some
 * Prelim matches are real), but some R1 slots have BOTH their Prelim children
 * hidden (byes).  Those R1 slots should collapse to rowsPerSlot instead of the
 * normal 2×rowsPerSlot.  All higher rounds derive their sizes recursively.
 *
 * Returns a Map<matchId, {slotStart, slotTotal}> to override the uniform formula,
 * or null when the uniform formula is already correct (exportPrelimByes=true, or
 * Prelim is completely absent from the layout).
 */
function buildVariableSlotMap(
  allMatches: CompMatch[],
  layoutMatches: CompMatch[],
  presentRounds: CompRound[],
  config: SheetExportConfig,
): Map<string, { slotStart: number; slotTotal: number }> | null {
  // Only needed when hiding prelim byes AND Prelim is still the first round
  // (i.e. some real Prelim matches remain in layoutMatches).
  if (config.exportPrelimByes || presentRounds[0] !== 'Prelim') return null;

  const map = new Map<string, { slotStart: number; slotTotal: number }>();

  // Visible Prelim matches (not filtered out as byes)
  const visPrelim = new Map<number, CompMatch>();
  for (const m of layoutMatches) {
    if (m.round === 'Prelim') visPrelim.set(m.position, m);
  }

  // Compute per-position slot info so higher rounds can derive their sizes.
  let prevRoundSlots = new Map<number, { start: number; total: number }>();

  // ── Prelim + R1 ────────────────────────────────────────────────────────────
  const r1Max = Math.max(
    ...layoutMatches.filter(m => m.round === 'R1').map(m => m.position),
    0,
  );
  let cursor = 0;
  for (let r1Pos = 1; r1Pos <= r1Max; r1Pos++) {
    const p1 = 2 * r1Pos - 1;
    const p2 = 2 * r1Pos;
    const m1 = visPrelim.get(p1);
    const m2 = visPrelim.get(p2);
    const s1 = m1 ? config.rowsPerSlot : 0;
    const s2 = m2 ? config.rowsPerSlot : 0;
    // R1 slot collapses to rowsPerSlot when both Prelim children are hidden byes.
    const groupTotal = Math.max(s1 + s2, config.rowsPerSlot);

    if (m1) map.set(m1.matchId, { slotStart: cursor,      slotTotal: config.rowsPerSlot });
    if (m2) map.set(m2.matchId, { slotStart: cursor + s1, slotTotal: config.rowsPerSlot });

    const r1m = layoutMatches.find(m => m.round === 'R1' && m.position === r1Pos);
    if (r1m) map.set(r1m.matchId, { slotStart: cursor, slotTotal: groupTotal });

    prevRoundSlots.set(r1Pos, { start: cursor, total: groupTotal });
    cursor += groupTotal;
  }

  // ── Higher rounds: each match spans two children from the previous round ──
  for (let ri = 2; ri < presentRounds.length; ri++) {
    const round = presentRounds[ri];
    const roundMatches = layoutMatches
      .filter(m => m.round === round)
      .sort((a, b) => a.position - b.position);
    const nextSlots = new Map<number, { start: number; total: number }>();
    for (const m of roundMatches) {
      const c1 = prevRoundSlots.get(2 * m.position - 1);
      const c2 = prevRoundSlots.get(2 * m.position);
      const start = c1?.start ?? c2?.start ?? 0;
      const total = (c1?.total ?? 0) + (c2?.total ?? 0);
      map.set(m.matchId, { slotStart: start, slotTotal: total });
      nextSlots.set(m.position, { start, total });
    }
    prevRoundSlots = nextSlots;
  }

  return map;
}

// Convert content row (0-indexed, after title+header+dates+blank) → 0-indexed sheet row index.
// Sheet row 0 = title, row 1 = round headers, row 2 = play-by dates, row 3 = blank, rows 4+ = bracket content.
function sr(contentRow: number) { return contentRow + 4; }

function formatPlayByDate(dateStr: string | null | undefined, isFinal: boolean): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day) return '';
  const formatted = `${day}/${month}/${year.slice(2)}`;
  return isFinal ? formatted : `Play by ${formatted}`;
}

function getRoundPlayByDate(round: CompRound, competition: Competition): string | null | undefined {
  switch (round) {
    case 'Prelim': return competition.prelimPlayBy;
    case 'R1':     return competition.r1PlayBy;
    case 'R2':     return competition.r2PlayBy;
    case 'QF':     return competition.qfPlayBy;
    case 'SF':     return competition.sfPlayBy;
    case 'F':      return competition.finalsDate;
  }
}

// ── Worksheet border helpers ────────────────────────────────────────────────
// All take 0-indexed row/col (Google-Sheets-range style, end exclusive) and translate
// to exceljs's 1-indexed getCell, merging onto whatever border the cell already has
// rather than overwriting it (multiple box/connector edges can land on the same cell).

function mergeBorder(cell: ExcelJS.Cell, edges: Partial<Record<'top' | 'bottom' | 'left' | 'right', { style: BorderStyle; argb: string }>>) {
  const existing = cell.border || {};
  const next: Partial<ExcelJS.Borders> = { ...existing };
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const e = edges[side];
    if (e) next[side] = { style: e.style, color: { argb: e.argb } };
  }
  cell.border = next;
}

function setBottomBorderRange(ws: ExcelJS.Worksheet, row0: number, colStart0: number, colEnd0: number, style: BorderStyle, argb: string) {
  const excelRow = row0 + 1;
  for (let c = colStart0; c < colEnd0; c++) {
    mergeBorder(ws.getCell(excelRow, c + 1), { bottom: { style, argb } });
  }
}

function setLeftBorderRange(ws: ExcelJS.Worksheet, rowStart0: number, rowEnd0: number, col0: number, style: BorderStyle, argb: string) {
  const excelCol = col0 + 1;
  for (let r = rowStart0; r < rowEnd0; r++) {
    mergeBorder(ws.getCell(r + 1, excelCol), { left: { style, argb } });
  }
}

// Single-column box border: left+right on every row, top on the first row, bottom on the last.
function setBoxBorder(ws: ExcelJS.Worksheet, rowStart0: number, rowEnd0: number, col0: number, style: BorderStyle, argb: string) {
  const excelCol = col0 + 1;
  for (let r = rowStart0; r < rowEnd0; r++) {
    const edges: Parameters<typeof mergeBorder>[1] = { left: { style, argb }, right: { style, argb } };
    if (r === rowStart0) edges.top = { style, argb };
    if (r === rowEnd0 - 1) edges.bottom = { style, argb };
    mergeBorder(ws.getCell(r + 1, excelCol), edges);
  }
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim();
  return (cleaned || 'Bracket').slice(0, 31);
}

// ── Main export function ──────────────────────────────────────────────────────

export async function buildBracketWorkbook(
  competition: Competition,
  matches: CompMatch[],
  memberInfo: Map<string, CompMemberInfo>,
  config: SheetExportConfig,
): Promise<Uint8Array> {
  const matchStyle = lineStyleToExcel(config.lineStyle);
  const connStyle = lineStyleToExcel(config.lineStyle);

  // When prelim byes are suppressed, exclude them from layout calculations entirely.
  // This means: if all prelim matches are byes the Prelim column disappears and R1
  // gets full rowsPerSlot spacing; if some prelim matches are real, the Prelim column
  // remains but byes are simply not drawn.
  const layoutMatches = config.exportPrelimByes
    ? matches
    : matches.filter(m => !(m.round === 'Prelim' && m.status === 'Bye'));

  const presentRounds = ROUND_ORDER.filter(r =>
    layoutMatches.some(m => m.round === r)
  ) as CompRound[];

  if (presentRounds.length === 0) throw new Error('No matches found for this competition');

  // firstRoundCount always derived from the FULL match list so bracket geometry
  // (column alignments, slot ratios) is based on the complete draw size.
  const firstRoundCount = inferFirstRoundCount(matches);

  // Variable-slot map: overrides uniform slotStart/slotTotal for each match when
  // exportPrelimByes=false and some Prelim byes have been filtered out.
  const variableSlots = buildVariableSlotMap(matches, layoutMatches, presentRounds, config);

  const condensed = config.connectorColWidthPx === 0;

  const rowsPerSide = (competition.compType !== 'singles' && config.nameFormat === 'separate-rows')
    ? (competition.compType === 'triples' ? 3 : 2)
    : 1;
  const matchBoxRows = 2 * rowsPerSide;

  const numRounds   = presentRounds.length;
  const colOffset   = 1; // spare column A before the first match column
  // 3 connector cols between each pair of rounds + 1 spare col at left
  const numCols     = colOffset + (numRounds === 1 ? 1 : 4 * numRounds - 3);

  // ── Date-based column positioning ────────────────────────────────────────
  // Matches whose playByDate matches an earlier round's play-by date are shifted
  // into that round's column, mirroring the BracketView date-column feature.

  const dateToRoundIndex = new Map<string, number>();
  presentRounds.forEach((round, ri) => {
    const d = getRoundPlayByDate(round, competition);
    if (d && !dateToRoundIndex.has(d)) dateToRoundIndex.set(d, ri);
  });

  function getEffectiveRoundIndex(match: CompMatch, naturalRoundIndex: number): number {
    const d = match.playByDate ?? getRoundPlayByDate(match.round as CompRound, competition);
    if (!d) return naturalRoundIndex;
    const ri = dateToRoundIndex.get(d);
    return ri !== undefined ? ri : naturalRoundIndex;
  }

  // ── Compute match positions ───────────────────────────────────────────────

  interface MatchPos {
    match: CompMatch;
    roundIndex: number;
    matchCol: number;   // includes colOffset; may differ from default when date-shifted
    boxStartRow: number;
    boxEndRow:   number;
    dividerRow:  number;
    side1Row:    number; // content row where side1 text begins
    side2Row:    number; // content row where side2 text begins
  }

  const matchPositions: MatchPos[] = [];

  presentRounds.forEach((round, roundIndex) => {
    const roundMatches = layoutMatches
      .filter(m => m.round === round)
      .sort((a, b) => a.position - b.position);

    const isFirstRound  = roundIndex === 0;
    const maxPosInRound = Math.max(...roundMatches.map(m => m.position));
    const slotsPerMatch = isFirstRound ? 1 : firstRoundCount / maxPosInRound;

    roundMatches.forEach(match => {
      // Each match may land in an earlier column if its playByDate matches
      // that round's date. Bye matches are never date-shifted — they always
      // belong in their natural round column so connector calculations stay correct.
      const effectiveRoundIndex = match.status === 'Bye'
        ? roundIndex
        : getEffectiveRoundIndex(match, roundIndex);
      const matchCol = colOffset + 4 * effectiveRoundIndex;

      const p = match.position;
      const vs = variableSlots?.get(match.matchId);
      const slotStart = vs ? vs.slotStart : (p - 1) * slotsPerMatch * config.rowsPerSlot;
      const slotTotal = vs ? vs.slotTotal : slotsPerMatch * config.rowsPerSlot;

      let boxStartRow: number, boxEndRow: number, dividerRow: number, side1Row: number, side2Row: number;

      if (condensed) {
        // Box fills the full slot; names sit either side of the midpoint divider
        const half = Math.floor(slotTotal / 2);
        boxStartRow = slotStart;
        boxEndRow   = slotStart + slotTotal - 1;
        dividerRow  = slotStart + half - 1;
        side1Row    = dividerRow - rowsPerSide + 1; // immediately above divider
        side2Row    = slotStart + half;              // immediately below divider
      } else {
        const boxStart = slotStart + Math.floor((slotTotal - matchBoxRows) / 2);
        const boxEnd   = boxStart + matchBoxRows - 1;
        boxStartRow = Math.max(slotStart, boxStart);
        boxEndRow   = Math.min(slotStart + slotTotal - 1, boxEnd);
        dividerRow  = boxStartRow + rowsPerSide - 1;
        side1Row    = boxStartRow;
        side2Row    = boxStartRow + rowsPerSide;
      }

      matchPositions.push({ match, roundIndex, matchCol, boxStartRow, boxEndRow, dividerRow, side1Row, side2Row });
    });
  });

  // ── Compute connector positions ───────────────────────────────────────────

  interface ConnectorPos {
    topConnColA:   number;
    botConnColA:   number;
    connColB:      number;
    connColC:      number;
    topConnRow:    number;
    botConnRow:    number;
    parentConnRow: number;
    isTopBye: boolean;
    isBotBye: boolean;
  }

  const connectorPositions: ConnectorPos[] = [];

  for (let ri = 0; ri < numRounds - 1; ri++) {
    const children = matchPositions.filter(mp => mp.roundIndex === ri);
    const parents  = matchPositions
      .filter(mp => mp.roundIndex === ri + 1)
      .sort((a, b) => a.match.position - b.match.position);

    for (const parent of parents) {
      const parentPos = parent.match.position;
      const top = children.find(c => c.match.position === 2 * parentPos - 1);
      const bot = children.find(c => c.match.position === 2 * parentPos);
      if (!top && !bot) continue;

      const isTopBye = !top || top.match.status === 'Bye';
      const isBotBye = !bot || bot.match.status === 'Bye';

      if (isTopBye && isBotBye && !config.exportPrelimByes) continue;

      const topMatchCol = (top ?? bot!).matchCol;
      const botMatchCol = (bot ?? top!).matchCol;
      const topConnColA = topMatchCol + 1;
      const botConnColA = botMatchCol + 1;
      const connColB = Math.max(topMatchCol, botMatchCol) + 2;
      const connColC = parent.matchCol - 1;

      const topConnRow = top?.dividerRow ?? parent.dividerRow;
      const botConnRow = bot?.dividerRow ?? parent.dividerRow;

      connectorPositions.push({
        topConnColA, botConnColA, connColB, connColC,
        topConnRow, botConnRow,
        parentConnRow: parent.dividerRow,
        isTopBye,
        isBotBye,
      });
    }
  }

  // ── Build the workbook ─────────────────────────────────────────────────────

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(sanitizeSheetName(competition.displayName), {
    views: [{ showGridLines: false }],
  });

  // Column widths — connector columns hidden when connectorColWidthPx is 0.
  // Google Sheets used pixelSize; exceljs width is roughly px/7 characters.
  const hideConnectors = config.connectorColWidthPx === 0;
  const connWidthPx = hideConnectors ? 0 : Math.max(1, Math.round(config.connectorColWidthPx / 3));
  for (let ci = 0; ci < numCols; ci++) {
    const isMatchCol = ci >= colOffset && (ci - colOffset) % 4 === 0;
    const isConnCol  = ci >= colOffset && !isMatchCol;
    const column = ws.getColumn(ci + 1);
    if (isConnCol && hideConnectors) {
      column.hidden = true;
    } else {
      column.width = (isMatchCol ? config.matchColWidthPx : connWidthPx) / 7;
    }
  }

  const lastMatchCol = colOffset + 4 * (numRounds - 1);

  // Row 0: competition title
  ws.getRow(1).height = 36 * 0.75;
  ws.mergeCells(1, colOffset + 1, 1, lastMatchCol + 1);
  const titleCell = ws.getCell(1, colOffset + 1);
  titleCell.value = competition.displayName;
  titleCell.font = { bold: true, size: 16 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 1: round header row height
  ws.getRow(2).height = 30 * 0.75;
  // Row 2: play-by dates
  ws.getRow(3).height = 18 * 0.75;
  // Row 3: blank separator
  ws.getRow(4).height = 8 * 0.75;

  // Round header + date cell formatting (match columns only)
  presentRounds.forEach((round, ri) => {
    const colIdx = colOffset + 4 * ri;
    const headerCell = ws.getCell(2, colIdx + 1);
    headerCell.value = COMP_ROUND_LABELS[round] ?? round;
    headerCell.font = { bold: true, size: 14 };
    headerCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const dateStr = formatPlayByDate(getRoundPlayByDate(round, competition), round === 'F');
    const dateCell = ws.getCell(3, colIdx + 1);
    if (dateStr) dateCell.value = dateStr;
    dateCell.font = { bold: false, size: 9 };
    dateCell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Double bottom border spanning all match columns (decorative rule under date row)
  setBottomBorderRange(ws, 2, colOffset, lastMatchCol + 1, 'double', BLACK_ARGB);

  // Match box borders + text
  function memberName(username: string): string {
    const info = memberInfo.get(username);
    if (!info) return username;
    return config.includeHandicap && info.handicap != null
      ? `${info.fullName} (${info.handicap})`
      : info.fullName;
  }

  function sideRows(usernames: string[], score: number | null | undefined): string[] {
    if (!usernames || usernames.length === 0) return Array(rowsPerSide).fill('TBD');
    const scoreStr = score != null ? `  ${score}` : '';
    if (rowsPerSide === 1) {
      return [`${usernames.map(memberName).join(' + ')}${scoreStr}`];
    }
    const rows = usernames.map(u => memberName(u));
    while (rows.length < rowsPerSide) rows.push('');
    rows[rowsPerSide - 1] += scoreStr;
    return rows.slice(0, rowsPerSide);
  }

  for (const mp of matchPositions) {
    const match = mp.match;
    if (match.status === 'Bye' && (!config.exportPrelimByes || match.round !== 'Prelim')) continue;

    const sRowStart = sr(mp.boxStartRow);
    const sRowEnd   = sr(mp.boxEndRow) + 1; // exclusive

    setBoxBorder(ws, sRowStart, sRowEnd, mp.matchCol, matchStyle, BLACK_ARGB);

    // Inner divider between side1 and side2
    setBottomBorderRange(ws, sr(mp.dividerRow), mp.matchCol, mp.matchCol + 1, 'thin', GRAY_ARGB);

    // Background fill + text format for every cell in the box
    const fillArgb = toArgb(match.position % 2 === 1 ? config.color1 : config.color2);
    for (let r = sRowStart; r < sRowEnd; r++) {
      const cell = ws.getCell(r + 1, mp.matchCol + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: config.nameFit === 'wrap' };
      cell.font = { size: 10 };
    }

    // Values
    const isComplete = match.status === 'Complete' || match.status === 'Walkover';
    const s1 = sideRows(match.side1Usernames, isComplete ? match.score1 : null);
    const s2Usernames = match.status === 'Bye' ? ['Bye'] : (match.side2Usernames ?? []);
    const s2 = sideRows(s2Usernames, isComplete ? match.score2 : null);

    s1.forEach((text, i) => {
      if (text) ws.getCell(sr(mp.side1Row) + i + 1, mp.matchCol + 1).value = text;
    });
    s2.forEach((text, i) => {
      if (text) ws.getCell(sr(mp.side2Row) + i + 1, mp.matchCol + 1).value = text;
    });
  }

  // Connector borders — skipped when connector columns are hidden
  //
  // BOTTOM border on row R = horizontal line at the BOTTOM of sheet row R (= top of row R+1).
  // LEFT border on range [rowStart, rowEnd) = vertical line on left edge of that range.
  //
  // Alignment rule:
  //   Child stub: BOTTOM on sr(childRow)   → line at bottom of sr(childRow)
  //   Vertical:   LEFT  from sr(vTop)+1 to sr(vBot)+1  → starts at SAME level as top stub
  //   Parent stub: BOTTOM on sr(parentRow) → enters parent match at divider level

  if (!hideConnectors) for (const cp of connectorPositions) {
    if (!cp.isTopBye && !cp.isBotBye || cp.isTopBye && cp.isBotBye) {
      // Full connector: both children present (either both real, or both exported byes)

      setBottomBorderRange(ws, sr(cp.topConnRow), cp.topConnColA, cp.connColB, connStyle, GRAY_ARGB);
      setBottomBorderRange(ws, sr(cp.botConnRow), cp.botConnColA, cp.connColB, connStyle, GRAY_ARGB);

      // Vertical spanning all three rows (top child, bot child, parent). startRowIndex +1
      // so the left border starts at the bottom of vTop row (= stub level).
      const vTop = Math.min(cp.topConnRow, cp.botConnRow, cp.parentConnRow);
      const vBot = Math.max(cp.topConnRow, cp.botConnRow, cp.parentConnRow);
      setLeftBorderRange(ws, sr(vTop) + 1, sr(vBot) + 1, cp.connColB, connStyle, GRAY_ARGB);

      setBottomBorderRange(ws, sr(cp.parentConnRow), cp.connColB, cp.connColC + 1, connStyle, GRAY_ARGB);

    } else {
      // Bye: one child directly to parent
      const childRow      = cp.isTopBye ? cp.botConnRow  : cp.topConnRow;
      const childConnColA = cp.isTopBye ? cp.botConnColA : cp.topConnColA;

      setBottomBorderRange(ws, sr(childRow), childConnColA, cp.connColB, connStyle, GRAY_ARGB);

      const vTop = Math.min(childRow, cp.parentConnRow);
      const vBot = Math.max(childRow, cp.parentConnRow);
      if (vTop < vBot) {
        setLeftBorderRange(ws, sr(vTop) + 1, sr(vBot) + 1, cp.connColB, connStyle, GRAY_ARGB);
      }

      setBottomBorderRange(ws, sr(cp.parentConnRow), cp.connColB, cp.connColC + 1, connStyle, GRAY_ARGB);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
