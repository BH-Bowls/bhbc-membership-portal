// src/lib/friendlies-utils.ts
// Utility functions for the Friendlies system

import { GameStatus } from './types/friendlies';

/**
 * Either a standalone game, or the games of one linked occasion (2+ fixtures in the
 * same fixture group — linked games and/or a reserve game) shown as a single card.
 */
export type GameOrGroup<T> = T | T[];

/** True when the item is a linked group (rendered as one card). */
export function isGameGroup<T>(item: GameOrGroup<T>): item is T[] {
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
 * Group games into linked occasions for display. Games group by their fixture group
 * (groupId) whatever their status — main games first, reserve games after. Games not
 * yet opened have no group and always show on their own (they're linked at opening).
 * Order follows the first game of each group in the input.
 */
export function groupLinkedGames<T extends {
  groupId?: string | null;
  reserveOf?: string | null;
  status: GameStatus;
  date: string;
}>(games: T[]): GameOrGroup<T>[] {
  const buckets = new Map<string, T[]>();
  const keyOf = (g: T): string | null => {
    if (g.groupId) return g.groupId;
    return null;
  };
  for (const g of games) {
    const key = keyOf(g);
    if (!key) continue;
    const list = buckets.get(key) || [];
    list.push(g);
    buckets.set(key, list);
  }

  const result: GameOrGroup<T>[] = [];
  const emitted = new Set<string>();
  for (const g of games) {
    const key = keyOf(g);
    const bucket = key ? buckets.get(key)! : null;
    if (!key || !bucket || bucket.length < 2) {
      result.push(g);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    result.push([...bucket].sort((a, b) => (a.reserveOf ? 1 : 0) - (b.reserveOf ? 1 : 0)));
  }
  return result;
}

/**
 * Best-effort category for a cancellation's free-text `reason` field, for the Games
 * Stats page. There is no structured reason field anywhere in the app — captains type
 * whatever they like into a plain text input (placeholder: "e.g., Weather, Insufficient
 * players") — so this is keyword matching, not a reliable classification. Good enough
 * for a rough breakdown; will miscategorize anything not phrased predictably.
 */
export type CancellationReasonCategory = 'Weather' | 'Insufficient players' | 'Other';

const WEATHER_KEYWORDS = ['weather', 'rain', 'wind', 'storm', 'snow', 'frost', 'waterlog', 'flood', 'hail', 'icy', 'ice'];
const PLAYERS_KEYWORDS = ['player', 'short', 'insufficient', 'unable to field', 'no team', 'understrength', 'not enough'];

export function categorizeCancellationReason(reason: string | null | undefined): CancellationReasonCategory {
  const text = (reason || '').toLowerCase();
  if (!text) return 'Other';
  if (WEATHER_KEYWORDS.some((k) => text.includes(k))) return 'Weather';
  if (PLAYERS_KEYWORDS.some((k) => text.includes(k))) return 'Insufficient players';
  return 'Other';
}
