// src/components/competitions/MatchCard.tsx
// Individual match box in the bracket

'use client';

import type { CompMatch } from '@/types/competitions';
import type { CompMemberInfo } from '@/types/competitions';
import { MATCH_HEIGHT, MATCH_WIDTH } from './bracketLayout';

interface MatchCardProps {
  match: CompMatch;
  topY: number;
  x: number;
  getInfo: (username: string) => CompMemberInfo;
  currentUsername?: string;
  showHandicap?: boolean;
  onClick?: (match: CompMatch) => void;
  canInteract: boolean; // true if this user can enter a score for this match
}

export function MatchCard({
  match,
  topY,
  x,
  getInfo,
  currentUsername,
  showHandicap = false,
  onClick,
  canInteract,
}: MatchCardProps) {
  const side1 = match.side1Usernames;
  const side2 = match.side2Usernames;

  const isComplete = match.status === 'Complete' || match.status === 'Walkover' || match.status === 'Bye';
  const isPending = match.status === 'Pending';

  // Check if the current user is in this match
  const allUsernames = [...side1, ...(side2 ?? [])];
  const isMyMatch = currentUsername
    ? allUsernames.includes(currentUsername)
    : false;

  // Determine winner highlighting
  const side1Won = isComplete && match.winnerSide === 1;
  const side2Won = isComplete && match.winnerSide === 2;

  const borderColor = isMyMatch && isPending
    ? 'border-blue-400'
    : isComplete
    ? 'border-gray-300'
    : 'border-gray-200';

  const bgColor = isMyMatch && isPending
    ? 'bg-blue-50'
    : 'bg-white';

  const clickable = canInteract && isPending;

  function renderSide(
    usernames: string[],
    score: number | null | undefined,
    won: boolean,
    side: 1 | 2
  ) {
    // Empty side = winner not yet determined (placeholder round)
    if (usernames.length === 0 || !usernames[0]) {
      return (
        <div
          className={`px-2 py-1 text-xs text-gray-300 italic ${
            side === 1 ? 'border-b border-gray-100' : ''
          }`}
        >
          — TBD —
        </div>
      );
    }

    const info = getInfo(usernames[0]);
    const extraCount = usernames.length - 1;
    const otherNames = extraCount > 0
      ? usernames.slice(1).map((u) => getInfo(u).fullName).join(', ')
      : '';

    return (
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
          won ? 'font-bold text-gray-900' : 'text-gray-600'
        } ${side === 1 ? 'border-b border-gray-100' : ''}`}
      >
        <span className="truncate flex-1 min-w-0">
          {won && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 mr-1 flex-shrink-0" />
          )}
          {info.fullName}
          {showHandicap && info.handicap != null && (
            <span className="ml-1 text-gray-400">({info.handicap})</span>
          )}
        </span>
        {extraCount > 0 && (
          <span
            className="flex-shrink-0 text-gray-400 cursor-default"
            title={otherNames}
          >
            +{extraCount}
          </span>
        )}
        {isComplete && (
          <span className={`flex-shrink-0 font-mono ${won ? 'text-gray-900' : 'text-gray-400'}`}>
            {score ?? '-'}
          </span>
        )}
        {match.status === 'Walkover' && won && (
          <span className="text-xs text-orange-500 flex-shrink-0">W/O</span>
        )}
        {match.status === 'Bye' && won && (
          <span className="text-xs text-gray-400 flex-shrink-0">Bye</span>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: topY,
        left: x,
        width: MATCH_WIDTH,
        height: MATCH_HEIGHT,
      }}
      onClick={clickable ? () => onClick?.(match) : undefined}
      className={`
        rounded border ${borderColor} ${bgColor}
        flex flex-col justify-center overflow-hidden
        ${clickable ? 'cursor-pointer hover:border-blue-500 hover:shadow-sm transition-all' : ''}
        ${isMyMatch && isPending ? 'ring-1 ring-blue-300' : ''}
      `}
    >
      {/* Play-by date banner for pending matches */}
      {isPending && match.playByDate && (
        <div className="px-2 pt-1 text-[10px] text-gray-400 leading-none">
          By {formatDate(match.playByDate)}
        </div>
      )}

      <div className="flex-1 flex flex-col justify-center">
        {renderSide(side1, match.score1, side1Won, 1)}
        {side2
          ? renderSide(side2, match.score2, side2Won, 2)
          : match.status === 'Bye' || match.status === 'Walkover'
          ? <div className="px-2 py-1 text-xs text-gray-400 italic">— bye —</div>
          : renderSide([], match.score2, false, 2)}
      </div>

      {/* "Your match" indicator */}
      {isMyMatch && isPending && (
        <div className="px-2 pb-1 text-[10px] text-blue-500 font-medium leading-none">
          Your match · tap to enter score
        </div>
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}
