// app/fixtures/season-planning/leagues/page.tsx
// Season Planning Stage 3 (Leagues) — structurally different from Events/
// Friendlies: league fixtures come from Sussex County Bowls, not from a
// carry-forward projection, so there's no Projected/Confirmed decision here.
// The committee generates a blank weekly skeleton per league ("No Game"
// placeholders, no club/H-A/format yet) up front, then fills each one in via
// Edit as the county's real schedule and opponents become known. Rows always
// land straight at Confirmed (see generateLeagueSlots in
// season-planning-supabase.ts) — no status badges shown here, since every
// row is the same status, unlike Events/Friendlies where it varies.
//
// League fixtures are deliberately NOT fed into Friendlies' same-day rink
// capacity math (season-planning-capacity.ts) — leagues play at 18:00,
// Friendlies at 14:00, so there's no shared-green clash to model. The
// "Multiple Games" same-day header badge below is purely a headcount, not a
// capacity warning — useful since e.g. MSL and JSL can both land on the same
// Tuesday.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SeasonPlanningTabs } from '@/components/SeasonPlanningTabs';
import { hasRole } from '@/lib/role-utils';
import { getButtonClasses } from '@/config/theme-helpers';
import { LEAGUE_GAME_TYPES, type LeagueGameType } from '@/lib/types/friendlies';
import type { Season, PlanningFixture } from '@/lib/season-planning-supabase';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Auto-fill for the Generate Slots panel — still editable, in case a
// league's night ever changes.
const LEAGUE_DEFAULTS: Record<LeagueGameType, { weekday: number; time: string }> = {
  'N/S A': { weekday: 1, time: '18:00' },
  'N/S B': { weekday: 1, time: '18:00' },
  'MSL': { weekday: 2, time: '18:00' },
  'JSL': { weekday: 2, time: '18:00' },
  'BL': { weekday: 4, time: '18:00' },
};

function leagueBadgeClasses(type: string): string {
  switch (type) {
    case 'N/S A':
    case 'N/S B': return 'bg-purple-100 text-purple-800';
    case 'MSL':
    case 'JSL':
    case 'BL': return 'bg-indigo-100 text-indigo-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function parseUKDateSafe(dateStr: string): Date | null {
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!ukMatch) return null;
  const d = new Date(parseInt(ukMatch[3]), parseInt(ukMatch[2]) - 1, parseInt(ukMatch[1]));
  return isNaN(d.getTime()) ? null : d;
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = parseUKDateSafe(dateStr);
  if (!d) return dateStr;
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES_SHORT[d.getMonth()]}`;
}

function toDateInputValue(dateStr: string): string {
  if (!dateStr) return '';
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) return `${ukMatch[3]}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;
  return '';
}

function displayClubName(clubName: string, clubSuffix: string): string {
  return [clubName, clubSuffix].filter(Boolean).join(' ');
}

export default function SeasonPlanningLeaguesPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const role = session && session.user ? session.user.role : '';
  const isAdmin = hasRole(role, 'Admin');
  const isCaptain = hasRole(role, 'Captain');
  const canAccess = isAdmin || isCaptain;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draftSeason, setDraftSeason] = useState<Season | null>(null);
  const [leagues, setLeagues] = useState<PlanningFixture[]>([]);
  const [clubNames, setClubNames] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<'All' | LeagueGameType>('All');

  const [generating, setGenerating] = useState(false);
  const [genFields, setGenFields] = useState({
    leagueType: LEAGUE_GAME_TYPES[0] as LeagueGameType,
    weekday: LEAGUE_DEFAULTS[LEAGUE_GAME_TYPES[0]].weekday,
    time: LEAGUE_DEFAULTS[LEAGUE_GAME_TYPES[0]].time,
    startDate: '', endDate: '',
  });
  const [submittingGenerate, setSubmittingGenerate] = useState(false);

  const [addingFixture, setAddingFixture] = useState(false);
  const [newFixture, setNewFixture] = useState({
    leagueType: LEAGUE_GAME_TYPES[0] as LeagueGameType,
    date: '', time: '18:00', description: '', clubName: '', clubSuffix: '', homeAway: 'H' as 'H' | 'A', format: '',
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editClubName, setEditClubName] = useState('');
  const [editClubSuffix, setEditClubSuffix] = useState('');
  const [editHomeAway, setEditHomeAway] = useState<'H' | 'A' | ''>('');
  const [editFormat, setEditFormat] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (session === null) { router.push('/'); return; }
    if (session && !canAccess) { router.push('/'); return; }
  }, [session, canAccess, router]);

  function loadSeasons() {
    fetch('/api/fixtures/season-planning/seasons')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDraftSeason(data.draftSeason);
        if (data.draftSeason) {
          return loadLeagues(data.draftSeason.id);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function loadLeagues(seasonId: string) {
    return fetch(`/api/fixtures/season-planning/leagues?seasonId=${seasonId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setLeagues(data.leagues || []);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (canAccess) loadSeasons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  useEffect(() => {
    if (!canAccess) return;
    fetch('/api/clubs')
      .then((r) => (r.ok ? r.json() : { clubs: [] }))
      .then((data) => setClubNames((data.clubs || []).map((c: any) => c.clubName).filter(Boolean).sort()))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  function selectGenLeagueType(leagueType: LeagueGameType) {
    setGenFields({ ...genFields, leagueType, weekday: LEAGUE_DEFAULTS[leagueType].weekday, time: LEAGUE_DEFAULTS[leagueType].time });
  }

  function submitGenerate() {
    if (!draftSeason) return;
    setError(null);
    setSubmittingGenerate(true);
    fetch('/api/fixtures/season-planning/leagues/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: draftSeason.id, ...genFields }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setGenerating(false);
        setGenFields({ ...genFields, startDate: '', endDate: '' });
        return loadLeagues(draftSeason.id);
      })
      .catch((err) => setError(err.message))
      .finally(() => setSubmittingGenerate(false));
  }

  function submitAddFixture() {
    if (!draftSeason) return;
    setError(null);
    fetch('/api/fixtures/season-planning/leagues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: draftSeason.id, ...newFixture }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAddingFixture(false);
        setNewFixture({ leagueType: LEAGUE_GAME_TYPES[0], date: '', time: '18:00', description: '', clubName: '', clubSuffix: '', homeAway: 'H', format: '' });
        return loadLeagues(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function startEdit(fixture: PlanningFixture) {
    setEditingId(fixture.id);
    setEditDate(toDateInputValue(fixture.date));
    setEditTime(fixture.time);
    setEditClubName(fixture.clubName);
    setEditClubSuffix(fixture.clubSuffix);
    setEditHomeAway(fixture.homeAway);
    setEditFormat(fixture.format);
    setEditDescription(fixture.description);
  }

  function submitEdit() {
    if (!editingId || !draftSeason) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/leagues/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: editDate, time: editTime, clubName: editClubName,
        clubSuffix: editClubSuffix, homeAway: editHomeAway || undefined, format: editFormat,
        description: editDescription,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEditingId(null);
        return loadLeagues(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function submitDelete() {
    if (!deleteId || !draftSeason) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/leagues/${deleteId}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDeleteId(null);
        return loadLeagues(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  if (!session || !canAccess) return null;

  const visibleLeagues = leagues.filter((l) => typeFilter === 'All' || l.fixtureType === typeFilter);
  const sortedLeagues = [...visibleLeagues].sort((a, b) => {
    const da = a.date.split('/').reverse().join('-');
    const db = b.date.split('/').reverse().join('-');
    return da.localeCompare(db);
  });
  const dateGroups: string[] = [];
  const seenDates = new Set<string>();
  for (const l of sortedLeagues) {
    if (!seenDates.has(l.date)) { seenDates.add(l.date); dateGroups.push(l.date); }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session.user.name || undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Season Planning</h1>
        <p className="text-sm text-gray-700 mb-4">
          Leagues — Sussex County Bowls sets these fixtures, so there's no projection here. Generate a blank weekly skeleton per league, then fill each row in via Edit as the real schedule arrives.
        </p>

        <SeasonPlanningTabs active="leagues" />

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-700">Loading…</div>}

        {!loading && !draftSeason && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-2">No draft season yet</h2>
            <p className="text-sm text-gray-700">
              Create the draft season from the Events tab first, then come back here.
            </p>
          </div>
        )}

        {!loading && draftSeason && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="text-sm text-gray-700">
                Planning <span className="font-semibold text-gray-900">{draftSeason.year}</span> season
                {' '}({draftSeason.startDate} – {draftSeason.endDate})
              </div>
              <div className="flex gap-2">
                <button className={getButtonClasses('primary')} onClick={() => setGenerating(true)}>
                  Generate League Slots
                </button>
                <button className={getButtonClasses('secondary')} onClick={() => setAddingFixture(true)}>
                  Add Fixture
                </button>
              </div>
            </div>

            {generating && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h3 className="font-medium text-gray-900 mb-3 text-sm">Generate League Slots</h3>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">League</label>
                    <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={genFields.leagueType} onChange={(e) => selectGenLeagueType(e.target.value as LeagueGameType)}>
                      {LEAGUE_GAME_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Weekday</label>
                    <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={genFields.weekday} onChange={(e) => setGenFields({ ...genFields, weekday: parseInt(e.target.value, 10) })}>
                      {WEEKDAY_NAMES.map((name, idx) => <option key={idx} value={idx}>{name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Time</label>
                    <input type="time" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={genFields.time} onChange={(e) => setGenFields({ ...genFields, time: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Start date</label>
                    <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={genFields.startDate} onChange={(e) => setGenFields({ ...genFields, startDate: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">End date</label>
                    <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={genFields.endDate} onChange={(e) => setGenFields({ ...genFields, endDate: e.target.value })} />
                  </div>
                  <button className={getButtonClasses('primary')} onClick={submitGenerate} disabled={submittingGenerate}>
                    {submittingGenerate ? 'Generating…' : 'Generate'}
                  </button>
                  <button className={getButtonClasses('secondary')} onClick={() => setGenerating(false)}>Cancel</button>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Creates one blank "No Game" slot for every {WEEKDAY_NAMES[genFields.weekday]} between the two dates — no club, H/A, or format yet. Fill each one in via Edit as the real fixture becomes known.
                </p>
              </div>
            )}

            {addingFixture && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h3 className="font-medium text-gray-900 mb-3 text-sm">New Fixture</h3>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">League</label>
                    <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={newFixture.leagueType} onChange={(e) => setNewFixture({ ...newFixture, leagueType: e.target.value as LeagueGameType })}>
                      {LEAGUE_GAME_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                    <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={newFixture.date} onChange={(e) => setNewFixture({ ...newFixture, date: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Time</label>
                    <input type="text" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-24"
                      value={newFixture.time} onChange={(e) => setNewFixture({ ...newFixture, time: e.target.value })} />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Club</label>
                    <input type="text" list="club-names-list" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
                      value={newFixture.clubName} onChange={(e) => setNewFixture({ ...newFixture, clubName: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Suffix</label>
                    <input type="text" placeholder="e.g. A" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-16"
                      value={newFixture.clubSuffix} onChange={(e) => setNewFixture({ ...newFixture, clubSuffix: e.target.value })} />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                    <input type="text" placeholder="e.g. No Game" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
                      value={newFixture.description} onChange={(e) => setNewFixture({ ...newFixture, description: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">H/A</label>
                    <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={newFixture.homeAway} onChange={(e) => setNewFixture({ ...newFixture, homeAway: e.target.value as 'H' | 'A' })}>
                      <option value="H">Home</option>
                      <option value="A">Away</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Format</label>
                    <input type="text" placeholder="e.g. 3 Rinks" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-28"
                      value={newFixture.format} onChange={(e) => setNewFixture({ ...newFixture, format: e.target.value })} />
                  </div>
                  <button className={getButtonClasses('primary')} onClick={submitAddFixture}>Add</button>
                  <button className={getButtonClasses('secondary')} onClick={() => setAddingFixture(false)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="text-xs font-medium text-gray-700 mr-2">Show:</label>
              <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'All' | LeagueGameType)}>
                <option value="All">All leagues</option>
                {LEAGUE_GAME_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
              {sortedLeagues.length === 0 && (
                <div className="text-center py-12 text-gray-700 text-sm">
                  No league fixtures yet. Generate slots for a league or add one manually.
                </div>
              )}
              {dateGroups.map((date) => {
                const dayFixtures = sortedLeagues.filter((l) => l.date === date);
                const showHeader = dayFixtures.length > 1;

                return (
                  <div key={date} className="contents">
                    {showHeader && (
                      <div className="px-4 py-2 bg-slate-50 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{formatDisplayDate(date)}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-200 text-gray-800">
                          Multiple Games ({dayFixtures.length})
                        </span>
                      </div>
                    )}
                    {dayFixtures.map((fixture) => (
                      <div key={fixture.id} className="px-4 py-3">
                        {editingId === fixture.id ? (
                          <div className="flex flex-wrap items-end gap-3">
                            <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                              value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                            <input type="text" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-24"
                              value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                            <input type="text" list="club-names-list" placeholder="Club" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 min-w-[140px]"
                              value={editClubName} onChange={(e) => setEditClubName(e.target.value)} />
                            <input type="text" placeholder="e.g. A" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-16"
                              value={editClubSuffix} onChange={(e) => setEditClubSuffix(e.target.value)} />
                            <input type="text" placeholder="Description (e.g. No Game)" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 min-w-[160px]"
                              value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                            <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                              value={editHomeAway} onChange={(e) => setEditHomeAway(e.target.value as 'H' | 'A' | '')}>
                              <option value="">–</option>
                              <option value="H">Home</option>
                              <option value="A">Away</option>
                            </select>
                            <input type="text" placeholder="e.g. 3 Rinks" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-28"
                              value={editFormat} onChange={(e) => setEditFormat(e.target.value)} />
                            <button className={getButtonClasses('primary', 'sm')} onClick={submitEdit}>Save</button>
                            <button className={getButtonClasses('secondary', 'sm')} onClick={() => setEditingId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="w-28 text-sm text-gray-900">{formatDisplayDate(fixture.date)}</div>
                              <div className="w-16 text-sm text-gray-700">{fixture.time}</div>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${leagueBadgeClasses(fixture.fixtureType)}`}>
                                {fixture.fixtureType}
                              </span>
                              <div className="text-sm text-gray-900 font-medium">
                                {displayClubName(fixture.clubName, fixture.clubSuffix) || fixture.description || 'No Game'}
                              </div>
                              {fixture.homeAway && (
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  fixture.homeAway === 'A' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {fixture.homeAway === 'A' ? 'Away' : 'Home'}
                                </span>
                              )}
                              {fixture.format && (
                                <span className="text-xs text-gray-700">{fixture.format}</span>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button className="text-xs text-blue-600 hover:text-blue-800" onClick={() => startEdit(fixture)}>Edit</button>
                              <button className="text-xs text-red-600 hover:text-red-800" onClick={() => setDeleteId(fixture.id)}>Delete</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <datalist id="club-names-list">
        {clubNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="Delete this fixture?"
        message="This removes it from the plan entirely. You can add it back manually later if needed."
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={submitDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
