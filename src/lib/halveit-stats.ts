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

export interface NightTotal {
  playerId: string;
  total: number;
  games: number;
}

export interface NightSummary {
  night: HalveItNight;
  players: number;
  games: GameResult[];
  topScore: { playerIds: string[]; score: number } | null;
  totals: NightTotal[]; // highest total first
}

export interface Ranked<T> {
  position: number; // equal values share a position
  item: T;
}

/** Final nights only, oldest first. */
export function finalNights(data: HalveItSeasonData): HalveItNight[] {
  const nights: HalveItNight[] = [];
  for (const night of data.nights) {
    if (night.status === 'final') nights.push(night);
  }
  nights.sort((a, b) => a.date.localeCompare(b.date));
  return nights;
}

/** Scores from final nights only. */
function finalScores(data: HalveItSeasonData): HalveItScore[] {
  const finalIds = new Set<string>();
  for (const night of finalNights(data)) finalIds.add(night.id);

  const scores: HalveItScore[] = [];
  for (const score of data.scores) {
    if (finalIds.has(score.nightId)) scores.push(score);
  }
  return scores;
}

export function summariseNight(night: HalveItNight, allScores: HalveItScore[]): NightSummary {
  // Just this night's scores
  const nightScores: HalveItScore[] = [];
  for (const score of allScores) {
    if (score.nightId === night.id) nightScores.push(score);
  }

  // Group scores by game number
  const byGame = new Map<number, { playerId: string; score: number }[]>();
  for (const s of nightScores) {
    if (!byGame.has(s.gameNo)) byGame.set(s.gameNo, []);
    byGame.get(s.gameNo)!.push({ playerId: s.playerId, score: s.score });
  }
  const gameNos = Array.from(byGame.keys()).sort((a, b) => a - b);

  // Each game's scores, highest first, and its winner(s) — everyone on the top score
  const games: GameResult[] = [];
  for (const gameNo of gameNos) {
    const gameScores = byGame.get(gameNo)!;
    gameScores.sort((a, b) => b.score - a.score);
    const winners: string[] = [];
    for (const gs of gameScores) {
      if (gs.score === gameScores[0].score) winners.push(gs.playerId);
    }
    games.push({ gameNo, scores: gameScores, winners });
  }

  // Each player's total and games played on the night
  const byPlayer = new Map<string, NightTotal>();
  for (const s of nightScores) {
    let entry = byPlayer.get(s.playerId);
    if (!entry) {
      entry = { playerId: s.playerId, total: 0, games: 0 };
      byPlayer.set(s.playerId, entry);
    }
    entry.total += s.score;
    entry.games++;
  }
  const totals = Array.from(byPlayer.values());
  totals.sort((a, b) => b.total - a.total);

  // The night's single highest game score, and who scored it
  let topScore: NightSummary['topScore'] = null;
  for (const s of nightScores) {
    if (topScore === null || s.score > topScore.score) {
      topScore = { score: s.score, playerIds: [s.playerId] };
    } else if (s.score === topScore.score && !topScore.playerIds.includes(s.playerId)) {
      topScore.playerIds.push(s.playerId);
    }
  }

  return { night, players: byPlayer.size, games, topScore, totals };
}

export function computePlayerStats(data: HalveItSeasonData): PlayerStats[] {
  const nights = finalNights(data);
  const scores = finalScores(data);

  // Count game wins per player across every final night
  const wins = new Map<string, number>();
  for (const night of nights) {
    const summary = summariseNight(night, scores);
    for (const game of summary.games) {
      for (const playerId of game.winners) {
        wins.set(playerId, (wins.get(playerId) || 0) + 1);
      }
    }
  }

  const bestNGames = data.settings.bestNGames;
  const result: PlayerStats[] = [];

  for (const player of data.players) {
    // This player's scores, and the nights they played
    const values: number[] = [];
    const nightIds = new Set<string>();
    for (const s of scores) {
      if (s.playerId === player.id) {
        values.push(s.score);
        nightIds.add(s.nightId);
      }
    }
    values.sort((a, b) => b - a); // highest first

    let total = 0;
    let bestN = 0;
    for (let i = 0; i < values.length; i++) {
      total += values[i];
      if (i < bestNGames) bestN += values[i];
    }

    const played = values.length > 0;
    result.push({
      player,
      nights: nightIds.size,
      games: values.length,
      total,
      average: played ? total / values.length : null,
      best: played ? values[0] : null,
      worst: played ? values[values.length - 1] : null,
      bestN,
      bestNCount: Math.min(values.length, bestNGames),
      gameWins: wins.get(player.id) || 0,
    });
  }
  return result;
}

/** Sorts descending by value and assigns shared positions to equal values. */
export function rank<T>(items: T[], value: (item: T) => number, tiebreak?: (a: T, b: T) => number): Ranked<T>[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    const diff = value(b) - value(a);
    if (diff !== 0 || !tiebreak) return diff;
    return tiebreak(a, b);
  });

  const result: Ranked<T>[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let position = i + 1;
    // Same value as the row above = same position
    if (i > 0 && value(sorted[i - 1]) === value(sorted[i])) {
      position = result[i - 1].position;
    }
    result.push({ position, item: sorted[i] });
  }
  return result;
}

const byName = (a: PlayerStats, b: PlayerStats) => a.player.name.localeCompare(b.player.name);

/** Players who've played at least one game. */
function withGames(stats: PlayerStats[]): PlayerStats[] {
  const played: PlayerStats[] = [];
  for (const s of stats) {
    if (s.games > 0) played.push(s);
  }
  return played;
}

export function totalTable(stats: PlayerStats[]): Ranked<PlayerStats>[] {
  return rank(withGames(stats), (s) => s.total, byName);
}

/** Qualified players ranked by average; the rest listed separately, most games first. */
export function averageTable(stats: PlayerStats[], minGames: number): { qualified: Ranked<PlayerStats>[]; unqualified: PlayerStats[] } {
  const qualified: PlayerStats[] = [];
  const unqualified: PlayerStats[] = [];
  for (const s of withGames(stats)) {
    if (s.games >= minGames) qualified.push(s);
    else unqualified.push(s);
  }
  unqualified.sort((a, b) => b.games - a.games || byName(a, b));
  return {
    qualified: rank(qualified, (s) => (s.average === null ? 0 : s.average), byName),
    unqualified,
  };
}

export function bestNTable(stats: PlayerStats[]): Ranked<PlayerStats>[] {
  return rank(withGames(stats), (s) => s.bestN, byName);
}

/** The position of a player in a ranked table, or null if they're not in it. */
export function positionOf(rows: Ranked<PlayerStats>[], playerId: string): number | null {
  for (const row of rows) {
    if (row.item.player.id === playerId) return row.position;
  }
  return null;
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

/** The highest value above zero, and every player id on it; null if nobody is above zero. */
function topPlayers(stats: PlayerStats[], value: (s: PlayerStats) => number): { max: number; ids: string[] } | null {
  let best: { max: number; ids: string[] } | null = null;
  for (const s of stats) {
    const v = value(s);
    if (v <= 0) continue;
    if (best === null || v > best.max) best = { max: v, ids: [s.player.id] };
    else if (v === best.max) best.ids.push(s.player.id);
  }
  return best;
}

export function computeRecords(data: HalveItSeasonData, stats: PlayerStats[]): SeasonRecords {
  const nights = finalNights(data);
  const scores = finalScores(data);

  // Highest single game score
  let highestGame: SeasonRecords['highestGame'] = null;
  for (const s of scores) {
    const entry = { playerId: s.playerId, nightId: s.nightId };
    if (highestGame === null || s.score > highestGame.score) highestGame = { score: s.score, entries: [entry] };
    else if (s.score === highestGame.score) highestGame.entries.push(entry);
  }

  // Highest total on a single night, and count the games played
  let highestNightTotal: SeasonRecords['highestNightTotal'] = null;
  let gamesPlayed = 0;
  for (const night of nights) {
    const summary = summariseNight(night, scores);
    gamesPlayed += summary.games.length;
    for (const t of summary.totals) {
      const entry = { playerId: t.playerId, nightId: night.id, games: t.games };
      if (highestNightTotal === null || t.total > highestNightTotal.total) highestNightTotal = { total: t.total, entries: [entry] };
      else if (t.total === highestNightTotal.total) highestNightTotal.entries.push(entry);
    }
  }

  // Best average only counts players who've qualified
  const qualified: PlayerStats[] = [];
  for (const s of stats) {
    if (s.average !== null && s.games >= data.settings.minGamesForAverage) qualified.push(s);
  }

  const wins = topPlayers(stats, (s) => s.gameWins);
  const played = topPlayers(stats, (s) => s.games);
  const avg = topPlayers(qualified, (s) => (s.average === null ? 0 : s.average));

  return {
    highestGame,
    highestNightTotal,
    mostGameWins: wins === null ? null : { wins: wins.max, playerIds: wins.ids },
    highestAverage: avg === null ? null : { average: avg.max, playerIds: avg.ids },
    mostGamesPlayed: played === null ? null : { games: played.max, playerIds: played.ids },
    nights: nights.length,
    games: gamesPlayed,
  };
}

export function formatAverage(avg: number | null): string {
  if (avg === null) return '—';
  return avg.toFixed(1);
}
