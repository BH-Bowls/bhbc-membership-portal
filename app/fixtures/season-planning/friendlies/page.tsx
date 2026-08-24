// app/fixtures/season-planning/friendlies/page.tsx
// Season Planning Stage 2 (Friendlies) — pull last year's Friendly fixtures
// forward via the same Nth-weekday-of-month projection used for Events, then
// work each one through Projected -> Confirmed, editing date/time/club/H-A/
// format freely, deleting anything that isn't happening. Each row's Contact
// button jumps to that club's Info page (contacts, outreach, fixture
// history) — see clubs/[clubName]/page.tsx. Two Friendlies-specific rules
// this page carries: the Monday amber warning (Mondays are allowed, just
// flagged), and same-day capacity warnings (rinks — Home fixtures/Events
// only, since an Away one uses the opponent's green, plus standing
// Reservation occurrences — and a softer all-fixture player-count guide,
// both against config/admin/config's General tab).
//
// Full editing (Run Projection/Add/Edit/Confirm/Delete) only applies to the
// draft season, created from the Events tab since Events are planned first —
// but the year picker also lets Captains/Admins switch to the active season
// or any archived past year to review that season's same-day clashes
// read-only. Whichever season is being viewed, its Events are fetched too,
// purely for their Format-derived rink/player contribution to the capacity
// sum (parsed the same way as Friendlies' own Format field).

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SeasonPlanningTabs } from '@/components/SeasonPlanningTabs';
import { hasRole } from '@/lib/role-utils';
import { getButtonClasses } from '@/config/theme-helpers';
import { computeDayCapacity, getReservationOccurrences, type CapacityEvent } from '@/lib/season-planning-capacity';
import type { Season, PlanningFixture } from '@/lib/season-planning-supabase';
import type { Reservation } from '@/lib/reservations-supabase';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseUKDateSafe(dateStr: string): Date | null {
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!ukMatch) return null;
  const d = new Date(parseInt(ukMatch[3]), parseInt(ukMatch[2]) - 1, parseInt(ukMatch[1]));
  return isNaN(d.getTime()) ? null : d;
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = parseUKDateSafe(dateStr);
  if (!d) return dateStr;
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES_SHORT[d.getMonth()]}`;
}

function isMonday(dateStr: string): boolean {
  const d = parseUKDateSafe(dateStr);
  return d !== null && d.getDay() === 1;
}

function toDateInputValue(dateStr: string): string {
  if (!dateStr) return '';
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) return `${ukMatch[3]}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;
  return '';
}

function displayClubName(clubName: string, clubSuffix: string): string {
  return [clubName, clubSuffix].filter(Boolean).join(' ');
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'Projected': return 'bg-amber-100 text-amber-800';
    case 'Email Sent': return 'bg-emerald-100 text-emerald-800';
    case 'Confirmed': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function sourceBadgeClasses(source: string): string {
  return source === 'Carried Forward'
    ? 'bg-gray-100 text-gray-700'
    : 'bg-purple-100 text-purple-700';
}

export default function SeasonPlanningFriendliesPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const role = session && session.user ? session.user.role : '';
  const isAdmin = hasRole(role, 'Admin');
  const isCaptain = hasRole(role, 'Captain');
  const canAccess = isAdmin || isCaptain;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draftSeason, setDraftSeason] = useState<Season | null>(null);
  const [allSeasons, setAllSeasons] = useState<{ id: string; year: number; isActive: boolean }[]>([]);
  const [viewSeasonId, setViewSeasonId] = useState<string | null>(null);
  const [friendlies, setFriendlies] = useState<PlanningFixture[]>([]);
  const [clubNames, setClubNames] = useState<string[]>([]);
  const [capacityEvents, setCapacityEvents] = useState<CapacityEvent[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [capacityConfig, setCapacityConfig] = useState({
    greenTotalRinks: 6, capacityWarningThreshold: 5, maxPlayersPerDay: 20,
    reservationDefaultStart: '15-04', reservationDefaultEnd: '30-09',
  });

  const [projecting, setProjecting] = useState(false);
  const [addingFriendly, setAddingFriendly] = useState(false);
  const [newFriendly, setNewFriendly] = useState({ date: '', time: '14:00', clubName: '', clubSuffix: '', homeAway: 'H' as 'H' | 'A', format: '', description: '' });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editClubName, setEditClubName] = useState('');
  const [editClubSuffix, setEditClubSuffix] = useState('');
  const [editHomeAway, setEditHomeAway] = useState<'H' | 'A'>('H');
  const [editFormat, setEditFormat] = useState('');
  const [editDescription, setEditDescription] = useState('');

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
        setDraftSeason(data.draftSeason);
        const seasons = data.allSeasons || [];
        setAllSeasons(seasons);
        // Default to the draft if one exists (the normal planning case), else
        // the active season — either way, the year picker lets Captains/Admins
        // switch to any archived past year to review its clashes read-only.
        const initial = data.draftSeason || seasons.find((s: any) => s.isActive) || null;
        setViewSeasonId(initial ? initial.id : null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (viewSeasonId) {
      loadFriendlies(viewSeasonId);
      loadCapacityEvents(viewSeasonId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSeasonId]);

  function loadFriendlies(seasonId: string) {
    return fetch(`/api/fixtures/season-planning/friendlies?seasonId=${seasonId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setFriendlies(data.friendlies || []);
      })
      .catch((err) => setError(err.message));
  }

  // Only needed for their Format-derived rink/player contribution to the
  // capacity sum — everything else about Events is irrelevant to Friendlies
  // planning. computeDayCapacity itself skips any Event with a blank/
  // unparseable Format, so no filtering is needed here.
  function loadCapacityEvents(seasonId: string) {
    return fetch(`/api/fixtures/season-planning/events?seasonId=${seasonId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const events: CapacityEvent[] = (data.events || [])
          .map((e: PlanningFixture) => ({ date: e.date, label: e.description || e.clubName || 'Event', homeAway: e.homeAway, format: e.format }));
        setCapacityEvents(events);
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (canAccess) loadSeasons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  useEffect(() => {
    if (!canAccess) return;
    fetch('/api/clubs')
      .then((r) => (r.ok ? r.json() : { clubs: [] }))
      .then((data) => setClubNames((data.clubs || []).map((c: any) => c.clubName).filter(Boolean).sort()))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  useEffect(() => {
    if (!canAccess) return;
    fetch('/api/fixtures/season-planning/friendlies/capacity-config')
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setCapacityConfig(data);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  useEffect(() => {
    if (!canAccess) return;
    fetch('/api/fixtures/season-planning/reservations')
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setReservations(data.reservations || []);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  function runProjection() {
    if (!draftSeason) return;
    setProjecting(true);
    setError(null);
    fetch('/api/fixtures/season-planning/friendlies/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftSeasonId: draftSeason.id }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        return loadFriendlies(draftSeason.id);
      })
      .catch((err) => setError(err.message))
      .finally(() => setProjecting(false));
  }

  function submitAddFriendly() {
    if (!draftSeason) return;
    setError(null);
    fetch('/api/fixtures/season-planning/friendlies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: draftSeason.id, ...newFriendly }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAddingFriendly(false);
        setNewFriendly({ date: '', time: '14:00', clubName: '', clubSuffix: '', homeAway: 'H', format: '', description: '' });
        return loadFriendlies(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function startEdit(friendly: PlanningFixture) {
    setEditingId(friendly.id);
    setEditDate(toDateInputValue(friendly.date));
    setEditTime(friendly.time);
    setEditClubName(friendly.clubName);
    setEditClubSuffix(friendly.clubSuffix);
    setEditHomeAway(friendly.homeAway === 'A' ? 'A' : 'H');
    setEditFormat(friendly.format);
    setEditDescription(friendly.description);
  }

  function submitEdit() {
    if (!editingId || !draftSeason) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/friendlies/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: editDate, time: editTime, clubName: editClubName,
        clubSuffix: editClubSuffix, homeAway: editHomeAway, format: editFormat,
        description: editDescription,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEditingId(null);
        return loadFriendlies(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function confirmFriendly(id: string) {
    if (!draftSeason) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/friendlies/${id}/confirm`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        return loadFriendlies(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function unconfirmFriendly(id: string) {
    if (!draftSeason) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/friendlies/${id}/unconfirm`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEditingId(null);
        return loadFriendlies(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  function submitDelete() {
    if (!deleteId || !draftSeason) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/friendlies/${deleteId}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDeleteId(null);
        return loadFriendlies(draftSeason.id);
      })
      .catch((err) => setError(err.message));
  }

  if (!session || !canAccess) return null;

  const viewSeason = allSeasons.find((s) => s.id === viewSeasonId) || null;
  const isViewingDraft = !!(draftSeason && viewSeasonId === draftSeason.id);
  const hasCarriedForward = friendlies.some((f) => f.planningSource === 'Carried Forward');
  const sortedFriendlies = [...friendlies].sort((a, b) => {
    const da = a.date.split('/').reverse().join('-');
    const db = b.date.split('/').reverse().join('-');
    return da.localeCompare(db);
  });
  const reservationOccurrences = viewSeason
    ? reservations.flatMap((res) =>
        getReservationOccurrences(res, viewSeason.year, capacityConfig.reservationDefaultStart, capacityConfig.reservationDefaultEnd)
          .map((date) => ({ date, label: res.name, rinksReserved: res.rinksReserved }))
      )
    : [];
  const capacityByDate = computeDayCapacity(friendlies, capacityEvents, reservationOccurrences);
  const dateGroups: string[] = [];
  const seenDates = new Set<string>();
  for (const f of sortedFriendlies) {
    if (!seenDates.has(f.date)) { seenDates.add(f.date); dateGroups.push(f.date); }
  }

  return (
    <div className="min-h-screen bg-gray-50">

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Season Planning</h1>
        <p className="text-sm text-gray-700 mb-4">
          Friendlies — project last year's fixtures forward, then confirm, edit, or delete each one.
        </p>

        <SeasonPlanningTabs active="friendlies" />

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-700">Loading…</div>}

        {!loading && !viewSeasonId && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-2">No seasons found</h2>
          </div>
        )}

        {!loading && viewSeasonId && (
          <>
            {!draftSeason && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 text-sm text-amber-800">
                No draft season yet — create one from the{' '}
                <Link href="/fixtures/season-planning" className="text-blue-700 hover:text-blue-900 font-medium underline">Events tab</Link>{' '}
                to start planning next year. You can still browse previous seasons below.
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="text-sm text-gray-700">
                  {isViewingDraft ? 'Planning' : 'Viewing'} <span className="font-semibold text-gray-900">{viewSeason?.year}</span> season
                  {isViewingDraft && draftSeason && ` (${draftSeason.startDate} – ${draftSeason.endDate})`}
                  {!isViewingDraft && <span className="ml-2 text-xs text-gray-500">(read-only)</span>}
                </div>
                {allSeasons.length > 1 && (
                  <select
                    className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                    value={viewSeasonId || ''}
                    onChange={(e) => { setViewSeasonId(e.target.value); setEditingId(null); setAddingFriendly(false); }}
                  >
                    {allSeasons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.year}{s.isActive ? ' (active)' : ''}{draftSeason && s.id === draftSeason.id ? ' (draft)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex gap-2">
                {isViewingDraft && !hasCarriedForward && (
                  <button className={getButtonClasses('primary')} onClick={runProjection} disabled={projecting}>
                    {projecting ? 'Projecting…' : 'Run Projection'}
                  </button>
                )}
                {isViewingDraft && (
                  <button className={getButtonClasses('secondary')} onClick={() => setAddingFriendly(true)}>
                    Add Friendly
                  </button>
                )}
                <Link href="/fixtures/season-planning/friendlies/clubs" className={getButtonClasses('secondary')}>
                  Clubs
                </Link>
              </div>
            </div>

            {isViewingDraft && addingFriendly && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h3 className="font-medium text-gray-900 mb-3 text-sm">New Friendly</h3>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                    <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={newFriendly.date} onChange={(e) => setNewFriendly({ ...newFriendly, date: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Time</label>
                    <input type="text" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-24"
                      value={newFriendly.time} onChange={(e) => setNewFriendly({ ...newFriendly, time: e.target.value })} />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Club</label>
                    <input type="text" list="club-names-list" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
                      value={newFriendly.clubName} onChange={(e) => setNewFriendly({ ...newFriendly, clubName: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Suffix</label>
                    <input type="text" placeholder="e.g. A" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-16"
                      value={newFriendly.clubSuffix} onChange={(e) => setNewFriendly({ ...newFriendly, clubSuffix: e.target.value })} />
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-gray-700 mb-1">or Description (non-club opponent, e.g. touring team)</label>
                    <input type="text" placeholder="e.g. Sussex County BA Under 25's" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
                      value={newFriendly.description} onChange={(e) => setNewFriendly({ ...newFriendly, description: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">H/A</label>
                    <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={newFriendly.homeAway} onChange={(e) => setNewFriendly({ ...newFriendly, homeAway: e.target.value as 'H' | 'A' })}>
                      <option value="H">Home</option>
                      <option value="A">Away</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Format</label>
                    <input type="text" placeholder="e.g. 6 Rinks" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-28"
                      value={newFriendly.format} onChange={(e) => setNewFriendly({ ...newFriendly, format: e.target.value })} />
                  </div>
                  <button className={getButtonClasses('primary')} onClick={submitAddFriendly}>Add</button>
                  <button className={getButtonClasses('secondary')} onClick={() => setAddingFriendly(false)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
              {sortedFriendlies.length === 0 && (
                <div className="text-center py-12 text-gray-700 text-sm">
                  {isViewingDraft ? 'No friendlies yet. Run the projection or add one manually.' : 'No friendlies found for this season.'}
                </div>
              )}
              {dateGroups.map((date) => {
                const day = capacityByDate[date];
                const dayFixtures = sortedFriendlies.filter((f) => f.date === date);
                // Events aren't rows on this page (that's the Events tab's job) — pulled
                // in here purely so a same-day clash against a Friendly is visible,
                // Home or Away, regardless of whether it affects the rinks total.
                const dayEvents = capacityEvents.filter((e) => e.date === date);
                const totalItems = dayFixtures.length + dayEvents.length;
                const monday = isMonday(date);
                const showHeader = totalItems > 1 || monday || !!(day && day.contributors.length > 0);

                return (
                  <div key={date} className="contents">
                    {showHeader && (
                      <div className="px-4 py-2 bg-slate-50 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{formatDisplayDate(date)}</span>
                        {(dayFixtures.length > 1 || dayEvents.length > 0) && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-200 text-gray-800"
                            title={[
                              ...dayFixtures.map((f) => `${displayClubName(f.clubName, f.clubSuffix) || f.description || 'Friendly'}${f.format ? ` (${f.format})` : ''} — ${f.homeAway === 'A' ? 'Away' : 'Home'}`),
                              ...dayEvents.map((e) => `${e.label}${e.format ? ` (${e.format})` : ''}${e.homeAway === 'A' ? ' — Away' : e.homeAway === 'H' ? ' — Home' : ''}`),
                            ].join('\n')}
                          >
                            {dayFixtures.length} Game{dayFixtures.length === 1 ? '' : 's'}
                            {dayEvents.length > 0 ? ` + ${dayEvents.length} Event${dayEvents.length === 1 ? '' : 's'}` : ''}
                          </span>
                        )}
                        {monday && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-800 border border-orange-300">
                            ⚠ Monday
                          </span>
                        )}
                        {day && day.homeRinks > 0 && (day.homeRinks >= capacityConfig.capacityWarningThreshold || totalItems > 1 || day.contributors.length > 0) && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              day.homeRinks > capacityConfig.greenTotalRinks ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-amber-100 text-amber-800'
                            }`}
                            title={day.contributors.length > 0 ? day.contributors.map((c) => `${c.label} (${c.rinks} rink${c.rinks === 1 ? '' : 's'})`).join('\n') : undefined}
                          >
                            {day.homeRinks > capacityConfig.greenTotalRinks ? '⚠ ' : ''}{day.homeRinks}/{capacityConfig.greenTotalRinks} rinks (Home)
                          </span>
                        )}
                        {day && totalItems > 1 && day.totalPlayers >= capacityConfig.maxPlayersPerDay && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800">
                            {day.totalPlayers} players needed
                          </span>
                        )}
                      </div>
                    )}
                    {dayFixtures.map((friendly) => (
              <div key={friendly.id} className="px-4 py-3">
                  {isViewingDraft && editingId === friendly.id ? (
                    <div className="flex flex-wrap items-end gap-3">
                      <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                        value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                      <input type="text" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-24"
                        value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                      <input type="text" list="club-names-list" placeholder="Club" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 min-w-[140px]"
                        value={editClubName} onChange={(e) => setEditClubName(e.target.value)} />
                      <input type="text" placeholder="e.g. A" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-16"
                        value={editClubSuffix} onChange={(e) => setEditClubSuffix(e.target.value)} />
                      <input type="text" placeholder="or Description (non-club opponent)" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 min-w-[180px]"
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
                      {friendly.planningStatus === 'Confirmed' && (
                        <button className="text-xs text-amber-700 hover:text-amber-900" onClick={() => unconfirmFriendly(friendly.id)}>
                          Un-confirm
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="w-28 text-sm text-gray-900">{formatDisplayDate(friendly.date)}</div>
                        <div className="w-16 text-sm text-gray-700">{friendly.time}</div>
                        <div className="text-sm text-gray-900 font-medium">
                          {displayClubName(friendly.clubName, friendly.clubSuffix) || friendly.description || ''}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          friendly.homeAway === 'A' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {friendly.homeAway === 'A' ? 'Away' : 'Home'}
                        </span>
                        {friendly.format && (
                          <span className="text-xs text-gray-700">{friendly.format}</span>
                        )}
                        {friendly.ladiesMen && friendly.ladiesMen !== 'Mixed' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-800">
                            {friendly.ladiesMen}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClasses(friendly.planningStatus)}`}>
                          {friendly.planningStatus}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sourceBadgeClasses(friendly.planningSource)}`}>
                          {friendly.planningSource}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        {isViewingDraft && (
                          <button className="text-xs text-blue-600 hover:text-blue-800" onClick={() => startEdit(friendly)}>Edit</button>
                        )}
                        {isViewingDraft && friendly.planningStatus !== 'Confirmed' && (
                          <button className="text-xs text-green-600 hover:text-green-800" onClick={() => confirmFriendly(friendly.id)}>Confirm</button>
                        )}
                        {friendly.clubName && (
                          <Link
                            href={`/fixtures/season-planning/friendlies/clubs/${encodeURIComponent(friendly.clubName)}`}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            Contact
                          </Link>
                        )}
                        {isViewingDraft && (
                          <button className="text-xs text-red-600 hover:text-red-800" onClick={() => setDeleteId(friendly.id)}>Delete</button>
                        )}
                      </div>
                    </div>
                  )}
              </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <datalist id="club-names-list">
        {clubNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="Delete this friendly?"
        message="This removes it from the plan entirely. You can add it back manually later if needed."
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={submitDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
