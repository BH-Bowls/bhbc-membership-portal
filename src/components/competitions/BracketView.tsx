// src/components/competitions/BracketView.tsx
// Renders a full knockout bracket with SVG connecting lines.
// Tabs let the user switch between "All Rounds" (full bracket) and a
// single-round card list that shows full player names.

'use client';

import { useState } from 'react';
import type { CompMatch, CompType, CompRound } from '@/types/competitions';
import type { CompMemberInfo } from '@/types/competitions';
import { COMP_ROUND_LABELS, ROUND_ORDER } from '@/types/competitions';
import { computeBracketLayout, MATCH_WIDTH, ROUND_GAP, MATCH_HEIGHT } from './bracketLayout';
import { MatchCard } from './MatchCard';

interface BracketViewProps {
  matches: CompMatch[];
  compType: CompType;
  firstRoundCount: number; // must be a power of 2
  getInfo: (username: string) => CompMemberInfo;
  currentUsername?: string;
  showHandicap?: boolean;
  onMatchClick?: (match: CompMatch) => void;
  isCommittee?: boolean;
  /** Map of round key (e.g. 'Prelim', 'R1', 'F') to play-by/finals date string */
  roundPlayByDates?: Record<string, string>;
}

function formatPlayByDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return d; }
}

export function BracketView({
  matches,
  compType,
  firstRoundCount,
  getInfo,
  currentUsername,
  showHandicap = false,
  onMatchClick,
  isCommittee = false,
  roundPlayByDates = {},
}: BracketViewProps) {
  const layout = computeBracketLayout(matches, firstRoundCount);
  const { matchGeometries, connectors, totalWidth, totalHeight, roundLabels } = layout;

  // Rounds present in this bracket (in order), excluding bye-only rounds
  const presentRounds = ROUND_ORDER.filter((r) =>
    matches.some((m) => m.round === r && m.status !== 'Bye')
  ) as CompRound[];

  // First round with a pending match (used as mobile default)
  const firstPendingRound: CompRound =
    presentRounds.find((r) => matches.some((m) => m.round === r && m.status === 'Pending')) ??
    presentRounds[0] ??
    'R1';

  // Desktop defaults to 'all'; mobile defaults to first pending round
  const [selectedRound, setSelectedRound] = useState<CompRound | 'all'>(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) return 'all';
    return firstPendingRound;
  });

  const effectiveRound: CompRound | 'all' =
    selectedRound === 'all' || presentRounds.includes(selectedRound as CompRound)
      ? selectedRound
      : presentRounds[0] ?? 'R1';

  const LABEL_HEIGHT = 44;

  // Determine if a user can interact with a specific match
  function canInteract(match: CompMatch): boolean {
    if (match.side1Usernames.length === 0) return false;
    if (isCommittee) return match.status === 'Pending';
    if (!currentUsername) return false;
    const allUsernames = [...match.side1Usernames, ...(match.side2Usernames ?? [])];
    return match.status === 'Pending' && allUsernames.includes(currentUsername);
  }

  // ── Single-round card list renderer ─────────────────────────────────────────
  function renderRoundSide(
    usernames: string[] | null,
    score: number | null | undefined,
    won: boolean,
    isBye: boolean,
    isComplete: boolean,
  ) {
    if (isBye) {
      return (
        <div className="flex justify-between items-center py-2">
          <span className="text-sm text-gray-300 italic">— bye —</span>
        </div>
      );
    }
    if (!usernames || usernames.length === 0 || !usernames[0]) {
      return (
        <div className="flex justify-between items-center py-2">
          <span className="text-sm text-gray-300 italic">— TBD —</span>
        </div>
      );
    }
    const info = getInfo(usernames[0]);
    const allNames = usernames.map((u) => getInfo(u).fullName).join(' + ');
    return (
      <div className="flex justify-between items-center py-2 gap-2">
        <span className={`text-sm flex-1 min-w-0 truncate ${won ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
          {won && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 flex-shrink-0" />}
          {allNames}
          {showHandicap && info.handicap != null && (
            <span className="ml-1 text-gray-400 text-xs">({info.handicap})</span>
          )}
        </span>
        {isComplete && (
          <span className={`flex-shrink-0 font-mono text-sm ${won ? 'font-bold text-gray-900' : 'text-gray-400'}`}>
            {score ?? '-'}
          </span>
        )}
      </div>
    );
  }

  const roundMatchList = effectiveRound !== 'all'
    ? matches
        .filter((m) => m.round === effectiveRound && m.status !== 'Bye')
        .sort((a, b) => a.position - b.position)
    : [];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Round tabs (all screen sizes, hidden when printing) ─────────────── */}
      <div className="print:hidden flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {/* All Rounds tab */}
        <button
          onClick={() => setSelectedRound('all')}
          className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            effectiveRound === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          All Rounds
        </button>

        {/* Individual round tabs */}
        {presentRounds.map((r) => {
          const date = roundPlayByDates[r];
          const isActive = r === effectiveRound;
          return (
            <button
              key={r}
              onClick={() => setSelectedRound(r)}
              className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <div>{COMP_ROUND_LABELS[r] ?? r}</div>
              {date && (
                <div className={`text-[10px] mt-0.5 ${isActive ? 'text-blue-200' : 'text-gray-400'}`}>
                  by {formatPlayByDate(date)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── All Rounds: full bracket view (also always shown when printing) ─── */}
      <div className={effectiveRound === 'all' ? 'overflow-x-auto pb-4' : 'hidden print:block overflow-x-auto pb-4'}>
          <div
            style={{ width: totalWidth, minHeight: totalHeight + LABEL_HEIGHT + MATCH_HEIGHT }}
            className="relative"
          >
            {/* Round labels */}
            <div className="flex mb-2" style={{ width: totalWidth }}>
              {roundLabels.map(({ label, x }) => {
                const date = roundPlayByDates[label];
                return (
                  <div
                    key={label}
                    style={{ position: 'absolute', left: x, width: MATCH_WIDTH, top: 0 }}
                    className="text-center py-1"
                  >
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {COMP_ROUND_LABELS[label as keyof typeof COMP_ROUND_LABELS] ?? label}
                    </div>
                    {date && (
                      <div className="text-[10px] text-gray-400 leading-none mt-0.5">
                        by {formatPlayByDate(date)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* SVG connector lines */}
            <svg
              style={{
                position: 'absolute',
                top: LABEL_HEIGHT,
                left: 0,
                width: totalWidth,
                height: totalHeight,
                overflow: 'visible',
                pointerEvents: 'none',
              }}
            >
              {connectors.map((c, i) => {
                const { topChildCenterY, botChildCenterY, childRightX, parentCenterY, parentLeftX, midX, isTopChildBye, isBotChildBye } = c;

                if (isTopChildBye && isBotChildBye) return null;

                if (isTopChildBye) {
                  return (
                    <g key={i} stroke="#d1d5db" strokeWidth={1.5} fill="none">
                      <path d={`M ${childRightX} ${botChildCenterY} H ${midX} V ${parentCenterY} H ${parentLeftX}`} />
                    </g>
                  );
                }

                if (isBotChildBye) {
                  return (
                    <g key={i} stroke="#d1d5db" strokeWidth={1.5} fill="none">
                      <path d={`M ${childRightX} ${topChildCenterY} H ${midX} V ${parentCenterY} H ${parentLeftX}`} />
                    </g>
                  );
                }

                return (
                  <g key={i} stroke="#d1d5db" strokeWidth={1.5} fill="none">
                    <path d={`M ${childRightX} ${topChildCenterY} H ${midX} V ${botChildCenterY}`} />
                    <path d={`M ${childRightX} ${botChildCenterY} H ${midX}`} />
                    <path d={`M ${midX} ${parentCenterY} H ${parentLeftX}`} />
                  </g>
                );
              })}
            </svg>

            {/* Match cards */}
            <div style={{ position: 'absolute', top: LABEL_HEIGHT, left: 0, width: totalWidth, height: totalHeight }}>
              {matchGeometries
                .filter((geo) => geo.match.status !== 'Bye')
                .map((geo) => (
                  <MatchCard
                    key={geo.matchId}
                    match={geo.match}
                    topY={geo.topY}
                    x={geo.x}
                    getInfo={getInfo}
                    currentUsername={currentUsername}
                    showHandicap={showHandicap}
                    canInteract={canInteract(geo.match)}
                    onClick={onMatchClick}
                  />
                ))}
            </div>
          </div>
        </div>

      {/* ── Single round: card list with full names (hidden when printing) ───── */}
      <div className={`print:hidden ${effectiveRound !== 'all' ? '' : 'hidden'}`}>
        {roundMatchList.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            No matches in this round yet.
          </div>
        ) : (
          <div className="space-y-3">
            {roundMatchList.map((match) => {
              const isComplete =
                match.status === 'Complete' ||
                match.status === 'Walkover' ||
                match.status === 'Bye';
              const side1Won = isComplete && match.winnerSide === 1;
              const side2Won = isComplete && match.winnerSide === 2;
              const isByeMatch = match.side2Usernames === null;
              const isMyMatch = currentUsername
                ? [...match.side1Usernames, ...(match.side2Usernames ?? [])].some(
                    (u) => u.toLowerCase() === currentUsername.toLowerCase()
                  )
                : false;
              const interactive = canInteract(match);

              return (
                <div
                  key={match.matchId}
                  onClick={interactive ? () => onMatchClick?.(match) : undefined}
                  className={`rounded-xl border p-4 ${
                    isMyMatch && match.status === 'Pending'
                      ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-200'
                      : isComplete
                      ? 'border-gray-200 bg-gray-50'
                      : 'border-gray-200 bg-white'
                  } ${interactive ? 'cursor-pointer hover:shadow-sm active:opacity-80 transition-shadow' : ''}`}
                >
                  {/* Card header */}
                  <div className="flex justify-between items-center mb-1 text-xs text-gray-400">
                    <span className="font-medium uppercase tracking-wide">
                      {COMP_ROUND_LABELS[match.round] ?? match.round} {match.position}
                    </span>
                    <span className="flex items-center gap-2">
                      {match.status === 'Walkover' && (
                        <span className="text-orange-500">Walkover</span>
                      )}
                      {match.playByDate && match.status === 'Pending' && (
                        <span>by {formatPlayByDate(match.playByDate)}</span>
                      )}
                    </span>
                  </div>

                  {/* Sides */}
                  <div className="divide-y divide-gray-100">
                    {renderRoundSide(match.side1Usernames, match.score1, side1Won, false, isComplete)}
                    {renderRoundSide(match.side2Usernames, match.score2, side2Won, isByeMatch, isComplete)}
                  </div>

                  {/* Enter score prompt */}
                  {interactive && (
                    <div className="mt-2 pt-2 border-t border-blue-100 text-xs text-blue-500 font-medium">
                      {typeof window !== 'undefined' && window.innerWidth < 768
                        ? 'Tap to enter score →'
                        : 'Click to enter score →'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
