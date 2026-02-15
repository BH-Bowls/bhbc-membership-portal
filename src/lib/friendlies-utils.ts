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
 * Group games that are paired (same date, both paired='Y') into tuples.
 * Only groups games in Upcoming (''), Open ('O'), or Allocating ('L') status.
 * Games past the Allocating phase render individually even if paired.
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
    if (game.paired === 'Y' && (game.status === '' || game.status === 'O' || game.status === 'L')) {
      // Find its partner: same date, also paired='Y', also Upcoming/Open/Allocating
      const partner = games.find(
        (g, j) =>
          j !== i &&
          !paired.has(g.rowNumber) &&
          g.paired === 'Y' &&
          g.date === game.date &&
          (g.status === '' || g.status === 'O' || g.status === 'L')
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
