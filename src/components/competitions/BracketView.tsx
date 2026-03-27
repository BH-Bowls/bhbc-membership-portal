// src/components/competitions/BracketView.tsx
// Renders a full knockout bracket with SVG connecting lines.
// Tabs let the user toggle individual rounds on/off.
// Print: paginated sections with fixed height so cards never split across pages,
//        connector lines drawn within each section, only selected rounds shown.

'use client';

import { useState } from 'react';
import type { CompMatch, CompType, CompRound } from '@/types/competitions';
import type { CompMemberInfo } from '@/types/competitions';
import { COMP_ROUND_LABELS, ROUND_ORDER } from '@/types/competitions';
import {
  computeBracketLayout,
  MATCH_WIDTH,
  ROUND_GAP,
  PRINT_MATCH_WIDTH,
  PRINT_ROUND_GAP,
  PRINT_LABEL_HEIGHT,
  PRINT_PAGE_BRACKET_HEIGHT_LANDSCAPE,
  PRINT_PAGE_BRACKET_HEIGHT_PORTRAIT,
  matchDimensionsForCompType,
} from './bracketLayout';
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
  /** If true, currentUsername's matches are clickable even when Complete (e.g. to update player names) */
  allowCompleteInteraction?: boolean;
  /** Map of round key (e.g. 'Prelim', 'R1', 'F') to play-by/finals date string */
  roundPlayByDates?: Record<string, string>;
  /** Controls @page size set by the parent before printing */
  printOrientation?: 'landscape' | 'portrait';
}

function formatPlayByDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return d; }
}

// ── Print-only match card ────────────────────────────────────────────────────
// minHeight is set to matchHeight so the visual centre matches the computed centerY.
function PrintMatchCard({
  match,
  getInfo,
  showHandicap,
  matchHeight,
}: {
  match: CompMatch;
  getInfo: (username: string) => CompMemberInfo;
  showHandicap: boolean;
  matchHeight: number;
}) {
  const isComplete = match.status === 'Complete' || match.status === 'Walkover';
  const side1Won = isComplete && match.winnerSide === 1;
  const side2Won = isComplete && match.winnerSide === 2;

  function names(usernames: string[]) {
    return usernames
      .map((u) => {
        const info = getInfo(u);
        return showHandicap && info.handicap != null
          ? `${info.fullName} (${info.handicap})`
          : info.fullName;
      })
      .join(' + ');
  }

  function renderSide(
    usernames: string[],
    score: number | null | undefined,
    won: boolean,
    isTop: boolean,
  ) {
    const border = isTop ? 'border-b border-gray-300' : '';
    if (usernames.length === 0) {
      return <div className={`px-1.5 py-0.5 text-gray-300 italic ${border}`}>TBD</div>;
    }
    return (
      <div className={`px-1.5 py-0.5 break-words leading-snug ${won ? 'font-bold text-gray-900' : 'text-gray-700'} ${border}`}>
        {won && <span className="mr-0.5">●</span>}
        {names(usernames)}
        {isComplete && <span className="ml-1 font-mono text-gray-600">{score ?? '-'}</span>}
        {match.status === 'Walkover' && won && <span className="ml-1 text-orange-500 font-normal">W/O</span>}
      </div>
    );
  }

  return (
    <div
      className="border border-gray-400 rounded text-[10px] overflow-hidden flex flex-col justify-center"
      style={{ minHeight: matchHeight }}
    >
      {renderSide(match.side1Usernames, match.score1, side1Won, true)}
      {match.side2Usernames && match.side2Usernames.length > 0
        ? renderSide(match.side2Usernames, match.score2, side2Won, false)
        : <div className="px-1.5 py-0.5 text-gray-400 italic">— bye —</div>
      }
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function BracketView({
  matches,
  compType,
  firstRoundCount,
  getInfo,
  currentUsername,
  showHandicap = false,
  onMatchClick,
  isCommittee = false,
  allowCompleteInteraction = false,
  roundPlayByDates = {},
  printOrientation = 'landscape',
}: BracketViewProps) {
  // Rounds present in this bracket (in order), excluding bye-only rounds
  const presentRounds = ROUND_ORDER.filter((r) =>
    matches.some((m) => m.round === r && m.status !== 'Bye')
  ) as CompRound[];

  // First round with a pending match (used as mobile default)
  const firstPendingRound: CompRound =
    presentRounds.find((r) => matches.some((m) => m.round === r && m.status === 'Pending')) ??
    presentRounds[0] ??
    'R1';

  // Desktop defaults to 'all'; mobile defaults to just the first pending round
  const [selectedRounds, setSelectedRounds] = useState<Set<CompRound> | 'all'>(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) return 'all';
    return new Set([firstPendingRound]);
  });

  const isAll = selectedRounds === 'all';

  function isRoundVisible(r: string): boolean {
    if (isAll) return true;
    return (selectedRounds as Set<CompRound>).has(r as CompRound);
  }

  function toggleRound(r: CompRound) {
    if (isAll) {
      setSelectedRounds(new Set([r]));
    } else {
      const next = new Set(selectedRounds as Set<CompRound>);
      if (next.has(r)) {
        next.delete(r);
        setSelectedRounds(next.size === 0 ? 'all' : next);
      } else {
        next.add(r);
        setSelectedRounds(next.size === presentRounds.length ? 'all' : next);
      }
    }
  }

  // ── Screen layout ────────────────────────────────────────────────────────────
  // Includes the round immediately after the last selected round so connector
  // lines are drawn from the edge of the visible area.
  const layoutRoundSet = new Set<string>();
  if (isAll) {
    presentRounds.forEach((r) => layoutRoundSet.add(r));
  } else {
    const sr = selectedRounds as Set<CompRound>;
    presentRounds.forEach((r, i) => {
      if (sr.has(r)) {
        layoutRoundSet.add(r);
        if (i + 1 < presentRounds.length) layoutRoundSet.add(presentRounds[i + 1]);
      }
    });
  }

  const { matchHeight, slotGap } = matchDimensionsForCompType(compType);
  const slotHeight = matchHeight + slotGap;

  // Build a function that overrides each match's x position based on its
  // playByDate — a match assigned to an earlier round's date moves left into
  // that round's column.  Falls back to the natural round column if no date
  // is set or the date doesn't correspond to any known round.
  function makeGetMatchX(mw: number, rg: number) {
    // Map: date string → column index (first round that owns that date)
    const dateToCol = new Map<string, number>();
    presentRounds.forEach((r, i) => {
      const d = roundPlayByDates[r];
      if (d && !dateToCol.has(d)) dateToCol.set(d, i);
    });
    return (match: CompMatch, defaultX: number): number => {
      const d = match.playByDate ?? roundPlayByDates[match.round];
      if (!d) return defaultX;
      const col = dateToCol.get(d);
      return col !== undefined ? col * (mw + rg) : defaultX;
    };
  }

  const layoutMatches = matches.filter((m) => layoutRoundSet.has(m.round));
  const layout = computeBracketLayout(
    layoutMatches, firstRoundCount, matchHeight, slotGap,
    MATCH_WIDTH, ROUND_GAP, makeGetMatchX(MATCH_WIDTH, ROUND_GAP),
  );
  const { matchGeometries, connectors, totalWidth, totalHeight, roundLabels } = layout;

  const LABEL_HEIGHT = 44;

  function canInteract(match: CompMatch): boolean {
    if (match.side1Usernames.length === 0) return false;
    if (isCommittee) return match.status === 'Pending';
    if (!currentUsername) return false;
    const allUsernames = [...match.side1Usernames, ...(match.side2Usernames ?? [])];
    if (!allUsernames.includes(currentUsername)) return false;
    return allowCompleteInteraction || match.status === 'Pending';
  }

  // ── Print layout ─────────────────────────────────────────────────────────────
  const printPageBracketHeight =
    printOrientation === 'portrait'
      ? PRINT_PAGE_BRACKET_HEIGHT_PORTRAIT
      : PRINT_PAGE_BRACKET_HEIGHT_LANDSCAPE;

  const printVisibleRounds = new Set(presentRounds.filter((r) => isRoundVisible(r)));

  // Include the next round after each visible round so R1→QF exit connector
  // lines are drawn (same pattern as the screen layout's layoutRoundSet).
  const printLayoutRoundSet = new Set<string>(printVisibleRounds);
  presentRounds.forEach((r, i) => {
    if (printVisibleRounds.has(r) && i + 1 < presentRounds.length) {
      printLayoutRoundSet.add(presentRounds[i + 1]);
    }
  });

  const printMatches = matches.filter((m) => printLayoutRoundSet.has(m.round));
  const printLayout = computeBracketLayout(
    printMatches,
    firstRoundCount,
    matchHeight,
    slotGap,
    PRINT_MATCH_WIDTH,
    PRINT_ROUND_GAP,
    makeGetMatchX(PRINT_MATCH_WIDTH, PRINT_ROUND_GAP),
  );

  // ── Print pagination ──────────────────────────────────────────────────────────
  // Split at the halfway slot boundary so absolutely-positioned cards never straddle
  // a physical page boundary. Each section is a position:relative div with overflow:hidden —
  // connectors that cross the section edge are drawn in both sections and clipped naturally.
  // If the bracket fits on one page, a single section is used (no break-after).
  // If two sections still exceed two pages, zoom the whole container to fit.
  const halfSlots = Math.ceil(firstRoundCount / 2);
  const splitY = halfSlots * slotHeight;
  const useTwoSections = printLayout.totalHeight + PRINT_LABEL_HEIGHT > printPageBracketHeight;
  const printSections = useTwoSections
    ? [
        { sectionStart: 0,      contentHeight: splitY },
        { sectionStart: splitY, contentHeight: printLayout.totalHeight - splitY },
      ]
    : [{ sectionStart: 0, contentHeight: printLayout.totalHeight }];

  const totalPrintHeight = printLayout.totalHeight + PRINT_LABEL_HEIGHT;
  const maxPrintHeight = (useTwoSections ? 2 : 1) * printPageBracketHeight;
  const printZoom = totalPrintHeight > maxPrintHeight ? maxPrintHeight / totalPrintHeight : undefined;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Round tabs (hidden when printing) ───────────────────────────────── */}
      <div className="print:hidden flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => setSelectedRounds('all')}
          className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            isAll
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          All Rounds
        </button>

        {presentRounds.map((r) => {
          const date = roundPlayByDates[r];
          const isActive = !isAll && (selectedRounds as Set<CompRound>).has(r);
          return (
            <button
              key={r}
              onClick={() => toggleRound(r)}
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

      {/* ── Screen bracket (hidden in print — absolute-positioned cards can't use break-inside) ── */}
      <div className="overflow-x-auto pb-4 print:hidden">
        <div
          style={{ width: totalWidth, minHeight: totalHeight + LABEL_HEIGHT + matchHeight }}
          className="relative"
        >
          {/* Round labels */}
          <div className="flex mb-2" style={{ width: totalWidth }}>
            {roundLabels
              .filter(({ label }) => isRoundVisible(label))
              .map(({ label, x }) => {
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
            {connectors
              .filter((c) => isRoundVisible(c.childRound))
              .map((c, i) => {
                const { topChildCenterY, botChildCenterY, topChildRightX, botChildRightX, parentCenterY, parentLeftX, midX, isTopChildBye, isBotChildBye } = c;
                if (isTopChildBye && isBotChildBye) return null;
                const stroke = '#9ca3af';
                if (isTopChildBye) return (
                  <g key={i} stroke={stroke} strokeWidth={1.5} fill="none">
                    <path d={`M ${botChildRightX} ${botChildCenterY} H ${midX} V ${parentCenterY} H ${parentLeftX}`} />
                  </g>
                );
                if (isBotChildBye) return (
                  <g key={i} stroke={stroke} strokeWidth={1.5} fill="none">
                    <path d={`M ${topChildRightX} ${topChildCenterY} H ${midX} V ${parentCenterY} H ${parentLeftX}`} />
                  </g>
                );
                return (
                  <g key={i} stroke={stroke} strokeWidth={1.5} fill="none">
                    <path d={`M ${topChildRightX} ${topChildCenterY} H ${midX} V ${botChildCenterY}`} />
                    <path d={`M ${botChildRightX} ${botChildCenterY} H ${midX}`} />
                    <path d={`M ${midX} ${parentCenterY} H ${parentLeftX}`} />
                  </g>
                );
              })}
          </svg>

          {/* Match cards */}
          <div style={{ position: 'absolute', top: LABEL_HEIGHT, left: 0, width: totalWidth, height: totalHeight }}>
            {matchGeometries
              .filter((geo) => geo.match.status !== 'Bye' && isRoundVisible(geo.match.round))
              .map((geo) => (
                <MatchCard
                  key={geo.matchId}
                  match={geo.match}
                  topY={geo.topY}
                  x={geo.x}
                  matchHeight={matchHeight}
                  getInfo={getInfo}
                  currentUsername={currentUsername}
                  showHandicap={showHandicap}
                  canInteract={canInteract(geo.match)}
                  onClick={onMatchClick}
                  roundPlayByDate={roundPlayByDates[geo.match.round]}
                  showFullNames={true}
                />
              ))}
          </div>
        </div>
      </div>

      {/* ── Print bracket ────────────────────────────────────────────────────── */}
      {/* Paginated into ≤2 sections split at the halfway slot boundary, so       */}
      {/* absolutely-positioned cards never straddle a physical page boundary.    */}
      {/* Each section draws ALL connector lines (adjusted by sectionStart);      */}
      {/* overflow:hidden on the section div clips cross-section connectors.      */}
      {/* Exit connectors (e.g. R1→QF) are drawn even when QF is not selected.   */}
      <div className="hidden print:block" style={printZoom != null ? { zoom: printZoom } : undefined}>
        {printSections.map(({ sectionStart, contentHeight }, si) => (
          <div
            key={si}
            style={{
              position: 'relative',
              width: printLayout.totalWidth,
              height: contentHeight + PRINT_LABEL_HEIGHT,
              breakAfter: si < printSections.length - 1 ? 'page' : 'auto',
              pageBreakAfter: si < printSections.length - 1 ? 'always' : 'auto',
              overflow: 'hidden',
            }}
          >
            {/* Round column headers — only for selected rounds */}
            {printLayout.roundLabels
              .filter(({ label }) => printVisibleRounds.has(label as CompRound))
              .map(({ label, x }) => {
                const date = roundPlayByDates[label];
                return (
                  <div
                    key={label}
                    style={{ position: 'absolute', top: 0, left: x, width: PRINT_MATCH_WIDTH }}
                    className="text-center"
                  >
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 pb-0.5 border-b border-gray-300">
                      {COMP_ROUND_LABELS[label as keyof typeof COMP_ROUND_LABELS] ?? label}
                    </div>
                    {date && (
                      <div className="text-[8px] text-gray-400 leading-none mt-0.5">
                        by {formatPlayByDate(date)}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* SVG connectors — all drawn, Y-adjusted by sectionStart.
                overflow:hidden on the section div clips cross-section lines. */}
            <svg
              style={{
                position: 'absolute',
                top: PRINT_LABEL_HEIGHT,
                left: 0,
                width: printLayout.totalWidth,
                height: contentHeight,
                overflow: 'visible',
                pointerEvents: 'none',
              }}
            >
              {printLayout.connectors
                .filter((c) => printVisibleRounds.has(c.childRound as CompRound))
                .map((c, ci) => {
                  const adjTop    = c.topChildCenterY - sectionStart;
                  const adjBot    = c.botChildCenterY - sectionStart;
                  const adjParent = c.parentCenterY   - sectionStart;
                  const stroke = '#6b7280';
                  if (c.isTopChildBye && c.isBotChildBye) return null;
                  if (c.isTopChildBye) return (
                    <g key={ci} stroke={stroke} strokeWidth={1} fill="none">
                      <path d={`M ${c.botChildRightX} ${adjBot} H ${c.midX} V ${adjParent} H ${c.parentLeftX}`} />
                    </g>
                  );
                  if (c.isBotChildBye) return (
                    <g key={ci} stroke={stroke} strokeWidth={1} fill="none">
                      <path d={`M ${c.topChildRightX} ${adjTop} H ${c.midX} V ${adjParent} H ${c.parentLeftX}`} />
                    </g>
                  );
                  return (
                    <g key={ci} stroke={stroke} strokeWidth={1} fill="none">
                      <path d={`M ${c.topChildRightX} ${adjTop} H ${c.midX} V ${adjBot}`} />
                      <path d={`M ${c.botChildRightX} ${adjBot} H ${c.midX}`} />
                      <path d={`M ${c.midX} ${adjParent} H ${c.parentLeftX}`} />
                    </g>
                  );
                })}
            </svg>

            {/* Match cards — only those within this section's Y range and selected rounds */}
            {printLayout.matchGeometries
              .filter((geo) =>
                geo.match.status !== 'Bye' &&
                printVisibleRounds.has(geo.match.round as CompRound) &&
                geo.topY >= sectionStart &&
                geo.topY < sectionStart + contentHeight
              )
              .map((geo) => (
                <div
                  key={geo.matchId}
                  style={{
                    position: 'absolute',
                    top: PRINT_LABEL_HEIGHT + geo.topY - sectionStart,
                    left: geo.x,
                    width: PRINT_MATCH_WIDTH,
                  }}
                >
                  <PrintMatchCard
                    match={geo.match}
                    getInfo={getInfo}
                    showHandicap={showHandicap}
                    matchHeight={matchHeight}
                  />
                </div>
              ))}
          </div>
        ))}
      </div>
    </>
  );
}
