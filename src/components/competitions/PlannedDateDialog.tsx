// src/components/competitions/PlannedDateDialog.tsx
// Simple dialog for members to record the agreed date and optional marker for their pending match.
// Shown when a member clicks their own pending match in the bracket view.
// For singles competitions the dialog also shows a marker (scorer) dropdown.

'use client';

import { useState, useEffect } from 'react';
import type { CompMatch, CompMemberInfo } from '@/types/competitions';

interface PlannedDateDialogProps {
  match: CompMatch;
  getInfo: (username: string) => CompMemberInfo;
  // onSave receives the agreed date and, for singles, the chosen marker username (or '' to clear)
  onSave: (matchId: string, date: string, marker?: string) => Promise<void>;
  onClose: () => void;
  // Whether this is a singles competition — controls visibility of the marker dropdown
  isSingles?: boolean;
  // Sorted list of playing members for the marker dropdown — pass only when isSingles is true
  playingMembers?: { username: string; fullName: string }[];
}

// Build a human-readable "Skip & Lead" label for a side
function getSideLabel(usernames: string[], getInfo: (u: string) => CompMemberInfo): string {
  if (usernames.length === 1) return getInfo(usernames[0]).fullName;
  const skip = getInfo(usernames[0]).fullName;
  const extras = usernames.slice(1).map((u) => getInfo(u).fullName);
  return skip + ' & ' + extras.join(' & ');
}

export function PlannedDateDialog({ match, getInfo, onSave, onClose, isSingles = false, playingMembers = [] }: PlannedDateDialogProps) {
  // Pre-fill from the match's existing arranged date (if any)
  const [dateValue, setDateValue] = useState(match.playedDate || '');
  // Pre-fill from the match's existing marker (if any)
  const [markerValue, setMarkerValue] = useState(match.marker || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync inputs when the match prop changes (e.g. when the dialog is reused)
  useEffect(() => {
    setDateValue(match.playedDate || '');
    setMarkerValue(match.marker || '');
  }, [match.playedDate, match.marker]);

  const side1Label = getSideLabel(match.side1Usernames, getInfo);
  const side2Usernames = match.side2Usernames || [];
  const side2Label = side2Usernames.length > 0 ? getSideLabel(side2Usernames, getInfo) : 'TBD';

  // Save handler — writes date (required) and marker (optional, singles only)
  async function handleSave() {
    // A date must be entered before saving
    if (!dateValue) {
      setError('Please select a date');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Pass the marker value only for singles comps; undefined suppresses the field for pairs/triples
      if (isSingles) {
        await onSave(match.matchId, dateValue, markerValue);
      } else {
        await onSave(match.matchId, dateValue);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm text-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-900">Arrange Match Date</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Match participants */}
          <p className="text-sm text-gray-700">
            <span className="font-medium">{side1Label}</span>
            {' vs '}
            <span className="font-medium">{side2Label}</span>
          </p>

          {/* Arranged date input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date arranged
            </label>
            <input
              type="date"
              value={dateValue}
              onChange={(e) => {
                setDateValue(e.target.value);
                setError(null);
              }}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm text-gray-900"
              autoFocus
            />
          </div>

          {/* Marker dropdown — only shown for singles competitions */}
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
                {/* Loop through the sorted playing members list to build dropdown options */}
                {playingMembers.map((m) => (
                  <option key={m.username} value={m.username}>{m.fullName}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dateValue}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
