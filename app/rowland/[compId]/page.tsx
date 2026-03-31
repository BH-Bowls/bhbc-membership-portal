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
import { ROWLAND_COMP_NAMES, rowlandTeamDisplayName } from '@/types/rowland';

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

export default function RowlandCompPage({ params }: { params: Promise<{ compId: string }> }) {
  const { compId } = use(params);
  const { data: session } = useSession();
  const router = useRouter();

  const [comp, setComp] = useState<RowlandComp | null>(null);
  const [matches, setMatches] = useState<CompMatch[]>([]);
  const [rawMatches, setRawMatches] = useState<RowlandMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printOrientation, setPrintOrientation] = useState<'landscape' | 'portrait'>('landscape');

  const [activeMatch, setActiveMatch] = useState<CompMatch | null>(null);
  const [saving, setSaving] = useState(false);

  const BHBC_CLUB_ID = 'burgess.hill';

  const role = session?.user?.role ?? '';
  const roles = role ? role.split(',').map(r => r.trim()) : [];
  const isClub = role === 'Club';
  const isRowlandPlayer = roles.includes('RowlandPlayer');
  // RowlandPlayer acts like a club (restricted to BHBC matches) but sees the full member nav
  const isCommittee = !isClub && !isRowlandPlayer && role !== 'Member' && role !== '';
  const clubId = isRowlandPlayer ? BHBC_CLUB_ID : session?.user?.clubId;

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

  // ── Match click handling ──────────────────────────────────────────────────

  function handleMatchClick(compMatch: CompMatch) {
    const rawMatch = rawMatches.find((m) => m.matchId === compMatch.matchId);
    if (!rawMatch) return;

    // Bye match with a home team — re-trigger propagation to advance to next round
    if (rawMatch.status === 'Bye' && rawMatch.homeTeam) {
      advanceBye(rawMatch.matchId);
      return;
    }

    // Club / RowlandPlayer: only allow if their club is in the match
    if ((isClub || isRowlandPlayer) && clubId) {
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

  // For Club role: find the club's display name as it appears in the bracket
  // (used as "currentUsername" so BracketView highlights their match)
  const myClubDisplayName = isClub && clubId
    ? (() => {
        for (const m of rawMatches) {
          if (m.homeTeam?.clubId === clubId) return rowlandTeamDisplayName(m.homeTeam);
          if (m.awayTeam?.clubId === clubId) return rowlandTeamDisplayName(m.awayTeam);
        }
        return undefined;
      })()
    : undefined;

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
        <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
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
              <h1 className="text-2xl font-bold">
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

        {/* Print-only title */}
        <div className="hidden print:block mb-4">
          <h1 className="text-2xl font-bold">
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
              canEnterScores={isCommittee}
              currentUsername={myClubDisplayName}
              allowCompleteInteraction={isClub}
              onMatchClick={handleMatchClick}
              roundPlayByDates={roundPlayByDates}
              printOrientation={printOrientation}
            />
          </div>
        )}
      </div>

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
