// src/components/competitions/ScoreDialog.tsx
// Modal dialog for entering match scores or recording a walkover (committee only).
// When onSaveDateOnly is provided, an optional "Date arranged" field is shown.
// Submitting with no scores but a date calls onSaveDateOnly instead.
// For singles competitions a marker dropdown is also shown alongside the date field.

'use client';

import { useState } from 'react';
import type { CompMatch } from '@/types/competitions';
import type { CompMemberInfo } from '@/types/competitions';

interface ScoreDialogProps {
  match: CompMatch;
  getInfo: (username: string) => CompMemberInfo;
  showHandicap?: boolean;
  // Called when both scores are filled — now carries the marker value as well
  onSubmit: (matchId: string, score1: number, score2: number, marker: string) => void;
  onWalkover: (matchId: string, winnerSide: 1 | 2) => void;
  onClose: () => void;
  saving?: boolean;
  // When provided, a "Date arranged" field is shown. Submitting with no scores saves the date (and marker) only.
  onSaveDateOnly?: (matchId: string, date: string, marker: string) => void;
  // Whether this is a singles competition — controls visibility of the marker dropdown
  isSingles?: boolean;
  // Sorted list of playing members for the marker dropdown (singles only)
  playingMembers?: { username: string; fullName: string }[];
}

// Build a human-readable label for one side of a match
function getSideLabel(usernames: string[], getInfo: (u: string) => CompMemberInfo): string {
  if (usernames.length === 1) return getInfo(usernames[0]).fullName;
  const skip = getInfo(usernames[0]).fullName;
  const extras = usernames.slice(1).map((u) => getInfo(u).fullName);
  return `${skip} & ${extras.join(' & ')}`;
}

export function ScoreDialog({
  match,
  getInfo,
  showHandicap = false,
  onSubmit,
  onWalkover,
  onClose,
  saving = false,
  onSaveDateOnly,
  isSingles = false,
  playingMembers = [],
}: ScoreDialogProps) {
  // Score fields — start empty so the user must enter values
  const [score1, setScore1] = useState('');
  const [score2, setScore2] = useState('');
  const [showWalkoverOptions, setShowWalkoverOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Arranged date — pre-filled from any existing value on the match
  const [plannedDate, setPlannedDate] = useState(match.playedDate || '');
  // Marker — pre-filled from any existing value on the match (singles only)
  const [markerValue, setMarkerValue] = useState(match.marker || '');

  const side1Label = getSideLabel(match.side1Usernames, getInfo);
  const side2Label = match.side2Usernames ? getSideLabel(match.side2Usernames, getInfo) : 'Bye';

  const side1Info = getInfo(match.side1Usernames[0]);
  const side2Info = match.side2Usernames ? getInfo(match.side2Usernames[0]) : null;

  // When no scores are entered and onSaveDateOnly is wired up, the submit button saves only the date+marker
  const scoresEmpty = score1 === '' && score2 === '';
  const saveDateOnly = onSaveDateOnly && scoresEmpty;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Date-only path: no scores entered — captain wants to record the agreed date (and optional marker)
    if (saveDateOnly) {
      if (!plannedDate) {
        setError('Please enter a date or fill in scores');
        return;
      }
      onSaveDateOnly(match.matchId, plannedDate, markerValue);
      return;
    }

    // Score path: validate both scores before calling onSubmit
    const s1 = parseInt(score1, 10);
    const s2 = parseInt(score2, 10);

    if (isNaN(s1) || isNaN(s2)) {
      setError('Please enter valid scores for both players');
      return;
    }
    if (s1 < 0 || s2 < 0) {
      setError('Scores cannot be negative');
      return;
    }
    if (s1 === s2) {
      setError('Scores cannot be equal — there must be a winner');
      return;
    }

    // Pass marker value along with scores so it can be saved in the same API call
    onSubmit(match.matchId, s1, s2, markerValue);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm text-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-900">Enter Score</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!showWalkoverOptions ? (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Optional date arranged field — only shown when onSaveDateOnly is wired up */}
            {onSaveDateOnly && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date arranged <span className="font-normal text-gray-500">(leave scores blank to save date only)</span>
                </label>
                <input
                  type="date"
                  value={plannedDate}
                  onChange={(e) => {
                    setPlannedDate(e.target.value);
                    setError(null);
                  }}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm text-gray-900"
                />
              </div>
            )}

            {/* Marker dropdown — only for singles competitions when the member list is available */}
            {isSingles && playingMembers.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Marker <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <select
                  value={markerValue}
                  onChange={(e) => setMarkerValue(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm text-gray-900"
                >
                  <option value="">— No marker assigned —</option>
                  {/* Loop through sorted playing members to build the dropdown */}
                  {playingMembers.map((m) => (
                    <option key={m.username} value={m.username}>{m.fullName}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Side 1 score */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {side1Label}
                {showHandicap && side1Info.handicap != null && (
                  <span className="ml-2 text-xs text-gray-500 font-normal">
                    Handicap: {side1Info.handicap}
                  </span>
                )}
              </label>
              <input
                type="number"
                min="0"
                value={score1}
                onChange={(e) => setScore1(e.target.value)}
                placeholder="Score"
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-lg font-mono text-gray-900"
                autoFocus
              />
            </div>

            {/* Side 2 score */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {side2Label}
                {showHandicap && side2Info && side2Info.handicap != null && (
                  <span className="ml-2 text-xs text-gray-500 font-normal">
                    Handicap: {side2Info.handicap}
                  </span>
                )}
              </label>
              <input
                type="number"
                min="0"
                value={score2}
                onChange={(e) => setScore2(e.target.value)}
                placeholder="Score"
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-lg font-mono text-gray-900"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <div className="flex justify-between items-center pt-1">
              <button
                type="button"
                onClick={() => setShowWalkoverOptions(true)}
                className="text-sm text-orange-600 hover:text-orange-700"
              >
                Record walkover instead
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : saveDateOnly ? 'Save Date' : 'Save Score'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-700">
              Which player advances by walkover?
            </p>
            <div className="space-y-2">
              <button
                onClick={() => onWalkover(match.matchId, 1)}
                className="w-full text-left px-4 py-3 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-sm font-medium text-orange-800"
              >
                {side1Label} advances
              </button>
              {match.side2Usernames && (
                <button
                  onClick={() => onWalkover(match.matchId, 2)}
                  className="w-full text-left px-4 py-3 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-sm font-medium text-orange-800"
                >
                  {side2Label} advances
                </button>
              )}
            </div>
            <button
              onClick={() => setShowWalkoverOptions(false)}
              className="text-sm text-gray-700 hover:text-gray-900"
            >
              ← Back to score entry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
