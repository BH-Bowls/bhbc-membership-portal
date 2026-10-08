'use client';

// app/halve-it/players/[playerId]/page.tsx
// One Halve It player's season: summary figures, league positions, and every
// night's scores (game by game) with their position on the night.

import { use, useMemo } from 'react';
import Link from 'next/link';
import { getCardClasses } from '@/config/theme-helpers';
import { useHalveItData, Spinner } from '@/components/halveit/shared';
import { averageTable, bestNTable, computePlayerStats, finalNights, formatAverage, rank, summariseNight, totalTable } from '@/lib/halveit-stats';
import { formatNightDate } from '@/types/halveit';

export default function HalveItPlayerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = use(params);
  const { data, error, loading } = useHalveItData(`player=${encodeURIComponent(playerId)}`);

  const stats = useMemo(() => (data ? computePlayerStats(data) : []), [data]);
  const mine = stats.find((s) => s.player.id === playerId) ?? null;

  const positions = useMemo(() => {
    if (!data) return null;
    const pos = (rows: { position: number; item: { player: { id: string } } }[]) => rows.find((r) => r.item.player.id === playerId)?.position ?? null;
    return {
      total: pos(totalTable(stats)),
      average: pos(averageTable(stats, data.settings.minGamesForAverage).qualified),
      bestN: pos(bestNTable(stats)),
    };
  }, [data, stats, playerId]);

  const nights = useMemo(() => {
    if (!data) return [];
    return finalNights(data)
      .reverse()
      .map((night) => {
        const summary = summariseNight(night, data.scores);
        const own = data.scores.filter((s) => s.nightId === night.id && s.playerId === playerId).sort((a, b) => a.gameNo - b.gameNo);
        if (!own.length) return null;
        const ranked = rank(summary.totals, (t) => t.total);
        const wins = summary.games.filter((g) => g.winners.includes(playerId)).map((g) => g.gameNo);
        return {
          night,
          own,
          wins,
          total: own.reduce((sum, s) => sum + s.score, 0),
          position: ranked.find((r) => r.item.playerId === playerId)?.position ?? null,
          field: summary.players,
        };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null);
  }, [data, playerId]);

  if (loading && !data) return <Spinner />;
  if (!data || !mine || !positions) return <p className="p-6 text-sm text-red-600">{error || 'Player not found'}</p>;

  const maxScore = Math.max(1, ...nights.flatMap((n) => n.own.map((s) => s.score)));

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <Link href={`/halve-it?season=${data.season}`} className="text-sm text-blue-600 hover:underline">← Halve It {data.season}</Link>
          <h1 className="text-2xl font-bold text-gray-900">{mine.player.name}</h1>
          <p className="text-sm text-gray-500">{data.season} season{!mine.player.active && ' · inactive'}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Average" value={formatAverage(mine.average)} />
          <Stat label="Best game" value={mine.best ?? '—'} />
          <Stat label="Games won" value={mine.gameWins} />
          <Stat label="Played" value={`${mine.games} games`} sub={`${mine.nights} nights`} />
        </div>

        <div className={getCardClasses('sm')}>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">League positions</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700">
            <span>Total: <strong>{ord(positions.total)}</strong> ({mine.total})</span>
            <span>
              Average: <strong>{positions.average === null ? 'not qualified' : ord(positions.average)}</strong>
              {positions.average === null && mine.games < data.settings.minGamesForAverage && ` (needs ${data.settings.minGamesForAverage - mine.games} more games)`}
            </span>
            <span>Best {data.settings.bestNGames}: <strong>{ord(positions.bestN)}</strong> ({mine.bestN})</span>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">Nights</h2>
          {nights.length === 0 && <p className="text-sm text-gray-500">No scores yet this season.</p>}
          {nights.map((n) => (
            <div key={n.night.id} className={getCardClasses('sm')}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <Link href={`/halve-it/nights/${n.night.id}`} className="font-medium text-blue-600 hover:underline">{formatNightDate(n.night.date)}</Link>
                <span className="text-sm text-gray-600">
                  Total <strong className="text-gray-900">{n.total}</strong> · {ord(n.position)} of {n.field}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {n.own.map((s) => {
                  const won = n.wins.includes(s.gameNo);
                  return (
                    <div key={s.gameNo} className={`w-14 rounded border text-center ${won ? 'border-green-300 bg-green-50' : 'border-gray-200'}`} title={won ? 'Won this game' : undefined}>
                      <div className="text-[10px] text-gray-500">G{s.gameNo}</div>
                      <div className={`text-sm font-semibold ${won ? 'text-green-800' : 'text-gray-900'}`}>{s.score}</div>
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

/** 1 -> "1st", 12 -> "12th", 22 -> "22nd". */
function ord(n: number | null): string {
  if (n === null) return '—';
  const teens = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teens ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return `${n}${suffix}`;
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className={getCardClasses('sm')}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}
