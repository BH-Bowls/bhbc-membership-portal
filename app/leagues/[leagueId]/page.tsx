// app/leagues/[leagueId]/page.tsx
// Public league detail — table, fixtures, and entry form

'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { EmailLink, PhoneLink } from '@/components/ContactLink';
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

function fmtAdj(n: number | null): string {
  if (!n) return '';
  return n > 0 ? `+${n}` : String(n);
}

const MATCH_STATUS_STYLES: Record<LeagueMatchStatus, string> = {
  Scheduled:   'bg-gray-100 text-gray-600',
  Played:      'bg-green-100 text-green-700',
  Walkover:    'bg-yellow-100 text-yellow-700',
  Conceded:    'bg-orange-100 text-orange-700',
  'Not Played': 'bg-red-100 text-red-600',
};

function LeagueDetailPageInner() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const initialTab = (searchParams.get('tab') as 'table' | 'fixtures' | 'squad' | 'rules') ?? 'table';
  const [tab, setTab] = useState<'table' | 'fixtures' | 'squad' | 'rules'>(initialTab);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [matchFilter, setMatchFilter] = useState<'all' | 'mine'>('all');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  function scrollToBanner() {
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 0);
  }

  function selectMatch(matchId: string) {
    setSelectedMatchId(matchId);
    scrollToBanner();
  }

  // Team breakdown popup
  const [teamDetailId, setTeamDetailId] = useState<string | null>(null);

  // Score entry
  const [scoreDialog, setScoreDialog] = useState<{
    matchId: string;
    homeTeamName: string; awayTeamName: string;
    status: LeagueMatchStatus | 'Reset';
    // Played / Conceded
    homeScore: string; awayScore: string;
    // All statuses with a result
    homeAdj: string; awayAdj: string;
    homePoints: string; awayPoints: string;
    // Walkover
    walkoverWinner: 'home' | 'away' | '';
    saving: boolean;
  } | null>(null);

  // Entry
  const [enteringLeague, setEnteringLeague] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);

  // Brief feedback after copying the team's emails / phone numbers to the clipboard
  const [copiedContacts, setCopiedContacts] = useState<'emails' | 'phones' | null>(null);

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
        setSelectedMatchId(null);
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

  function autoPoints(homeScore: string, awayScore: string, homeAdj: string, awayAdj: string): { home: string; away: string } {
    const hs = parseInt(homeScore) || 0;
    const as_ = parseInt(awayScore) || 0;
    const ha = parseInt(homeAdj) || 0;
    const aa = parseInt(awayAdj) || 0;
    const h = hs + ha, a = as_ + aa;
    if (h > a) return { home: '2', away: '0' };
    if (a > h) return { home: '0', away: '2' };
    return { home: '1', away: '1' };
  }

  async function saveScore() {
    if (!scoreDialog) return;
    const { status } = scoreDialog;

    let payload: Record<string, unknown> = { status };

    if (status === 'Reset') {
      payload = { status: 'Scheduled', homeScore: null, awayScore: null, homeAdj: null, awayAdj: null, homePoints: null, awayPoints: null };
    } else if (status === 'Played' || status === 'Conceded') {
      const home = parseInt(scoreDialog.homeScore);
      const away = parseInt(scoreDialog.awayScore);
      if (isNaN(home) || isNaN(away)) { alert('Enter valid scores for both sides'); return; }
      const homeAdj = scoreDialog.homeAdj !== '' ? parseInt(scoreDialog.homeAdj) : null;
      const awayAdj = scoreDialog.awayAdj !== '' ? parseInt(scoreDialog.awayAdj) : null;
      const homePts = parseInt(scoreDialog.homePoints);
      const awayPts = parseInt(scoreDialog.awayPoints);
      if (isNaN(homePts) || isNaN(awayPts)) { alert('Enter valid points for both sides'); return; }
      payload = { status, homeScore: home, awayScore: away, homeAdj: homeAdj ?? 0, awayAdj: awayAdj ?? 0, homePoints: homePts, awayPoints: awayPts };

    } else if (status === 'Walkover') {
      if (!scoreDialog.walkoverWinner) { alert('Select which team is awarded the points'); return; }
      const homeAdj = parseInt(scoreDialog.homeAdj);
      const awayAdj = parseInt(scoreDialog.awayAdj);
      const homePts = parseInt(scoreDialog.homePoints);
      const awayPts = parseInt(scoreDialog.awayPoints);
      if (isNaN(homeAdj) || isNaN(awayAdj) || isNaN(homePts) || isNaN(awayPts)) {
        alert('Enter valid adjustment and points values'); return;
      }
      payload = { status, homeScore: null, awayScore: null, homeAdj, awayAdj, homePoints: homePts, awayPoints: awayPts };
    }
    // Cancelled: just status

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
    const initialStatus: LeagueMatchStatus = match.status === 'Scheduled' ? 'Played' : match.status;
    const walkoverWinner: 'home' | 'away' | '' =
      match.status === 'Walkover' && match.homeAdj !== null && match.awayAdj !== null
        ? (match.homeAdj > match.awayAdj ? 'home' : 'away')
        : '';
    const existingHomeAdj = match.homeAdj !== null ? String(match.homeAdj) : '0';
    const existingAwayAdj = match.awayAdj !== null ? String(match.awayAdj) : '0';
    const existingHomePts = match.homePoints !== null ? String(match.homePoints) : '';
    const existingAwayPts = match.awayPoints !== null ? String(match.awayPoints) : '';
    setScoreDialog({
      matchId: match.matchId,
      homeTeamName: homeTeam?.teamName ?? 'Home',
      awayTeamName: awayTeam?.teamName ?? 'Away',
      homeScore: match.homeScore !== null ? String(match.homeScore) : '',
      awayScore: match.awayScore !== null ? String(match.awayScore) : '',
      homeAdj: existingHomeAdj,
      awayAdj: existingAwayAdj,
      homePoints: existingHomePts,
      awayPoints: existingAwayPts,
      status: initialStatus,
      walkoverWinner,
      saving: false,
    });
  }

  const POSITION_ORDER: Record<string, number> = { Captain: 0, Skip: 1, Lead: 2, Two: 3 };
  const sortByPosition = (members: LeagueSquadMember[]) =>
    [...members].sort((a, b) => {
      const aO = a.position ? (POSITION_ORDER[a.position] ?? 99) : 99;
      const bO = b.position ? (POSITION_ORDER[b.position] ?? 99) : 99;
      return aO - bO;
    });

  // My team context
  const myTeammates = myEntry?.teamId
    ? squad.filter((m) => m.teamId === myEntry.teamId && m.username !== userName)
    : [];

  // Copy all teammate emails (or phone numbers) as a comma-separated list, ready to paste
  // straight into an email To: field or a text-message recipient field.
  async function copyTeammateContacts(kind: 'emails' | 'phones') {
    // Collect non-blank, de-duplicated values in display order
    const parts: string[] = [];
    for (let i = 0; i < myTeammates.length; i++) {
      // Phone falls back to landline when no mobile is set
      const raw = kind === 'emails'
        ? myTeammates[i].email
        : (myTeammates[i].mobile || myTeammates[i].landline);
      const value = raw ? raw.trim() : '';
      if (value && parts.indexOf(value) === -1) {
        parts.push(value);
      }
    }
    if (parts.length === 0) return;
    try {
      await navigator.clipboard.writeText(parts.join(', '));
      setCopiedContacts(kind);
      setTimeout(() => setCopiedContacts(null), 1500);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context) — silently ignore
    }
  }

  // Whether the team has any emails / phone numbers to copy
  let teamHasEmails = false;
  let teamHasPhones = false;
  for (let i = 0; i < myTeammates.length; i++) {
    const em = myTeammates[i].email;
    const mob = myTeammates[i].mobile || myTeammates[i].landline;
    if (em && em.trim()) teamHasEmails = true;
    if (mob && mob.trim()) teamHasPhones = true;
  }

  const nextFixture = myEntry?.teamId
    ? [...matches]
        .filter((m) =>
          (m.homeTeamId === myEntry.teamId || m.awayTeamId === myEntry.teamId) &&
          m.status === 'Scheduled'
        )
        .sort((a, b) => {
          const aDate = getMatchDate(a, league?.type ?? 'triples');
          const bDate = getMatchDate(b, league?.type ?? 'triples');
          if (aDate && bDate) return aDate.localeCompare(bDate);
          if (aDate) return -1;
          if (bDate) return 1;
          return a.matchday - b.matchday;
        })[0] ?? null
    : null;

  const contactFixture = myEntry?.teamId
    ? (selectedMatchId ? (matches.find((m) => m.matchId === selectedMatchId) ?? nextFixture) : nextFixture)
    : null;

  const contactOpponentTeamId = contactFixture && myEntry?.teamId
    ? (contactFixture.homeTeamId === myEntry.teamId ? contactFixture.awayTeamId : contactFixture.homeTeamId)
    : null;

  const contactOpposingSkip = contactOpponentTeamId
    ? (squad.find((m) => m.teamId === contactOpponentTeamId && m.position === 'Captain') ?? null)
    : null;

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
              {league.message && (
                <p className="mt-2 text-sm text-gray-700 whitespace-pre-line">{league.message}</p>
              )}
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
            <p className="font-medium">
              You are entered in this league
              {myEntry.teamId && teams.find((t) => t.teamId === myEntry.teamId)
                ? ` — ${teams.find((t) => t.teamId === myEntry.teamId)!.teamName}`
                : ' — team to be assigned'}
              {myEntry.position ? ` (${myEntry.position})` : ''}.
            </p>

            {/* Table tab: show team member contacts */}
            {tab === 'table' && myTeammates.length > 0 && (
              <div className="mt-2 space-y-1">
                {myTeammates.map((m) => (
                  <div key={m.username} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="font-medium text-blue-900">{m.fullName}{m.position ? ` (${m.position})` : ''}</span>
                    {(m.mobile || m.landline) && (
                      <PhoneLink phone={m.mobile || m.landline || ''} stopPropagation />
                    )}
                    {m.email && (
                      <EmailLink email={m.email} stopPropagation />
                    )}
                  </div>
                ))}

                {/* Copy all contacts — paste straight into an email To: or a text recipient field */}
                {(teamHasEmails || teamHasPhones) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {teamHasEmails && (
                      <button
                        type="button"
                        onClick={() => copyTeammateContacts('emails')}
                        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-blue-300 bg-white text-blue-700 hover:bg-blue-100"
                      >
                        {copiedContacts === 'emails' ? '✓ Copied!' : 'Copy all emails'}
                      </button>
                    )}
                    {teamHasPhones && (
                      <button
                        type="button"
                        onClick={() => copyTeammateContacts('phones')}
                        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-blue-300 bg-white text-blue-700 hover:bg-blue-100"
                      >
                        {copiedContacts === 'phones' ? '✓ Copied!' : 'Copy all phone numbers'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Fixtures tab: contact details for selected/next fixture */}
            {tab === 'fixtures' && myEntry.teamId && (() => {
              const oppTeam = teams.find((t) => t.teamId === contactOpponentTeamId);
              const fixtureDate = contactFixture ? getMatchDate(contactFixture, league.type) : null;
              return (
                <div className="mt-2">
                  {contactFixture ? (
                    <>
                      <p className="text-blue-700">
                        {fixtureDate ? formatFullDate(fixtureDate) : 'Unscheduled'}{contactFixture.scheduledTime ? ` at ${formatTime(contactFixture.scheduledTime)}` : ''} vs{' '}
                        <span className="font-medium">{oppTeam?.teamName ?? '—'}</span>
                      </p>
                      {contactOpposingSkip && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="text-blue-700">Opposing Captain: <span className="font-medium text-blue-900">{contactOpposingSkip.fullName}</span></span>
                          {(contactOpposingSkip.mobile || contactOpposingSkip.landline) && (
                            <PhoneLink phone={contactOpposingSkip.mobile || contactOpposingSkip.landline || ''} stopPropagation />
                          )}
                          {contactOpposingSkip.email && (
                            <EmailLink email={contactOpposingSkip.email} stopPropagation />
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-blue-600 italic">No upcoming fixtures.</p>
                  )}
                  <p className="mt-2 text-xs text-blue-500">{selectedMatchId ? 'Tap another fixture for contact details.' : 'Showing next scheduled fixture — tap any of your games for contact details.'}</p>
                </div>
              );
            })()}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 mb-6">
          {(['table', 'fixtures', 'squad', 'rules'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); if (t === 'fixtures') scrollToBanner(); }}
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
              <>
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => {
                    const w = window.open('', '_blank', 'width=800,height=600');
                    if (!w) return;
                    const rows = table.map((row, i) => `
                      <tr style="border-bottom:1px solid #e5e7eb;${i === 0 ? 'font-weight:600;' : ''}">
                        <td style="padding:6px 12px 6px 0;text-align:left">${i + 1}</td>
                        <td style="padding:6px 12px;text-align:left">${row.teamName}</td>
                        <td style="padding:6px 8px;text-align:center">${row.played}</td>
                        <td style="padding:6px 8px;text-align:center">${row.won}</td>
                        <td style="padding:6px 8px;text-align:center">${row.drew}</td>
                        <td style="padding:6px 8px;text-align:center">${row.lost}</td>
                        <td style="padding:6px 8px;text-align:center">${row.shotsFor}</td>
                        <td style="padding:6px 8px;text-align:center">${row.shotsAgainst}</td>
                        <td style="padding:6px 8px;text-align:center">${row.shotDiff > 0 ? '+' + row.shotDiff : row.shotDiff}</td>
                        <td style="padding:6px 0 6px 8px;text-align:center;font-weight:600">${row.points}</td>
                      </tr>`).join('');
                    w.document.write(`<!DOCTYPE html><html><head><title>${league.name} — League Table</title>
                      <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}
                      h1{font-size:20px;margin-bottom:4px}p{margin:0 0 16px;color:#555;font-size:13px}
                      table{border-collapse:collapse;width:100%;font-size:14px}
                      th{padding:8px 8px 8px 0;text-align:center;border-bottom:2px solid #111;color:#555;font-weight:600;font-size:12px}
                      th:nth-child(2){text-align:left}th:first-child{text-align:left}
                      @media print{button{display:none}}</style></head><body>
                      <h1>${league.name}</h1>
                      <p>${league.type.charAt(0).toUpperCase() + league.type.slice(1)} · ${league.season} · Printed ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}</p>
                      <table><thead><tr>
                        <th>Pos</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>F</th><th>A</th><th>+/-</th><th>Pts</th>
                      </tr></thead><tbody>${rows}</tbody></table>
                      <script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}<\/script>
                      </body></html>`);
                    w.document.close();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print table
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-700 border-b border-gray-200">
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
                        <td className="py-2 pr-3 text-gray-900">
                          <button
                            onClick={() => setTeamDetailId(row.teamId)}
                            className="text-left hover:text-green-700 hover:underline"
                          >
                            {row.teamName}
                          </button>
                        </td>
                        <td className="py-2 px-2 text-center text-gray-900">{row.played}</td>
                        <td className="py-2 px-2 text-center text-gray-900">{row.won}</td>
                        <td className="py-2 px-2 text-center text-gray-900">{row.drew}</td>
                        <td className="py-2 px-2 text-center text-gray-900">{row.lost}</td>
                        <td className="py-2 px-2 text-center text-gray-900">{row.shotsFor}</td>
                        <td className="py-2 px-2 text-center text-gray-900">{row.shotsAgainst}</td>
                        <td className="py-2 px-2 text-center text-gray-900">{row.shotDiff > 0 ? `+${row.shotDiff}` : row.shotDiff}</td>
                        <td className="py-2 pl-2 text-center font-semibold text-gray-900">{row.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </>
        )}

        {/* Fixtures & Results */}
        {tab === 'fixtures' && (
          <>
            {myEntry?.teamId && (
              <div className="flex gap-4 mb-4">
                {(['all', 'mine'] as const).map((v) => (
                  <label key={v} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                    <input
                      type="radio"
                      name="matchFilter"
                      value={v}
                      checked={matchFilter === v}
                      onChange={() => setMatchFilter(v)}
                      className="accent-green-600"
                    />
                    <span className="text-gray-700">{v === 'all' ? 'Show all' : 'My matches'}</span>
                  </label>
                ))}
              </div>
            )}
            {matches.length === 0 ? (
              <div className="text-center py-10 text-gray-400">No fixtures scheduled yet.</div>
            ) : (
              <div className="space-y-6">
                {scheduledDates.filter((date) =>
                  matchFilter === 'all' || !myEntry?.teamId
                    ? true
                    : matches.some((m) => getMatchDate(m, league.type) === date && (m.homeTeamId === myEntry.teamId || m.awayTeamId === myEntry.teamId))
                ).map((date) => (
                  <div key={date}>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                      {league.dateLabel}: {formatFullDate(date)}
                    </h3>
                    <div className="space-y-2">
                      {matches.filter((m) => getMatchDate(m, league.type) === date && (matchFilter === 'all' || !myEntry?.teamId || m.homeTeamId === myEntry.teamId || m.awayTeamId === myEntry.teamId)).map((match) => {
                        const homeTeam = teams.find((t) => t.teamId === match.homeTeamId);
                        const awayTeam = teams.find((t) => t.teamId === match.awayTeamId);
                        const isPlayed = match.status === 'Played' || match.status === 'Walkover' || match.status === 'Conceded';
                        const isMyMatch = !!myEntry?.teamId && (match.homeTeamId === myEntry.teamId || match.awayTeamId === myEntry.teamId);
                        const isSelected = match.matchId === (selectedMatchId ?? nextFixture?.matchId);

                        return (
                          <div
                            key={match.matchId}
                            id={`match-${match.matchId}`}
                            onClick={isMyMatch ? () => selectMatch(match.matchId) : undefined}
                            className={`rounded-lg border p-3 flex flex-wrap items-center gap-3 ${isMyMatch ? 'cursor-pointer' : ''} ${isSelected ? 'bg-blue-50 border-blue-400' : 'bg-white border-gray-200'}`}
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
                                  <>
                                    <span className="text-gray-700 font-semibold">
                                      {match.homeScore} – {match.awayScore}
                                    </span>
                                    {(match.homeAdj || match.awayAdj) ? (
                                      <span className="text-xs text-gray-400">
                                        (adj {fmtAdj(match.homeAdj)}/{fmtAdj(match.awayAdj)})
                                      </span>
                                    ) : null}
                                  </>
                                )}
                                {(match.status === 'Walkover' || match.status === 'Conceded') && match.homeScore === null && (
                                  <span className="text-xs text-gray-500 italic">
                                    {match.homePoints !== null && match.awayPoints !== null
                                      ? match.homePoints > match.awayPoints
                                        ? `${homeTeam?.teamName ?? 'Home'} awarded points`
                                        : match.awayPoints > match.homePoints
                                          ? `${awayTeam?.teamName ?? 'Away'} awarded points`
                                          : 'points shared'
                                      : 'result pending'}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MATCH_STATUS_STYLES[match.status]}`}>
                                {match.status}
                              </span>
                              {canEnterScore(match) && !isPlayed && match.status !== 'Not Played' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); openScoreDialog(match); }}
                                  className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                                >
                                  Enter Score
                                </button>
                              )}
                              {isCommittee && (isPlayed || match.status === 'Not Played') && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); openScoreDialog(match); }}
                                  className="text-xs px-2 py-1 bg-gray-50 text-gray-600 rounded hover:bg-gray-100"
                                >
                                  Edit Score
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {unscheduledMatches.filter((m) => matchFilter === 'all' || !myEntry?.teamId || m.homeTeamId === myEntry.teamId || m.awayTeamId === myEntry.teamId).length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Unscheduled</h3>
                    <div className="space-y-2">
                      {unscheduledMatches.filter((m) => matchFilter === 'all' || !myEntry?.teamId || m.homeTeamId === myEntry.teamId || m.awayTeamId === myEntry.teamId).map((match) => {
                        const homeTeam = teams.find((t) => t.teamId === match.homeTeamId);
                        const awayTeam = teams.find((t) => t.teamId === match.awayTeamId);
                        const isPlayed = match.status === 'Played' || match.status === 'Walkover' || match.status === 'Conceded';
                        const isMyMatch = !!myEntry?.teamId && (match.homeTeamId === myEntry.teamId || match.awayTeamId === myEntry.teamId);
                        const isSelected = match.matchId === (selectedMatchId ?? nextFixture?.matchId);
                        return (
                          <div
                            key={match.matchId}
                            id={`match-${match.matchId}`}
                            onClick={isMyMatch ? () => selectMatch(match.matchId) : undefined}
                            className={`rounded-lg border p-3 flex flex-wrap items-center gap-3 ${isMyMatch ? 'cursor-pointer' : ''} ${isSelected ? 'bg-blue-50 border-blue-400' : 'bg-white border-gray-200'}`}
                          >
                            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-medium text-gray-900">{homeTeam?.teamName ?? '—'}</span>
                              <span className="text-gray-400">vs</span>
                              <span className="font-medium text-gray-900">{awayTeam?.teamName ?? '—'}</span>
                              {isPlayed && match.homeScore !== null && match.awayScore !== null && (
                                <>
                                  <span className="text-gray-700 font-semibold">{match.homeScore} – {match.awayScore}</span>
                                  {(match.homeAdj || match.awayAdj) ? (
                                    <span className="text-xs text-gray-400">(adj {fmtAdj(match.homeAdj)}/{fmtAdj(match.awayAdj)})</span>
                                  ) : null}
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MATCH_STATUS_STYLES[match.status]}`}>
                                {match.status}
                              </span>
                              {canEnterScore(match) && !isPlayed && match.status !== 'Not Played' && (
                                <button onClick={(e) => { e.stopPropagation(); openScoreDialog(match); }} className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100">Enter Score</button>
                              )}
                              {isCommittee && (isPlayed || match.status === 'Not Played') && (
                                <button onClick={(e) => { e.stopPropagation(); openScoreDialog(match); }} className="text-xs px-2 py-1 bg-gray-50 text-gray-600 rounded hover:bg-gray-100">Edit</button>
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
                        <a
                          href={`/members?search=${encodeURIComponent(m.fullName)}&back=${encodeURIComponent('/leagues/' + leagueId + '?tab=squad')}`}
                          className="font-medium text-green-700 underline hover:text-green-900"
                        >{m.fullName}</a>
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
                          <a
                            href={`/members?search=${encodeURIComponent(m.fullName)}&back=${encodeURIComponent('/leagues/' + leagueId + '?tab=squad')}`}
                            className="font-medium text-green-700 underline hover:text-green-900"
                          >{m.fullName}</a>
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
                              <a
                                href={`/members?search=${encodeURIComponent(m.fullName)}&back=${encodeURIComponent('/leagues/' + leagueId + '?tab=squad')}`}
                                className="font-medium text-green-700 underline hover:text-green-900"
                              >{m.fullName}</a>
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Enter Result</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {scoreDialog.homeTeamName} vs {scoreDialog.awayTeamName}
              </p>
            </div>
            <div className="p-5 space-y-4">
              {/* Status */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">Result type</label>
                <select
                  value={scoreDialog.status}
                  onChange={(e) => {
                    const s = e.target.value as LeagueMatchStatus;
                    const isWalkover = s === 'Walkover';
                    setScoreDialog((d) => d ? {
                      ...d, status: s, walkoverWinner: '',
                      homeScore: isWalkover ? '' : d.homeScore,
                      awayScore: isWalkover ? '' : d.awayScore,
                      homeAdj: isWalkover ? '10' : '0',
                      awayAdj: isWalkover ? '0' : '0',
                      homePoints: isWalkover ? '2' : '',
                      awayPoints: isWalkover ? '0' : '',
                    } : d);
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="Played">Played</option>
                  <option value="Conceded">Conceded</option>
                  <option value="Walkover">Walkover</option>
                  <option value="Not Played">Not Played</option>
                  <option value="Reset">— Reset to Scheduled —</option>
                </select>
              </div>

              {/* Walkover: which side claims */}
              {scoreDialog.status === 'Walkover' && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Which team is awarded the points?</label>
                  <select
                    value={scoreDialog.walkoverWinner}
                    onChange={(e) => {
                      const winner = e.target.value as 'home' | 'away' | '';
                      setScoreDialog((d) => d ? {
                        ...d, walkoverWinner: winner,
                        homeAdj: winner === 'home' ? '10' : winner === 'away' ? '0' : d.homeAdj,
                        awayAdj: winner === 'away' ? '10' : winner === 'home' ? '0' : d.awayAdj,
                        homePoints: winner === 'home' ? '2' : winner === 'away' ? '0' : d.homePoints,
                        awayPoints: winner === 'away' ? '2' : winner === 'home' ? '0' : d.awayPoints,
                      } : d);
                    }}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    autoFocus
                  >
                    <option value="">— select —</option>
                    <option value="home">{scoreDialog.homeTeamName}</option>
                    <option value="away">{scoreDialog.awayTeamName}</option>
                  </select>
                </div>
              )}

              {/* Played / Conceded: final score */}
              {(scoreDialog.status === 'Played' || scoreDialog.status === 'Conceded') && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Final score</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-500 mb-1 truncate">{scoreDialog.homeTeamName}</p>
                      <input
                        type="number" min="0"
                        value={scoreDialog.homeScore}
                        onChange={(e) => {
                          const v = e.target.value;
                          setScoreDialog((d) => {
                            if (!d) return d;
                            const pts = autoPoints(v, d.awayScore, d.homeAdj, d.awayAdj);
                            return { ...d, homeScore: v, homePoints: pts.home, awayPoints: pts.away };
                          });
                        }}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-lg font-semibold text-center"
                        autoFocus
                      />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1 truncate">{scoreDialog.awayTeamName}</p>
                      <input
                        type="number" min="0"
                        value={scoreDialog.awayScore}
                        onChange={(e) => {
                          const v = e.target.value;
                          setScoreDialog((d) => {
                            if (!d) return d;
                            const pts = autoPoints(d.homeScore, v, d.homeAdj, d.awayAdj);
                            return { ...d, awayScore: v, homePoints: pts.home, awayPoints: pts.away };
                          });
                        }}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-lg font-semibold text-center"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Score adjustment (all result types except Cancelled) */}
              {scoreDialog.status !== 'Not Played' && scoreDialog.status !== 'Reset' && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Score adjustment</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-500 mb-1 truncate">{scoreDialog.homeTeamName}</p>
                      <input
                        type="number"
                        value={scoreDialog.homeAdj}
                        onChange={(e) => {
                          const v = e.target.value;
                          setScoreDialog((d) => {
                            if (!d) return d;
                            if (d.status === 'Played' || d.status === 'Conceded') {
                              const pts = autoPoints(d.homeScore, d.awayScore, v, d.awayAdj);
                              return { ...d, homeAdj: v, homePoints: pts.home, awayPoints: pts.away };
                            }
                            return { ...d, homeAdj: v };
                          });
                        }}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-center"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1 truncate">{scoreDialog.awayTeamName}</p>
                      <input
                        type="number"
                        value={scoreDialog.awayAdj}
                        onChange={(e) => {
                          const v = e.target.value;
                          setScoreDialog((d) => {
                            if (!d) return d;
                            if (d.status === 'Played' || d.status === 'Conceded') {
                              const pts = autoPoints(d.homeScore, d.awayScore, d.homeAdj, v);
                              return { ...d, awayAdj: v, homePoints: pts.home, awayPoints: pts.away };
                            }
                            return { ...d, awayAdj: v };
                          });
                        }}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-center"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Points (all result types except Cancelled) */}
              {scoreDialog.status !== 'Not Played' && scoreDialog.status !== 'Reset' && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Points awarded</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-500 mb-1 truncate">{scoreDialog.homeTeamName}</p>
                      <input
                        type="number" min="0"
                        value={scoreDialog.homePoints}
                        onChange={(e) => setScoreDialog((d) => d ? { ...d, homePoints: e.target.value } : d)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-center"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1 truncate">{scoreDialog.awayTeamName}</p>
                      <input
                        type="number" min="0"
                        value={scoreDialog.awayPoints}
                        onChange={(e) => setScoreDialog((d) => d ? { ...d, awayPoints: e.target.value } : d)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-center"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              )}

              {scoreDialog.status === 'Not Played' && (
                <p className="text-sm text-gray-500">This match will be marked as not played with no result.</p>
              )}
              {scoreDialog.status === 'Reset' && (
                <p className="text-sm text-amber-700">This will clear all scores and reset the match to Scheduled.</p>
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

      {/* Team breakdown popup */}
      {teamDetailId && (() => {
        const teamName = teams.find((t) => t.teamId === teamDetailId)?.teamName ?? teamDetailId;
        const teamMatches = matches
          .filter((m) => m.homeTeamId === teamDetailId || m.awayTeamId === teamDetailId)
          .filter((m) => m.status !== 'Scheduled')
          .map((m) => {
            const isHome = m.homeTeamId === teamDetailId;
            const oppId = isHome ? m.awayTeamId : m.homeTeamId;
            const oppName = teams.find((t) => t.teamId === oppId)?.teamName ?? '—';
            const myScore  = isHome ? m.homeScore  : m.awayScore;
            const oppScore = isHome ? m.awayScore  : m.homeScore;
            const myAdj    = isHome ? m.homeAdj    : m.awayAdj;
            const myPts    = isHome ? m.homePoints : m.awayPoints;
            return { m, oppName, isHome, myScore, oppScore, myAdj, myPts };
          });

        const totalPts = teamMatches.reduce((s, r) => s + (r.myPts ?? 0), 0);

        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setTeamDetailId(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b border-gray-200 flex justify-between items-start">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">{teamName}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Points breakdown</p>
                </div>
                <button onClick={() => setTeamDetailId(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <div className="overflow-y-auto flex-1 p-5">
                {teamMatches.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No results yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                        <th className="pb-2 font-medium">Opponent</th>
                        <th className="pb-2 px-2 font-medium text-center">Score</th>
                        <th className="pb-2 px-2 font-medium text-center">Adj</th>
                        <th className="pb-2 pl-2 font-medium text-center">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamMatches.map(({ m, oppName, myScore, oppScore, myAdj, myPts }) => (
                        <tr key={m.matchId} className="border-b border-gray-100">
                          <td className="py-2 pr-2 text-gray-900">
                            {oppName}
                            {(m.status === 'Walkover' || m.status === 'Conceded' || m.status === 'Not Played') && (
                              <span className="ml-1 text-xs text-gray-400">({m.status})</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-center text-gray-600 whitespace-nowrap">
                            {myScore !== null && oppScore !== null ? `${myScore}–${oppScore}` : '—'}
                          </td>
                          <td className="py-2 px-2 text-center text-gray-600 whitespace-nowrap">
                            {myAdj !== null ? (myAdj > 0 ? `+${myAdj}` : String(myAdj)) : '—'}
                          </td>
                          <td className="py-2 pl-2 text-center font-semibold text-gray-900">{myPts ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300">
                        <td colSpan={3} className="pt-2 text-sm font-semibold text-gray-700">Total</td>
                        <td className="pt-2 pl-2 text-center font-bold text-gray-900">{totalPts}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default function LeagueDetailPage() {
  return (
    <Suspense>
      <LeagueDetailPageInner />
    </Suspense>
  );
}
