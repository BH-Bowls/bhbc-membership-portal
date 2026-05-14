// app/rowland/[compId]/page.tsx
// Bracket view for a single Rowland Cup competition — reuses BracketView

'use client';

import { use, useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { BracketView } from '@/components/competitions/BracketView';
import { RowlandMatchDialog } from '@/components/rowland/RowlandMatchDialog';
import type { RowlandResultData } from '@/components/rowland/RowlandMatchDialog';
import type { CompMatch, CompMemberInfo, CompRound } from '@/types/competitions';
import type { RowlandComp, RowlandMatch } from '@/types/rowland';
import { ROWLAND_COMP_NAMES, ROWLAND_ROUND_LABELS, rowlandTeamDisplayName } from '@/types/rowland';

// Convert a Drive /view URL to a raw image URL usable in <img> tags.
function driveImageSrc(url: string): string {
  const m = url?.match(/\/file\/d\/([^/]+)/);
  return m ? `/api/drive-image?id=${m[1]}` : url;
}
import type { ClubContact } from '@/lib/types/clubs';

const LS_KEY = 'rowland_selected_club';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a RowlandMatch into a CompMatch for BracketView.
 *
 * Bye matches are kept as visible cards (status → 'Pending', side2 → ['Bye'])
 * rather than invisible geometry-only slots, because in Rowland the bye is a
 * real drawn position ("Adastra vs Bye") that should appear in the bracket.
 */
function rowlandToCompMatch(m: RowlandMatch): CompMatch {
  const isBye = m.status === 'Bye';
  return {
    matchId: m.matchId,
    round: m.round as CompRound,
    position: m.position,
    side1Usernames: m.homeTeam ? [rowlandTeamDisplayName(m.homeTeam)] : [],
    side2Usernames: isBye
      ? ['Bye']
      : m.awayTeam ? [rowlandTeamDisplayName(m.awayTeam)] : null,
    score1: m.homeScore,
    score2: m.awayScore,
    winnerSide: m.winnerSide,
    // Byes show as Pending so the card is rendered; Played maps to Complete
    status: isBye ? 'Pending' : m.status === 'Played' ? 'Complete' : (m.status as CompMatch['status']),
    playByDate: m.playByDate,
    playedDate: m.playedDate,
    scoreSheetUrl: m.scoreSheetUrl,
  };
}

/** Club display name doubles as the "username" key — just echo it back. */
function getInfo(name: string): CompMemberInfo {
  return { username: name, fullName: name, handicap: null, memberType: '' };
}

function inferFirstRoundCount(matches: CompMatch[]): number {
  const firstRound = matches.filter((m) => m.round === 'R1' || m.round === 'Prelim');
  if (firstRound.length === 0) return 2;
  const maxPos = Math.max(...firstRound.map((m) => m.position));
  let p = 1;
  while (p < maxPos) p *= 2;
  return p;
}

// ── Page ─────────────────────────────────────────────────────────────────────

const ROWLAND_GUEST_BUTTONS = (
  <>
    <a href="/clublogin" className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors">Club Login</a>
    <a href="/login"     className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600  hover:bg-blue-700  rounded-md transition-colors">Member Login</a>
  </>
);

export default function RowlandCompPage({ params }: { params: Promise<{ compId: string }> }) {
  const { compId } = use(params);
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';
  const router = useRouter();

  const [comp, setComp] = useState<RowlandComp | null>(null);
  const [matches, setMatches] = useState<CompMatch[]>([]);
  const [rawMatches, setRawMatches] = useState<RowlandMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printOrientation, setPrintOrientation] = useState<'landscape' | 'portrait'>('landscape');

  const [activeMatch, setActiveMatch] = useState<CompMatch | null>(null);
  const [saving, setSaving] = useState(false);
  const [scoreSheetPopup, setScoreSheetPopup] = useState<string | null>(null);

  // Next match card
  const [nextMatchData, setNextMatchData] = useState<{
    match: RowlandMatch;
    opponentContacts: ClubContact[];
  } | null>(null);
  const [nextMatchClubName, setNextMatchClubName] = useState<string | null>(null);
  const [guestClubId, setGuestClubId] = useState<string | null>(null);

  const BHBC_CLUB_ID = 'burgess.hill';

  const role = session?.user?.role ?? '';
  const roles = role ? role.split(',').map(r => r.trim()) : [];
  const isClub = role === 'Club';
  const isRowlandPlayer = roles.includes('RowlandPlayer');
  const isCaptain = roles.includes('Captain');
  // RowlandPlayer/Captain act like a club (restricted to BHBC matches) but see the full member nav
  const isCommittee = !isClub && !isRowlandPlayer && !isCaptain && role !== 'Member' && role !== '';
  const clubId = (isRowlandPlayer || isCaptain) ? BHBC_CLUB_ID : session?.user?.clubId;

  function handlePrint() {
    const styleId = 'print-orientation-style';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${printOrientation}; }`;
    window.print();
  }

  const loadData = useCallback(async () => {
    try {
      const [compRes, matchRes] = await Promise.all([
        fetch(`/api/rowland/${compId}`),
        fetch(`/api/rowland/${compId}/matches`),
      ]);
      const compData  = await compRes.json();
      const matchData = await matchRes.json();
      if (compData.error) throw new Error(compData.error);
      setComp(compData.comp);
      const raw: RowlandMatch[] = matchData.matches ?? [];
      setRawMatches(raw);
      setMatches(raw.map(rowlandToCompMatch));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [compId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load next match card once we know who the club is
  useEffect(() => {
    if (status === 'loading') return;

    let lookupClubId: string | null = null;
    let lookupClubName: string | null = null;

    if ((isClub || isRowlandPlayer || isCaptain) && clubId) {
      lookupClubId = clubId;
    } else if (isGuest || (!isClub && !isRowlandPlayer && !isCaptain)) {
      try {
        const stored = localStorage.getItem(LS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          lookupClubId = parsed.clubId ?? null;
          lookupClubName = parsed.clubName ?? null;
        }
      } catch {}
    }

    if (!lookupClubId) { setNextMatchData(null); setGuestClubId(null); return; }

    setNextMatchClubName(lookupClubName);
    if (!isClub && !isRowlandPlayer) setGuestClubId(lookupClubId);
    fetch(`/api/rowland/${compId}/next-match?clubId=${encodeURIComponent(lookupClubId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.match) setNextMatchData({ match: data.match, opponentContacts: data.opponentContacts ?? [] });
        else setNextMatchData(null);
      })
      .catch(() => setNextMatchData(null));
  }, [status, isClub, isRowlandPlayer, isGuest, clubId, compId]);

  // ── Match click handling ──────────────────────────────────────────────────

  function handleMatchClick(compMatch: CompMatch) {
    if (isGuest) return;
    const rawMatch = rawMatches.find((m) => m.matchId === compMatch.matchId);
    if (!rawMatch) return;

    // Bye match with a home team — re-trigger propagation to advance to next round
    if (rawMatch.status === 'Bye' && rawMatch.homeTeam) {
      advanceBye(rawMatch.matchId);
      return;
    }

    // Club / RowlandPlayer / Captain: only allow if their club is in the match
    if ((isClub || isRowlandPlayer || isCaptain) && clubId) {
      if (rawMatch.homeTeam?.clubId !== clubId && rawMatch.awayTeam?.clubId !== clubId) return;
    }

    setActiveMatch(compMatch);
  }

  async function advanceBye(matchId: string) {
    try {
      await fetch(`/api/rowland/${compId}/matches/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Bye' }),
      });
      loadData();
    } catch {
      // silently ignore — the bracket will show the correct state on reload
    }
  }

  async function handleResultSubmit(matchId: string, data: RowlandResultData) {
    setSaving(true);
    try {
      const res = await fetch(`/api/rowland/${compId}/matches/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? 'Failed to save');
      }
      setActiveMatch(null);
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  // Find display name for a given clubId from the raw match data
  function findClubDisplayName(id: string): string | undefined {
    for (const m of rawMatches) {
      if (m.homeTeam?.clubId === id) return rowlandTeamDisplayName(m.homeTeam);
      if (m.awayTeam?.clubId === id) return rowlandTeamDisplayName(m.awayTeam);
    }
    return undefined;
  }

  // For Club / RowlandPlayer: highlight their team in the bracket.
  // For guests with a selected club: highlight that club too.
  const effectiveClubId = (isClub || isRowlandPlayer || isCaptain) ? clubId : guestClubId;
  const myClubDisplayName = effectiveClubId ? findClubDisplayName(effectiveClubId) : undefined;

  const roundPlayByDates: Record<string, string> = {};
  if (comp?.prelimPlayBy) roundPlayByDates['Prelim'] = comp.prelimPlayBy;
  if (comp?.r1PlayBy)     roundPlayByDates['R1']     = comp.r1PlayBy;
  if (comp?.r2PlayBy)     roundPlayByDates['R2']     = comp.r2PlayBy;
  if (comp?.qfPlayBy)     roundPlayByDates['QF']     = comp.qfPlayBy;
  if (comp?.sfPlayBy)     roundPlayByDates['SF']     = comp.sfPlayBy;
  if (comp?.fPlayBy)      roundPlayByDates['F']      = comp.fPlayBy;

  const firstRoundCount = inferFirstRoundCount(matches);

  // Active raw match for the dialog
  const activeRawMatch = activeMatch
    ? rawMatches.find((m) => m.matchId === activeMatch.matchId) ?? null
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="print:hidden">
        <Navbar userName={session?.user?.name ?? undefined} userRole={role} showLogoOnly={isGuest} guestButtons={ROWLAND_GUEST_BUTTONS} />
      </div>

      <div className="container mx-auto px-4 py-6 max-w-full">
        {/* Header */}
        <div className="print:hidden flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <button
              onClick={() => router.push('/rowland')}
              className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
            >
              ← Rowland Cup
            </button>
            {loading ? (
              <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
            ) : (
              <h1 className="text-2xl font-bold text-gray-900">
                {comp ? (ROWLAND_COMP_NAMES[comp.compId] ?? comp.compName) : compId}
              </h1>
            )}
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            {/* Orientation toggle */}
            <div className="flex rounded-md border border-gray-300 overflow-hidden text-sm">
              <button
                onClick={() => setPrintOrientation('landscape')}
                className={`px-3 py-2 ${printOrientation === 'landscape' ? 'bg-gray-100 text-gray-800 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                Landscape
              </button>
              <button
                onClick={() => setPrintOrientation('portrait')}
                className={`px-3 py-2 border-l border-gray-300 ${printOrientation === 'portrait' ? 'bg-gray-100 text-gray-800 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                Portrait
              </button>
            </div>

            {/* Print button */}
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print
            </button>

            {isCommittee && (
              <button
                onClick={() => router.push(`/rowland/${compId}/setup`)}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
              >
                Manage
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="print:hidden mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Next match card */}
        {nextMatchData && (() => {
          const { match, opponentContacts } = nextMatchData;
          const viewingAsClubId = (isClub || isRowlandPlayer || isCaptain) ? clubId : guestClubId;
          const opponentTeam = viewingAsClubId
            ? (match.homeTeam?.clubId === viewingAsClubId ? match.awayTeam : match.homeTeam)
            : (match.homeTeam ?? match.awayTeam);

          const organiser = opponentContacts.find((c) => c.role.endsWith('Organiser'));
          const skip      = opponentContacts.find((c) => c.role.endsWith('Skip'));

          return (
            <div className="print:hidden mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">
                    {ROWLAND_ROUND_LABELS[match.round] ?? match.round} — Your next match
                  </p>
                  <p className="text-base font-semibold text-gray-900">
                    vs {opponentTeam ? rowlandTeamDisplayName(opponentTeam) : 'TBD'}
                  </p>
                  {match.playByDate && (
                    <p className="text-xs text-gray-500 mt-0.5">Play by {match.playByDate}</p>
                  )}

                  {(organiser || skip) && (
                    <div className="mt-3 space-y-2">
                      {[organiser, skip].filter(Boolean).map((c) => (
                        <div key={c!.role} className="text-sm">
                          <span className="font-medium text-gray-700">
                            {c!.role.endsWith('Organiser') ? 'Organiser' : 'Skip'}:
                          </span>{' '}
                          <span className="text-gray-900">{c!.name || `${c!.firstName} ${c!.lastName}`.trim()}</span>
                          {c!.mobileNumber && (
                            <> · <a href={`tel:${c!.mobileNumber}`} className="text-blue-600 hover:underline">{c!.mobileNumber}</a></>
                          )}
                          {!c!.mobileNumber && c!.phoneNumber && (
                            <> · <a href={`tel:${c!.phoneNumber}`} className="text-blue-600 hover:underline">{c!.phoneNumber}</a></>
                          )}
                          {c!.email && (
                            <> · <a href={`mailto:${c!.email}`} className="text-blue-600 hover:underline">{c!.email}</a></>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {opponentTeam && opponentContacts.length === 0 && (
                    <p className="text-xs text-gray-400 mt-2 italic">No contact details on record for this club.</p>
                  )}
                </div>

                {/* Guest: show club name + change link */}
                {isGuest && (
                  <div className="text-right shrink-0">
                    {nextMatchClubName && (
                      <p className="text-xs text-gray-500 mb-1">Viewing as: <span className="font-medium">{nextMatchClubName}</span></p>
                    )}
                    <a
                      href="/rowland"
                      onClick={() => { try { localStorage.removeItem(LS_KEY); } catch {} }}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Not your club?
                    </a>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Print-only title */}
        <div className="hidden print:block mb-4">
          <h1 className="text-2xl font-bold text-gray-900">
            {comp ? (ROWLAND_COMP_NAMES[comp.compId] ?? comp.compName) : compId}
          </h1>
        </div>

        {/* Bracket */}
        {loading ? (
          <div className="print:hidden bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-400">
            Loading draw sheet…
          </div>
        ) : matches.length === 0 ? (
          <div className="print:hidden bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-400">
            Draw not yet set up.
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 print:shadow-none print:border-0 print:p-0">
            <BracketView
              matches={matches}
              compType="singles"
              firstRoundCount={firstRoundCount}
              getInfo={getInfo}
              canEnterScores={!isGuest && isCommittee}
              currentUsername={myClubDisplayName}
              allowCompleteInteraction={!isGuest && (isClub || isRowlandPlayer || isCaptain)}
              onMatchClick={handleMatchClick}
              roundPlayByDates={roundPlayByDates}
              printOrientation={printOrientation}
              onScoreSheetView={!isGuest && isCommittee ? (_matchId, url) => setScoreSheetPopup(url) : undefined}
            />
          </div>
        )}
      </div>

      {/* Score sheet lightbox */}
      {scoreSheetPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setScoreSheetPopup(null)}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setScoreSheetPopup(null)}
              className="absolute top-2 right-2 z-10 bg-black/60 hover:bg-black/90 text-white rounded-full w-8 h-8 flex items-center justify-center text-base leading-none"
              aria-label="Close"
            >
              ✕
            </button>
            <img
              src={driveImageSrc(scoreSheetPopup)}
              alt="Score sheet"
              className="max-w-[90vw] max-h-[85vh] w-auto h-auto rounded shadow-xl"
            />
            <a
              href={driveImageSrc(scoreSheetPopup)}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-2 text-center text-xs text-white/60 hover:text-white/90"
            >
              Open full size ↗
            </a>
          </div>
        </div>
      )}

      {/* Result entry dialog */}
      {activeMatch && activeRawMatch && (
        <RowlandMatchDialog
          compMatch={activeMatch}
          rawMatch={activeRawMatch}
          myTeamSide={
            myClubDisplayName
              ? activeMatch.side1Usernames[0] === myClubDisplayName ? 'home' : 'away'
              : null
          }
          onSubmit={handleResultSubmit}
          onClose={() => setActiveMatch(null)}
          saving={saving}
          uploadPath={`/api/rowland/${compId}/matches/${activeMatch.matchId}`}
        />
      )}
    </div>
  );
}
