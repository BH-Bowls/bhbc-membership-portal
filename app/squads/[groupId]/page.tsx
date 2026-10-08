// app/squads/[groupId]/page.tsx
// One squad: the season's fixtures (with each member's own actions and the published
// teams), the squad list with appearances, and — for its organisers, Captains and
// Admins — adding/removing members, setting organisers, and picking each fixture's team.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getButtonClasses, getAlertClasses, getBadgeClasses } from '@/config/theme-helpers';
import { RouterBackLink } from '@/components/RouterBackLink';
import { parseUKDate } from '@/lib/date-utils';

interface FixturePlayer { username: string; fullName: string; team: number | null; position: string; withdrawn: boolean }
interface SquadFixture {
  id: string; tabName: string; date: string; time: string; fixtureType: string; opponent: string; homeAway: 'H' | 'A';
  clubName: string; description: string; ladiesMen: string;
  format: string; status: string; result: 'W' | 'L' | 'D' | null; bhbcScore: number | null; opponentScore: number | null;
  teaLead: string; teaFirst: string; players: FixturePlayer[];
  myPick: 'playing' | 'withdrawn' | null; myTeas: boolean; myUnavailable: boolean;
}
interface SquadMember { username: string; fullName: string; status: 'entered' | 'withdrawn'; appearances: number }
interface SquadDetail {
  group: { id: string; label: string; entryMode: 'self' | 'manager'; squadType: 'league' | 'club_team' | null };
  canManage: boolean;
  managers: Array<{ username: string; fullName: string }>;
  members: SquadMember[];
  fixtures: SquadFixture[];
  myEntry: { status: 'entered' | 'withdrawn' } | null;
  players: Array<{ userName: string; fullName: string }>;
  clubNames: string[];        // Club Team organisers: the club directory, for the opponent
  viewer: string;
}

// The Club Team fixture form
interface FixtureForm { date: string; time: string; clubName: string; opponentText: string; homeAway: 'H' | 'A'; format: string; ladiesMen: string }
const EMPTY_FORM: FixtureForm = { date: '', time: '', clubName: '', opponentText: '', homeAway: 'H', format: '', ladiesMen: 'Mixed' };

function ukToIsoDate(uk: string): string {
  const parts = uk.split('/');
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : '';
}

const STATUS_LABEL: Record<string, string> = { '': 'Not picked', X: 'Picking', S: 'Team published', P: 'Played', C: 'Cancelled', A: 'Abandoned' };
const POSITION_LABEL: Record<string, string> = { S: 'Skip', '1': 'Lead', '2': 'Two', '3': 'Three' };

function displayDate(uk: string): string {
  if (!uk) return 'Date TBC';
  const d = parseUKDate(uk);
  if (isNaN(d.getTime())) return uk;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function isUpcoming(uk: string): boolean {
  if (!uk) return true; // no date yet (Club Team fixture) — still to come
  const d = parseUKDate(uk);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !isNaN(d.getTime()) && d >= today;
}

export default function SquadPage() {
  const params = useParams();
  const groupId = params.groupId as string;
  const router = useRouter();

  const [detail, setDetail] = useState<SquadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openTeams, setOpenTeams] = useState<Set<string>>(new Set());
  const [showPast, setShowPast] = useState(false);
  const [addMember, setAddMember] = useState('');
  const [managerDraft, setManagerDraft] = useState<string[] | null>(null);
  const [addManager, setAddManager] = useState('');
  // Club Team fixtures: the add form, and the fixture being edited (id or 'new')
  const [editingFixture, setEditingFixture] = useState<string | null>(null);
  const [fixtureForm, setFixtureForm] = useState<FixtureForm>(EMPTY_FORM);

  function startFixtureForm(f: SquadFixture | null) {
    if (f) {
      setFixtureForm({
        date: ukToIsoDate(f.date),
        time: f.time,
        clubName: f.clubName,
        opponentText: f.clubName ? '' : f.description,
        homeAway: f.homeAway,
        format: f.format,
        ladiesMen: f.ladiesMen || 'Mixed',
      });
      setEditingFixture(f.id);
    } else {
      setFixtureForm(EMPTY_FORM);
      setEditingFixture('new');
    }
  }

  async function saveFixture() {
    if (!editingFixture) return;
    setBusy('fixture');
    setError(null);
    setNotice(null);
    try {
      const isNew = editingFixture === 'new';
      const res = await fetch(isNew ? `/api/squads/${groupId}/fixtures` : `/api/squads/fixture/${editingFixture}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fixtureForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save fixture');
        return;
      }
      setEditingFixture(null);
      setNotice(isNew ? 'Fixture added.' : 'Fixture updated.');
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function deleteFixture(f: SquadFixture) {
    if (!window.confirm(`Delete ${f.fixtureType} v ${f.opponent}? Any team picked for it is removed too.`)) return;
    setBusy(`del-${f.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/squads/fixture/${f.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to delete fixture');
        return;
      }
      setNotice('Fixture deleted.');
      await load();
    } finally {
      setBusy(null);
    }
  }

  // Organisers: result / cancel / reinstate for one fixture (publishing is on the selection page)
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [resultForm, setResultForm] = useState({ result: '', ours: '', theirs: '' });

  async function fixtureStatus(fixtureId: string, action: string, extra: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(`st-${fixtureId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/squads/fixture/${fixtureId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update the fixture');
        return false;
      }
      setNotice(success);
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }

  // "Ask squad": open (creating/syncing) the squad's group in the availability planner
  async function askSquad() {
    setBusy('ask');
    setError(null);
    try {
      const res = await fetch(`/api/squads/${groupId}/ask`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not open the availability planner');
        return;
      }
      router.push(`/availability/groups/${data.availabilityGroupId}`);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function load() {
    try {
      const res = await fetch(`/api/squads/${groupId}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load squad');
        return;
      }
      setDetail(data as SquadDetail);
    } catch {
      setError('Failed to load squad');
    } finally {
      setLoading(false);
    }
  }

  async function post(url: string, body: Record<string, unknown>, key: string, success: string): Promise<boolean> {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return false;
      }
      if (data.needsConfirmation) {
        if (window.confirm(data.message || 'Add anyway?')) {
          return post(url, { ...body, confirm: true }, key, success);
        }
        return false;
      }
      setNotice(success);
      await load();
      return true;
    } catch {
      setError('Something went wrong');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveManagers() {
    if (!managerDraft) return;
    setBusy('managers');
    setError(null);
    try {
      const res = await fetch(`/api/squads/${groupId}/managers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: managerDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update organisers');
        return;
      }
      setManagerDraft(null);
      setNotice('Organisers updated.');
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-gray-50 p-8 text-gray-700">Loading squad…</div>;
  }
  if (!detail) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className={getAlertClasses('danger')}>{error || 'Squad not found'}</div>
      </div>
    );
  }

  const inSquad = !!detail.myEntry && detail.myEntry.status === 'entered';
  const isClubTeam = detail.group.squadType === 'club_team';

  // Club Team fixture form (add or edit) — the date can be left blank until it's agreed
  function renderFixtureForm() {
    const set = (change: Partial<FixtureForm>) => setFixtureForm({ ...fixtureForm, ...change });
    return (
      <div className="bg-white rounded-lg shadow p-4 my-3 border border-blue-200 text-sm text-gray-900">
        <h3 className="font-semibold mb-2">{editingFixture === 'new' ? 'Add a fixture' : 'Edit fixture'}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            Opponent (club directory)
            <select value={fixtureForm.clubName} onChange={e => set({ clubName: e.target.value })} className="block w-full mt-1 border border-gray-300 rounded px-2 py-1.5">
              <option value="">Not in the directory / not known yet</option>
              {detail!.clubNames.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {!fixtureForm.clubName && (
            <label>
              Opponent (if not in the directory)
              <input value={fixtureForm.opponentText} onChange={e => set({ opponentText: e.target.value })} placeholder="e.g. Sussex County BA, or TBC" className="block w-full mt-1 border border-gray-300 rounded px-2 py-1.5" />
            </label>
          )}
          <label>
            Date (leave blank until agreed)
            <input type="date" value={fixtureForm.date} onChange={e => set({ date: e.target.value })} className="block w-full mt-1 border border-gray-300 rounded px-2 py-1.5" />
          </label>
          <label>
            Time
            <input type="time" value={fixtureForm.time} onChange={e => set({ time: e.target.value })} className="block w-full mt-1 border border-gray-300 rounded px-2 py-1.5" />
          </label>
          <label>
            Venue
            <select value={fixtureForm.homeAway} onChange={e => set({ homeAway: e.target.value === 'A' ? 'A' : 'H' })} className="block w-full mt-1 border border-gray-300 rounded px-2 py-1.5">
              <option value="H">Home</option>
              <option value="A">Away</option>
            </select>
          </label>
          <label>
            Format
            <input value={fixtureForm.format} onChange={e => set({ format: e.target.value })} placeholder="e.g. 2 Rinks" className="block w-full mt-1 border border-gray-300 rounded px-2 py-1.5" />
          </label>
          <label>
            Ladies / Men
            <select value={fixtureForm.ladiesMen} onChange={e => set({ ladiesMen: e.target.value })} className="block w-full mt-1 border border-gray-300 rounded px-2 py-1.5">
              <option value="Mixed">Mixed</option>
              <option value="Ladies">Ladies</option>
              <option value="Men">Men</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" onClick={() => setEditingFixture(null)} className={getButtonClasses('secondary', 'sm')}>Cancel</button>
          <button type="button" onClick={saveFixture} disabled={busy === 'fixture'} className={getButtonClasses('primary', 'sm')}>
            {busy === 'fixture' ? 'Saving…' : 'Save fixture'}
          </button>
        </div>
      </div>
    );
  }
  const activeMembers = detail.members.filter(m => m.status === 'entered');
  const nameOf = (u: string) => {
    const m = detail.members.find(x => x.username === u);
    if (m) return m.fullName;
    const p = detail.players.find(x => x.userName === u);
    return p ? p.fullName : u;
  };
  const visibleFixtures = detail.fixtures.filter(f => showPast || isUpcoming(f.date) || !['P', 'C', 'A'].includes(f.status));
  const hiddenCount = detail.fixtures.length - visibleFixtures.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <RouterBackLink fallbackHref="/squads" label="Squads" />
        <div className="flex flex-wrap justify-between items-start gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{detail.group.label}</h1>
            <p className="text-sm text-gray-700">
              Organiser: {detail.managers.length > 0 ? detail.managers.map(m => m.fullName).join(', ') : 'not set'}
            </p>
          </div>
          {detail.group.entryMode === 'self' && (
            inSquad ? (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Leave the ${detail.group.label} squad? Any picks and tea duties for upcoming fixtures will be cleared.`)) {
                    post(`/api/squads/${groupId}/members`, { action: 'leave' }, 'self', `You've left the squad.`);
                  }
                }}
                disabled={busy === 'self'}
                className={getButtonClasses('danger', 'sm')}
              >
                Leave squad
              </button>
            ) : (
              <button
                type="button"
                onClick={() => post(`/api/squads/${groupId}/members`, { action: 'join' }, 'self', `You've joined the squad.`)}
                disabled={busy === 'self'}
                className={getButtonClasses('primary', 'sm')}
              >
                {detail.myEntry ? 'Rejoin squad' : 'Join squad'}
              </button>
            )
          )}
        </div>

        {error && <div className={getAlertClasses('danger') + ' mt-4'}>{error}</div>}
        {notice && <div className={getAlertClasses('success') + ' mt-4'}>{notice}</div>}

        {/* ── Fixtures ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap justify-between items-center gap-2 mt-6 mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Fixtures</h2>
          {detail.canManage && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={askSquad} disabled={busy === 'ask'} className={getButtonClasses('secondary', 'sm')}>
                {busy === 'ask' ? 'Opening…' : 'Ask squad'}
              </button>
              {isClubTeam && editingFixture !== 'new' && (
                <button type="button" onClick={() => startFixtureForm(null)} className={getButtonClasses('primary', 'sm')}>
                  Add fixture
                </button>
              )}
            </div>
          )}
        </div>
        {detail.canManage && (
          <p className="text-sm text-gray-700 mb-2">
            <span className="font-medium">Ask squad</span> opens the squad in the availability planner, where you can
            create a poll with the dates you&apos;ve been offered (or want to offer) and see who can make them.
          </p>
        )}
        {editingFixture === 'new' && renderFixtureForm()}
        {visibleFixtures.length === 0 ? (
          <p className="text-gray-700">No fixtures.</p>
        ) : (
          <div className="space-y-3">
            {visibleFixtures.map(f => {
              const published = f.status === 'S' || f.status === 'P';
              const finished = ['P', 'C', 'A'].includes(f.status);
              const upcoming = isUpcoming(f.date) && !finished;
              const teamsOpen = openTeams.has(f.id);
              const teams = new Map<string, FixturePlayer[]>();
              for (const p of f.players) {
                const key = p.team === null ? 'Unassigned' : `Team ${p.team}`;
                const list = teams.get(key) || [];
                list.push(p);
                teams.set(key, list);
              }
              return (
                <div key={f.id} className="bg-white rounded-lg shadow p-4 border border-gray-200">
                  <div className="flex flex-wrap justify-between items-start gap-2">
                    <div>
                      <p className="font-semibold text-gray-900">
                        {f.fixtureType} v {f.opponent}
                      </p>
                      <p className="text-sm text-gray-700">
                        {displayDate(f.date)}{f.time ? ` at ${f.time}` : ''} · {f.homeAway === 'H' ? 'Home' : 'Away'}{f.format ? ` · ${f.format}` : ''}
                      </p>
                      {f.status === 'P' && f.result && (
                        <p className="text-sm font-semibold text-gray-900">
                          {f.result === 'W' ? 'Won' : f.result === 'L' ? 'Lost' : 'Drawn'}
                          {f.bhbcScore !== null && f.opponentScore !== null ? ` ${f.bhbcScore}–${f.opponentScore}` : ''}
                        </p>
                      )}
                    </div>
                    <span className={getBadgeClasses(published ? 'success' : f.status === 'C' ? 'danger' : 'secondary', 'sm')}>
                      {STATUS_LABEL[f.status] !== undefined ? STATUS_LABEL[f.status] : f.status}
                    </span>
                  </div>

                  {/* The viewer's own place */}
                  {inSquad && (
                    <div className="mt-2 text-sm">
                      {f.myPick === 'playing' && <p className="font-semibold text-green-700">You&apos;re playing{f.myTeas ? ' — and on teas' : ''}</p>}
                      {f.myPick !== 'playing' && f.myTeas && <p className="font-semibold text-green-700">You&apos;re on teas</p>}
                      {f.myPick === 'withdrawn' && <p className="font-semibold text-red-700">You dropped out of this one</p>}
                      {upcoming && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {f.myPick !== 'playing' && f.date && (
                            <label className="flex items-center gap-2 cursor-pointer text-gray-900">
                              <input
                                type="checkbox"
                                checked={f.myUnavailable}
                                disabled={busy === `me-${f.id}`}
                                onChange={e => post(
                                  `/api/squads/fixture/${f.id}/me`,
                                  { action: e.target.checked ? 'unavailable' : 'available' },
                                  `me-${f.id}`,
                                  e.target.checked ? 'Marked as not available.' : 'Marked as available.'
                                )}
                                className="rounded border-gray-300"
                              />
                              Can&apos;t make this one
                            </label>
                          )}
                          {f.myPick === 'playing' && (
                            <button
                              type="button"
                              disabled={busy === `me-${f.id}`}
                              onClick={() => {
                                if (window.confirm('Drop out of this fixture? The organiser will be emailed to find a replacement.')) {
                                  post(`/api/squads/fixture/${f.id}/me`, { action: 'withdraw' }, `me-${f.id}`, 'The organiser has been told.');
                                }
                              }}
                              className={getButtonClasses('danger', 'sm')}
                            >
                              I can&apos;t play
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {f.players.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(openTeams);
                          if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
                          setOpenTeams(next);
                        }}
                        className={getButtonClasses('secondary', 'sm')}
                      >
                        {teamsOpen ? 'Hide team' : published ? 'Show team' : 'Show team (not published)'}
                      </button>
                    )}
                    {/* The friendlies game page: confirm / withdraw, teams, match card */}
                    {published && f.tabName && (
                      <Link href={`/friendlies/game/${encodeURIComponent(f.tabName)}`} className={getButtonClasses('secondary', 'sm')}>
                        View game
                      </Link>
                    )}
                    {/* Organisers pick the team on the same selection page as friendlies */}
                    {detail.canManage && !finished && f.tabName && (
                      <Link href={`/friendlies/manage/game/${encodeURIComponent(f.tabName)}`} className={getButtonClasses('primary', 'sm')}>
                        Pick team
                      </Link>
                    )}
                    {detail.canManage && f.status === 'S' && resultFor !== f.id && (
                      <button type="button" onClick={() => { setResultFor(f.id); setResultForm({ result: '', ours: '', theirs: '' }); }} className={getButtonClasses('success', 'sm')}>
                        Record result
                      </button>
                    )}
                    {detail.canManage && !finished && (
                      <button
                        type="button"
                        disabled={busy === `st-${f.id}`}
                        onClick={() => {
                          const reason = window.prompt(`Cancel ${f.fixtureType} v ${f.opponent}? Reason (optional):`);
                          if (reason !== null) fixtureStatus(f.id, 'cancel', { reason }, 'Fixture cancelled.');
                        }}
                        className={getButtonClasses('danger', 'sm')}
                      >
                        Cancel
                      </button>
                    )}
                    {detail.canManage && (f.status === 'P' || f.status === 'C') && (
                      <button
                        type="button"
                        disabled={busy === `st-${f.id}`}
                        onClick={() => fixtureStatus(f.id, 'reinstate', {}, 'Fixture reinstated.')}
                        className={getButtonClasses('secondary', 'sm')}
                      >
                        Reinstate
                      </button>
                    )}
                    {detail.canManage && isClubTeam && editingFixture !== f.id && (
                      <>
                        <button type="button" onClick={() => startFixtureForm(f)} className={getButtonClasses('secondary', 'sm')}>
                          Edit details
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteFixture(f)}
                          disabled={busy === `del-${f.id}`}
                          className={getButtonClasses('danger', 'sm')}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                  {editingFixture === f.id && renderFixtureForm()}

                  {/* Organisers: record the result (W/L/D, scores optional) */}
                  {resultFor === f.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-3 text-sm text-gray-900 border-t border-gray-100 pt-3">
                      <label>
                        Result
                        <select
                          value={resultForm.result}
                          onChange={e => setResultForm({ ...resultForm, result: e.target.value })}
                          className="block mt-1 border border-gray-300 rounded px-2 py-1.5"
                        >
                          <option value="">Choose…</option>
                          <option value="W">Won</option>
                          <option value="L">Lost</option>
                          <option value="D">Drawn</option>
                        </select>
                      </label>
                      <label>
                        Our score (optional)
                        <input value={resultForm.ours} onChange={e => setResultForm({ ...resultForm, ours: e.target.value.replace(/\D/g, '') })} inputMode="numeric" className="block mt-1 w-20 border border-gray-300 rounded px-2 py-1.5" />
                      </label>
                      <label>
                        Their score (optional)
                        <input value={resultForm.theirs} onChange={e => setResultForm({ ...resultForm, theirs: e.target.value.replace(/\D/g, '') })} inputMode="numeric" className="block mt-1 w-20 border border-gray-300 rounded px-2 py-1.5" />
                      </label>
                      <button type="button" onClick={() => setResultFor(null)} className={getButtonClasses('secondary', 'sm')}>Cancel</button>
                      <button
                        type="button"
                        disabled={!resultForm.result || busy === `st-${f.id}`}
                        onClick={async () => {
                          const ok = await fixtureStatus(f.id, 'result', { result: resultForm.result, bhbc_score: resultForm.ours, opponent_score: resultForm.theirs }, 'Result recorded.');
                          if (ok) setResultFor(null);
                        }}
                        className={getButtonClasses('primary', 'sm')}
                      >
                        Save result
                      </button>
                    </div>
                  )}

                  {teamsOpen && (
                    <div className="mt-3 text-sm text-gray-900 space-y-1">
                      {Array.from(teams.entries()).map(([team, list]) => (
                        <p key={team}>
                          <span className="font-semibold">{team}:</span>{' '}
                          {list.map((p, i) => (
                            <span key={p.username} className={p.withdrawn ? 'line-through text-gray-700' : ''}>
                              {i > 0 && ', '}
                              {p.fullName}{POSITION_LABEL[p.position] ? ` (${POSITION_LABEL[p.position]})` : ''}
                            </span>
                          ))}
                        </p>
                      ))}
                      {f.homeAway === 'H' && (f.teaLead || f.teaFirst) && (
                        <p><span className="font-semibold">Teas:</span> {[f.teaLead, f.teaFirst].filter(Boolean).map(nameOf).join(' and ')}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {hiddenCount > 0 && (
          <button type="button" onClick={() => setShowPast(!showPast)} className="mt-2 text-sm text-blue-700 hover:underline">
            {showPast ? 'Hide past fixtures' : `Show ${hiddenCount} past fixture${hiddenCount === 1 ? '' : 's'}`}
          </button>
        )}

        {/* ── Squad ────────────────────────────────────────────────────── */}
        <h2 className="text-lg font-semibold text-gray-900 mt-8 mb-2">Squad ({activeMembers.length})</h2>
        <div className="bg-white rounded-lg shadow border border-gray-200 divide-y divide-gray-100">
          {activeMembers.length === 0 && <p className="p-4 text-gray-700">Nobody has joined yet.</p>}
          {activeMembers.map(m => (
            <div key={m.username} className="flex justify-between items-center px-4 py-2 text-sm text-gray-900">
              <span>{m.fullName}</span>
              <span className="flex items-center gap-3">
                <span className="text-gray-700">{m.appearances} game{m.appearances === 1 ? '' : 's'}</span>
                {detail.canManage && m.username !== detail.viewer && (
                  <button
                    type="button"
                    disabled={busy === `rm-${m.username}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${m.fullName} from the squad? Their picks and tea duties for upcoming fixtures will be cleared.`)) {
                        post(`/api/squads/${groupId}/members`, { action: 'leave', username: m.username }, `rm-${m.username}`, `${m.fullName} removed.`);
                      }
                    }}
                    className="text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* ── Organiser tools ──────────────────────────────────────────── */}
        {detail.canManage && (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-2">Add to squad</h3>
              <div className="flex gap-2">
                <select value={addMember} onChange={e => setAddMember(e.target.value)} className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm">
                  <option value="">Choose a member…</option>
                  {detail.players
                    .filter(p => !activeMembers.some(m => m.username === p.userName))
                    .map(p => <option key={p.userName} value={p.userName}>{p.fullName}</option>)}
                </select>
                <button
                  type="button"
                  disabled={!addMember || busy === 'add'}
                  onClick={async () => {
                    const ok = await post(`/api/squads/${groupId}/members`, { action: 'join', username: addMember }, 'add', `${nameOf(addMember)} added.`);
                    if (ok) setAddMember('');
                  }}
                  className={getButtonClasses('primary', 'sm')}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-2">Organisers</h3>
              {managerDraft === null ? (
                <div className="flex justify-between items-center text-sm text-gray-900">
                  <span>{detail.managers.length > 0 ? detail.managers.map(m => m.fullName).join(', ') : 'None set'}</span>
                  <button type="button" onClick={() => setManagerDraft(detail.managers.map(m => m.username))} className={getButtonClasses('secondary', 'sm')}>
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2 text-sm text-gray-900">
                  {managerDraft.map(u => (
                    <div key={u} className="flex justify-between">
                      <span>{nameOf(u)}</span>
                      <button type="button" onClick={() => setManagerDraft(managerDraft.filter(x => x !== u))} className="text-red-700 hover:underline">Remove</button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <select value={addManager} onChange={e => setAddManager(e.target.value)} className="flex-1 border border-gray-300 rounded px-2 py-1.5">
                      <option value="">Add an organiser…</option>
                      {detail.players.filter(p => !managerDraft.includes(p.userName)).map(p => <option key={p.userName} value={p.userName}>{p.fullName}</option>)}
                    </select>
                    <button type="button" disabled={!addManager} onClick={() => { setManagerDraft([...managerDraft, addManager]); setAddManager(''); }} className={getButtonClasses('secondary', 'sm')}>
                      Add
                    </button>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setManagerDraft(null)} className={getButtonClasses('secondary', 'sm')}>Cancel</button>
                    <button type="button" onClick={saveManagers} disabled={busy === 'managers'} className={getButtonClasses('primary', 'sm')}>Save</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
