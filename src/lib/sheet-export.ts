// src/lib/sheet-export.ts
// Exports a competition bracket to a Google Sheet tab in the competitions spreadsheet.
// Sheet name: sheet-{compId}  e.g. sheet-mens-championship
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
//   BOTTOM border on row R draws a horizontal line between sheet rows R and R+1.
//   Vertical LEFT border starts at sr(vTop)+1 so it meets the top stub exactly (not one row above).

import {
  getCompetitionsSpreadsheetId,
  getGoogleSheetsClient,
  getColumnLetter,
} from './sheets';
import type { Competition, CompMatch, CompMemberInfo, CompRound } from '@/types/competitions';
import { ROUND_ORDER, COMP_ROUND_LABELS } from '@/types/competitions';
import type { SheetExportConfig } from './sheet-export-config';
export type { SheetExportConfig } from './sheet-export-config';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return {
    red:   parseInt(h.slice(0, 2), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    blue:  parseInt(h.slice(4, 6), 16) / 255,
  };
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

// ── Main export function ──────────────────────────────────────────────────────

export async function exportBracketToSheet(
  compId: string,
  competition: Competition,
  matches: CompMatch[],
  memberInfo: Map<string, CompMemberInfo>,
  config: SheetExportConfig,
): Promise<{ sheetUrl: string; sheetTitle: string }> {

  const sheetsClient  = getGoogleSheetsClient();
  const spreadsheetId = getCompetitionsSpreadsheetId();
  const sheetTitle    = `sheet-${compId}`;
  const compType      = competition.compType;

  // Dynamic border styles (use config.lineStyle for boxes and connectors)
  const BLACK = { red: 0.15, green: 0.15, blue: 0.15 };
  const GRAY  = { red: 0.55, green: 0.55, blue: 0.55 };
  const MATCH_BORDER     = { style: config.lineStyle, colorStyle: { rgbColor: BLACK } };
  const DIVIDER_BORDER   = { style: 'SOLID',          colorStyle: { rgbColor: GRAY  } };
  const CONNECTOR_BORDER = { style: config.lineStyle, colorStyle: { rgbColor: GRAY  } };

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

  // hasPlayByDates is used only for date-based column shifting (separate concern from byes).
  const hasPlayByDates = presentRounds.some(r => !!getRoundPlayByDate(r as CompRound, competition));

  // firstRoundCount always derived from the FULL match list so bracket geometry
  // (column alignments, slot ratios) is based on the complete draw size.
  const firstRoundCount = inferFirstRoundCount(matches);

  // Variable-slot map: overrides uniform slotStart/slotTotal for each match when
  // exportPrelimByes=false and some Prelim byes have been filtered out.
  const variableSlots = buildVariableSlotMap(matches, layoutMatches, presentRounds, config);

  const condensed = config.connectorColWidthPx === 0;

  const rowsPerSide = (compType !== 'singles' && config.nameFormat === 'separate-rows')
    ? (compType === 'triples' ? 3 : 2)
    : 1;
  const matchBoxRows = 2 * rowsPerSide;

  const numRounds   = presentRounds.length;
  const colOffset   = 1; // spare column A before the first match column
  // 3 connector cols between each pair of rounds + 1 spare col at left
  const numCols     = colOffset + (numRounds === 1 ? 1 : 4 * numRounds - 3);

  // When variableSlots is active, contentRows comes from the maximum extent of any
  // match in the map; otherwise use the uniform formula.
  const contentRows = variableSlots !== null
    ? (() => {
        let max = 0;
        for (const { slotStart, slotTotal } of variableSlots.values()) {
          max = Math.max(max, slotStart + slotTotal);
        }
        return max;
      })()
    : firstRoundCount * config.rowsPerSlot;

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
    // Per-child: first column to the right of each child match box
    topConnColA:   number;
    botConnColA:   number;
    // Vertical column — placed right of the furthest-right child
    connColB:      number;
    // Last column before parent match box (parent stub ends here)
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
      // Bracket rule: positions 2k-1 and 2k feed parent at position k (ceil(P/2) = k).
      // Look up each child by position rather than by array index so that filtered-out
      // bye matches (missing from matchPositions) don't misalign the remaining pairs.
      const top = children.find(c => c.match.position === 2 * parentPos - 1);
      const bot = children.find(c => c.match.position === 2 * parentPos);
      if (!top && !bot) continue;

      // A missing child (prelim bye that was filtered out) counts as a bye.
      const isTopBye = !top || top.match.status === 'Bye';
      const isBotBye = !bot || bot.match.status === 'Bye';

      // Skip entirely only when both children are absent/bye and we're not exporting them.
      // When exportPrelimByes=true we still draw connectors between the bye boxes and R1.
      if (isTopBye && isBotBye && !config.exportPrelimByes) continue;

      // Fall back to the other child's column when one is absent.
      const topMatchCol = (top ?? bot!).matchCol;
      const botMatchCol = (bot ?? top!).matchCol;
      const topConnColA = topMatchCol + 1;
      const botConnColA = botMatchCol + 1;
      // Vertical sits one column right of whichever child is furthest right.
      const connColB = Math.max(topMatchCol, botMatchCol) + 2;
      // Parent stub ends one column left of the parent match box.
      const connColC = parent.matchCol - 1;

      // Row fallback for absent child: use parent divider so the vertical shrinks to
      // zero length on that side rather than drawing a spurious long line.
      const topConnRow    = top?.dividerRow ?? parent.dividerRow;
      const botConnRow    = bot?.dividerRow ?? parent.dividerRow;

      connectorPositions.push({
        topConnColA, botConnColA, connColB, connColC,
        topConnRow, botConnRow,
        parentConnRow: parent.dividerRow,
        isTopBye,
        isBotBye,
      });
    }
  }

  // ── Step 1: Delete existing tab and create fresh ──────────────────────────

  const metaResp = await sheetsClient.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  const existing = metaResp.data.sheets?.find(s => s.properties?.title === sheetTitle);

  const prepRequests: object[] = [];
  if (existing?.properties?.sheetId != null) {
    prepRequests.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
  }
  prepRequests.push({
    addSheet: {
      properties: {
        title: sheetTitle,
        gridProperties: { rowCount: contentRows + 7, columnCount: numCols + 2 },
      },
    },
  });

  const prepResult = await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: prepRequests },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newSheetId = (prepResult.data.replies as any[])
    ?.find(r => r.addSheet)
    ?.addSheet?.properties?.sheetId as number | undefined;

  if (newSheetId == null) throw new Error('Failed to create sheet tab');

  // ── Step 2: Formatting ────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fmtRequests: any[] = [];

  // Hide gridlines
  fmtRequests.push({
    updateSheetProperties: {
      properties: {
        sheetId: newSheetId,
        gridProperties: { hideGridlines: true },
      },
      fields: 'gridProperties.hideGridlines',
    },
  });

  // Column widths — connector columns hidden when connectorColWidthPx is 0
  const hideConnectors = config.connectorColWidthPx === 0;
  const connWidth = hideConnectors ? 0 : Math.max(1, Math.round(config.connectorColWidthPx / 3));
  for (let ci = 0; ci < numCols; ci++) {
    const isMatchCol = ci >= colOffset && (ci - colOffset) % 4 === 0;
    const isConnCol  = ci >= colOffset && !isMatchCol;
    if (isConnCol && hideConnectors) {
      fmtRequests.push({
        updateDimensionProperties: {
          range: { sheetId: newSheetId, dimension: 'COLUMNS', startIndex: ci, endIndex: ci + 1 },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      });
    } else {
      fmtRequests.push({
        updateDimensionProperties: {
          range: { sheetId: newSheetId, dimension: 'COLUMNS', startIndex: ci, endIndex: ci + 1 },
          properties: { pixelSize: isMatchCol ? config.matchColWidthPx : connWidth },
          fields: 'pixelSize',
        },
      });
    }
  }

  const lastMatchCol = colOffset + 4 * (numRounds - 1);

  // Row 0: competition title
  fmtRequests.push({
    updateDimensionProperties: {
      range: { sheetId: newSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 36 },
      fields: 'pixelSize',
    },
  });
  fmtRequests.push({
    mergeCells: {
      range: {
        sheetId: newSheetId,
        startRowIndex: 0, endRowIndex: 1,
        startColumnIndex: colOffset, endColumnIndex: lastMatchCol + 1,
      },
      mergeType: 'MERGE_ALL',
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: {
        sheetId: newSheetId,
        startRowIndex: 0, endRowIndex: 1,
        startColumnIndex: colOffset, endColumnIndex: lastMatchCol + 1,
      },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 16 },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
    },
  });

  // Row 1: round header row height (tall enough for 14pt bold)
  fmtRequests.push({
    updateDimensionProperties: {
      range: { sheetId: newSheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
      properties: { pixelSize: 30 },
      fields: 'pixelSize',
    },
  });

  // Row 2: play-by dates
  fmtRequests.push({
    updateDimensionProperties: {
      range: { sheetId: newSheetId, dimension: 'ROWS', startIndex: 2, endIndex: 3 },
      properties: { pixelSize: 18 },
      fields: 'pixelSize',
    },
  });

  // Row 3: blank separator — small visual gap
  fmtRequests.push({
    updateDimensionProperties: {
      range: { sheetId: newSheetId, dimension: 'ROWS', startIndex: 3, endIndex: 4 },
      properties: { pixelSize: 8 },
      fields: 'pixelSize',
    },
  });

  // Round header cell format: bold, centred, font 14 (match columns only)
  for (let ri = 0; ri < numRounds; ri++) {
    const colIdx = colOffset + 4 * ri;
    fmtRequests.push({
      repeatCell: {
        range: {
          sheetId: newSheetId,
          startRowIndex: 1, endRowIndex: 2,
          startColumnIndex: colIdx, endColumnIndex: colIdx + 1,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 14 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    });
    // Date row: font 9, not bold, centred
    fmtRequests.push({
      repeatCell: {
        range: {
          sheetId: newSheetId,
          startRowIndex: 2, endRowIndex: 3,
          startColumnIndex: colIdx, endColumnIndex: colIdx + 1,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: false, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    });
  }

  // Double bottom border spanning all match columns (decorative rule under date row)
  fmtRequests.push({
    updateBorders: {
      range: {
        sheetId: newSheetId,
        startRowIndex: 2, endRowIndex: 3,
        startColumnIndex: colOffset, endColumnIndex: lastMatchCol + 1,
      },
      bottom: { style: 'DOUBLE', colorStyle: { rgbColor: BLACK } },
    },
  });

  // Match box borders + text format
  for (const mp of matchPositions) {
    if (mp.match.status === 'Bye' && (!config.exportPrelimByes || mp.match.round !== 'Prelim')) continue;

    const sRowStart = sr(mp.boxStartRow);
    const sRowEnd   = sr(mp.boxEndRow) + 1; // exclusive

    // Outer box
    fmtRequests.push({
      updateBorders: {
        range: {
          sheetId: newSheetId,
          startRowIndex: sRowStart, endRowIndex: sRowEnd,
          startColumnIndex: mp.matchCol, endColumnIndex: mp.matchCol + 1,
        },
        top: MATCH_BORDER, bottom: MATCH_BORDER,
        left: MATCH_BORDER, right: MATCH_BORDER,
      },
    });

    // Inner divider between side1 and side2
    const divSRow = sr(mp.dividerRow);
    fmtRequests.push({
      updateBorders: {
        range: {
          sheetId: newSheetId,
          startRowIndex: divSRow, endRowIndex: divSRow + 1,
          startColumnIndex: mp.matchCol, endColumnIndex: mp.matchCol + 1,
        },
        bottom: DIVIDER_BORDER,
      },
    });

    // Cell text format + alternating background colour
    const bgColor = hexToRgb(mp.match.position % 2 === 1 ? config.color1 : config.color2);
    fmtRequests.push({
      repeatCell: {
        range: {
          sheetId: newSheetId,
          startRowIndex: sRowStart, endRowIndex: sRowEnd,
          startColumnIndex: mp.matchCol, endColumnIndex: mp.matchCol + 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor:     bgColor,
            wrapStrategy:        config.nameFit === 'wrap' ? 'WRAP' : 'CLIP',
            verticalAlignment:   'MIDDLE',
            horizontalAlignment: 'LEFT',
            textFormat:          { fontSize: 10 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,wrapStrategy,verticalAlignment,horizontalAlignment,textFormat.fontSize)',
      },
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
    // isTopBye && isBotBye cases that should be skipped are already excluded during
    // connector computation above; any remaining both-bye entry means exportPrelimByes=true,
    // so we draw the full connector between the two bye boxes and their R1 parent.

    if (!cp.isTopBye && !cp.isBotBye || cp.isTopBye && cp.isBotBye) {
      // Full connector: both children present (either both real, or both exported byes)

      // Horizontal stub from each child's right edge to just before the vertical.
      // When a child is date-shifted to an earlier column the stub spans more columns.
      fmtRequests.push({
        updateBorders: {
          range: {
            sheetId: newSheetId,
            startRowIndex: sr(cp.topConnRow), endRowIndex: sr(cp.topConnRow) + 1,
            startColumnIndex: cp.topConnColA, endColumnIndex: cp.connColB,
          },
          bottom: CONNECTOR_BORDER,
        },
      });
      fmtRequests.push({
        updateBorders: {
          range: {
            sheetId: newSheetId,
            startRowIndex: sr(cp.botConnRow), endRowIndex: sr(cp.botConnRow) + 1,
            startColumnIndex: cp.botConnColA, endColumnIndex: cp.connColB,
          },
          bottom: CONNECTOR_BORDER,
        },
      });

      // Vertical spanning all three rows (top child, bot child, parent).
      // Including parentConnRow ensures the vertical always reaches the parent stub
      // even when direct-entry children are compressed above the parent's natural position.
      // startRowIndex +1 so the left border starts at the bottom of vTop row (= stub level).
      const vTop = Math.min(cp.topConnRow, cp.botConnRow, cp.parentConnRow);
      const vBot = Math.max(cp.topConnRow, cp.botConnRow, cp.parentConnRow);
      fmtRequests.push({
        updateBorders: {
          range: {
            sheetId: newSheetId,
            startRowIndex: sr(vTop) + 1, endRowIndex: sr(vBot) + 1,
            startColumnIndex: cp.connColB, endColumnIndex: cp.connColB + 1,
          },
          left: CONNECTOR_BORDER,
        },
      });

      // Horizontal stub from vertical to parent match box
      fmtRequests.push({
        updateBorders: {
          range: {
            sheetId: newSheetId,
            startRowIndex: sr(cp.parentConnRow), endRowIndex: sr(cp.parentConnRow) + 1,
            startColumnIndex: cp.connColB, endColumnIndex: cp.connColC + 1,
          },
          bottom: CONNECTOR_BORDER,
        },
      });

    } else {
      // Bye: one child directly to parent ──────────────────────────────────
      const childRow     = cp.isTopBye ? cp.botConnRow  : cp.topConnRow;
      const childConnColA = cp.isTopBye ? cp.botConnColA : cp.topConnColA;

      // Horizontal stub from surviving child to just before vertical
      fmtRequests.push({
        updateBorders: {
          range: {
            sheetId: newSheetId,
            startRowIndex: sr(childRow), endRowIndex: sr(childRow) + 1,
            startColumnIndex: childConnColA, endColumnIndex: cp.connColB,
          },
          bottom: CONNECTOR_BORDER,
        },
      });

      // Vertical from child to parent
      const vTop = Math.min(childRow, cp.parentConnRow);
      const vBot = Math.max(childRow, cp.parentConnRow);
      if (vTop < vBot) {
        fmtRequests.push({
          updateBorders: {
            range: {
              sheetId: newSheetId,
              startRowIndex: sr(vTop) + 1, endRowIndex: sr(vBot) + 1,
              startColumnIndex: cp.connColB, endColumnIndex: cp.connColB + 1,
            },
            left: CONNECTOR_BORDER,
          },
        });
      }

      // Horizontal stub from vertical to parent match box
      fmtRequests.push({
        updateBorders: {
          range: {
            sheetId: newSheetId,
            startRowIndex: sr(cp.parentConnRow), endRowIndex: sr(cp.parentConnRow) + 1,
            startColumnIndex: cp.connColB, endColumnIndex: cp.connColC + 1,
          },
          bottom: CONNECTOR_BORDER,
        },
      });
    }
  }

  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: fmtRequests },
  });

  // ── Step 3: Write values ──────────────────────────────────────────────────

  const escapedTitle = sheetTitle.replace(/'/g, "''");

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

  const valueData: { range: string; values: string[][] }[] = [];

  // Row 0: competition title (merged cell — write to first match column)
  valueData.push({
    range: `'${escapedTitle}'!${getColumnLetter(colOffset)}1`,
    values: [[competition.displayName]],
  });

  // Row 1: round labels
  presentRounds.forEach((round, ri) => {
    const col = getColumnLetter(colOffset + 4 * ri);
    valueData.push({
      range: `'${escapedTitle}'!${col}2`,
      values: [[COMP_ROUND_LABELS[round] ?? round]],
    });
  });

  // Row 2: play-by dates
  presentRounds.forEach((round, ri) => {
    const dateStr = formatPlayByDate(getRoundPlayByDate(round, competition), round === 'F');
    if (!dateStr) return;
    const col = getColumnLetter(colOffset + 4 * ri);
    valueData.push({
      range: `'${escapedTitle}'!${col}3`,
      values: [[dateStr]],
    });
  });

  // Match box values
  for (const mp of matchPositions) {
    const match = mp.match;
    if (match.status === 'Bye' && (!config.exportPrelimByes || match.round !== 'Prelim')) continue;

    const col        = getColumnLetter(mp.matchCol);
    // A1 offset: +1 title, +1 header, +1 dates, +1 blank, +1 for 1-indexed = content row + 5
    const s1StartRow = mp.side1Row + 5;
    const s2StartRow = mp.side2Row + 5;

    const isComplete = match.status === 'Complete' || match.status === 'Walkover';
    const s1 = sideRows(match.side1Usernames, isComplete ? match.score1 : null);
    // For bye matches, show "Bye" as the opponent instead of "TBD"
    const s2Usernames = match.status === 'Bye' ? ['Bye'] : (match.side2Usernames ?? []);
    const s2 = sideRows(s2Usernames, isComplete ? match.score2 : null);

    s1.forEach((text, i) => {
      if (text) valueData.push({ range: `'${escapedTitle}'!${col}${s1StartRow + i}`, values: [[text]] });
    });
    s2.forEach((text, i) => {
      if (text) valueData.push({ range: `'${escapedTitle}'!${col}${s2StartRow + i}`, values: [[text]] });
    });
  }

  if (valueData.length > 0) {
    await sheetsClient.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: valueData },
    });
  }

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  return { sheetUrl, sheetTitle };
}
