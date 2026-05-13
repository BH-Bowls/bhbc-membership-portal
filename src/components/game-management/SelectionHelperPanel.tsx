// src/components/game-management/SelectionHelperPanel.tsx
// Inline Selection Helper panel — same data as the dialog but rendered in the right-hand column.
// Omits bar/driver sections (visible in D/B column) and removes verbose description lines.

'use client';

import { useEffect, useState } from 'react';

interface HelperPlayer {
  userName: string;
  fullName: string;
  driverBar: string;
  selected: string;
  nameDown: number;
  picked: number;
  percentPlayed: number;
  consecutiveReserves: number;
  isFirstTimer: boolean;
}

interface BuddyPair {
  player1: string;
  player1Selected: string;
  player2: string;
  player2Selected: string;
}

interface PercentOutlier extends HelperPlayer {
  direction: 'above' | 'below';
}

interface HelperData {
  homeAway: 'H' | 'A';
  format: string;
  totalEntered: number;
  reservePriority: HelperPlayer[];
  firstTimers: HelperPlayer[];
  buddyPairs: BuddyPair[];
  percentOutliers: PercentOutlier[];
  avgPercentPlayed: number;
  hasPercentData: boolean;
}


function Pct({ value }: { value: number }) {
  const pct = Math.round(value > 1 ? value : value * 100);
  return <span className="text-gray-500 text-xs ml-1">({pct}%)</span>;
}

function ReserveStreak({ n }: { n: number }) {
  if (n === 0) return null;
  const colour = n >= 3 ? 'bg-red-100 text-red-800' : n === 2 ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800';
  return (
    <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${colour}`}>
      ×{n}
    </span>
  );
}

interface Props {
  tabName: string;
  active: boolean;
}

export function SelectionHelperPanel({ tabName, active }: Props) {
  const [data, setData] = useState<HelperData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fetchKey, setFetchKey] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!active || !tabName) return;
    setLoading(true);
    setError('');
    fetch(`/api/friendlies/manage/selection-helper?tab_name=${encodeURIComponent(tabName)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError('Failed to load selection helper'))
      .finally(() => setLoading(false));
  }, [active, tabName, fetchKey]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        {data && (
          <p className="text-xs text-gray-500">{data.totalEntered} entered · {data.format}</p>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setShowHelp(h => !h)}
            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
              showHelp ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-400 text-gray-400 hover:border-gray-600 hover:text-gray-600'
            }`}
            aria-label="Help"
          >
            ?
          </button>
          <button
            onClick={() => setFetchKey(k => k + 1)}
            disabled={loading}
            className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400 transition-colors"
            title="Reload selection helper"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2 text-xs text-gray-700">
          <p><strong>⭐ Recent Reserves</strong> — players whose last game was a reserve, sorted by streak. Yellow = 1 in a row, orange = 2, red = 3+.</p>
          <p><strong>🌟 First Timers</strong> — players who have never been picked to play.</p>
          <p><strong>💑 Buddies</strong> — buddy pairs where both players have entered. Worth putting on the same rink.</p>
          <p><strong>📊 % Played</strong> — group average, plus anyone more than 10% above or below it.</p>
          <p className="text-blue-700">Click Refresh to reload after making changes.</p>
        </div>
      )}

      {loading && (
        <div className="text-center py-6">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          <p className="mt-2 text-gray-500 text-xs">Analysing...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded text-xs">{error}</div>
      )}

      {data && !loading && (
        <>
          {/* Recent Reserves */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">⭐ Recent Reserves</p>
            {data.reservePriority.length === 0 ? (
              <p className="text-xs text-gray-500">None.</p>
            ) : (
              <ol className="space-y-1">
                {data.reservePriority.map((p, idx) => (
                  <li key={p.userName} className="flex items-start gap-1.5 text-xs">
                    <span className="text-gray-400 w-4 flex-shrink-0 text-right">{idx + 1}.</span>
                    <span className="text-gray-700 leading-snug">
                      {p.fullName}
                      <ReserveStreak n={p.consecutiveReserves} />
                      <Pct value={p.percentPlayed} />
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* First Timers */}
          {data.firstTimers.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">🌟 First Timers</p>
              <ul className="space-y-1">
                {data.firstTimers.map(p => (
                  <li key={p.userName} className="flex items-center text-xs text-gray-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mr-2 flex-shrink-0" />
                    {p.fullName}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Buddy Pairs */}
          {data.buddyPairs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">💑 Buddies</p>
              <ul className="space-y-1">
                {data.buddyPairs.map((pair, i) => (
                  <li key={i} className="flex items-center flex-wrap gap-x-1 text-xs text-gray-700">
                    <span className="font-medium">{pair.player1}</span>
                    <span className="text-gray-400 mx-0.5">↔</span>
                    <span className="font-medium">{pair.player2}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* % Played */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">📊 % Played</p>
            {!data.hasPercentData ? (
              <p className="text-xs text-gray-500">No history yet.</p>
            ) : (
              <>
                <p className="text-xs text-gray-600 mb-1.5">
                  Average: <strong>{Math.round(data.avgPercentPlayed * 100)}%</strong>
                </p>
                {data.percentOutliers.length === 0 ? (
                  <p className="text-xs text-gray-500">No fairness concerns.</p>
                ) : (
                  <ul className="space-y-1">
                    {data.percentOutliers.map(p => (
                      <li key={p.userName} className="flex items-center text-xs text-gray-700">
                        <span className={`w-1.5 h-1.5 rounded-full mr-2 flex-shrink-0 ${
                          p.direction === 'below' ? 'bg-orange-400' : 'bg-blue-400'
                        }`} />
                        {p.fullName}
                        <Pct value={p.percentPlayed} />
                          <span className={`ml-1 text-xs ${p.direction === 'below' ? 'text-orange-600' : 'text-blue-600'}`}>
                          {p.direction === 'below' ? '▼' : '▲'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {data.reservePriority.length === 0 &&
            data.firstTimers.length === 0 &&
            data.buddyPairs.length === 0 &&
            data.percentOutliers.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-2">Nothing to flag — good to go!</p>
          )}
        </>
      )}
    </div>
  );
}
