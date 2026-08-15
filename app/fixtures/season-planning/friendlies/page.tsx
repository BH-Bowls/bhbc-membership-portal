// app/fixtures/season-planning/friendlies/page.tsx
// Season Planning Stage 2 (Friendlies) — thin first slice: pull last year's
// Friendly fixtures forward via the same Nth-weekday-of-month projection
// used for Events, then work each one through Projected -> Confirmed,
// editing date/time/club/H-A/format freely, deleting anything that isn't
// happening. No capacity/rink-clash warnings, no club-contact matching, no
// email-draft generation yet — those land as a follow-up once this planning
// table itself is proven out. The one Friendlies-specific rule this slice
// does carry is the Monday amber warning (Mondays are allowed, just flagged).
//
// Requires the draft season to already exist — created from the Events tab,
// since Events are planned first (Friendlies/Leagues clash-checking, not
// built yet, will check against Events).

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SeasonPlanningTabs } from '@/components/SeasonPlanningTabs';
import { hasRole } from '@/lib/role-utils';
import { getButtonClasses } from '@/config/theme-helpers';
import type { Season, PlanningFixture } from '@/lib/season-planning-supabase';

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
  const [friendlies, setFriendlies] = useState<PlanningFixture[]>([]);
  const [clubNames, setClubNames] = useState<string[]>([]);

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
        if (data.draftSeason) {
          return loadFriendlies(data.draftSeason.id);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function loadFriendlies(seasonId: string) {
    return fetch(`/api/fixtures/season-planning/friendlies?seasonId=${seasonId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setFriendlies(data.friendlies || []);
      })
      .catch((err) => setError(err.message));
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

  const hasCarriedForward = friendlies.some((f) => f.planningSource === 'Carried Forward');
  const sortedFriendlies = [...friendlies].sort((a, b) => {
    const da = a.date.split('/').reverse().join('-');
    const db = b.date.split('/').reverse().join('-');
    return da.localeCompare(db);
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session.user.name || undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Season Planning</h1>
        <p className="text-sm text-gray-700 mb-4">
          Friendlies — project last year's fixtures forward, then confirm, edit, or delete each one. No capacity warnings or club outreach yet.
        </p>

        <SeasonPlanningTabs active="friendlies" />

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
              Events are planned first — create the draft season from the{' '}
              <Link href="/fixtures/season-planning" className="text-blue-600 hover:text-blue-800 font-medium">Events tab</Link>, then come back here.
            </p>
          </div>
        )}

        {!loading && draftSeason && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="text-sm text-gray-700">
                Planning <span className="font-semibold text-gray-900">{draftSeason.year}</span> season
                {' '}({draftSeason.startDate} – {draftSeason.endDate})
              </div>
              <div className="flex gap-2">
                {!hasCarriedForward && (
                  <button className={getButtonClasses('primary')} onClick={runProjection} disabled={projecting}>
                    {projecting ? 'Projecting…' : 'Run Projection'}
                  </button>
                )}
                <button className={getButtonClasses('secondary')} onClick={() => setAddingFriendly(true)}>
                  Add Friendly
                </button>
                <Link href="/fixtures/season-planning/friendlies/outreach" className={getButtonClasses('secondary')}>
                  Outreach
                </Link>
              </div>
            </div>

            {addingFriendly && (
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
                  No friendlies yet. Run the projection or add one manually.
                </div>
              )}
              {sortedFriendlies.map((friendly) => (
                <div key={friendly.id} className="px-4 py-3">
                  {editingId === friendly.id ? (
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
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="w-28 text-sm text-gray-900">{formatDisplayDate(friendly.date)}</div>
                        {isMonday(friendly.date) && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-800 border border-orange-300">
                            ⚠ Monday
                          </span>
                        )}
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
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClasses(friendly.planningStatus)}`}>
                          {friendly.planningStatus}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sourceBadgeClasses(friendly.planningSource)}`}>
                          {friendly.planningSource}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button className="text-xs text-blue-600 hover:text-blue-800" onClick={() => startEdit(friendly)}>Edit</button>
                        {friendly.planningStatus !== 'Confirmed' && (
                          <button className="text-xs text-green-600 hover:text-green-800" onClick={() => confirmFriendly(friendly.id)}>Confirm</button>
                        )}
                        <button className="text-xs text-red-600 hover:text-red-800" onClick={() => setDeleteId(friendly.id)}>Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
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
