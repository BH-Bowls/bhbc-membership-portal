// src/lib/halveit-stats.ts
// Halve It league calculations. Pure functions over a season's raw data, used by
// the pages (client side) — only final nights ever count. A game's winner is the
// highest score among the players who played that game; ties share the win.

import type { HalveItNight, HalveItPlayer, HalveItScore, HalveItSeasonData } from '@/types/halveit';

export interface PlayerStats {
  player: HalveItPlayer;
  nights: number;
  games: number;
  total: number;
  average: number | null; // per game
  best: number | null;
  worst: number | null;
  bestN: number; // sum of the best N games
  bestNCount: number; // how many games make up bestN (< N if they haven't played N yet)
  gameWins: number;
}

export interface GameResult {
  gameNo: number;
  scores: { playerId: string; score: number }[]; // highest first
  winners: string[]; // player ids
}

export interface NightSummary {
  night: HalveItNight;
  players: number;
  games: GameResult[];
  topScore: { playerIds: string[]; score: number } | null;
  totals: { playerId: string; total: number; games: number }[]; // highest total first
}

export interface Ranked<T> {
  position: number; // equal values share a position
  item: T;
}

/** Final nights only, oldest first. */
export function finalNights(data: HalveItSeasonData): HalveItNight[] {
  return data.nights.filter((n) => n.status === 'final').sort((a, b) => a.date.localeCompare(b.date));
}

function finalScores(data: HalveItSeasonData): HalveItScore[] {
  const ids = new Set(finalNights(data).map((n) => n.id));
  return data.scores.filter((s) => ids.has(s.nightId));
}

export function summariseNight(night: HalveItNight, scores: HalveItScore[]): NightSummary {
  const own = scores.filter((s) => s.nightId === night.id);
  const gameNos = Array.from(new Set(own.map((s) => s.gameNo))).sort((a, b) => a - b);
  const games: GameResult[] = gameNos.map((gameNo) => {
    const gs = own.filter((s) => s.gameNo === gameNo).map((s) => ({ playerId: s.playerId, score: s.score })).sort((a, b) => b.score - a.score);
    const top = gs[0]?.score;
    return { gameNo, scores: gs, winners: gs.filter((s) => s.score === top).map((s) => s.playerId) };
  });
  const byPlayer = new Map<string, { total: number; games: number }>();
  for (const s of own) {
    const t = byPlayer.get(s.playerId) || { total: 0, games: 0 };
    t.total += s.score;
    t.games++;
    byPlayer.set(s.playerId, t);
  }
  const totals = Array.from(byPlayer.entries()).map(([playerId, t]) => ({ playerId, ...t })).sort((a, b) => b.total - a.total);
  let topScore: NightSummary['topScore'] = null;
  if (own.length > 0) {
    const max = Math.max(...own.map((s) => s.score));
    topScore = { score: max, playerIds: Array.from(new Set(own.filter((s) => s.score === max).map((s) => s.playerId))) };
  }
  return { night, players: byPlayer.size, games, topScore, totals };
}

export function computePlayerStats(data: HalveItSeasonData): PlayerStats[] {
  const nights = finalNights(data);
  const scores = finalScores(data);
  const wins = new Map<string, number>();
  for (const night of nights) {
    for (const g of summariseNight(night, scores).games) {
      for (const id of g.winners) wins.set(id, (wins.get(id) || 0) + 1);
    }
  }
  const n = data.settings.bestNGames;
  return data.players.map((player) => {
    const own = scores.filter((s) => s.playerId === player.id);
    const values = own.map((s) => s.score).sort((a, b) => b - a);
    const total = values.reduce((sum, v) => sum + v, 0);
    const top = values.slice(0, n);
    return {
      player,
      nights: new Set(own.map((s) => s.nightId)).size,
      games: values.length,
      total,
      average: values.length ? total / values.length : null,
      best: values.length ? values[0] : null,
      worst: values.length ? values[values.length - 1] : null,
      bestN: top.reduce((sum, v) => sum + v, 0),
      bestNCount: top.length,
      gameWins: wins.get(player.id) || 0,
    };
  });
}

/** Sorts descending by value and assigns shared positions to equal values. */
export function rank<T>(items: T[], value: (item: T) => number, tiebreak?: (a: T, b: T) => number): Ranked<T>[] {
  const sorted = [...items].sort((a, b) => value(b) - value(a) || (tiebreak ? tiebreak(a, b) : 0));
  const result: Ranked<T>[] = [];
  sorted.forEach((item, i) => {
    const prev = result[i - 1];
    const position = prev && value(prev.item) === value(item) ? prev.position : i + 1;
    result.push({ position, item });
  });
  return result;
}

const byName = (a: PlayerStats, b: PlayerStats) => a.player.name.localeCompare(b.player.name);

export function totalTable(stats: PlayerStats[]): Ranked<PlayerStats>[] {
  return rank(stats.filter((s) => s.games > 0), (s) => s.total, byName);
}

/** Qualified players ranked by average; the rest listed separately, most games first. */
export function averageTable(stats: PlayerStats[], minGames: number): { qualified: Ranked<PlayerStats>[]; unqualified: PlayerStats[] } {
  const played = stats.filter((s) => s.games > 0);
  return {
    qualified: rank(played.filter((s) => s.games >= minGames), (s) => s.average ?? 0, byName),
    unqualified: played.filter((s) => s.games < minGames).sort((a, b) => b.games - a.games || byName(a, b)),
  };
}

export function bestNTable(stats: PlayerStats[]): Ranked<PlayerStats>[] {
  return rank(stats.filter((s) => s.games > 0), (s) => s.bestN, byName);
}

export interface SeasonRecords {
  highestGame: { score: number; entries: { playerId: string; nightId: string }[] } | null;
  highestNightTotal: { total: number; entries: { playerId: string; nightId: string; games: number }[] } | null;
  mostGameWins: { wins: number; playerIds: string[] } | null;
  highestAverage: { average: number; playerIds: string[] } | null; // qualified players only
  mostGamesPlayed: { games: number; playerIds: string[] } | null;
  nights: number;
  games: number;
}

export function computeRecords(data: HalveItSeasonData, stats: PlayerStats[]): SeasonRecords {
  const nights = finalNights(data);
  const scores = finalScores(data);
  const summaries = nights.map((n) => summariseNight(n, scores));

  let highestGame: SeasonRecords['highestGame'] = null;
  if (scores.length) {
    const max = Math.max(...scores.map((s) => s.score));
    highestGame = { score: max, entries: scores.filter((s) => s.score === max).map((s) => ({ playerId: s.playerId, nightId: s.nightId })) };
  }

  let highestNightTotal: SeasonRecords['highestNightTotal'] = null;
  const allTotals = summaries.flatMap((s) => s.totals.map((t) => ({ ...t, nightId: s.night.id })));
  if (allTotals.length) {
    const max = Math.max(...allTotals.map((t) => t.total));
    highestNightTotal = { total: max, entries: allTotals.filter((t) => t.total === max).map((t) => ({ playerId: t.playerId, nightId: t.nightId, games: t.games })) };
  }

  const top = (values: { id: string; v: number }[]) => {
    const live = values.filter((x) => x.v > 0);
    if (!live.length) return null;
    const max = Math.max(...live.map((x) => x.v));
    return { max, ids: live.filter((x) => x.v === max).map((x) => x.id) };
  };

  const wins = top(stats.map((s) => ({ id: s.player.id, v: s.gameWins })));
  const played = top(stats.map((s) => ({ id: s.player.id, v: s.games })));
  const qualified = stats.filter((s) => s.average !== null && s.games >= data.settings.minGamesForAverage);
  const avg = top(qualified.map((s) => ({ id: s.player.id, v: s.average as number })));

  return {
    highestGame,
    highestNightTotal,
    mostGameWins: wins && { wins: wins.max, playerIds: wins.ids },
    highestAverage: avg && { average: avg.max, playerIds: avg.ids },
    mostGamesPlayed: played && { games: played.max, playerIds: played.ids },
    nights: nights.length,
    games: summaries.reduce((sum, s) => sum + s.games.length, 0),
  };
}

export function formatAverage(avg: number | null): string {
  return avg === null ? '—' : avg.toFixed(1);
}
