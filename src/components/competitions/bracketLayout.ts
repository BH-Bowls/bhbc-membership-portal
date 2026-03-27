// src/components/competitions/bracketLayout.ts
// Pure functions for computing bracket geometry

import type { CompMatch, CompRound } from '@/types/competitions';
import { ROUND_ORDER } from '@/types/competitions';

// ── Screen layout constants ──────────────────────────────────────────────────
export const MATCH_HEIGHT = 56; // px — default match card height (singles)
export const MATCH_WIDTH  = 192; // px — width of a match card
export const ROUND_GAP    = 52;  // px — gap between round columns (for connector lines)
export const SLOT_GAP     = 8;   // px — default gap between adjacent matches

export const SLOT_HEIGHT = MATCH_HEIGHT + SLOT_GAP; // singles slot height

// ── Print layout constants ───────────────────────────────────────────────────
// Smaller column width and gap so multiple rounds fit on the page width.
// A4 landscape (≈1123px) fits 6 × 160 + 5 × 28 = 1100px.
export const PRINT_MATCH_WIDTH = 160;
export const PRINT_ROUND_GAP   = 28;
export const PRINT_LABEL_HEIGHT = 40; // round header height on each print section

// Usable bracket area per print page (CSS px at 96dpi), after typical 15 mm margins.
// These are intentionally conservative so cards don't land right at the edge.
export const PRINT_PAGE_BRACKET_HEIGHT_LANDSCAPE = 620;
export const PRINT_PAGE_BRACKET_HEIGHT_PORTRAIT  = 940;

/**
 * Pairs/triples show all player names which can wrap to multiple lines.
 * Return a card height and slot gap large enough to prevent overlap.
 */
export function matchDimensionsForCompType(compType: string): { matchHeight: number; slotGap: number } {
  if (compType === 'triples') return { matchHeight: 104, slotGap: 12 };
  if (compType === 'pairs')   return { matchHeight: 84,  slotGap: 12 };
  return { matchHeight: MATCH_HEIGHT, slotGap: SLOT_GAP };
}

export interface MatchGeometry {
  matchId: string;
  match: CompMatch;
  topY: number;    // absolute Y of top of match card
  centerY: number; // absolute Y of vertical centre
  x: number;       // absolute X of left edge
  roundIndex: number;
}

export interface ConnectorGeometry {
  // Match IDs — used to identify which section each connector belongs to
  topChildMatchId: string;
  botChildMatchId: string;
  parentMatchId: string;

  // The two child match centerY values
  topChildCenterY: number;
  botChildCenterY: number;
  // Per-child right X (may differ when matches are in different date columns)
  topChildRightX: number;
  botChildRightX: number;
  // Rightmost child right X — where the vertical segment is drawn
  childRightX: number;
  // The parent match centerY + its left X
  parentCenterY: number;
  parentLeftX: number;
  // Midpoint X where the vertical segment lives
  midX: number;
  // Whether each child is a bye (affects which connector arms are drawn)
  isTopChildBye: boolean;
  isBotChildBye: boolean;
  // Which rounds this connector links (for filtering by visible rounds)
  childRound: string;
  parentRound: string;
}

export interface BracketLayout {
  matchGeometries: MatchGeometry[];
  connectors: ConnectorGeometry[];
  totalWidth: number;
  totalHeight: number;
  roundLabels: { label: string; x: number }[];
}

/**
 * Compute all positions for a bracket.
 * firstRoundCount must be a power of 2.
 * matchWidth and roundGap can be overridden for print layouts.
 *
 * getMatchX: optional override — given a match and its default x, returns the
 * actual x to use.  Pass this to place matches in date-based columns instead of
 * their natural round column.
 */
export function computeBracketLayout(
  matches: CompMatch[],
  firstRoundCount: number,
  matchHeight: number = MATCH_HEIGHT,
  slotGap: number = SLOT_GAP,
  matchWidth: number = MATCH_WIDTH,
  roundGap: number = ROUND_GAP,
  getMatchX?: (match: CompMatch, defaultX: number) => number,
): BracketLayout {
  const slotHeight = matchHeight + slotGap;

  // Determine which rounds are present, in order
  const presentRounds = ROUND_ORDER.filter((r) =>
    matches.some((m) => m.round === r)
  );

  const totalHeight = firstRoundCount * slotHeight - slotGap;

  const matchGeometries: MatchGeometry[] = [];
  const roundLabels: { label: string; x: number }[] = [];

  presentRounds.forEach((round, roundIndex) => {
    const defaultX = roundIndex * (matchWidth + roundGap);
    const roundMatches = matches
      .filter((m) => m.round === round)
      .sort((a, b) => a.position - b.position);

    const numMatchesInRound = roundMatches.length;
    // Each match in this round spans slotsPerMatch "first-round slots"
    const slotsPerMatch = firstRoundCount / numMatchesInRound;

    roundLabels.push({ label: round, x: defaultX });

    roundMatches.forEach((match, matchIndex) => {
      const centerY =
        matchIndex * slotsPerMatch * slotHeight +
        (slotsPerMatch * slotHeight - slotGap) / 2;
      const topY = centerY - matchHeight / 2;

      const x = getMatchX ? getMatchX(match, defaultX) : defaultX;

      matchGeometries.push({
        matchId: match.matchId,
        match,
        topY,
        centerY,
        x,
        roundIndex,
      });
    });
  });

  // Build connectors between adjacent rounds.
  // Use actual geo.x positions so connectors follow matches wherever they land.
  const connectors: ConnectorGeometry[] = [];

  for (let ri = 0; ri < presentRounds.length - 1; ri++) {
    const currentGeos = matchGeometries
      .filter((g) => g.roundIndex === ri)
      .sort((a, b) => a.match.position - b.match.position);

    const nextGeos = matchGeometries
      .filter((g) => g.roundIndex === ri + 1)
      .sort((a, b) => a.match.position - b.match.position);

    // Each pair of current-round matches feeds one next-round match
    for (let i = 0; i < currentGeos.length; i += 2) {
      const top = currentGeos[i];
      const bot = currentGeos[i + 1];
      const parent = nextGeos[i / 2];
      if (!top || !bot || !parent) continue;

      const isTopBye = top.match.status === 'Bye';
      const isBotBye = bot.match.status === 'Bye';

      const topChildRightX = top.x + matchWidth;
      const botChildRightX = bot.x + matchWidth;
      // childRightX = right edge of whichever child is furthest right
      // (where the vertical segment of the connector is drawn)
      const childRightX = isTopBye ? botChildRightX
        : isBotBye ? topChildRightX
        : Math.max(topChildRightX, botChildRightX);
      const parentLeftX = parent.x;
      const midX = childRightX + roundGap / 2;

      connectors.push({
        topChildMatchId: top.matchId,
        botChildMatchId: bot.matchId,
        parentMatchId: parent.matchId,
        topChildCenterY: top.centerY,
        botChildCenterY: bot.centerY,
        topChildRightX,
        botChildRightX,
        childRightX,
        parentCenterY: parent.centerY,
        parentLeftX,
        midX,
        isTopChildBye: isTopBye,
        isBotChildBye: isBotBye,
        childRound: presentRounds[ri],
        parentRound: presentRounds[ri + 1],
      });
    }
  }

  const totalWidth =
    presentRounds.length * matchWidth +
    (presentRounds.length - 1) * roundGap;

  return { matchGeometries, connectors, totalWidth, totalHeight, roundLabels };
}
