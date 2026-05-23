// app/competitions/[compId]/page.tsx
// Competition bracket page — loads live data from API

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { BracketView } from '@/components/competitions/BracketView';
import { ScoreDialog } from '@/components/competitions/ScoreDialog';
import { PlannedDateDialog } from '@/components/competitions/PlannedDateDialog';
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
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';
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
  const [pendingDateMatch, setPendingDateMatch] = useState<CompMatch | null>(null);
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
  const canEnterScores = (role.split(',').map(r => r.trim())).some(r => ['Captain', 'Admin'].includes(r));
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
  // marker is the selected marker username ('' = no marker / clear existing).
  // Sent to the API alongside scores so both are recorded in the same request.
  async function handleScoreSubmit(matchId: string, score1: number, score2: number, marker: string) {
    setSaving(true);
    try {
      // Include the marker with scores so both are written in a single PATCH.
      // For non-singles comps the marker will be '' (the dropdown is not shown), which is harmless.
      const res = await fetch(`/api/competitions/${compId}/matches/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Complete', score1, score2, marker }),
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

  // ── Planned date / marker save ─────────────────────────────────────────────
  // Used by both PlannedDateDialog (members) and ScoreDialog date-only path (committee).
  // marker is optional — only passed for singles comps.
  async function handleSavePlannedDate(matchId: string, date: string, marker?: string) {
    // Build the request body — always include date; include marker when provided
    const patchBody: Record<string, string> = { playedDate: date };
    if (marker !== undefined) {
      patchBody.marker = marker;
    }

    const res = await fetch(`/api/competitions/${compId}/matches/${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error || 'Failed to save date');
    }
    loadData();
    // TODO: call clearDiaryCache(currentUsername) here when home-cache.ts is implemented
  }

  // Called from ScoreDialog onSaveDateOnly — sync wrapper (dialog handles its own close)
  function handleSaveDateOnly(matchId: string, date: string, marker: string) {
    handleSavePlannedDate(matchId, date, marker)
      .then(() => setActiveMatch(null))
      .catch(() => {
        // Error is surfaced by ScoreDialog internally via its error state
      });
  }

  // Routes bracket card clicks to the right dialog
  function handleMatchClick(match: CompMatch) {
    if (canEnterScores) {
      setActiveMatch(match);
    } else {
      setPendingDateMatch(match);
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const isHandicapComp = compId === 'handicap';
  const isSinglesComp = competition ? competition.compType === 'singles' : false;
  const firstRoundCount = inferFirstRoundCount(matches);

  // Build the playing members list for the marker dropdown (singles comps only).
  // Derived from the existing memberMap — no additional API call required.
  const playingMembers: { username: string; fullName: string }[] = [];
  if (isSinglesComp) {
    // Loop through all members in the map and keep only playing members
    for (const [, info] of memberMap.entries()) {
      if (info.memberType === 'Playing Man' || info.memberType === 'Playing Lady') {
        playingMembers.push({ username: info.username, fullName: info.fullName });
      }
    }
    // Sort alphabetically for the dropdown
    playingMembers.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  // Map from bracket round key → play-by date (passed to BracketView for column headers)
  const roundPlayByDates: Record<string, string> = {};
  if (competition?.prelimPlayBy) roundPlayByDates['Prelim'] = competition.prelimPlayBy;
  // For triples comps with no prelim, triplesFixedDate overrides r1PlayBy for the fixed first round
  if (!competition?.prelimPlayBy && competition?.triplesFixedDay && competition?.triplesFixedDate) {
    roundPlayByDates['R1'] = competition.triplesFixedDate;
  } else if (competition?.r1PlayBy) {
    roundPlayByDates['R1'] = competition.r1PlayBy;
  }
  if (competition?.r2PlayBy)     roundPlayByDates['R2']     = competition.r2PlayBy;
  if (competition?.qfPlayBy)     roundPlayByDates['QF']     = competition.qfPlayBy;
  if (competition?.sfPlayBy)     roundPlayByDates['SF']     = competition.sfPlayBy;
  if (competition?.finalsDate)   roundPlayByDates['F']      = competition.finalsDate;

  // Rounds where the date is a fixed "play ON" day rather than a deadline.
  // If the comp has a Prelim round, the fixed day is the Prelim; otherwise it's R1.
  const roundOnDates = new Set<string>();
  if (competition?.triplesFixedDay) {
    roundOnDates.add(competition.prelimPlayBy ? 'Prelim' : 'R1');
  }

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
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
        showLogoOnly={isGuest}
      />

      <div className="container mx-auto px-4 py-6 max-w-full print:p-0">
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
                <h1 className="text-2xl font-bold text-gray-900">{competition?.displayName ?? compId}</h1>
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

            {canEnterScores && (
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
            {canEnterScores && (
              <button
                onClick={() => setActiveMatch(myPending)}
                className="ml-4 px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
              >
                Enter Score
              </button>
            )}
          </div>
        )}

        {/* Print-only title */}
        <div className="hidden print:block mb-4">
          <h1 className="text-2xl font-bold text-gray-900">{competition?.displayName ?? compId}</h1>
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
              onMatchClick={handleMatchClick}
              canEnterScores={canEnterScores}
              roundPlayByDates={roundPlayByDates}
              roundOnDates={roundOnDates}
              printOrientation={printOrientation}
            />
          </div>
        )}
      </div>

      {/* Score entry dialog (committee) — includes marker dropdown for singles */}
      {activeMatch && (
        <ScoreDialog
          match={activeMatch}
          getInfo={getInfo}
          showHandicap={isHandicapComp}
          onSubmit={handleScoreSubmit}
          onWalkover={handleWalkover}
          onClose={() => setActiveMatch(null)}
          saving={saving}
          onSaveDateOnly={handleSaveDateOnly}
          isSingles={isSinglesComp}
          playingMembers={playingMembers}
        />
      )}

      {/* Date arrangement dialog (members) — includes marker dropdown for singles */}
      {pendingDateMatch && (
        <PlannedDateDialog
          match={pendingDateMatch}
          getInfo={getInfo}
          onSave={handleSavePlannedDate}
          onClose={() => setPendingDateMatch(null)}
          isSingles={isSinglesComp}
          playingMembers={playingMembers}
        />
      )}
    </div>
  );
}
