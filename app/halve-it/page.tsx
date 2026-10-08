'use client';

// app/halve-it/page.tsx
// Halve It — the winter darts league. League table (Total / Average / Best N),
// the season's nights, and season records. Any member can view; the Darts role
// (or Admin) also gets a link to Manage. Only final nights count.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { getButtonClasses, getCardClasses } from '@/config/theme-helpers';
import { useHalveItData, initialSeasonQuery, Spinner, SeasonPicker, Position, isTied } from '@/components/halveit/shared';
import { averageTable, bestNTable, computePlayerStats, computeRecords, finalNights, formatAverage, summariseNight, totalTable } from '@/lib/halveit-stats';
import type { PlayerStats, Ranked } from '@/lib/halveit-stats';
import { formatNightDate, seasonSpan } from '@/types/halveit';

type Tab = 'table' | 'nights' | 'records';
type TableMode = 'total' | 'average' | 'bestN';

const TABLE_MODES: { id: TableMode; label: string }[] = [
  { id: 'total', label: 'Total' },
  { id: 'average', label: 'Average' },
  { id: 'bestN', label: 'Best N' },
];

export default function HalveItPage() {
  const [query, setQuery] = useState<string | null>(initialSeasonQuery);
  const { data, error, loading } = useHalveItData(query);
  const [tab, setTab] = useState<Tab>('table');
  const [mode, setMode] = useState<TableMode>('total');

  const stats = useMemo(() => (data ? computePlayerStats(data) : []), [data]);
  const nights = useMemo(() => (data ? finalNights(data).reverse() : []), [data]);
  const records = useMemo(() => (data ? computeRecords(data, stats) : null), [data, stats]);
  const names = useMemo(() => new Map((data?.players ?? []).map((p) => [p.id, p.name])), [data]);

  function changeSeason(season: number) {
    window.history.replaceState(null, '', `/halve-it?season=${season}`);
    setQuery(`season=${season}`);
  }

  if (loading && !data) return <Spinner />;
  if (!data) return <p className="p-6 text-sm text-red-600">{error || 'Failed to load Halve It'}</p>;

  const nameList = (ids: string[]) => ids.map((id) => names.get(id) || 'Unknown').join(', ');
  const nightDate = (id: string) => {
    const n = data.nights.find((x) => x.id === id);
    return n ? formatNightDate(n.date) : '';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-5xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Halve It</h1>
            <p className="text-sm text-gray-500">Winter darts league · {data.season} season ({seasonSpan(data.season)})</p>
          </div>
          <div className="flex gap-2 items-center">
            <SeasonPicker seasons={data.seasons} value={data.season} onChange={changeSeason} />
            {data.canManage && (
              <Link href={`/halve-it/manage?season=${data.season}`} className={getButtonClasses('primary', 'md')}>Manage</Link>
            )}
          </div>
        </div>

        <div className="flex gap-1 border-b border-gray-200">
          {([['table', 'League Table'], ['nights', `Nights (${nights.length})`], ['records', 'Records']] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {nights.length === 0 && (
          <div className={getCardClasses('md')}>
            <p className="text-sm text-gray-600">No results yet for the {data.season} season.</p>
          </div>
        )}

        {tab === 'table' && nights.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
                {TABLE_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`px-3 py-1.5 text-sm rounded-md ${mode === m.id ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                  >
                    {m.id === 'bestN' ? `Best ${data.settings.bestNGames}` : m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                {mode === 'total' && 'All scores added together.'}
                {mode === 'average' && `Average score per game. ${data.settings.minGamesForAverage} games needed to qualify.`}
                {mode === 'bestN' && `Each player's best ${data.settings.bestNGames} game scores added together.`}
              </p>
            </div>

            {mode === 'average' ? (
              (() => {
                const { qualified, unqualified } = averageTable(stats, data.settings.minGamesForAverage);
                return (
                  <>
                    <LeagueTable rows={qualified} highlight="average" bestN={data.settings.bestNGames} />
                    {unqualified.length > 0 && (
                      <div className={getCardClasses('sm')}>
                        <p className="text-sm font-medium text-gray-700 mb-2">Not yet qualified</p>
                        <ul className="text-sm text-gray-600 space-y-1">
                          {unqualified.map((s) => (
                            <li key={s.player.id} className="flex justify-between gap-3">
                              <Link href={`/halve-it/players/${s.player.id}`} className="text-blue-600 hover:underline">{s.player.name}</Link>
                              <span>
                                avg {formatAverage(s.average)} · {s.games} game{s.games !== 1 ? 's' : ''}, needs {data.settings.minGamesForAverage - s.games} more
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                );
              })()
            ) : (
              <LeagueTable rows={mode === 'total' ? totalTable(stats) : bestNTable(stats)} highlight={mode} bestN={data.settings.bestNGames} />
            )}
          </div>
        )}

        {tab === 'nights' && nights.length > 0 && (
          <div className="space-y-2">
            {nights.map((n) => {
              const s = summariseNight(n, data.scores);
              return (
                <Link key={n.id} href={`/halve-it/nights/${n.id}`} className={`${getCardClasses('sm')} block hover:bg-gray-50`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-gray-900">{formatNightDate(n.date)}</div>
                    <div className="text-sm text-gray-500">{s.players} players · {s.games.length} games</div>
                  </div>
                  {s.topScore && (
                    <div className="text-sm text-gray-600 mt-1">
                      Top score: <span className="font-semibold text-gray-900">{s.topScore.score}</span> — {nameList(s.topScore.playerIds)}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        {tab === 'records' && records && nights.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <RecordCard title="Highest single game">
              {records.highestGame && (
                <>
                  <div className="text-2xl font-bold text-gray-900">{records.highestGame.score}</div>
                  {records.highestGame.entries.map((e, i) => (
                    <div key={i} className="text-sm text-gray-600">{names.get(e.playerId)} · {nightDate(e.nightId)}</div>
                  ))}
                </>
              )}
            </RecordCard>
            <RecordCard title="Highest night total">
              {records.highestNightTotal && (
                <>
                  <div className="text-2xl font-bold text-gray-900">{records.highestNightTotal.total}</div>
                  {records.highestNightTotal.entries.map((e, i) => (
                    <div key={i} className="text-sm text-gray-600">{names.get(e.playerId)} · {nightDate(e.nightId)} ({e.games} games)</div>
                  ))}
                </>
              )}
            </RecordCard>
            <RecordCard title="Most game wins">
              {records.mostGameWins && (
                <>
                  <div className="text-2xl font-bold text-gray-900">{records.mostGameWins.wins}</div>
                  <div className="text-sm text-gray-600">{nameList(records.mostGameWins.playerIds)}</div>
                </>
              )}
            </RecordCard>
            <RecordCard title={`Best average (min ${data.settings.minGamesForAverage} games)`}>
              {records.highestAverage && (
                <>
                  <div className="text-2xl font-bold text-gray-900">{formatAverage(records.highestAverage.average)}</div>
                  <div className="text-sm text-gray-600">{nameList(records.highestAverage.playerIds)}</div>
                </>
              )}
            </RecordCard>
            <RecordCard title="Most games played">
              {records.mostGamesPlayed && (
                <>
                  <div className="text-2xl font-bold text-gray-900">{records.mostGamesPlayed.games}</div>
                  <div className="text-sm text-gray-600">{nameList(records.mostGamesPlayed.playerIds)}</div>
                </>
              )}
            </RecordCard>
            <RecordCard title="Season so far">
              <div className="text-2xl font-bold text-gray-900">{records.nights} nights</div>
              <div className="text-sm text-gray-600">{records.games} games played</div>
            </RecordCard>
          </div>
        )}
      </main>
    </div>
  );
}

function LeagueTable({ rows, highlight, bestN }: { rows: Ranked<PlayerStats>[]; highlight: 'total' | 'average' | 'bestN'; bestN: number }) {
  if (rows.length === 0) return <p className="text-sm text-gray-500">Nobody qualifies yet.</p>;
  const cell = (key: typeof highlight) => `px-3 py-2 text-right ${highlight === key ? 'font-semibold text-gray-900' : 'text-gray-600'}`;
  return (
    <div className="bg-white shadow rounded-lg overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            <th className="px-3 py-2 text-left">Pos</th>
            <th className="px-3 py-2 text-left">Player</th>
            <th className="px-3 py-2 text-right" title="Nights played">Nts</th>
            <th className="px-3 py-2 text-right" title="Games played">Gms</th>
            <th className="px-3 py-2 text-right" title="Games won">Won</th>
            <th className="px-3 py-2 text-right">Best</th>
            <th className="px-3 py-2 text-right">Avg</th>
            <th className="px-3 py-2 text-right">{highlight === 'bestN' ? `Best ${bestN}` : 'Total'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={r.item.player.id} className="hover:bg-gray-50">
              <td className="px-3 py-2"><Position position={r.position} tied={isTied(rows, i)} /></td>
              <td className="px-3 py-2">
                <Link href={`/halve-it/players/${r.item.player.id}`} className="text-blue-600 hover:underline font-medium">{r.item.player.name}</Link>
              </td>
              <td className="px-3 py-2 text-right text-gray-600">{r.item.nights}</td>
              <td className="px-3 py-2 text-right text-gray-600">{r.item.games}</td>
              <td className="px-3 py-2 text-right text-gray-600">{r.item.gameWins}</td>
              <td className="px-3 py-2 text-right text-gray-600">{r.item.best ?? '—'}</td>
              <td className={cell('average')}>{formatAverage(r.item.average)}</td>
              {highlight === 'bestN' ? (
                <td className={cell('bestN')}>
                  {r.item.bestN}
                  {r.item.bestNCount < bestN && <span className="ml-1 text-xs font-normal text-gray-400">({r.item.bestNCount})</span>}
                </td>
              ) : (
                <td className={cell('total')}>{r.item.total}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={getCardClasses('md')}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{title}</div>
      {children || <div className="text-sm text-gray-400">—</div>}
    </div>
  );
}
