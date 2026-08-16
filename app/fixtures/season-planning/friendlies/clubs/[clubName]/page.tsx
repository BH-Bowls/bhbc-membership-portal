// app/fixtures/season-planning/friendlies/clubs/[clubName]/page.tsx
// Club Info page — contact resolution (Match Secretary if found, otherwise
// a manual radio pick from all known contacts, always with a free-text
// email override), Draft Email + Mark Sent/Unsent for this club's pending
// draft-season fixtures, and multi-season fixture history with results
// (wherever the underlying data actually has them — 2024/2025 currently
// don't, 2026 does) and same-day clashes against other clubs.

'use client';

import { useEffect, useState, use } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SeasonPlanningCalendar } from '@/components/SeasonPlanningCalendar';
import { hasRole } from '@/lib/role-utils';
import { getButtonClasses } from '@/config/theme-helpers';
import type { ClubInfo, ClubFixtureHistoryRow, ClubClash } from '@/lib/season-planning-supabase';

interface PageProps {
  params: Promise<{ clubName: string }>;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDisplayDate(dateStr: string): string {
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!ukMatch) return dateStr;
  const d = new Date(parseInt(ukMatch[3]), parseInt(ukMatch[2]) - 1, parseInt(ukMatch[1]));
  if (isNaN(d.getTime())) return dateStr;
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES_SHORT[d.getMonth()]}`;
}

function resultLabel(row: ClubFixtureHistoryRow): { label: string; classes: string } | null {
  switch (row.gameStatus) {
    case 'P':
      return { label: `Played — BHBC ${row.bhbcScore ?? '?'} v ${row.opponentScore ?? '?'}`, classes: 'bg-green-100 text-green-800' };
    case 'C':
      return { label: `Cancelled${row.reason ? ` — ${row.reason}` : ''}${row.who ? ` (${row.who})` : ''}`, classes: 'bg-red-100 text-red-800' };
    case 'A':
      return { label: `Abandoned${row.reason ? ` — ${row.reason}` : ''}${row.who ? ` (${row.who})` : ''}`, classes: 'bg-orange-100 text-orange-800' };
    case 'O':
      return { label: 'Open', classes: 'bg-teal-100 text-teal-800' };
    case 'S':
      return { label: 'Selected', classes: 'bg-blue-100 text-blue-800' };
    default:
      return null; // blank — no live-workflow status recorded for this row (true for every 2024/2025 fixture currently)
  }
}

function toDateInputValue(dateStr: string): string {
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) return `${ukMatch[3]}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;
  return '';
}

function clashTooltip(clashes: ClubClash[]): string {
  return clashes
    .map((c) => `${c.clubName} — ${c.homeAway === 'A' ? 'Away' : 'Home'}${c.ladiesMen && c.ladiesMen !== 'Mixed' ? `, ${c.ladiesMen}` : ''}${c.format ? `, ${c.format}` : ''}`)
    .join('\n');
}

function planningBadgeClasses(status: string): string {
  switch (status) {
    case 'Projected': return 'bg-amber-100 text-amber-800';
    case 'Email Sent': return 'bg-emerald-100 text-emerald-800';
    case 'Confirmed': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function buildGmailLink(recipientEmail: string, clubName: string, year: number, pendingFixtures: ClubFixtureHistoryRow[]): string {
  const subject = `BHBC Friendly Fixtures ${year} — Proposed Dates`;
  const many = pendingFixtures.length > 1;
  const lines = pendingFixtures.map((f) =>
    `- ${formatDisplayDate(f.date)} (${f.homeAway === 'A' ? 'Away' : 'Home'})${f.format ? `, ${f.format}` : ''}`
  );
  const body = [
    'Hi,',
    '',
    `Ahead of the ${year} season, here ${many ? 'are our proposed dates' : 'is our proposed date'} for our friendly fixture${many ? 's' : ''} against ${clubName}:`,
    '',
    ...lines,
    '',
    `Please let us know if ${many ? 'these all still work' : 'this still works'}, or if anything needs to move.`,
    '',
    'Thanks,',
    'Burgess Hill Bowls Club',
  ].join('\n');
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipientEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function ClubInfoPage({ params }: PageProps) {
  const { clubName: encodedClubName } = use(params);
  const clubName = decodeURIComponent(encodedClubName);

  const { data: session } = useSession();
  const router = useRouter();

  const role = session && session.user ? session.user.role : '';
  const isAdmin = hasRole(role, 'Admin');
  const isCaptain = hasRole(role, 'Captain');
  const canAccess = isAdmin || isCaptain;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ClubInfo | null>(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [selectedContactIndex, setSelectedContactIndex] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editClubSuffix, setEditClubSuffix] = useState('');
  const [editHomeAway, setEditHomeAway] = useState<'H' | 'A'>('H');
  const [editFormat, setEditFormat] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (session === null) { router.push('/'); return; }
    if (session && !canAccess) { router.push('/'); return; }
  }, [session, canAccess, router]);

  function load() {
    setLoading(true);
    fetch(`/api/fixtures/season-planning/friendlies/clubs/${encodeURIComponent(clubName)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setInfo(data);
        if (data.matchSecretary && data.matchSecretary.email) {
          setRecipientEmail(data.matchSecretary.email);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (canAccess) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  if (!session || !canAccess) return null;
  if (loading) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session.user.name || undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-3xl text-center text-gray-700">Loading…</div>
    </div>
  );

  const years = info ? Object.keys(info.fixturesBySeasonYear).map(Number).sort((a, b) => b - a) : [];
  // Highest year = the draft season being planned (if it exists) — shown first.
  const draftYear = years[0];
  const draftFixtures = info && draftYear !== undefined ? info.fixturesBySeasonYear[draftYear] : [];
  const pendingDraftFixtures = draftFixtures.filter((f) => f.planningStatus && f.planningStatus !== 'Confirmed');
  const anyUnsent = pendingDraftFixtures.some((f) => f.planningStatus !== 'Email Sent');
  const anySent = pendingDraftFixtures.some((f) => f.planningStatus === 'Email Sent');

  function selectContact(index: number) {
    setSelectedContactIndex(index);
    const contact = info && info.contacts[index];
    if (contact && contact.email) setRecipientEmail(contact.email);
  }

  function setEmailStatus(sent: boolean) {
    const ids = pendingDraftFixtures
      .filter((f) => (sent ? f.planningStatus !== 'Email Sent' : f.planningStatus === 'Email Sent'))
      .map((f) => f.id);
    if (ids.length === 0) return;

    setUpdating(true);
    setError(null);
    fetch('/api/fixtures/season-planning/friendlies/email-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, sent }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        load();
      })
      .catch((err) => setError(err.message))
      .finally(() => setUpdating(false));
  }

  function draftEmail() {
    if (!recipientEmail || draftYear === undefined) return;
    window.open(buildGmailLink(recipientEmail, clubName, draftYear, pendingDraftFixtures), '_blank');
  }

  function startEdit(f: ClubFixtureHistoryRow) {
    setEditingId(f.id);
    setEditDate(toDateInputValue(f.date));
    setEditTime(f.time);
    setEditClubSuffix(f.clubSuffix);
    setEditHomeAway(f.homeAway === 'A' ? 'A' : 'H');
    setEditFormat(f.format);
  }

  function submitEdit() {
    if (!editingId) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/friendlies/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: editDate, time: editTime, clubSuffix: editClubSuffix, homeAway: editHomeAway, format: editFormat,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEditingId(null);
        load();
      })
      .catch((err) => setError(err.message));
  }

  function confirmFixture(id: string) {
    setError(null);
    fetch(`/api/fixtures/season-planning/friendlies/${id}/confirm`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        load();
      })
      .catch((err) => setError(err.message));
  }

  function unconfirmFixture(id: string) {
    setError(null);
    fetch(`/api/fixtures/season-planning/friendlies/${id}/unconfirm`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEditingId(null);
        load();
      })
      .catch((err) => setError(err.message));
  }

  function submitDelete() {
    if (!deleteId) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/friendlies/${deleteId}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDeleteId(null);
        load();
      })
      .catch((err) => setError(err.message));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session.user.name || undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-2">
          <div className="flex gap-4">
            <Link href="/fixtures/season-planning/friendlies" className="text-sm text-blue-600 hover:text-blue-800 inline-block">
              ← Friendlies
            </Link>
            <Link href="/fixtures/season-planning/friendlies/clubs" className="text-sm text-blue-600 hover:text-blue-800 inline-block">
              ← All Clubs
            </Link>
          </div>
          <SeasonPlanningCalendar />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{clubName}</h1>

        {error && (
          <div className="my-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {info && info.club && (
          <p className="text-sm text-gray-700 mb-4">
            {[info.club.address, info.club.postCode].filter(Boolean).join(', ')}
            {info.club.phone && ` · ${info.club.phone}`}
            {info.club.website && (
              <> · <a href={info.club.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">Website</a></>
            )}
          </p>
        )}

        {info && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">Contact</h2>

            {info.matchSecretary ? (
              <div className="text-sm text-gray-900 mb-3">
                <span className="font-medium">{info.matchSecretary.name}</span> — Match Secretary — {info.matchSecretary.email}
              </div>
            ) : info.contacts.length > 0 ? (
              <div className="space-y-2 mb-3">
                <p className="text-xs text-gray-700">No Match Secretary with an email on file — pick a contact:</p>
                {info.contacts.map((c, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm text-gray-900">
                    <input type="radio" name="contact" checked={selectedContactIndex === i} onChange={() => selectContact(i)} />
                    {c.name} — {c.role || 'no role on file'} — {c.email || 'no email'}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-700 mb-3">No contacts on file for this club — check Clubs.</p>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs font-medium text-gray-700 mb-1">Recipient email</label>
                <input
                  type="email"
                  placeholder="Type an email manually if none on file"
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                />
              </div>
              <button
                className={`px-4 py-2 text-sm font-medium rounded-lg ${
                  recipientEmail && pendingDraftFixtures.length > 0 ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
                disabled={!recipientEmail || pendingDraftFixtures.length === 0}
                onClick={draftEmail}
              >
                Draft Email
              </button>
              {anyUnsent && (
                <button
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  disabled={updating}
                  onClick={() => setEmailStatus(true)}
                >
                  Mark Sent
                </button>
              )}
              {anySent && (
                <button
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  disabled={updating}
                  onClick={() => setEmailStatus(false)}
                >
                  Mark Unsent
                </button>
              )}
            </div>
            {pendingDraftFixtures.length === 0 && draftYear !== undefined && (
              <p className="text-xs text-gray-700 mt-2">No pending {draftYear} fixtures to email about.</p>
            )}
          </div>
        )}

        {info && years.map((year) => {
          const fixtures = info.fixturesBySeasonYear[year];
          const isDraftYear = year === draftYear;
          return (
            <div key={year} className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
              <h2 className="font-semibold text-gray-900 mb-3 text-sm">{year}{isDraftYear ? ' (planning)' : ''}</h2>
              <div className="divide-y divide-gray-100">
                {fixtures.map((f) => {
                  const clash = info.sameDayClashes[f.date];
                  const result = resultLabel(f);

                  if (isDraftYear && editingId === f.id) {
                    return (
                      <div key={f.id} className="py-2 flex flex-wrap items-end gap-3">
                        <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                          value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                        <input type="text" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-24"
                          value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                        <input type="text" placeholder="e.g. A" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-16"
                          value={editClubSuffix} onChange={(e) => setEditClubSuffix(e.target.value)} />
                        <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                          value={editHomeAway} onChange={(e) => setEditHomeAway(e.target.value as 'H' | 'A')}>
                          <option value="H">Home</option>
                          <option value="A">Away</option>
                        </select>
                        <input type="text" placeholder="e.g. 6 Rinks" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-28"
                          value={editFormat} onChange={(e) => setEditFormat(e.target.value)} />
                        <button className={getButtonClasses('primary', 'sm')} onClick={submitEdit}>Save</button>
                        <button className={getButtonClasses('secondary', 'sm')} onClick={() => setEditingId(null)}>Cancel</button>
                        {f.planningStatus === 'Confirmed' && (
                          <button className="text-xs text-amber-700 hover:text-amber-900" onClick={() => unconfirmFixture(f.id)}>
                            Un-confirm
                          </button>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={f.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <div className="w-28 text-gray-900">{formatDisplayDate(f.date)}</div>
                        <div className="w-16 text-gray-700">{f.time}</div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          f.homeAway === 'A' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {f.homeAway === 'A' ? 'Away' : 'Home'}
                        </span>
                        {f.format && <span className="text-gray-700">{f.format}</span>}
                        {f.ladiesMen && f.ladiesMen !== 'Mixed' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-800">
                            {f.ladiesMen}
                          </span>
                        )}
                        {isDraftYear && f.planningStatus && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${planningBadgeClasses(f.planningStatus)}`}>
                            {f.planningStatus}
                          </span>
                        )}
                        {result && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${result.classes}`}>
                            {result.label}
                          </span>
                        )}
                        {isDraftYear && clash && clash.length > 0 && (
                          <span
                            title={clashTooltip(clash)}
                            className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-800 border border-red-300 cursor-help"
                          >
                            ⚠ Clash
                          </span>
                        )}
                      </div>
                      {isDraftYear && (
                        <div className="flex gap-2">
                          <button className="text-xs text-blue-600 hover:text-blue-800" onClick={() => startEdit(f)}>Edit</button>
                          {f.planningStatus !== 'Confirmed' && (
                            <button className="text-xs text-green-600 hover:text-green-800" onClick={() => confirmFixture(f.id)}>Confirm</button>
                          )}
                          <button className="text-xs text-red-600 hover:text-red-800" onClick={() => setDeleteId(f.id)}>Delete</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {info && years.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-700 text-center">
            No fixtures recorded against this club in any season.
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="Delete this fixture?"
        message="This removes it from the plan entirely. You can add it back manually later if needed."
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={submitDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
