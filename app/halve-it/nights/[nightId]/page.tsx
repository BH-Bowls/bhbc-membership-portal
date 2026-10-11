'use client';

// app/halve-it/nights/[nightId]/page.tsx
// One Halve It night: every player's score in every game, their night totals,
// and the winner of each game (highlighted). A dash = didn't play that game.

import { use, useMemo } from 'react';
import Link from 'next/link';
import { getButtonClasses } from '@/config/theme-helpers';
import { RouterBackLink } from '@/components/RouterBackLink';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';
import { useHalveItData, playerNames, Spinner } from '@/components/halveit/shared';
import { summariseNight, formatAverage } from '@/lib/halveit-stats';
import { formatNightDate } from '@/types/halveit';
import type { HalveItNight } from '@/types/halveit';

export default function HalveItNightPage({ params }: { params: Promise<{ nightId: string }> }) {
  const { nightId } = use(params);
  const { data, error, loading } = useHalveItData(`night=${encodeURIComponent(nightId)}`);

  // Find this night in the season's data
  let night: HalveItNight | null = null;
  if (data) {
    for (const n of data.nights) {
      if (n.id === nightId) night = n;
    }
  }

  const leagueHref = data ? `/halve-it?season=${data.season}` : '/halve-it';
  usePhoneBackNavigation(leagueHref);

  const summary = useMemo(() => (data && night ? summariseNight(night, data.scores) : null), [data, night]);

  if (loading && !data) return <Spinner />;
  if (!data || !night || !summary) return <p className="p-6 text-sm text-red-700">{error || 'Night not found'}</p>;

  const names = playerNames(data.players);

  // Lookups for the grid: each score by player:game, and which cells won their game
  const scoreOf = new Map<string, number>();
  for (const s of data.scores) {
    if (s.nightId === nightId) scoreOf.set(`${s.playerId}:${s.gameNo}`, s.score);
  }
  const winners = new Set<string>();
  const gameNos: number[] = [];
  for (const game of summary.games) {
    gameNos.push(game.gameNo);
    for (const playerId of game.winners) winners.add(`${playerId}:${game.gameNo}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main className="max-w-5xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <RouterBackLink fallbackHref={leagueHref} label={`Halve It ${data.season}`} />
            <h1 className="text-2xl font-bold text-gray-900">{formatNightDate(night.date)}</h1>
            <p className="text-sm text-gray-700">
              {summary.players} players · {summary.games.length} games
              {night.status === 'draft' && <span className="ml-2 text-amber-800 font-medium">Draft — not counted yet</span>}
            </p>
          </div>
          {data.canManage && (
            <Link href={`/halve-it/manage/nights/${night.id}`} className={getButtonClasses('secondary', 'md')}>Edit scores</Link>
          )}
        </div>

        {night.notes && <p className="text-sm text-gray-900 bg-white rounded-lg shadow px-4 py-3 whitespace-pre-line">{night.notes}</p>}

        {summary.totals.length === 0 ? (
          <p className="text-sm text-gray-700">No scores entered for this night.</p>
        ) : (
          <div className="bg-white shadow rounded-lg overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm text-gray-900">
              <thead className="bg-gray-50">
                <tr className="text-xs font-medium text-gray-700 uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Player</th>
                  {gameNos.map((g) => <th key={g} className="px-3 py-2 text-right">G{g}</th>)}
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.totals.map((t) => (
                  <tr key={t.playerId} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={`/halve-it/players/${t.playerId}`} className="text-blue-700 hover:underline font-medium">{names.get(t.playerId)}</Link>
                    </td>
                    {gameNos.map((g) => {
                      const key = `${t.playerId}:${g}`;
                      const score = scoreOf.get(key);
                      return (
                        <td key={g} className={`px-3 py-2 text-right ${winners.has(key) ? 'bg-green-50 font-semibold text-green-900' : ''}`}>
                          {score === undefined ? <span className="text-gray-700">–</span> : score}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-semibold">{t.total}</td>
                    <td className="px-3 py-2 text-right">{formatAverage(t.total / t.games)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-gray-700">Green = game winner. – = didn&apos;t play that game.</p>
      </main>
    </div>
  );
}
