// src/components/game-management/SelectionHelperDialog.tsx
// "Selection Helper" dialog for captains — surfaces key considerations before picking a team.
// Shows: bar/driving availability, reserve priority, first-timers, buddy pairs, % outliers.

'use client';

import { useEffect, useState } from 'react';

// ============================================================================
// Types (mirrors the API response shape)
// ============================================================================

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
  barVolunteers: HelperPlayer[];
  barVolunteersSelected: number;
  drivers: HelperPlayer[];
  carsNeeded: number;
  driversSelected: number;
  reservePriority: HelperPlayer[];
  firstTimers: HelperPlayer[];
  buddyPairs: BuddyPair[];
  percentOutliers: PercentOutlier[];
  avgPercentPlayed: number;
  hasPercentData: boolean;
}

// ============================================================================
// Sub-components
// ============================================================================

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-lg">{icon}</span>
      <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
    </div>
  );
}

function StatusBadge({ selected }: { selected: string }) {
  if (selected === 'Y') return <span className="ml-1 text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded">Playing</span>;
  if (selected === 'R') return <span className="ml-1 text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">Reserve</span>;
  if (selected === 'T') return <span className="ml-1 text-xs bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">Res Team</span>;
  return null;
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
      Reserve ×{n}
    </span>
  );
}

// ============================================================================
// Main component
// ============================================================================

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tabName: string;
}

export function SelectionHelperDialog({ isOpen, onClose, tabName }: Props) {
  const [data, setData] = useState<HelperData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!isOpen || !tabName) return;
    setLoading(true);
    setError('');
    setData(null);

    fetch(`/api/friendlies/manage/selection-helper?tab_name=${encodeURIComponent(tabName)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError('Failed to load selection helper'))
      .finally(() => setLoading(false));
  }, [isOpen, tabName]);

  if (!isOpen) return null;

  const isAway = data?.homeAway === 'A';

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">

          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Selection Helper</h2>
              {data && (
                <p className="text-sm text-gray-500 mt-0.5">
                  {data.totalEntered} players entered · {data.format} · {data.homeAway === 'H' ? 'Home' : 'Away'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHelp(h => !h)}
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-sm font-bold transition-colors ${
                  showHelp
                    ? 'border-blue-500 bg-blue-500 text-white'
                    : 'border-gray-400 text-gray-400 hover:border-gray-600 hover:text-gray-600'
                }`}
                aria-label="Help"
              >
                ?
              </button>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">

            {/* ---------------------------------------------------------------- */}
            {/* HELP PANEL                                                        */}
            {/* ---------------------------------------------------------------- */}
            {showHelp && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3 text-sm text-gray-700">
                <p className="font-semibold text-blue-900">What each section shows</p>
                <p>
                  <strong>🍺 Bar Volunteers</strong> (home games) — lists entered players willing to
                  do bar duty, and warns if none are currently selected to play.
                </p>
                <p>
                  <strong>🚗 Drivers Needed</strong> (away games) — calculates how many cars are
                  required (total players in format ÷ 4) and lists available drivers. Warns if
                  fewer drivers are selected than cars needed.
                </p>
                <p>
                  <strong>⭐ Recent Reserves</strong> — all entered players whose most recent
                  closed game was a reserve, sorted by streak length. A yellow badge means 1
                  reserve in a row, orange means 2, red means 3 or more. Ties are broken by %
                  played (lower first). Selection status is shown alongside each name so you can
                  see who still needs to be picked.
                </p>
                <p>
                  <strong>🌟 First Timers</strong> — entered players who have never been picked to
                  play in a friendly. Worth giving them a run if possible.
                </p>
                <p>
                  <strong>💑 Couples / Buddies</strong> — buddy pairs (set up in member profiles)
                  where both players have entered this game. Worth trying to put them on the same
                  rink.
                </p>
                <p>
                  <strong>📊 % Played</strong> — shows the group average, then lists players more
                  than 10 percentage points above or below it. First Timers (never picked) are
                  shown in their own section and are not repeated here. If everyone is within 10%,
                  a &ldquo;no fairness concerns&rdquo; message is shown.
                </p>
                <p className="text-xs text-blue-700 pt-1">
                  The helper loads fresh data each time you open it — close and reopen to see an
                  updated picture as you make changes.
                </p>
              </div>
            )}

            {loading && (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                <p className="mt-2 text-gray-500 text-sm">Analysing selection...</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">{error}</div>
            )}

            {data && (
              <>
                {/* ---------------------------------------------------------------- */}
                {/* BAR (home) / DRIVING (away)                                      */}
                {/* ---------------------------------------------------------------- */}
                {!isAway ? (
                  <section>
                    <SectionHeader icon="🍺" title="Bar Volunteers (Home Game)" />
                    {data.barVolunteers.length === 0 ? (
                      <p className="text-sm text-red-600 font-medium">⚠ No bar volunteers in this game!</p>
                    ) : (
                      <>
                        {data.barVolunteersSelected === 0 && (
                          <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded mb-2">
                            ⚠ None of your bar volunteers are selected yet.
                          </p>
                        )}
                        <ul className="space-y-1">
                          {data.barVolunteers.map(p => (
                            <li key={p.userName} className="flex items-center text-sm text-gray-700">
                              <span className="w-2 h-2 rounded-full bg-amber-400 mr-2 flex-shrink-0" />
                              {p.fullName}
                              <StatusBadge selected={p.selected} />
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </section>
                ) : (
                  <section>
                    <SectionHeader icon="🚗" title={`Drivers Needed (Away Game)`} />
                    <p className="text-sm text-gray-600 mb-2">
                      <strong>{data.carsNeeded} cars</strong> needed for {data.format} ({Math.ceil(data.totalEntered / 4) !== data.carsNeeded ? `${data.totalEntered} players ÷ 4` : `${data.totalEntered} players ÷ 4`}).
                      {' '}{data.driversSelected} of {data.drivers.length} driver{data.drivers.length !== 1 ? 's' : ''} selected so far.
                    </p>
                    {data.driversSelected < data.carsNeeded && (
                      <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded mb-2">
                        ⚠ Only {data.driversSelected} driver{data.driversSelected !== 1 ? 's' : ''} selected — need {data.carsNeeded}.
                      </p>
                    )}
                    {data.drivers.length === 0 ? (
                      <p className="text-sm text-red-600 font-medium">No drivers in this game!</p>
                    ) : (
                      <ul className="space-y-1">
                        {data.drivers.map(p => (
                          <li key={p.userName} className="flex items-center text-sm text-gray-700">
                            <span className="w-2 h-2 rounded-full bg-blue-400 mr-2 flex-shrink-0" />
                            {p.fullName}
                            <StatusBadge selected={p.selected} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {/* ---------------------------------------------------------------- */}
                {/* RESERVE PRIORITY                                                 */}
                {/* ---------------------------------------------------------------- */}
                <section>
                  <SectionHeader icon="⭐" title="Recent Reserves" />
                  {data.reservePriority.length === 0 ? (
                    <p className="text-sm text-gray-500">No players have a reserve as their most recent game.</p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500 mb-2">
                        All entered players whose last game was a reserve, ordered by streak then % played (lower first).
                      </p>
                      <ol className="space-y-1.5">
                        {data.reservePriority.map((p, idx) => (
                          <li key={p.userName} className="flex items-start gap-2 text-sm">
                            <span className="text-gray-400 w-5 flex-shrink-0 text-right">{idx + 1}.</span>
                            <span className="text-gray-700">
                              {p.fullName}
                              <StatusBadge selected={p.selected} />
                              <ReserveStreak n={p.consecutiveReserves} />
                              <Pct value={p.percentPlayed} />
                              {p.isFirstTimer && (
                                <span className="ml-1 text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">First timer</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </section>

                {/* ---------------------------------------------------------------- */}
                {/* FIRST TIMERS                                                     */}
                {/* ---------------------------------------------------------------- */}
                {data.firstTimers.length > 0 && (
                  <section>
                    <SectionHeader icon="🌟" title="First Timers" />
                    <p className="text-xs text-gray-500 mb-2">Players who have never been picked to play.</p>
                    <ul className="space-y-1">
                      {data.firstTimers.map(p => (
                        <li key={p.userName} className="flex items-center text-sm text-gray-700">
                          <span className="w-2 h-2 rounded-full bg-blue-400 mr-2 flex-shrink-0" />
                          {p.fullName}
                          <StatusBadge selected={p.selected} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* ---------------------------------------------------------------- */}
                {/* BUDDY / COUPLE PAIRS                                             */}
                {/* ---------------------------------------------------------------- */}
                {data.buddyPairs.length > 0 && (
                  <section>
                    <SectionHeader icon="💑" title="Couples / Buddies" />
                    <p className="text-xs text-gray-500 mb-2">Consider teaming these players together.</p>
                    <ul className="space-y-1.5">
                      {data.buddyPairs.map((pair, i) => (
                        <li key={i} className="flex items-center flex-wrap gap-x-1 text-sm text-gray-700">
                          <span className="font-medium">{pair.player1}</span>
                          <StatusBadge selected={pair.player1Selected} />
                          <span className="text-gray-400 mx-1">↔</span>
                          <span className="font-medium">{pair.player2}</span>
                          <StatusBadge selected={pair.player2Selected} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* ---------------------------------------------------------------- */}
                {/* % PLAYED OUTLIERS                                                */}
                {/* ---------------------------------------------------------------- */}
                <section>
                  <SectionHeader icon="📊" title="% Played" />
                  {!data.hasPercentData ? (
                    <p className="text-sm text-gray-500">No closed-game history yet this season.</p>
                  ) : (
                    <>
                      <p className="text-sm text-gray-600 mb-2">
                        Group average: <strong>{Math.round(data.avgPercentPlayed * 100)}%</strong>
                      </p>
                      {data.percentOutliers.length === 0 ? (
                        <p className="text-sm text-gray-500">
                          Everyone is within 10% of the average — no fairness concerns.
                        </p>
                      ) : (
                        <>
                          <p className="text-xs text-gray-500 mb-2">
                            Players more than 10% above or below the average:
                          </p>
                          <ul className="space-y-1">
                            {data.percentOutliers.map(p => (
                              <li key={p.userName} className="flex items-center text-sm text-gray-700">
                                <span className={`w-2 h-2 rounded-full mr-2 flex-shrink-0 ${
                                  p.direction === 'below' ? 'bg-orange-400' : 'bg-blue-400'
                                }`} />
                                {p.fullName}
                                <Pct value={p.percentPlayed} />
                                <StatusBadge selected={p.selected} />
                                <span className={`ml-1 text-xs ${p.direction === 'below' ? 'text-orange-600' : 'text-blue-600'}`}>
                                  {p.direction === 'below' ? '▼ below' : '▲ above'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </>
                  )}
                </section>

                {/* All clear message */}
                {data.reservePriority.length === 0 &&
                  data.firstTimers.length === 0 &&
                  data.buddyPairs.length === 0 &&
                  data.percentOutliers.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">Nothing else to flag — good to go!</p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-gray-200 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
