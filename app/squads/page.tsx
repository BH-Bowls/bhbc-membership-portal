// app/squads/page.tsx
// Squads — the season's external-league squads (MSL, BL, JSL, N/S) and Club Teams
// (Gladys/Edward Rowland teams, Top Clubs, Tony Alcock…). Members join or leave a league
// squad here; a Club Team's organiser builds its squad. Captain/Admin create the league
// squads; any member can start a Club Team and becomes its organiser.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getButtonClasses, getAlertClasses, getBadgeClasses } from '@/config/theme-helpers';

interface SquadSummary {
  id: string;
  label: string;
  leagueType: string | null;
  squadType: 'league' | 'club_team' | null;
  entryMode: 'self' | 'manager';
  memberCount: number;
  fixtureCount: number;
  managers: Array<{ username: string; fullName: string }>;
  myStatus: 'member' | 'withdrawn' | null;
  canManage: boolean;
}

interface MemberOption {
  userName: string;
  fullName: string;
}

/**
 * Choose people by name: a dropdown + Add, with the chosen names shown as removable
 * chips. Works in usernames underneath (what the API wants), names on screen.
 */
function MemberPicker({ members, selected, onChange }: {
  members: MemberOption[];
  selected: string[];
  onChange: (usernames: string[]) => void;
}) {
  const [choice, setChoice] = useState('');
  const nameOf = (u: string) => {
    const m = members.find(x => x.userName === u);
    return m ? m.fullName : u;
  };
  const available = members.filter(m => !selected.includes(m.userName));

  return (
    <div className="mt-1">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selected.map(u => (
            <span key={u} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-900 rounded-full pl-3 pr-1 py-0.5 text-sm">
              {nameOf(u)}
              <button
                type="button"
                onClick={() => onChange(selected.filter(x => x !== u))}
                aria-label={`Remove ${nameOf(u)}`}
                className="rounded-full w-5 h-5 inline-flex items-center justify-center text-blue-900 hover:bg-blue-200"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <select
          value={choice}
          onChange={e => setChoice(e.target.value)}
          className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900"
        >
          <option value="">Choose a member…</option>
          {available.map(m => <option key={m.userName} value={m.userName}>{m.fullName}</option>)}
        </select>
        <button
          type="button"
          disabled={!choice}
          onClick={() => { onChange([...selected, choice]); setChoice(''); }}
          className={getButtonClasses('secondary', 'sm')}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default function SquadsPage() {
  const [squads, setSquads] = useState<SquadSummary[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [missingLeagues, setMissingLeagues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // League squad form (Captain/Admin)
  const [createLeague, setCreateLeague] = useState('');
  const [createManagers, setCreateManagers] = useState<string[]>([]);
  // Club Team form (anyone)
  const [teamName, setTeamName] = useState('');
  const [teamCoOrganisers, setTeamCoOrganisers] = useState<string[]>([]);
  // Every member's name, for choosing organisers by name
  const [members, setMembers] = useState<MemberOption[]>([]);

  useEffect(() => {
    loadSquads();
  }, []);

  async function loadSquads() {
    setLoading(true);
    try {
      const res = await fetch('/api/squads');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load squads');
        return;
      }
      setSquads(data.squads || []);
      setCanCreate(!!data.canCreate);
      setMissingLeagues(data.missingLeagues || []);
      setMembers(data.members || []);
      if (data.missingLeagues && data.missingLeagues.length > 0) setCreateLeague(data.missingLeagues[0]);
    } catch {
      setError('Failed to load squads');
    } finally {
      setLoading(false);
    }
  }

  async function joinOrLeave(squad: SquadSummary, action: 'join' | 'leave') {
    setBusy(squad.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/squads/${squad.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }
      setNotice(action === 'join' ? `You've joined the ${squad.label} squad.` : `You've left the ${squad.label} squad.`);
      await loadSquads();
    } catch {
      setError('Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function create(body: Record<string, unknown>, key: string, success: string, reset: () => void) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/squads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create');
        return;
      }
      reset();
      setNotice(success);
      await loadSquads();
    } catch {
      setError('Failed to create');
    } finally {
      setBusy(null);
    }
  }

  const leagueSquads = squads.filter(s => s.squadType === 'league');
  const clubTeams = squads.filter(s => s.squadType === 'club_team');

  function SquadCard({ squad }: { squad: SquadSummary }) {
    const selfEntry = squad.entryMode === 'self';
    return (
      <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
        <div className="flex justify-between items-start">
          <div>
            <Link href={`/squads/${squad.id}`} className="text-lg font-bold text-blue-700 hover:underline">
              {squad.label}
            </Link>
            <p className="text-sm text-gray-700">
              {squad.memberCount} in squad · {squad.fixtureCount} fixture{squad.fixtureCount === 1 ? '' : 's'}
            </p>
            <p className="text-sm text-gray-700">
              Organiser: {squad.managers.length > 0 ? squad.managers.map(m => m.fullName).join(', ') : 'not set'}
            </p>
          </div>
          {squad.myStatus === 'member' && <span className={getBadgeClasses('success', 'sm')}>In squad</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/squads/${squad.id}`} className={getButtonClasses('secondary', 'sm')}>
            {squad.canManage ? 'Manage' : 'View'}
          </Link>
          {/* League squads: members join and leave themselves. Club Teams: the organiser picks the squad. */}
          {selfEntry && (squad.myStatus === 'member' ? (
            <button
              type="button"
              onClick={() => joinOrLeave(squad, 'leave')}
              disabled={busy === squad.id}
              className={getButtonClasses('danger', 'sm')}
            >
              {busy === squad.id ? 'Leaving…' : 'Leave squad'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => joinOrLeave(squad, 'join')}
              disabled={busy === squad.id}
              className={getButtonClasses('primary', 'sm')}
            >
              {busy === squad.id ? 'Joining…' : squad.myStatus === 'withdrawn' ? 'Rejoin squad' : 'Join squad'}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Squads</h1>
        <p className="text-sm text-gray-700 mt-1 mb-6">
          Join the squad for any league you&apos;d like to play in this season. The organiser picks
          the team for each fixture from the squad, and you&apos;ll be emailed when you&apos;re picked.
          Away for a week? Tick &quot;Can&apos;t make this one&quot; on the squad page.
        </p>

        {error && <div className={getAlertClasses('danger') + ' mb-4'}>{error}</div>}
        {notice && <div className={getAlertClasses('success') + ' mb-4'}>{notice}</div>}

        {loading ? (
          <p className="text-gray-700">Loading squads…</p>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">League squads</h2>
            {leagueSquads.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-4 text-gray-700 mb-6">No league squads have been set up for this season yet.</div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 mb-6">
                {leagueSquads.map(s => <SquadCard key={s.id} squad={s} />)}
              </div>
            )}

            <h2 className="text-lg font-semibold text-gray-900 mb-2">Club Teams</h2>
            <p className="text-sm text-gray-700 mb-2">
              Teams for cups and competitions through the year — the organiser picks the squad and
              arranges each game as it comes up.
            </p>
            {clubTeams.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-4 text-gray-700 mb-6">No Club Teams yet this season.</div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 mb-6">
                {clubTeams.map(s => <SquadCard key={s.id} squad={s} />)}
              </div>
            )}
          </>
        )}

        {/* Anyone: start a Club Team (they organise it) */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Start a Club Team</h2>
          <p className="text-sm text-gray-700 mb-3">
            For example &quot;Gladys Rowland 2027&quot; or &quot;Tony Alcock&quot;. You&apos;ll be its organiser:
            you pick the squad, add each game as the draw comes out, and can ask the squad which dates suit.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-gray-900 flex-1 min-w-[12rem]">
              Team name
              <input
                type="text"
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                className="block w-full mt-1 border border-gray-300 rounded px-2 py-1.5"
              />
            </label>
            <div className="text-sm text-gray-900 flex-1 min-w-[16rem]">
              Co-organisers (optional — you&apos;re an organiser already)
              <MemberPicker members={members} selected={teamCoOrganisers} onChange={setTeamCoOrganisers} />
            </div>
            <button
              type="button"
              disabled={!teamName.trim() || busy === 'team'}
              onClick={() => create(
                { kind: 'club_team', label: teamName, managers: teamCoOrganisers },
                'team',
                `${teamName.trim()} created.`,
                () => { setTeamName(''); setTeamCoOrganisers([]); }
              )}
              className={getButtonClasses('primary', 'md')}
            >
              {busy === 'team' ? 'Creating…' : 'Create team'}
            </button>
          </div>
        </div>

        {/* Captain/Admin: create the season's league squads */}
        {canCreate && missingLeagues.length > 0 && (
          <div className="bg-white rounded-lg shadow p-4 mt-4 border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Set up a league squad</h2>
            <p className="text-sm text-gray-700 mb-3">
              Creates this season&apos;s squad and attaches its league fixtures from Season Planning.
              Organisers can pick teams for their squad; Captains and Admins can manage every squad.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-gray-900">
                League
                <select
                  value={createLeague}
                  onChange={e => setCreateLeague(e.target.value)}
                  className="block mt-1 border border-gray-300 rounded px-2 py-1.5"
                >
                  {missingLeagues.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <div className="text-sm text-gray-900 flex-1 min-w-[16rem]">
                Organisers
                <MemberPicker members={members} selected={createManagers} onChange={setCreateManagers} />
              </div>
              <button
                type="button"
                onClick={() => create(
                  { leagueType: createLeague, managers: createManagers },
                  'create',
                  `${createLeague} squad created.`,
                  () => setCreateManagers([])
                )}
                disabled={busy === 'create'}
                className={getButtonClasses('primary', 'md')}
              >
                {busy === 'create' ? 'Creating…' : 'Create squad'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
