// app/my-availability/page.tsx
// Member-facing standard-week editor + overrides + duties band + max games per day.
// Part of the member-availability substrate — see specs/MEMBER_AVAILABILITY_SPEC.md.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { useEditMode } from '@/hooks/useEditMode';
import { getButtonClasses, getInputClasses, getCardClasses, getAlertClasses } from '@/config/theme-helpers';
import type { StandardWeekEntry, AvailabilityOverride, Commitment, Session, OverrideSession } from '@/lib/member-availability';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SESSIONS: { value: Session; label: string }[] = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
];

interface GridCell {
  status: 'free' | 'busy';
  label: string;
}
// Always has exactly 21 keys (7 weekdays x 3 sessions) once loaded — every cell is
// explicit free-or-busy, never absent, so the resolver never sees "unknown" for a
// member who has saved their week at least once.
type GridState = Record<string, GridCell>;

function cellKey(weekday: number, session: Session): string {
  return `${weekday}:${session}`;
}

function buildDefaultGrid(entries: StandardWeekEntry[]): GridState {
  const grid: GridState = {};
  for (let weekday = 0; weekday < 7; weekday++) {
    for (const s of SESSIONS) {
      grid[cellKey(weekday, s.value)] = { status: 'free', label: '' };
    }
  }
  for (const entry of entries) {
    grid[cellKey(entry.weekday, entry.session)] = { status: entry.status, label: entry.label || '' };
  }
  return grid;
}

export default function MyAvailabilityPage() {
  const { data: authSession, status } = useSession();
  const isGuest = status === 'unauthenticated';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [duties, setDuties] = useState<Commitment[]>([]);
  const [overrides, setOverrides] = useState<AvailabilityOverride[]>([]);
  const [maxGamesPerDay, setMaxGamesPerDay] = useState<1 | 2>(2);
  const [savingMaxGames, setSavingMaxGames] = useState(false);
  const [initialGrid, setInitialGrid] = useState<GridState>({});

  // Add-override form
  const [overrideStartDate, setOverrideStartDate] = useState('');
  const [overrideEndDate, setOverrideEndDate] = useState('');
  const [overrideSession, setOverrideSession] = useState<OverrideSession>('all');
  const [overrideStatus, setOverrideStatus] = useState<'free' | 'busy'>('busy');
  const [overrideLabel, setOverrideLabel] = useState('');
  const [addingOverride, setAddingOverride] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [removingOverrideId, setRemovingOverrideId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/my-availability');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load availability');
        return;
      }
      setInitialGrid(buildDefaultGrid(data.standardWeek || []));
      setDuties(data.duties || []);
      setOverrides(data.overrides || []);
      setMaxGamesPerDay(data.maxGamesPerDay === 1 ? 1 : 2);
    } catch {
      setError('Failed to load availability');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const editMode = useEditMode<GridState>({
    draftKey: 'MyAvailability-StandardWeek',
    initialData: initialGrid,
    onSave: async (data) => {
      const entries = Object.entries(data).map(([key, cell]) => {
        const [weekdayStr, sessionStr] = key.split(':');
        return {
          weekday: parseInt(weekdayStr, 10),
          session: sessionStr as Session,
          status: cell.status,
          label: cell.label || undefined,
        };
      });
      const res = await fetch('/api/my-availability/standard-week', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) {
        const data2 = await res.json();
        setError(data2.error || 'Failed to save standard week');
        return false;
      }
      return true;
    },
    onSaveSuccess: fetchData,
  });

  function toggleCell(weekday: number, session: Session) {
    if (!editMode.isEditing) return;
    editMode.updateData((prev) => {
      const key = cellKey(weekday, session);
      const current = prev[key];
      return {
        ...prev,
        [key]: { status: current.status === 'free' ? 'busy' : 'free', label: current.label },
      };
    });
  }

  function updateCellLabel(weekday: number, session: Session, label: string) {
    editMode.updateData((prev) => {
      const key = cellKey(weekday, session);
      return { ...prev, [key]: { ...prev[key], label } };
    });
  }

  async function handleMaxGamesChange(value: 1 | 2) {
    setSavingMaxGames(true);
    try {
      const res = await fetch('/api/my-availability/max-games-per-day', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxGamesPerDay: value }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save preference');
        return;
      }
      setMaxGamesPerDay(value);
    } catch {
      setError('Failed to save preference');
    } finally {
      setSavingMaxGames(false);
    }
  }

  async function handleAddOverride() {
    if (!overrideStartDate) {
      setOverrideError('Pick a date');
      return;
    }
    setAddingOverride(true);
    setOverrideError(null);
    try {
      const res = await fetch('/api/my-availability/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: toUKDate(overrideStartDate),
          endDate: overrideEndDate ? toUKDate(overrideEndDate) : undefined,
          session: overrideSession,
          status: overrideStatus,
          label: overrideLabel || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOverrideError(data.error || 'Failed to add override');
        return;
      }
      setOverrideStartDate('');
      setOverrideEndDate('');
      setOverrideLabel('');
      await fetchData();
    } catch {
      setOverrideError('Failed to add override');
    } finally {
      setAddingOverride(false);
    }
  }

  async function handleRemoveOverride(id: string) {
    setRemovingOverrideId(id);
    try {
      const res = await fetch(`/api/my-availability/overrides/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to remove override');
        return;
      }
      setOverrides((prev) => prev.filter((o) => o.id !== id));
    } catch {
      setError('Failed to remove override');
    } finally {
      setRemovingOverrideId(null);
    }
  }

  if (isGuest) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar showLogoOnly />
        <div className="container mx-auto px-4 py-8 max-w-3xl text-center text-gray-700">
          Please log in to manage your availability.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={authSession?.user?.name ?? undefined}
        userRole={authSession?.user?.role ?? undefined}
        actionButtons={editMode.getNavbarActions()}
      />

      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Availability</h1>
          <p className="text-gray-700 mt-1">
            Set your normal weekly pattern so captains and organisers can see when you&apos;re usually free.
          </p>
        </div>

        {error && <div className={getAlertClasses('danger')}>{error}</div>}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <p className="mt-2 text-gray-700">Loading...</p>
          </div>
        ) : (
          <>
            {/* Duties band */}
            {duties.length > 0 && (
              <div className={getCardClasses('md')}>
                <h2 className="text-sm font-medium text-gray-700 mb-2">Upcoming duties</h2>
                <ul className="space-y-1 text-sm text-gray-900">
                  {duties.map((d) => (
                    <li key={d.id} className="flex justify-between">
                      <span>{d.label || d.type}</span>
                      <span className="text-gray-700">{d.date}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Standard week grid */}
            <div className={getCardClasses('md')}>
              <h2 className="text-sm font-medium text-gray-700 mb-3">Standard week</h2>
              <p className="text-xs text-gray-700 mb-3">
                {editMode.isEditing
                  ? 'Tap a session to mark it busy. Add a short label if you like (e.g. "Work").'
                  : 'Tap Edit to change your usual weekly pattern.'}
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className="text-left text-xs font-medium text-gray-700 pb-2 pr-2">Day</th>
                      {SESSIONS.map((s) => (
                        <th key={s.value} className="text-xs font-medium text-gray-700 pb-2 px-2">
                          {s.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {WEEKDAYS.map((dayName, weekday) => (
                      <tr key={weekday} className="border-t border-gray-100">
                        <td className="text-sm text-gray-900 py-2 pr-2 whitespace-nowrap">{dayName}</td>
                        {SESSIONS.map((s) => {
                          const cell = editMode.editedData[cellKey(weekday, s.value)];
                          if (!cell) return <td key={s.value} />;
                          const isBusy = cell.status === 'busy';
                          return (
                            <td key={s.value} className="py-2 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => toggleCell(weekday, s.value)}
                                disabled={!editMode.isEditing}
                                className={`w-full min-w-[80px] px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
                                  isBusy
                                    ? 'bg-red-50 text-red-700 border-red-200'
                                    : 'bg-green-50 text-green-700 border-green-200'
                                } ${editMode.isEditing ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                              >
                                {isBusy ? (cell.label || 'Busy') : 'Free'}
                              </button>
                              {editMode.isEditing && isBusy && (
                                <input
                                  type="text"
                                  value={cell.label}
                                  onChange={(e) => updateCellLabel(weekday, s.value, e.target.value)}
                                  placeholder="Label (optional)"
                                  className="mt-1 w-full text-xs px-1.5 py-1 border border-gray-300 rounded"
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Max games per day */}
            <div className={getCardClasses('md')}>
              <h2 className="text-sm font-medium text-gray-700 mb-2">Games per day</h2>
              <p className="text-xs text-gray-700 mb-3">
                If you&apos;d rather not play twice in one day, other sessions on a day you&apos;re already
                committed will default to unlikely when captains select teams (you can always say yes anyway).
              </p>
              <div className="flex gap-3">
                {[1, 2].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => handleMaxGamesChange(n as 1 | 2)}
                    disabled={savingMaxGames}
                    className={`px-4 py-2 rounded-md text-sm font-medium border disabled:opacity-50 ${
                      maxGamesPerDay === n
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {n} game{n !== 1 ? 's' : ''} per day
                  </button>
                ))}
              </div>
            </div>

            {/* Overrides */}
            <div className={getCardClasses('md')}>
              <h2 className="text-sm font-medium text-gray-700 mb-3">Exceptions</h2>
              <p className="text-xs text-gray-700 mb-3">
                Away for a fortnight, or free one Saturday despite your usual pattern — add a specific date
                (or date range) exception here. It overrides your standard week for that date only.
              </p>

              {overrides.length > 0 && (
                <ul className="mb-4 space-y-1">
                  {overrides.map((o) => (
                    <li key={o.id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2">
                      <span className="text-gray-900">
                        {o.date} — {o.session === 'all' ? 'All day' : o.session} —{' '}
                        <span className={o.status === 'busy' ? 'text-red-700' : 'text-green-700'}>
                          {o.status === 'busy' ? 'Busy' : 'Free'}
                        </span>
                        {o.label && <span className="text-gray-700"> ({o.label})</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveOverride(o.id)}
                        disabled={removingOverrideId === o.id}
                        className="text-red-500 hover:text-red-700 text-xs ml-3 shrink-0"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {overrideError && <div className={`${getAlertClasses('danger')} mb-3`}>{overrideError}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
                  <input
                    type="date"
                    value={overrideStartDate}
                    onChange={(e) => setOverrideStartDate(e.target.value)}
                    className={getInputClasses()}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">To (optional)</label>
                  <input
                    type="date"
                    value={overrideEndDate}
                    onChange={(e) => setOverrideEndDate(e.target.value)}
                    className={getInputClasses()}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Session</label>
                  <select
                    value={overrideSession}
                    onChange={(e) => setOverrideSession(e.target.value as OverrideSession)}
                    className={getInputClasses()}
                  >
                    <option value="all">All day</option>
                    {SESSIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={overrideStatus}
                    onChange={(e) => setOverrideStatus(e.target.value as 'free' | 'busy')}
                    className={getInputClasses()}
                  >
                    <option value="busy">Busy</option>
                    <option value="free">Free</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Reason (optional)</label>
                  <input
                    type="text"
                    value={overrideLabel}
                    onChange={(e) => setOverrideLabel(e.target.value)}
                    placeholder="e.g. Holiday"
                    className={getInputClasses()}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddOverride}
                disabled={addingOverride || !overrideStartDate}
                className={`${getButtonClasses('primary', 'md')} mt-3`}
              >
                {addingOverride ? 'Adding...' : 'Add exception'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// HTML date inputs give YYYY-MM-DD; the rest of the app speaks DD/MM/YYYY.
function toUKDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}
