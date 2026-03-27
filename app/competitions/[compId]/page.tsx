// app/competitions/[compId]/page.tsx
// Competition bracket page — loads live data from API

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { BracketView } from '@/components/competitions/BracketView';
import { ScoreDialog } from '@/components/competitions/ScoreDialog';
import type { CompMatch, Competition, CompMemberInfo } from '@/types/competitions';

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(d: string | null | undefined) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return d; }
}

/** How many first-round slots does this bracket need? Nearest power of 2 ≥ match count in round 1. */
function inferFirstRoundCount(matches: CompMatch[]): number {
  const r1Matches = matches.filter((m) => m.round === 'R1' || m.round === 'Prelim');
  if (r1Matches.length === 0) return 2;
  // Find max position in the earliest round
  const maxPos = Math.max(...r1Matches.map((m) => m.position));
  // Round up to next power of 2
  let p = 1;
  while (p < maxPos) p *= 2;
  return p;
}

// ============================================================================
// PAGE
// ============================================================================

export default function CompetitionBracketPage({
  params,
}: {
  params: Promise<{ compId: string }>;
}) {
  const { data: session } = useSession();
  const router = useRouter();

  const [compId, setCompId] = React.useState<string>('');
  React.useEffect(() => {
    params.then((p) => setCompId(p.compId));
  }, [params]);

  const [competition, setCompetition] = useState<Competition | null>(null);
  const [matches, setMatches] = useState<CompMatch[]>([]);
  const [memberMap, setMemberMap] = useState<Map<string, CompMemberInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState<CompMatch | null>(null);
  const [saving, setSaving] = useState(false);
  const [printOrientation, setPrintOrientation] = useState<'landscape' | 'portrait'>('landscape');

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

  const role = session?.user?.role ?? '';
  // Only Captains and Admins can manage/enter competition results on behalf of players
  const isCommittee = (role.split(',').map(r => r.trim())).some(r => ['Captain', 'Admin'].includes(r));
  const currentUsername = session?.user?.userName ?? '';

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadData = useCallback(() => {
    if (!compId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/competitions/${compId}`).then((r) => r.json()),
      fetch('/api/competitions/members').then((r) => r.json()),
    ])
      .then(([compData, memberData]) => {
        if (compData.error) throw new Error(compData.error);
        if (memberData.error) throw new Error(memberData.error);
        setCompetition(compData.competition);
        setMatches(compData.matches || []);
        const map = new Map<string, CompMemberInfo>();
        for (const [key, val] of Object.entries(memberData.members as Record<string, CompMemberInfo>)) {
          map.set(key, val);
        }
        setMemberMap(map);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [compId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Member lookup for BracketView ──────────────────────────────────────────
  function getInfo(username: string): CompMemberInfo {
    return memberMap.get(username.toLowerCase()) ?? {
      username,
      fullName: username,
      handicap: null,
      memberType: '',
    };
  }

  // ── Score/walkover submit ──────────────────────────────────────────────────
  async function handleScoreSubmit(matchId: string, score1: number, score2: number) {
    setSaving(true);
    try {
      const res = await fetch(`/api/competitions/${compId}/matches/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Complete', score1, score2 }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to save score');
      }
      setActiveMatch(null);
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleWalkover(matchId: string, winnerSide: 1 | 2) {
    setSaving(true);
    try {
      const res = await fetch(`/api/competitions/${compId}/matches/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Walkover', winnerSide }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to save walkover');
      }
      setActiveMatch(null);
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const isHandicapComp = compId === 'handicap';
  const firstRoundCount = inferFirstRoundCount(matches);

  // Map from bracket round key → play-by date (passed to BracketView for column headers)
  const roundPlayByDates: Record<string, string> = {};
  if (competition?.prelimPlayBy) roundPlayByDates['Prelim'] = competition.prelimPlayBy;
  if (competition?.r1PlayBy)     roundPlayByDates['R1']     = competition.r1PlayBy;
  if (competition?.r2PlayBy)     roundPlayByDates['R2']     = competition.r2PlayBy;
  if (competition?.qfPlayBy)     roundPlayByDates['QF']     = competition.qfPlayBy;
  if (competition?.sfPlayBy)     roundPlayByDates['SF']     = competition.sfPlayBy;
  if (competition?.finalsDate)   roundPlayByDates['F']      = competition.finalsDate;

  // My pending match (for "Your next match" callout)
  const myPending = matches.find(
    (m) =>
      m.status === 'Pending' &&
      [...m.side1Usernames, ...(m.side2Usernames ?? [])].some(
        (u) => u.toLowerCase() === currentUsername.toLowerCase()
      )
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="print:hidden">
        <Navbar
          userName={session?.user?.name ?? undefined}
          userRole={session?.user?.role ?? undefined}
        />
      </div>

      <div className="container mx-auto px-4 py-6 max-w-full">
        {/* Header */}
        <div className="print:hidden flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <button
              onClick={() => router.push('/competitions')}
              className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
            >
              ← All Competitions
            </button>
            {loading ? (
              <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
            ) : (
              <>
                <h1 className="text-2xl font-bold">{competition?.displayName ?? compId}</h1>
                <p className="text-gray-500 text-sm mt-0.5 capitalize">{competition?.compType}</p>
              </>
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
                onClick={() => router.push(`/competitions/${compId}/setup`)}
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

        {/* Handicap note */}
        {isHandicapComp && (
          <div className="print:hidden mb-4 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-xs text-yellow-800">
            Handicap is shown next to each player&apos;s name. The weaker player starts with the
            stronger player&apos;s handicap added to their score.
          </div>
        )}

        {/* Your match callout */}
        {myPending && !loading && (
          <div className="print:hidden mb-4 bg-blue-50 border border-blue-300 rounded-lg px-4 py-3 text-sm text-blue-800 flex items-center justify-between">
            <span>
              <strong>Your next match:</strong>{' '}
              vs{' '}
              {(() => {
                const opp = myPending.side1Usernames.some(
                  (u) => u.toLowerCase() === currentUsername.toLowerCase()
                )
                  ? myPending.side2Usernames
                  : myPending.side1Usernames;
                return opp
                  ? opp.map((u) => getInfo(u).fullName).join(' & ')
                  : 'Unknown';
              })()}
              {myPending.playByDate && <> — play by {formatDate(myPending.playByDate)}</>}
            </span>
            <button
              onClick={() => setActiveMatch(myPending)}
              className="ml-4 px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
            >
              Enter Score
            </button>
          </div>
        )}

        {/* Print-only title */}
        <div className="hidden print:block mb-4">
          <h1 className="text-2xl font-bold">{competition?.displayName ?? compId}</h1>
        </div>

        {/* Bracket */}
        {loading ? (
          <div className="print:hidden bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-400">
            Loading draw sheet…
          </div>
        ) : matches.length === 0 ? (
          <div className="print:hidden bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-400">
            {competition?.status === 'Not Started'
              ? 'The draw has not been entered yet.'
              : 'No matches found.'}
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 print:shadow-none print:border-0 print:p-0">
            <BracketView
              matches={matches}
              compType={competition?.compType ?? 'singles'}
              firstRoundCount={firstRoundCount}
              getInfo={getInfo}
              currentUsername={currentUsername}
              showHandicap={isHandicapComp}
              onMatchClick={setActiveMatch}
              isCommittee={isCommittee}
              roundPlayByDates={roundPlayByDates}
              printOrientation={printOrientation}
            />
          </div>
        )}
      </div>

      {/* Score entry dialog */}
      {activeMatch && (
        <ScoreDialog
          match={activeMatch}
          getInfo={getInfo}
          showHandicap={isHandicapComp}
          onSubmit={handleScoreSubmit}
          onWalkover={handleWalkover}
          onClose={() => setActiveMatch(null)}
          saving={saving}
        />
      )}
    </div>
  );
}
