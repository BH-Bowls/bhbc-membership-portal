// src/lib/friendlies-utils.ts
// Utility functions for the Friendlies system

import { Game } from './types/friendlies';

/**
 * Represents either a standalone game or a paired game tuple.
 * Paired games share the same date and both have paired='Y'.
 */
export type GameOrPair = Game | [Game, Game];

/**
 * Check if a GameOrPair is a paired tuple
 */
export function isPairedGame(item: GameOrPair): item is [Game, Game] {
  return Array.isArray(item);
}

/**
 * Parse the number of players required from a format string.
 * e.g. "4 Triples" → 12, "3 Pairs" → 6, "6 Rinks" → 24, "3 Triples, 4 Rinks" → 25.
 * Returns null if the format can't be parsed.
 */
export function parseNumberRequired(format: string): number | null {
  if (!format) return null;
  const sizeMap: Record<string, number> = {
    singles: 1, single: 1,
    pairs: 2, pair: 2,
    triples: 3, triple: 3,
    fours: 4, four: 4, rinks: 4, rink: 4,
    fives: 5, five: 5,
  };
  // Support compound formats e.g. "3 Triples, 4 Rinks"
  const parts = format.split(',').map(s => s.trim());
  let total = 0;
  for (const part of parts) {
    const match = part.match(/^(\d+)\s+(\w+)$/i);
    if (!match) return null; // any unrecognised segment → can't calculate
    const count = parseInt(match[1], 10);
    const size = sizeMap[match[2].toLowerCase()];
    if (!size) return null;
    total += count * size;
  }
  return total > 0 ? total : null;
}

/**
 * Group games that are paired (same date, both paired='Y') into tuples.
 * Only groups games in Upcoming ('') or Open ('O') status — once closed
 * (Selecting onward) the two games are managed/selected individually.
 * Preserves date ordering.
 *
 * @param games Array of Game objects
 * @returns Array of standalone Games and [GameA, GameB] tuples
 */
export function groupPairedGames(games: Game[]): GameOrPair[] {
  const result: GameOrPair[] = [];
  const paired = new Set<number>(); // Track rowNumbers already paired

  for (let i = 0; i < games.length; i++) {
    const game = games[i];

    // Skip if already grouped into a pair
    if (paired.has(game.rowNumber)) continue;

    // Only group if this game is marked as paired and in Upcoming/Open status
    if (game.paired === 'Y' && (game.status === '' || game.status === 'O')) {
      // Find its partner: same date, also paired='Y', also Upcoming/Open
      const partner = games.find(
        (g, j) =>
          j !== i &&
          !paired.has(g.rowNumber) &&
          g.paired === 'Y' &&
          g.date === game.date &&
          (g.status === '' || g.status === 'O')
      );

      if (partner) {
        paired.add(game.rowNumber);
        paired.add(partner.rowNumber);
        result.push([game, partner]);
        continue;
      }
    }

    // Standalone game
    result.push(game);
  }

  return result;
}
