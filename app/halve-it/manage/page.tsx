'use client';

// app/halve-it/manage/page.tsx
// Halve It management (Darts role / Admin): the season's nights, team and league
// settings. Start a new night here, then enter its scores on the night page.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBadgeClasses, getButtonClasses, getCardClasses, getInputClasses } from '@/config/theme-helpers';
import { SearchableSelect } from '@/components/SearchableSelect';
import { RouterBackLink } from '@/components/RouterBackLink';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';
import { useHalveItData, useMemberOptions, initialSeasonQuery, Spinner, SeasonPicker } from '@/components/halveit/shared';
import { formatNightDate, seasonForDate, seasonSpan, todayIso } from '@/types/halveit';
import type { HalveItPlayer } from '@/types/halveit';

export default function HalveItManagePage() {
  const router = useRouter();
  const [query, setQuery] = useState<string | null>(initialSeasonQuery);
  const { data, error, loading, reload } = useHalveItData(query);
  const canManage = data !== null && data.canManage;
  const members = useMemberOptions(canManage);

  const [addUser, setAddUser] = useState('');
  const [teamError, setTeamError] = useState('');
  const [busy, setBusy] = useState(false);

  const [minGames, setMinGames] = useState('');
  const [bestN, setBestN] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  const [newDate, setNewDate] = useState(todayIso());
  const [nightError, setNightError] = useState('');

  const leagueHref = data ? `/halve-it?season=${data.season}` : '/halve-it';
  usePhoneBackNavigation(leagueHref);

  // Runs once the data arrives: anyone without the Darts role / Admin goes back to the league
  useEffect(() => {
    if (data && !data.canManage) router.push('/halve-it');
  }, [data, router]);

  // Runs when the season or its saved settings change (not on every reload, so
  // toggling a player doesn't wipe unsaved edits to the settings boxes)
  const season = data ? data.season : null;
  const savedMinGames = data ? data.settings.minGamesForAverage : null;
  const savedBestN = data ? data.settings.bestNGames : null;
  useEffect(() => {
    if (savedMinGames === null || savedBestN === null) return;
    setMinGames(String(savedMinGames));
    setBestN(String(savedBestN));
  }, [season, savedMinGames, savedBestN]);

  function changeSeason(newSeason: number) {
    window.history.replaceState(null, '', `/halve-it/manage?season=${newSeason}`);
    setQuery(`season=${newSeason}`);
  }

  /** Calls an API route and reloads; returns an error message, or null if it worked. */
  async function call(url: string, method: string, body?: unknown): Promise<string | null> {
    setBusy(true);
    try {
      const options: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) options.body = JSON.stringify(body);
      const res = await fetch(url, options);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return json.error || 'Something went wrong';
      }
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
    const err = await call(`/api/halve-it/players/${p.id}`, 'PATCH', { active: !p.active });
    setTeamError(err || '');
  }

  async function removePlayer(p: HalveItPlayer) {
    const err = await call(`/api/halve-it/players/${p.id}`, 'DELETE');
    setTeamError(err || '');
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
      const res = await fetch('/api/halve-it/nights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: newDate }),
      });
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
  if (!data) return <p className="p-6 text-sm text-red-700">{error || 'Failed to load Halve It'}</p>;
  if (!data.canManage) return null;

  // Members not already on this season's team
  const teamUsers = new Set<string>();
  let activeCount = 0;
  for (const p of data.players) {
    teamUsers.add(p.userName);
    if (p.active) activeCount++;
  }
  const memberOptions: { value: string; label: string }[] = [];
  for (const m of members) {
    if (!teamUsers.has(m.value)) memberOptions.push(m);
  }

  // Players with any scores can't be removed, only made inactive
  const playersWithScores = new Set<string>();
  for (const s of data.scores) playersWithScores.add(s.playerId);

  // Per night: how many players have scores
  const playersPerNight = new Map<string, Set<string>>();
  for (const s of data.scores) {
    if (!playersPerNight.has(s.nightId)) playersPerNight.set(s.nightId, new Set());
    playersPerNight.get(s.nightId)!.add(s.playerId);
  }

  const nights = [...data.nights].reverse(); // newest first
  let newDateSeason: number | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(newDate)) newDateSeason = seasonForDate(newDate);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <RouterBackLink fallbackHref={leagueHref} label={`Halve It ${data.season}`} />
            <h1 className="text-2xl font-bold text-gray-900">Manage Halve It</h1>
            <p className="text-sm text-gray-700">{data.season} season ({seasonSpan(data.season)})</p>
          </div>
          <SeasonPicker seasons={data.seasons} value={data.season} onChange={changeSeason} />
        </div>

        {/* Nights */}
        <section className={`${getCardClasses('md')} space-y-3`}>
          <h2 className="text-lg font-semibold text-gray-900">Nights</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Date</label>
              <input type="date" className={`${getInputClasses()} w-auto`} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <button onClick={startNight} disabled={busy || !newDate} className={getButtonClasses('primary', 'md')}>Start night</button>
          </div>
          {newDateSeason !== null && newDateSeason !== data.season && (
            <p className="text-sm text-amber-800">That date is in the {newDateSeason} season.</p>
          )}
          {nightError && <p className="text-sm text-red-700">{nightError}</p>}
          {nights.length === 0 ? (
            <p className="text-sm text-gray-700">No nights yet this season.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {nights.map((n) => {
                const nightPlayers = playersPerNight.get(n.id);
                const playerCount = nightPlayers ? nightPlayers.size : 0;
                return (
                  <li key={n.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{formatNightDate(n.date)}</span>
                      <span className={getBadgeClasses(n.status === 'final' ? 'success' : 'warning', 'sm')}>{n.status === 'final' ? 'Final' : 'Draft'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-gray-700">{playerCount} players · {n.gamesCount} games</span>
                      <Link href={`/halve-it/manage/nights/${n.id}`} className="text-blue-700 hover:text-blue-900 font-medium">Scores</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Team */}
        <section className={`${getCardClasses('md')} space-y-3`}>
          <h2 className="text-lg font-semibold text-gray-900">Team ({activeCount} active)</h2>
          <div className="flex gap-2 items-center">
            <SearchableSelect options={memberOptions} value={addUser} onChange={setAddUser} placeholder="Search members to add…" className="flex-1" />
            <button onClick={addPlayer} disabled={busy || !addUser} className={getButtonClasses('primary', 'md')}>Add</button>
          </div>
          {teamError && <p className="text-sm text-red-700">{teamError}</p>}
          {data.players.length === 0 ? (
            <p className="text-sm text-gray-700">No players yet. Add members above — you can add more at any time, including on the night.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.players.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                  <span className="text-gray-900">
                    {p.name}
                    {!p.active && <span className={`${getBadgeClasses('secondary', 'sm')} ml-2`}>Inactive</span>}
                  </span>
                  <div className="flex gap-3 text-sm">
                    <button onClick={() => toggleActive(p)} disabled={busy} className="text-blue-700 hover:text-blue-900">
                      {p.active ? 'Make inactive' : 'Make active'}
                    </button>
                    {!playersWithScores.has(p.id) && (
                      <button onClick={() => removePlayer(p)} disabled={busy} className="text-red-700 hover:text-red-900">Remove</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-gray-700">Inactive players keep their scores and stay in the tables, but aren&apos;t listed when entering a new night.</p>
        </section>

        {/* Settings */}
        <section className={`${getCardClasses('md')} space-y-3`}>
          <h2 className="text-lg font-semibold text-gray-900">League settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Games needed to qualify for the Average table</label>
              <input type="number" min={1} className={getInputClasses()} value={minGames} onChange={(e) => { setMinGames(e.target.value); setSettingsMsg(''); }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Games counted in the Best N table</label>
              <input type="number" min={1} className={getInputClasses()} value={bestN} onChange={(e) => { setBestN(e.target.value); setSettingsMsg(''); }} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveSettings} disabled={busy} className={getButtonClasses('secondary', 'md')}>Save settings</button>
            {settingsMsg && <span className={`text-sm ${settingsMsg === 'Saved' ? 'text-green-800' : 'text-red-700'}`}>{settingsMsg}</span>}
          </div>
        </section>
      </main>
    </div>
  );
}
