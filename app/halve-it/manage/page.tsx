'use client';

// app/halve-it/manage/page.tsx
// Halve It management (Darts role / Admin): the season's team, league settings,
// and its nights — start a new night here, then enter scores on the night page.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBadgeClasses, getButtonClasses, getCardClasses, getInputClasses } from '@/config/theme-helpers';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useHalveItData, initialSeasonQuery, Spinner, SeasonPicker } from '@/components/halveit/shared';
import { formatNightDate, seasonForDate, seasonSpan, todayIso } from '@/types/halveit';
import type { HalveItPlayer } from '@/types/halveit';

export default function HalveItManagePage() {
  const router = useRouter();
  const [query, setQuery] = useState<string | null>(initialSeasonQuery);
  const { data, error, loading, reload } = useHalveItData(query);
  const [members, setMembers] = useState<{ value: string; label: string }[]>([]);

  const [addUser, setAddUser] = useState('');
  const [teamError, setTeamError] = useState('');
  const [busy, setBusy] = useState(false);

  const [minGames, setMinGames] = useState('');
  const [bestN, setBestN] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  const [newDate, setNewDate] = useState(todayIso());
  const [nightError, setNightError] = useState('');

  useEffect(() => {
    if (data && !data.canManage) router.push('/halve-it');
  }, [data, router]);

  // Only when the season or saved values change, so other reloads don't wipe unsaved edits
  const savedMinGames = data?.settings.minGamesForAverage;
  const savedBestN = data?.settings.bestNGames;
  useEffect(() => {
    if (savedMinGames === undefined || savedBestN === undefined) return;
    setMinGames(String(savedMinGames));
    setBestN(String(savedBestN));
  }, [data?.season, savedMinGames, savedBestN]);

  useEffect(() => {
    if (!data?.canManage || members.length) return;
    fetch('/api/halve-it/players')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => json?.members && setMembers(json.members))
      .catch(() => {});
  }, [data, members.length]);

  function changeSeason(season: number) {
    window.history.replaceState(null, '', `/halve-it/manage?season=${season}`);
    setQuery(`season=${season}`);
  }

  async function call(url: string, method: string, body?: unknown): Promise<string | null> {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return json.error || 'Something went wrong';
      await reload();
      return null;
    } catch {
      return 'Something went wrong';
    } finally {
      setBusy(false);
    }
  }

  async function addPlayer() {
    if (!data || !addUser) return;
    const err = await call('/api/halve-it/players', 'POST', { season: data.season, userName: addUser });
    setTeamError(err || '');
    if (!err) setAddUser('');
  }

  async function toggleActive(p: HalveItPlayer) {
    setTeamError((await call(`/api/halve-it/players/${p.id}`, 'PATCH', { active: !p.active })) || '');
  }

  async function removePlayer(p: HalveItPlayer) {
    setTeamError((await call(`/api/halve-it/players/${p.id}`, 'DELETE')) || '');
  }

  async function saveSettings() {
    if (!data) return;
    const err = await call('/api/halve-it/settings', 'PUT', {
      season: data.season,
      settings: { minGamesForAverage: parseInt(minGames), bestNGames: parseInt(bestN) },
    });
    setSettingsMsg(err || 'Saved');
  }

  async function startNight() {
    setNightError('');
    setBusy(true);
    try {
      const res = await fetch('/api/halve-it/nights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: newDate }) });
      const json = await res.json();
      if (!res.ok) {
        setNightError(json.error || 'Failed to start night');
        return;
      }
      router.push(`/halve-it/manage/nights/${json.night.id}`);
    } catch {
      setNightError('Failed to start night');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Spinner />;
  if (!data) return <p className="p-6 text-sm text-red-600">{error || 'Failed to load Halve It'}</p>;
  if (!data.canManage) return null;

  const teamUsers = new Set(data.players.map((p) => p.userName));
  const memberOptions = members.filter((m) => !teamUsers.has(m.value));
  const playersWithScores = new Set(data.scores.map((s) => s.playerId));
  const nights = [...data.nights].reverse();
  const newDateSeason = /^\d{4}-\d{2}-\d{2}$/.test(newDate) ? seasonForDate(newDate) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/halve-it?season=${data.season}`} className="text-sm text-blue-600 hover:underline">← Halve It {data.season}</Link>
            <h1 className="text-2xl font-bold text-gray-900">Manage Halve It</h1>
            <p className="text-sm text-gray-500">{data.season} season ({seasonSpan(data.season)})</p>
          </div>
          <SeasonPicker seasons={data.seasons} value={data.season} onChange={changeSeason} />
        </div>

        {/* Nights */}
        <section className={`${getCardClasses('md')} space-y-3`}>
          <h2 className="text-lg font-semibold text-gray-900">Nights</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" className={`${getInputClasses()} w-auto`} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <button onClick={startNight} disabled={busy || !newDate} className={getButtonClasses('primary', 'md')}>Start night</button>
          </div>
          {newDateSeason !== null && newDateSeason !== data.season && (
            <p className="text-xs text-amber-700">That date is in the {newDateSeason} season.</p>
          )}
          {nightError && <p className="text-sm text-red-600">{nightError}</p>}
          {nights.length === 0 ? (
            <p className="text-sm text-gray-500">No nights yet this season.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {nights.map((n) => {
                const scores = data.scores.filter((s) => s.nightId === n.id);
                const players = new Set(scores.map((s) => s.playerId)).size;
                return (
                  <li key={n.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{formatNightDate(n.date)}</span>
                      <span className={getBadgeClasses(n.status === 'final' ? 'success' : 'warning', 'sm')}>{n.status === 'final' ? 'Final' : 'Draft'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-gray-500">{players} players · {n.gamesCount} games</span>
                      <Link href={`/halve-it/manage/nights/${n.id}`} className="text-blue-600 hover:text-blue-800 font-medium">Scores</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Team */}
        <section className={`${getCardClasses('md')} space-y-3`}>
          <h2 className="text-lg font-semibold text-gray-900">Team ({data.players.filter((p) => p.active).length} active)</h2>
          <div className="flex gap-2 items-center">
            <SearchableSelect options={memberOptions} value={addUser} onChange={setAddUser} placeholder="Search members to add…" className="flex-1" />
            <button onClick={addPlayer} disabled={busy || !addUser} className={getButtonClasses('primary', 'md')}>Add</button>
          </div>
          {teamError && <p className="text-sm text-red-600">{teamError}</p>}
          {data.players.length === 0 ? (
            <p className="text-sm text-gray-500">No players yet. Add members above — you can add more at any time, including on the night.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.players.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                  <span className={p.active ? 'text-gray-900' : 'text-gray-400 line-through'}>{p.name}</span>
                  <div className="flex gap-3 text-sm">
                    <button onClick={() => toggleActive(p)} disabled={busy} className="text-blue-600 hover:text-blue-800">
                      {p.active ? 'Make inactive' : 'Make active'}
                    </button>
                    {!playersWithScores.has(p.id) && (
                      <button onClick={() => removePlayer(p)} disabled={busy} className="text-red-600 hover:text-red-800">Remove</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500">Inactive players keep their scores and stay in the tables, but aren&apos;t listed when entering a new night.</p>
        </section>

        {/* Settings */}
        <section className={`${getCardClasses('md')} space-y-3`}>
          <h2 className="text-lg font-semibold text-gray-900">League settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Games needed to qualify for the Average table</label>
              <input type="number" min={1} className={getInputClasses()} value={minGames} onChange={(e) => { setMinGames(e.target.value); setSettingsMsg(''); }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Games counted in the Best N table</label>
              <input type="number" min={1} className={getInputClasses()} value={bestN} onChange={(e) => { setBestN(e.target.value); setSettingsMsg(''); }} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveSettings} disabled={busy} className={getButtonClasses('secondary', 'md')}>Save settings</button>
            {settingsMsg && <span className={`text-sm ${settingsMsg === 'Saved' ? 'text-green-700' : 'text-red-600'}`}>{settingsMsg}</span>}
          </div>
        </section>
      </main>
    </div>
  );
}
