'use client';

// app/halve-it/page.tsx
// Halve It — the winter darts league. League table (Total / Average / Best N),
// the season's nights, and season records. Any member can view; the Darts role
// (or Admin) also gets a link to Manage. Only final nights count.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { getButtonClasses, getCardClasses } from '@/config/theme-helpers';
import { useHalveItData, initialSeasonQuery, playerNames, nameList, Spinner, SeasonPicker, Position, isTied } from '@/components/halveit/shared';
import { averageTable, bestNTable, computePlayerStats, computeRecords, finalNights, formatAverage, summariseNight, totalTable } from '@/lib/halveit-stats';
import type { PlayerStats, Ranked } from '@/lib/halveit-stats';
import { formatNightDate, seasonSpan } from '@/types/halveit';
import type { HalveItSeasonData } from '@/types/halveit';

type Tab = 'table' | 'nights' | 'records';
type TableMode = 'total' | 'average' | 'bestN';

const TABS: { id: Tab; label: string }[] = [
  { id: 'table', label: 'League Table' },
  { id: 'nights', label: 'Nights' },
  { id: 'records', label: 'Records' },
];

const TABLE_MODES: { id: TableMode; label: string }[] = [
  { id: 'total', label: 'Total' },
  { id: 'average', label: 'Average' },
  { id: 'bestN', label: 'Best N' },
];

/** A night's date by id, for the records cards. */
function nightDate(data: HalveItSeasonData, nightId: string): string {
  for (const n of data.nights) {
    if (n.id === nightId) return formatNightDate(n.date);
  }
  return '';
}

export default function HalveItPage() {
  const [query, setQuery] = useState<string | null>(initialSeasonQuery);
  const { data, error, loading } = useHalveItData(query);
  const [tab, setTab] = useState<Tab>('table');
  const [mode, setMode] = useState<TableMode>('total');

  // Everything below is worked out from the season's raw scores
  const stats = useMemo(() => (data ? computePlayerStats(data) : []), [data]);
  const nights = useMemo(() => (data ? finalNights(data).reverse() : []), [data]); // newest first
  const records = useMemo(() => (data ? computeRecords(data, stats) : null), [data, stats]);
  const names = useMemo(() => playerNames(data ? data.players : []), [data]);

  function changeSeason(season: number) {
    window.history.replaceState(null, '', `/halve-it?season=${season}`);
    setQuery(`season=${season}`);
  }

  if (loading && !data) return <Spinner />;
  if (!data) return <p className="p-6 text-sm text-red-700">{error || 'Failed to load Halve It'}</p>;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main className="max-w-5xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Halve It</h1>
            <p className="text-sm text-gray-700">Winter darts league · {data.season} season ({seasonSpan(data.season)})</p>
          </div>
          <div className="flex gap-2 items-center">
            <SeasonPicker seasons={data.seasons} value={data.season} onChange={changeSeason} />
            {data.canManage && (
              <Link href={`/halve-it/manage?season=${data.season}`} className={getButtonClasses('primary', 'md')}>Manage</Link>
            )}
          </div>
        </div>

        <div className="flex gap-1 border-b border-gray-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-700 hover:text-gray-900'}`}
            >
              {t.id === 'nights' ? `Nights (${nights.length})` : t.label}
            </button>
          ))}
        </div>

        {nights.length === 0 && (
          <div className={getCardClasses('md')}>
            <p className="text-sm text-gray-700">No results yet for the {data.season} season.</p>
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
                    className={`px-3 py-1.5 text-sm rounded-md ${mode === m.id ? 'bg-blue-600 text-white' : 'text-gray-900 hover:bg-gray-100'}`}
                  >
                    {m.id === 'bestN' ? `Best ${data.settings.bestNGames}` : m.label}
                  </button>
                ))}
              </div>
              <p className="text-sm text-gray-700">
                {mode === 'total' && 'All scores added together.'}
                {mode === 'average' && `Average score per game. ${data.settings.minGamesForAverage} games needed to qualify.`}
                {mode === 'bestN' && `Each player's best ${data.settings.bestNGames} game scores added together.`}
              </p>
            </div>

            {mode === 'total' && <LeagueTable rows={totalTable(stats)} highlight="total" bestN={data.settings.bestNGames} />}
            {mode === 'bestN' && <LeagueTable rows={bestNTable(stats)} highlight="bestN" bestN={data.settings.bestNGames} />}
            {mode === 'average' && <AverageTable stats={stats} minGames={data.settings.minGamesForAverage} bestN={data.settings.bestNGames} />}
          </div>
        )}

        {tab === 'nights' && nights.length > 0 && (
          <div className="space-y-2">
            {nights.map((n) => {
              const summary = summariseNight(n, data.scores);
              return (
                <Link key={n.id} href={`/halve-it/nights/${n.id}`} className={`${getCardClasses('sm')} block hover:bg-gray-50`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-gray-900">{formatNightDate(n.date)}</div>
                    <div className="text-sm text-gray-700">{summary.players} players · {summary.games.length} games</div>
                  </div>
                  {summary.topScore && (
                    <div className="text-sm text-gray-700 mt-1">
                      Top score: <span className="font-semibold text-gray-900">{summary.topScore.score}</span> — {nameList(names, summary.topScore.playerIds)}
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
                    <div key={i} className="text-sm text-gray-700">{names.get(e.playerId)} · {nightDate(data, e.nightId)}</div>
                  ))}
                </>
              )}
            </RecordCard>
            <RecordCard title="Highest night total">
              {records.highestNightTotal && (
                <>
                  <div className="text-2xl font-bold text-gray-900">{records.highestNightTotal.total}</div>
                  {records.highestNightTotal.entries.map((e, i) => (
                    <div key={i} className="text-sm text-gray-700">{names.get(e.playerId)} · {nightDate(data, e.nightId)} ({e.games} games)</div>
                  ))}
                </>
              )}
            </RecordCard>
            <RecordCard title="Most game wins">
              {records.mostGameWins && (
                <>
                  <div className="text-2xl font-bold text-gray-900">{records.mostGameWins.wins}</div>
                  <div className="text-sm text-gray-700">{nameList(names, records.mostGameWins.playerIds)}</div>
                </>
              )}
            </RecordCard>
            <RecordCard title={`Best average (min ${data.settings.minGamesForAverage} games)`}>
              {records.highestAverage && (
                <>
                  <div className="text-2xl font-bold text-gray-900">{formatAverage(records.highestAverage.average)}</div>
                  <div className="text-sm text-gray-700">{nameList(names, records.highestAverage.playerIds)}</div>
                </>
              )}
            </RecordCard>
            <RecordCard title="Most games played">
              {records.mostGamesPlayed && (
                <>
                  <div className="text-2xl font-bold text-gray-900">{records.mostGamesPlayed.games}</div>
                  <div className="text-sm text-gray-700">{nameList(names, records.mostGamesPlayed.playerIds)}</div>
                </>
              )}
            </RecordCard>
            <RecordCard title="Season so far">
              <div className="text-2xl font-bold text-gray-900">{records.nights} nights</div>
              <div className="text-sm text-gray-700">{records.games} games played</div>
            </RecordCard>
          </div>
        )}
      </main>
    </div>
  );
}

/** Average table: qualified players ranked, then who hasn't played enough games yet. */
function AverageTable({ stats, minGames, bestN }: { stats: PlayerStats[]; minGames: number; bestN: number }) {
  const { qualified, unqualified } = averageTable(stats, minGames);
  return (
    <>
      <LeagueTable rows={qualified} highlight="average" bestN={bestN} />
      {unqualified.length > 0 && (
        <div className={getCardClasses('sm')}>
          <p className="text-sm font-medium text-gray-900 mb-2">Not yet qualified</p>
          <ul className="text-sm text-gray-700 space-y-1">
            {unqualified.map((s) => (
              <li key={s.player.id} className="flex justify-between gap-3">
                <Link href={`/halve-it/players/${s.player.id}`} className="text-blue-700 hover:underline">{s.player.name}</Link>
                <span>
                  avg {formatAverage(s.average)} · {s.games} game{s.games !== 1 ? 's' : ''}, needs {minGames - s.games} more
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function LeagueTable({ rows, highlight, bestN }: { rows: Ranked<PlayerStats>[]; highlight: TableMode; bestN: number }) {
  if (rows.length === 0) return <p className="text-sm text-gray-700">Nobody qualifies yet.</p>;
  // The column the table is ranked by is shown bold
  const cell = (key: TableMode) => `px-3 py-2 text-right ${highlight === key ? 'font-semibold' : ''}`;
  return (
    <div className="bg-white shadow rounded-lg overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm text-gray-900">
        <thead className="bg-gray-50">
          <tr className="text-xs font-medium text-gray-700 uppercase tracking-wider">
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
                <Link href={`/halve-it/players/${r.item.player.id}`} className="text-blue-700 hover:underline font-medium">{r.item.player.name}</Link>
              </td>
              <td className="px-3 py-2 text-right">{r.item.nights}</td>
              <td className="px-3 py-2 text-right">{r.item.games}</td>
              <td className="px-3 py-2 text-right">{r.item.gameWins}</td>
              <td className="px-3 py-2 text-right">{r.item.best === null ? '—' : r.item.best}</td>
              <td className={cell('average')}>{formatAverage(r.item.average)}</td>
              {highlight === 'bestN' ? (
                <td className={cell('bestN')}>
                  {r.item.bestN}
                  {r.item.bestNCount < bestN && (
                    <span className="ml-1 text-xs font-normal text-gray-700" title={`Only ${r.item.bestNCount} games played so far`}>({r.item.bestNCount})</span>
                  )}
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
      <div className="text-xs font-medium text-gray-700 uppercase tracking-wider mb-1">{title}</div>
      {children || <div className="text-sm text-gray-700">—</div>}
    </div>
  );
}
