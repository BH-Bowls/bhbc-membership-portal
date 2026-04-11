// app/leagues/[leagueId]/page.tsx
// Public league detail — table, fixtures, and entry form

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type {
  League,
  LeagueTeam,
  LeagueSquadMember,
  LeagueMatch,
  LeagueTableRow,
  LeagueMatchStatus,
} from '@/types/leagues';
import { AttachmentsList } from '@/components/AttachmentsList';
import type { Attachment } from '@/types/attachments';

function formatDate(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return d; }
}

function formatFullDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return d; }
}

function formatTime(t: string | null): string {
  if (!t) return '';
  return t.replace(':', '');
}

function getMatchDate(m: LeagueMatch, leagueType: string): string | null {
  return leagueType === 'triples' ? (m.scheduledDate ?? null) : (m.playByDate ?? null);
}

const MATCH_STATUS_STYLES: Record<LeagueMatchStatus, string> = {
  Scheduled: 'bg-gray-100 text-gray-600',
  Played:    'bg-green-100 text-green-700',
  Walkover:  'bg-yellow-100 text-yellow-700',
  Cancelled: 'bg-red-100 text-red-600',
};

export default function LeagueDetailPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: session } = useSession();
  const router = useRouter();

  const role = session?.user?.role ?? '';
  const userName = session?.user?.userName ?? '';
  const isCommittee = role !== 'Member' && role !== '' && role !== 'Kiosk' && role !== 'Club';

  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<LeagueTeam[]>([]);
  const [squad, setSquad] = useState<LeagueSquadMember[]>([]);
  const [matches, setMatches] = useState<LeagueMatch[]>([]);
  const [table, setTable] = useState<LeagueTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'table' | 'fixtures' | 'squad' | 'rules'>('table');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Score entry
  const [scoreDialog, setScoreDialog] = useState<{
    isOpen: boolean; matchId: string; homeTeamName: string; awayTeamName: string;
    homeScore: string; awayScore: string; status: LeagueMatchStatus; saving: boolean;
  } | null>(null);

  // Entry
  const [enteringLeague, setEnteringLeague] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);

  function loadLeague() {
    fetch(`/api/leagues/${leagueId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setLeague(data.league);
        setTeams(data.teams);
        setSquad(data.squad);
        setMatches(data.matches);
        setTable(data.table);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadLeague();
    if (session !== undefined) {
      fetch(`/api/leagues/${leagueId}/attachments`)
        .then((r) => r.json())
        .then((data) => { if (data.attachments) setAttachments(data.attachments); })
        .catch(() => {});
    }
  }, [leagueId, session]);

  const myEntry = squad.find((m) => m.username === userName);
  const canEnter = !!session && !myEntry && league?.status === 'Entries Open';

  function canEnterScore(_match: LeagueMatch): boolean {
    return isCommittee;
  }

  async function submitEntry() {
    setEnterError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to enter');
      setEnteringLeague(false);
      loadLeague();
    } catch (err: any) {
      setEnterError(err.message);
    }
  }

  async function withdraw() {
    if (!confirm('Are you sure you want to withdraw from this league?')) return;
    try {
      const res = await fetch(`/api/leagues/${leagueId}/enter`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to withdraw');
      loadLeague();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function saveScore() {
    if (!scoreDialog) return;
    const { status } = scoreDialog;
    let payload: Record<string, unknown> = { status };

    if (status === 'Played') {
      const home = parseInt(scoreDialog.homeScore);
      const away = parseInt(scoreDialog.awayScore);
      if (isNaN(home) || isNaN(away)) { alert('Enter valid scores'); return; }
      payload = { homeScore: home, awayScore: away, status: 'Played' };
    }

    setScoreDialog((d) => d ? { ...d, saving: true } : d);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/matches/${scoreDialog.matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      setScoreDialog(null);
      loadLeague();
    } catch (err: any) {
      alert(err.message);
      setScoreDialog((d) => d ? { ...d, saving: false } : d);
    }
  }

  function openScoreDialog(match: LeagueMatch) {
    const homeTeam = teams.find((t) => t.teamId === match.homeTeamId);
    const awayTeam = teams.find((t) => t.teamId === match.awayTeamId);
    setScoreDialog({
      isOpen: true,
      matchId: match.matchId,
      homeTeamName: homeTeam?.teamName ?? 'Home',
      awayTeamName: awayTeam?.teamName ?? 'Away',
      homeScore: match.homeScore !== null ? String(match.homeScore) : '',
      awayScore: match.awayScore !== null ? String(match.awayScore) : '',
      status: match.status,
      saving: false,
    });
  }

  const POSITION_ORDER: Record<string, number> = { Skip: 0, Lead: 1, Two: 2 };
  const sortByPosition = (members: LeagueSquadMember[]) =>
    [...members].sort((a, b) => {
      const aO = a.position ? (POSITION_ORDER[a.position] ?? 99) : 99;
      const bO = b.position ? (POSITION_ORDER[b.position] ?? 99) : 99;
      return aO - bO;
    });

  // Group matches by date
  const scheduledDates = Array.from(
    new Set(matches.map((m) => getMatchDate(m, league?.type ?? 'triples')).filter(Boolean) as string[])
  ).sort();
  const unscheduledMatches = matches.filter((m) => !getMatchDate(m, league?.type ?? 'triples'));

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
        <div className="text-center py-20 text-gray-400">Loading…</div>
      </div>
    );
  }

  if (error || !league) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
        <div className="text-center py-20 text-red-500">{error ?? 'League not found'}</div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/leagues')}
            className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
          >
            ← Leagues
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{league.name}</h1>
              <p className="text-sm text-gray-500 mt-0.5 capitalize">{league.type} · {league.season}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {canEnter && !enteringLeague && (
                <button
                  onClick={() => setEnteringLeague(true)}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                >
                  Enter League
                </button>
              )}
              {myEntry && league.status === 'Entries Open' && (
                <button
                  onClick={withdraw}
                  className="px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 font-medium"
                >
                  Withdraw
                </button>
              )}
              {isCommittee && (
                <button
                  onClick={() => router.push(`/leagues/manage/${leagueId}`)}
                  className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
                >
                  Manage
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Entry form */}
        {enteringLeague && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-green-800 mb-3">Enter League</h3>
            <div className="flex gap-3 flex-wrap items-end">
              <button
                onClick={submitEntry}
                className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Confirm Entry
              </button>
              <button
                onClick={() => { setEnteringLeague(false); setEnterError(null); }}
                className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
            {enterError && <p className="mt-2 text-sm text-red-600">{enterError}</p>}
          </div>
        )}

        {/* My entry banner */}
        {myEntry && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            You are entered in this league
            {myEntry.teamId && teams.find((t) => t.teamId === myEntry.teamId)
              ? ` — ${teams.find((t) => t.teamId === myEntry.teamId)!.teamName}`
              : ' — team to be assigned'}
            {myEntry.position ? ` (${myEntry.position})` : ''}.
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 mb-6">
          {(['table', 'fixtures', 'squad', 'rules'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 capitalize transition-colors ${
                tab === t
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'table' ? 'League Table' : t === 'fixtures' ? 'Fixtures & Results' : t === 'squad' ? 'Teams' : 'Rules'}
            </button>
          ))}
        </div>

        {/* League Table */}
        {tab === 'table' && (
          <>
            {table.length === 0 ? (
              <div className="text-center py-10 text-gray-400">No results yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="pb-2 pr-3 font-medium">Team</th>
                      <th className="pb-2 px-2 font-medium text-center">P</th>
                      <th className="pb-2 px-2 font-medium text-center">W</th>
                      <th className="pb-2 px-2 font-medium text-center">D</th>
                      <th className="pb-2 px-2 font-medium text-center">L</th>
                      <th className="pb-2 px-2 font-medium text-center">F</th>
                      <th className="pb-2 px-2 font-medium text-center">A</th>
                      <th className="pb-2 px-2 font-medium text-center">+/-</th>
                      <th className="pb-2 pl-2 font-medium text-center">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((row, i) => (
                      <tr key={row.teamId} className={`border-b border-gray-100 ${i === 0 ? 'font-semibold' : ''}`}>
                        <td className="py-2 pr-3 text-gray-900">{row.teamName}</td>
                        <td className="py-2 px-2 text-center text-gray-600">{row.played}</td>
                        <td className="py-2 px-2 text-center text-gray-600">{row.won}</td>
                        <td className="py-2 px-2 text-center text-gray-600">{row.drew}</td>
                        <td className="py-2 px-2 text-center text-gray-600">{row.lost}</td>
                        <td className="py-2 px-2 text-center text-gray-600">{row.shotsFor}</td>
                        <td className="py-2 px-2 text-center text-gray-600">{row.shotsAgainst}</td>
                        <td className="py-2 px-2 text-center text-gray-600">{row.shotDiff > 0 ? `+${row.shotDiff}` : row.shotDiff}</td>
                        <td className="py-2 pl-2 text-center font-semibold text-gray-900">{row.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Fixtures & Results */}
        {tab === 'fixtures' && (
          <>
            {matches.length === 0 ? (
              <div className="text-center py-10 text-gray-400">No fixtures scheduled yet.</div>
            ) : (
              <div className="space-y-6">
                {scheduledDates.map((date) => (
                  <div key={date}>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                      {formatFullDate(date)}
                    </h3>
                    <div className="space-y-2">
                      {matches.filter((m) => getMatchDate(m, league.type) === date).map((match) => {
                        const homeTeam = teams.find((t) => t.teamId === match.homeTeamId);
                        const awayTeam = teams.find((t) => t.teamId === match.awayTeamId);
                        const isPlayed = match.status === 'Played' || match.status === 'Walkover';

                        return (
                          <div
                            key={match.matchId}
                            className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-3"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                {match.scheduledTime && (
                                  <span className="text-gray-500 font-mono text-xs">{formatTime(match.scheduledTime)}</span>
                                )}
                                <span className="font-medium text-gray-900">
                                  {homeTeam?.teamName ?? '—'}
                                </span>
                                <span className="text-gray-400">vs</span>
                                <span className="font-medium text-gray-900">
                                  {awayTeam?.teamName ?? '—'}
                                </span>
                                {isPlayed && match.homeScore !== null && match.awayScore !== null && (
                                  <span className="text-gray-700 font-semibold">
                                    {match.homeScore} – {match.awayScore}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MATCH_STATUS_STYLES[match.status]}`}>
                                {match.status}
                              </span>
                              {canEnterScore(match) && !isPlayed && match.status !== 'Cancelled' && (
                                <button
                                  onClick={() => openScoreDialog(match)}
                                  className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                                >
                                  Enter Score
                                </button>
                              )}
                              {isCommittee && (isPlayed || match.status === 'Cancelled') && (
                                <button
                                  onClick={() => openScoreDialog(match)}
                                  className="text-xs px-2 py-1 bg-gray-50 text-gray-600 rounded hover:bg-gray-100"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {unscheduledMatches.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Unscheduled</h3>
                    <div className="space-y-2">
                      {unscheduledMatches.map((match) => {
                        const homeTeam = teams.find((t) => t.teamId === match.homeTeamId);
                        const awayTeam = teams.find((t) => t.teamId === match.awayTeamId);
                        const isPlayed = match.status === 'Played' || match.status === 'Walkover';
                        return (
                          <div
                            key={match.matchId}
                            className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-3"
                          >
                            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-medium text-gray-900">{homeTeam?.teamName ?? '—'}</span>
                              <span className="text-gray-400">vs</span>
                              <span className="font-medium text-gray-900">{awayTeam?.teamName ?? '—'}</span>
                              {isPlayed && match.homeScore !== null && match.awayScore !== null && (
                                <span className="text-gray-700 font-semibold">{match.homeScore} – {match.awayScore}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MATCH_STATUS_STYLES[match.status]}`}>
                                {match.status}
                              </span>
                              {canEnterScore(match) && !isPlayed && match.status !== 'Cancelled' && (
                                <button onClick={() => openScoreDialog(match)} className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100">Enter Score</button>
                              )}
                              {isCommittee && (isPlayed || match.status === 'Cancelled') && (
                                <button onClick={() => openScoreDialog(match)} className="text-xs px-2 py-1 bg-gray-50 text-gray-600 rounded hover:bg-gray-100">Edit</button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Players / Squad */}
        {tab === 'squad' && (
          <>
            {teams.length === 0 ? (
              <div>
                {squad.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">No players entered yet.</div>
                ) : (
                  <div className="space-y-2">
                    {squad.map((m) => (
                      <div key={m.rowNumber} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-900">{m.fullName}</span>
                        {m.position && <span className="text-gray-500">{m.position}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Reserves */}
                {squad.filter((m) => !m.teamId).length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Reserves</h3>
                    <div className="space-y-2">
                      {squad.filter((m) => !m.teamId).map((m) => (
                        <div key={m.rowNumber} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between text-sm">
                          <span className="font-medium text-gray-900">{m.fullName}</span>
                          {m.position && <span className="text-gray-500">{m.position}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Per team */}
                {teams.map((team) => {
                  const members = sortByPosition(squad.filter((m) => m.teamId === team.teamId));
                  return (
                    <div key={team.teamId}>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{team.teamName}</h3>
                      {members.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">No players assigned.</p>
                      ) : (
                        <div className="space-y-2">
                          {members.map((m) => (
                            <div key={m.rowNumber} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between text-sm">
                              <span className="font-medium text-gray-900">{m.fullName}</span>
                              {m.position && <span className="text-gray-500">{m.position}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        {/* Rules */}
        {tab === 'rules' && (
          attachments.length === 0 ? (
            <div className="text-center py-10 text-gray-400">No rules documents uploaded yet.</div>
          ) : (
            <AttachmentsList
              apiBasePath={`/api/leagues/${leagueId}`}
              attachments={attachments}
              canDelete={false}
              onDelete={() => {}}
            />
          )
        )}
      </div>

      {/* Score entry dialog */}
      {scoreDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">
                {scoreDialog.status === 'Played' || scoreDialog.status === 'Scheduled' ? 'Enter Score' : 'Edit Result'}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {scoreDialog.homeTeamName} vs {scoreDialog.awayTeamName}
              </p>
            </div>
            <div className="p-5 space-y-4">
              {isCommittee && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Result type</label>
                  <select
                    value={scoreDialog.status}
                    onChange={(e) => setScoreDialog((d) => d ? { ...d, status: e.target.value as LeagueMatchStatus } : d)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    <option value="Played">Score</option>
                    <option value="Walkover">Walkover</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
              )}
              {scoreDialog.status === 'Played' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{scoreDialog.homeTeamName}</label>
                    <input
                      type="number" min="0"
                      value={scoreDialog.homeScore}
                      onChange={(e) => setScoreDialog((d) => d ? { ...d, homeScore: e.target.value } : d)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-lg font-semibold text-center"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{scoreDialog.awayTeamName}</label>
                    <input
                      type="number" min="0"
                      value={scoreDialog.awayScore}
                      onChange={(e) => setScoreDialog((d) => d ? { ...d, awayScore: e.target.value } : d)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-lg font-semibold text-center"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => setScoreDialog(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={saveScore}
                disabled={scoreDialog.saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {scoreDialog.saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
