// src/components/competitions/bracketLayout.ts
// Pure functions for computing bracket geometry

import type { CompMatch, CompRound } from '@/types/competitions';
import { ROUND_ORDER } from '@/types/competitions';

export const MATCH_HEIGHT = 76; // px — height of a match card
export const MATCH_WIDTH  = 192; // px — width of a match card
export const ROUND_GAP    = 52;  // px — gap between round columns (for connector lines)
export const SLOT_GAP     = 8;   // px — gap between adjacent matches in first round

export const SLOT_HEIGHT = MATCH_HEIGHT + SLOT_GAP; // 84px per "slot"

export interface MatchGeometry {
  matchId: string;
  match: CompMatch;
  topY: number;    // absolute Y of top of match card
  centerY: number; // absolute Y of vertical centre
  x: number;       // absolute X of left edge
  roundIndex: number;
}

export interface ConnectorGeometry {
  // The two child match centerY values + their right X
  topChildCenterY: number;
  botChildCenterY: number;
  childRightX: number;
  // The parent match centerY + its left X
  parentCenterY: number;
  parentLeftX: number;
  // Midpoint X where the vertical segment lives
  midX: number;
  // Whether each child is a bye (affects which connector arms are drawn)
  isTopChildBye: boolean;
  isBotChildBye: boolean;
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
 */
export function computeBracketLayout(
  matches: CompMatch[],
  firstRoundCount: number
): BracketLayout {
  // Determine which rounds are present, in order
  const presentRounds = ROUND_ORDER.filter((r) =>
    matches.some((m) => m.round === r)
  );

  const totalHeight = firstRoundCount * SLOT_HEIGHT - SLOT_GAP;

  const matchGeometries: MatchGeometry[] = [];
  const roundLabels: { label: string; x: number }[] = [];

  presentRounds.forEach((round, roundIndex) => {
    const x = roundIndex * (MATCH_WIDTH + ROUND_GAP);
    const roundMatches = matches
      .filter((m) => m.round === round)
      .sort((a, b) => a.position - b.position);

    const numMatchesInRound = roundMatches.length;
    // Each match in this round spans slotsPerMatch "first-round slots"
    const slotsPerMatch = firstRoundCount / numMatchesInRound;

    roundLabels.push({ label: round, x });

    roundMatches.forEach((match, matchIndex) => {
      const centerY =
        matchIndex * slotsPerMatch * SLOT_HEIGHT +
        (slotsPerMatch * SLOT_HEIGHT - SLOT_GAP) / 2;
      const topY = centerY - MATCH_HEIGHT / 2;

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

  // Build connectors between adjacent rounds
  const connectors: ConnectorGeometry[] = [];

  for (let ri = 0; ri < presentRounds.length - 1; ri++) {
    const currentGeos = matchGeometries
      .filter((g) => g.roundIndex === ri)
      .sort((a, b) => a.match.position - b.match.position);

    const nextGeos = matchGeometries
      .filter((g) => g.roundIndex === ri + 1)
      .sort((a, b) => a.match.position - b.match.position);

    const childRightX = ri * (MATCH_WIDTH + ROUND_GAP) + MATCH_WIDTH;
    const parentLeftX = (ri + 1) * (MATCH_WIDTH + ROUND_GAP);
    const midX = childRightX + ROUND_GAP / 2;

    // Each pair of current-round matches feeds one next-round match
    for (let i = 0; i < currentGeos.length; i += 2) {
      const top = currentGeos[i];
      const bot = currentGeos[i + 1];
      const parent = nextGeos[i / 2];
      if (!top || !bot || !parent) continue;

      connectors.push({
        topChildCenterY: top.centerY,
        botChildCenterY: bot.centerY,
        childRightX,
        parentCenterY: parent.centerY,
        parentLeftX,
        midX,
        isTopChildBye: top.match.status === 'Bye',
        isBotChildBye: bot.match.status === 'Bye',
      });
    }
  }

  const totalWidth =
    presentRounds.length * MATCH_WIDTH +
    (presentRounds.length - 1) * ROUND_GAP;

  return { matchGeometries, connectors, totalWidth, totalHeight, roundLabels };
}
