// app/fixtures/season-planning/page.tsx
// Season Planning Stage 1 (Events) — pull last year's Event fixtures forward
// onto next year's calendar via a chosen date-projection method (see
// season-planning-dates.ts — back-1-day/forward-6-days are how BHBC's real
// fixture list is actually compiled; nth-weekday is a fallback), then work
// each one through Projected -> Confirmed, editing date/time/description
// freely at any point, deleting anything that isn't happening. "Clear All
// Projected Events" wipes every still-Projected, Carried-Forward Event row
// (Friendlies has its own separate clear button, on its own tab), so a run
// using the wrong method can be undone and re-run — see clearProjectedFixtures.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SeasonPlanningTabs } from '@/components/SeasonPlanningTabs';
import { hasRole } from '@/lib/role-utils';
import { getButtonClasses } from '@/config/theme-helpers';
import { PROJECTION_METHOD_LABELS, type ProjectionMethod } from '@/lib/season-planning-dates';
import type { Season, PlanningFixture } from '@/lib/season-planning-supabase';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!ukMatch) return dateStr;
  const d = new Date(parseInt(ukMatch[3]), parseInt(ukMatch[2]) - 1, parseInt(ukMatch[1]));
  if (isNaN(d.getTime())) return dateStr;
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES_SHORT[d.getMonth()]}`;
}

function toDateInputValue(dateStr: string): string {
  if (!dateStr) return '';
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) return `${ukMatch[3]}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;
  return '';
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'Projected': return 'bg-amber-100 text-amber-800';
    case 'Confirmed': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function sourceBadgeClasses(source: string): string {
  return source === 'Carried Forward'
    ? 'bg-gray-100 text-gray-700'
    : 'bg-purple-100 text-purple-700';
}

export default function SeasonPlanningEventsPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const role = session && session.user ? session.user.role : '';
  const isAdmin = hasRole(role, 'Admin');
  const isCaptain = hasRole(role, 'Captain');
  const canAccess = isAdmin || isCaptain;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [draftSeason, setDraftSeason] = useState<Season | null>(null);
  const [events, setEvents] = useState<PlanningFixture[]>([]);

  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftYear, setDraftYear] = useState('');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');

  const [projecting, setProjecting] = useState(false);
  const [projectionMethod, setProjectionMethod] = useState<ProjectionMethod>('back-1-day');
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [addingEvent, setAddingEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ date: '', time: '', description: '', clubName: '', homeAway: 'H' as 'H' | 'A', format: '' });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editHomeAway, setEditHomeAway] = useState<'H' | 'A'>('H');
  const [editFormat, setEditFormat] = useState('');

  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (session === null) { router.push('/'); return; }
    if (session && !canAccess) { router.push('/'); return; }
  }, [session, canAccess, router]);

  function loadSeasons() {
    fetch('/api/fixtures/season-planning/seasons')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setActiveSeason(data.activeSeason);
        setDraftSeason(data.draftSeason);
        if (data.draftSeason) {
          return loadEvents(data.draftSeason.id);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function loadEvents(seasonId: string) {
    return fetch(`/api/fixtures/season-planning/events?seasonId=${seasonId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEvents(data.events || []);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (canAccess) loadSeasons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  function startCreateDraft() {
    if (!activeSeason) return;
    const startParts = activeSeason.startDate.split('/');
    const endParts = activeSeason.endDate.split('/');
    const nextYear = activeSeason.year + 1;
    setDraftYear(String(nextYear));
    setDraftStart(`${nextYear}-${startParts[1]}-${startParts[0]}`);
    setDraftEnd(`${nextYear}-${endParts[1]}-${endParts[0]}`);
    setCreatingDraft(true);
  }

  // Shared by both the initial "Create Draft Season" flow (which auto-runs
  // this immediately, so creating a draft season and pulling last year's
  // Events forward reads as one action) and the standalone "Run Projection"
  // button (kept for the rare case the auto-run needs a manual retry — e.g.
  // it failed, or the season was created some other way).
  function runProjectionFor(seasonId: string) {
    setProjecting(true);
    setError(null);
    return fetch('/api/fixtures/season-planning/events/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftSeasonId: seasonId, method: projectionMethod }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        return loadEvents(seasonId);
      })
      .catch((err) => setError(err.message))
      .finally(() => setProjecting(false));
  }

  // Clears only this tab's (Events') Carried-Forward/Projected rows — lets a
  // projection run with the wrong method be undone and re-run, without
  // touching Friendlies (which has its own separate clear button).
  function clearAllProjected() {
    if (!draftSeason) return;
    setClearing(true);
    setError(null);
    fetch('/api/fixtures/season-planning/clear-projected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: draftSeason.id, fixtureType: 'Event' }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setConfirmClear(false);
        return loadEvents(draftSeason.id);
      })
      .catch((err) => setError(err.message))
      .finally(() => setClearing(false));
  }

  function submitCreateDraft() {
    setError(null);
    fetch('/api/fixtures/season-planning/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: draftYear, startDate: draftStart, endDate: draftEnd }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCreatingDraft(false);
        setDraftSeason(data.draftSeason);
        return runProjectionFor(data.draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function runProjection() {
    if (!draftSeason) return;
    runProjectionFor(draftSeason.id);
  }

  function submitAddEvent() {
    if (!draftSeason) return;
    setError(null);
    fetch('/api/fixtures/season-planning/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: draftSeason.id, ...newEvent }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAddingEvent(false);
        setNewEvent({ date: '', time: '', description: '', clubName: '', homeAway: 'H', format: '' });
        return loadEvents(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function startEdit(event: PlanningFixture) {
    setEditingId(event.id);
    setEditDate(toDateInputValue(event.date));
    setEditTime(event.time);
    setEditDescription(event.description || event.clubName);
    setEditHomeAway(event.homeAway === 'A' ? 'A' : 'H');
    setEditFormat(event.format);
  }

  function submitEdit() {
    if (!editingId || !draftSeason) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/events/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: editDate, time: editTime, description: editDescription, homeAway: editHomeAway, format: editFormat }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEditingId(null);
        return loadEvents(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function unconfirmEvent(id: string) {
    if (!draftSeason) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/events/${id}/unconfirm`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEditingId(null);
        return loadEvents(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function confirmEvent(id: string) {
    if (!draftSeason) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/events/${id}/confirm`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        return loadEvents(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function submitDelete() {
    if (!deleteId || !draftSeason) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/events/${deleteId}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDeleteId(null);
        return loadEvents(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  if (!session || !canAccess) return null;

  const hasCarriedForward = events.some((e) => e.planningSource === 'Carried Forward');
  const sortedEvents = [...events].sort((a, b) => {
    const da = a.date.split('/').reverse().join('-');
    const db = b.date.split('/').reverse().join('-');
    return da.localeCompare(db);
  });

  return (
    <div className="min-h-screen bg-gray-50">

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Season Planning</h1>
        <p className="text-sm text-gray-700 mb-4">
          Events are planned first so Friendlies and Leagues planning can check against them for clashes.
        </p>

        <SeasonPlanningTabs active="events" />

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-700">Loading…</div>}

        {!loading && !draftSeason && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-2">No draft season yet</h2>
            <p className="text-sm text-gray-700 mb-4">
              Create next season's draft to start planning — this year's Events (Finals Day, Open Days, Rowland, etc.) get pulled forward onto next year's dates automatically. The window below is a suggested default — edit it if needed.
            </p>
            {!creatingDraft && (
              <button className={getButtonClasses('primary')} onClick={startCreateDraft}>
                Create Draft Season
              </button>
            )}
            {creatingDraft && (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Year</label>
                  <input
                    type="number"
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-24"
                    value={draftYear}
                    onChange={(e) => setDraftYear(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start date</label>
                  <input
                    type="date"
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                    value={draftStart}
                    onChange={(e) => setDraftStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">End date</label>
                  <input
                    type="date"
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                    value={draftEnd}
                    onChange={(e) => setDraftEnd(e.target.value)}
                  />
                </div>
                <button className={getButtonClasses('primary')} onClick={submitCreateDraft}>Save</button>
                <button className={getButtonClasses('secondary')} onClick={() => setCreatingDraft(false)}>Cancel</button>
              </div>
            )}
          </div>
        )}

        {!loading && draftSeason && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="text-sm text-gray-700">
                Planning <span className="font-semibold text-gray-900">{draftSeason.year}</span> season
                {' '}({draftSeason.startDate} – {draftSeason.endDate})
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!hasCarriedForward && (
                  <>
                    <select
                      className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                      value={projectionMethod}
                      onChange={(e) => setProjectionMethod(e.target.value as ProjectionMethod)}
                      title="How next season's dates are worked out from this season's"
                    >
                      {Object.entries(PROJECTION_METHOD_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <button className={getButtonClasses('primary')} onClick={runProjection} disabled={projecting}>
                      {projecting ? 'Projecting…' : 'Run Projection'}
                    </button>
                  </>
                )}
                <button className={getButtonClasses('secondary')} onClick={() => setAddingEvent(true)}>
                  Add Event
                </button>
                <button className="text-xs text-red-600 hover:text-red-800 underline" onClick={() => setConfirmClear(true)} disabled={clearing}>
                  Clear all projected Events
                </button>
              </div>
            </div>

            {addingEvent && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h3 className="font-medium text-gray-900 mb-3 text-sm">New Event</h3>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                    <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Time</label>
                    <input type="text" placeholder="e.g. 14:00 or 14:00-17:00" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={newEvent.time} onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })} />
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                    <input type="text" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
                      value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">H/A</label>
                    <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={newEvent.homeAway} onChange={(e) => setNewEvent({ ...newEvent, homeAway: e.target.value as 'H' | 'A' })}>
                      <option value="H">Home</option>
                      <option value="A">Away</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Format</label>
                    <input type="text" placeholder="e.g. 6 Rinks" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-28"
                      value={newEvent.format} onChange={(e) => setNewEvent({ ...newEvent, format: e.target.value })} />
                  </div>
                  <button className={getButtonClasses('primary')} onClick={submitAddEvent}>Add</button>
                  <button className={getButtonClasses('secondary')} onClick={() => setAddingEvent(false)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
              {sortedEvents.length === 0 && (
                <div className="text-center py-12 text-gray-700 text-sm">
                  No events yet. Run the projection or add one manually.
                </div>
              )}
              {sortedEvents.map((event) => (
                <div key={event.id} className="px-4 py-3">
                  {editingId === event.id ? (
                    <div className="flex flex-wrap items-end gap-3">
                      <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                        value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                      <input type="text" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-32"
                        value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                      <input type="text" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 min-w-[200px]"
                        value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                      <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                        value={editHomeAway} onChange={(e) => setEditHomeAway(e.target.value as 'H' | 'A')}>
                        <option value="H">Home</option>
                        <option value="A">Away</option>
                      </select>
                      <input type="text" placeholder="e.g. 6 Rinks" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-28"
                        value={editFormat} onChange={(e) => setEditFormat(e.target.value)} />
                      <button className={getButtonClasses('primary', 'sm')} onClick={submitEdit}>Save</button>
                      <button className={getButtonClasses('secondary', 'sm')} onClick={() => setEditingId(null)}>Cancel</button>
                      {event.planningStatus === 'Confirmed' && (
                        <button className="text-xs text-amber-700 hover:text-amber-900" onClick={() => unconfirmEvent(event.id)}>
                          Un-confirm
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="w-28 text-sm text-gray-900">{formatDisplayDate(event.date)}</div>
                        <div className="w-24 text-sm text-gray-700">{event.time}</div>
                        <div className="text-sm text-gray-900 font-medium">
                          {event.description || event.clubName}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          event.homeAway === 'A' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {event.homeAway === 'A' ? 'Away' : 'Home'}
                        </span>
                        {event.format && (
                          <span className="text-xs text-gray-700">{event.format}</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClasses(event.planningStatus)}`}>
                          {event.planningStatus}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sourceBadgeClasses(event.planningSource)}`}>
                          {event.planningSource}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button className="text-xs text-blue-600 hover:text-blue-800" onClick={() => startEdit(event)}>Edit</button>
                        {event.planningStatus !== 'Confirmed' && (
                          <button className="text-xs text-green-600 hover:text-green-800" onClick={() => confirmEvent(event.id)}>Confirm</button>
                        )}
                        <button className="text-xs text-red-600 hover:text-red-800" onClick={() => setDeleteId(event.id)}>Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="Delete this event?"
        message="This removes it from the plan entirely. You can add it back manually later if needed."
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={submitDelete}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        isOpen={confirmClear}
        title="Clear all projected Events?"
        message="Deletes every still-Projected, carried-forward Event in this draft season. Friendlies are untouched — clear those separately from the Friendlies tab if needed. Anything already Confirmed or Manually Added is left untouched. Use this to re-run the projection with a different date method."
        confirmLabel={clearing ? 'Clearing…' : 'Clear all'}
        confirmVariant="danger"
        onConfirm={clearAllProjected}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
