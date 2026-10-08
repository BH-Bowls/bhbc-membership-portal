'use client';

// app/halve-it/players/[playerId]/page.tsx
// One Halve It player's season: summary figures, league positions, and every
// night's scores (game by game) with their position on the night.

import { use, useMemo } from 'react';
import Link from 'next/link';
import { getCardClasses } from '@/config/theme-helpers';
import { RouterBackLink } from '@/components/RouterBackLink';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';
import { useHalveItData, Spinner } from '@/components/halveit/shared';
import { averageTable, bestNTable, computePlayerStats, finalNights, formatAverage, positionOf, rank, summariseNight, totalTable } from '@/lib/halveit-stats';
import type { PlayerStats } from '@/lib/halveit-stats';
import { formatNightDate } from '@/types/halveit';
import type { HalveItNight, HalveItScore, HalveItSeasonData } from '@/types/halveit';

interface PlayerNight {
  night: HalveItNight;
  scores: HalveItScore[]; // this player's, in game order
  wins: number[]; // game numbers they won
  total: number;
  position: number | null; // on the night, by total
  field: number; // how many played that night
}

/** Every final night this player scored on, newest first. */
function playerNights(data: HalveItSeasonData, playerId: string): PlayerNight[] {
  const result: PlayerNight[] = [];
  const nights = finalNights(data).reverse();

  for (const night of nights) {
    const scores: HalveItScore[] = [];
    let total = 0;
    for (const s of data.scores) {
      if (s.nightId === night.id && s.playerId === playerId) {
        scores.push(s);
        total += s.score;
      }
    }
    if (scores.length === 0) continue; // didn't play that night
    scores.sort((a, b) => a.gameNo - b.gameNo);

    const summary = summariseNight(night, data.scores);
    const wins: number[] = [];
    for (const game of summary.games) {
      if (game.winners.includes(playerId)) wins.push(game.gameNo);
    }

    let position: number | null = null;
    for (const row of rank(summary.totals, (t) => t.total)) {
      if (row.item.playerId === playerId) position = row.position;
    }

    result.push({ night, scores, wins, total, position, field: summary.players });
  }
  return result;
}

/** 1 -> "1st", 12 -> "12th", 22 -> "22nd". */
function ord(n: number | null): string {
  if (n === null) return '—';
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

export default function HalveItPlayerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = use(params);
  const { data, error, loading } = useHalveItData(`player=${encodeURIComponent(playerId)}`);

  const leagueHref = data ? `/halve-it?season=${data.season}` : '/halve-it';
  usePhoneBackNavigation(leagueHref);

  const stats = useMemo(() => (data ? computePlayerStats(data) : []), [data]);
  const nights = useMemo(() => (data ? playerNights(data, playerId) : []), [data, playerId]);

  if (loading && !data) return <Spinner />;

  let mine: PlayerStats | null = null;
  for (const s of stats) {
    if (s.player.id === playerId) mine = s;
  }
  if (!data || !mine) return <p className="p-6 text-sm text-red-700">{error || 'Player not found'}</p>;

  const minGames = data.settings.minGamesForAverage;
  const totalPosition = positionOf(totalTable(stats), playerId);
  const averagePosition = positionOf(averageTable(stats, minGames).qualified, playerId);
  const bestNPosition = positionOf(bestNTable(stats), playerId);

  // Highest score across their nights, to scale the little bars under each game
  let maxScore = 1;
  for (const n of nights) {
    for (const s of n.scores) {
      if (s.score > maxScore) maxScore = s.score;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <RouterBackLink fallbackHref={leagueHref} label={`Halve It ${data.season}`} />
          <h1 className="text-2xl font-bold text-gray-900">{mine.player.name}</h1>
          <p className="text-sm text-gray-700">{data.season} season{!mine.player.active && ' · inactive'}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Average" value={formatAverage(mine.average)} />
          <Stat label="Best game" value={mine.best === null ? '—' : mine.best} />
          <Stat label="Games won" value={mine.gameWins} />
          <Stat label="Played" value={`${mine.games} games`} sub={`${mine.nights} nights`} />
        </div>

        <div className={getCardClasses('sm')}>
          <div className="text-xs font-medium text-gray-700 uppercase tracking-wider mb-2">League positions</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-900">
            <span>Total: <strong>{ord(totalPosition)}</strong> ({mine.total})</span>
            <span>
              Average: <strong>{averagePosition === null ? 'not qualified' : ord(averagePosition)}</strong>
              {averagePosition === null && mine.games < minGames && ` (needs ${minGames - mine.games} more games)`}
            </span>
            <span>Best {data.settings.bestNGames}: <strong>{ord(bestNPosition)}</strong> ({mine.bestN})</span>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">Nights</h2>
          {nights.length === 0 && <p className="text-sm text-gray-700">No scores yet this season.</p>}
          {nights.map((n) => (
            <div key={n.night.id} className={getCardClasses('sm')}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <Link href={`/halve-it/nights/${n.night.id}`} className="font-medium text-blue-700 hover:underline">{formatNightDate(n.night.date)}</Link>
                <span className="text-sm text-gray-700">
                  Total <strong className="text-gray-900">{n.total}</strong> · {ord(n.position)} of {n.field}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {n.scores.map((s) => {
                  const won = n.wins.includes(s.gameNo);
                  return (
                    <div key={s.gameNo} className={`w-14 rounded border text-center ${won ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'}`} title={won ? 'Won this game' : undefined}>
                      <div className="text-xs text-gray-700">G{s.gameNo}</div>
                      <div className={`text-sm font-semibold ${won ? 'text-green-900' : 'text-gray-900'}`}>{s.score}</div>
                      <div className="h-1 bg-gray-100 rounded-b">
                        <div className={`h-1 rounded-b ${won ? 'bg-green-500' : 'bg-blue-400'}`} style={{ width: `${(s.score / maxScore) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className={getCardClasses('sm')}>
      <div className="text-xs font-medium text-gray-700 uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-700">{sub}</div>}
    </div>
  );
}
