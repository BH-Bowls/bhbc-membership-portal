// app/fixtures/season-planning/friendlies/outreach/page.tsx
// Club-grouped outreach: each club with pending (not-yet-Confirmed)
// friendlies, its resolved contact (Match Secretary > Captain fallback,
// flagged either way it isn't a clean Secretary match), a "Draft Email"
// button that opens a pre-filled Gmail compose link (no SMTP/Gmail API
// integration — matches the original design's "compose-link, not real
// send"), and separate Mark Sent / Mark Unsent buttons. Opening a draft
// doesn't mean it was actually sent — the status change is a deliberate,
// explicit action, never a side effect of clicking Draft Email.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { hasRole } from '@/lib/role-utils';
import type { Season, ClubOutreachGroup, PlanningFixture } from '@/lib/season-planning-supabase';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDisplayDate(dateStr: string): string {
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!ukMatch) return dateStr;
  const d = new Date(parseInt(ukMatch[3]), parseInt(ukMatch[2]) - 1, parseInt(ukMatch[1]));
  if (isNaN(d.getTime())) return dateStr;
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES_SHORT[d.getMonth()]}`;
}

function tierLabel(tier: string): { label: string; classes: string } {
  switch (tier) {
    case 'secretary': return { label: 'Match Secretary', classes: 'bg-green-100 text-green-800' };
    case 'captain': return { label: 'Using Captain (no Secretary email)', classes: 'bg-amber-100 text-amber-800' };
    case 'secretary-no-email': return { label: 'Secretary found, no email — pick manually', classes: 'bg-red-100 text-red-800' };
    default: return { label: 'No contact found — pick manually', classes: 'bg-red-100 text-red-800' };
  }
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'Projected': return 'bg-amber-100 text-amber-800';
    case 'Email Sent': return 'bg-emerald-100 text-emerald-800';
    case 'Confirmed': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function firstNameOf(name: string): string {
  return name.split(' ')[0] || name;
}

function buildGmailLink(group: ClubOutreachGroup, year: number): string {
  const to = group.contact ? group.contact.email || '' : '';
  const subject = `BHBC Friendly Fixtures ${year} — Proposed Dates`;
  const many = group.fixtures.length > 1;
  const lines = group.fixtures.map((f: PlanningFixture) =>
    `- ${formatDisplayDate(f.date)} (${f.homeAway === 'A' ? 'Away' : 'Home'})${f.format ? `, ${f.format}` : ''}`
  );
  const greetingName = group.contact ? firstNameOf(group.contact.name) : '';
  const body = [
    `Hi${greetingName ? ` ${greetingName}` : ''},`,
    '',
    `Ahead of the ${year} season, here ${many ? 'are our proposed dates' : 'is our proposed date'} for our friendly fixture${many ? 's' : ''} against ${group.clubName}:`,
    '',
    ...lines,
    '',
    `Please let us know if ${many ? 'these all still work' : 'this still works'}, or if anything needs to move.`,
    '',
    'Thanks,',
    'Burgess Hill Bowls Club',
  ].join('\n');
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function FriendliesOutreachPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const role = session && session.user ? session.user.role : '';
  const isAdmin = hasRole(role, 'Admin');
  const isCaptain = hasRole(role, 'Captain');
  const canAccess = isAdmin || isCaptain;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftSeason, setDraftSeason] = useState<Season | null>(null);
  const [groups, setGroups] = useState<ClubOutreachGroup[]>([]);
  const [updatingFor, setUpdatingFor] = useState<string | null>(null);

  useEffect(() => {
    if (session === null) { router.push('/'); return; }
    if (session && !canAccess) { router.push('/'); return; }
  }, [session, canAccess, router]);

  function loadGroups(seasonId: string) {
    return fetch(`/api/fixtures/season-planning/friendlies/outreach?seasonId=${seasonId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setGroups(data.groups || []);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (!canAccess) return;
    fetch('/api/fixtures/season-planning/seasons')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDraftSeason(data.draftSeason);
        if (data.draftSeason) return loadGroups(data.draftSeason.id);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  function draftEmail(group: ClubOutreachGroup) {
    if (!draftSeason || !group.contact || !group.contact.email) return;
    const url = buildGmailLink(group, draftSeason.year);
    window.open(url, '_blank');
  }

  function setGroupEmailStatus(group: ClubOutreachGroup, sent: boolean) {
    if (!draftSeason) return;
    const ids = group.fixtures
      .filter((f) => (sent ? f.planningStatus !== 'Email Sent' : f.planningStatus === 'Email Sent'))
      .map((f) => f.id);
    if (ids.length === 0) return;

    setUpdatingFor(group.clubName);
    setError(null);
    fetch('/api/fixtures/season-planning/friendlies/email-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, sent }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        return loadGroups(draftSeason.id);
      })
      .catch((err) => setError(err.message))
      .finally(() => setUpdatingFor(null));
  }

  if (!session || !canAccess) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session.user.name || undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Season Planning</h1>
        <p className="text-sm text-gray-700 mb-4">
          Friendlies outreach — one entry per club with fixtures still needing a reply, grouped so each secretary gets one email covering everything.
        </p>

        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <Link href="/fixtures/season-planning/friendlies" className="px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-t-lg border-b-2 border-transparent">
            ← Back to Friendlies list
          </Link>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-700">Loading…</div>}

        {!loading && !draftSeason && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-700">
            No draft season yet — create it from the Events tab first.
          </div>
        )}

        {!loading && draftSeason && groups.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-700 text-center">
            Nothing to chase — every club's fixtures are either Confirmed or there are no Friendlies projected yet.
          </div>
        )}

        {!loading && draftSeason && groups.length > 0 && (
          <div className="space-y-4">
            {groups.map((group) => {
              const tier = tierLabel(group.tier);
              const hasEmail = !!(group.contact && group.contact.email);
              const anyUnsent = group.fixtures.some((f) => f.planningStatus !== 'Email Sent');
              const anySent = group.fixtures.some((f) => f.planningStatus === 'Email Sent');
              const busy = updatingFor === group.clubName;
              return (
                <div key={group.clubName} className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="font-semibold text-gray-900">{group.clubName}</div>
                      <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${tier.classes}`}>
                        {tier.label}
                      </span>
                      {group.contact && (
                        <div className="text-sm text-gray-700 mt-1">
                          {group.contact.name} — {group.contact.role}
                          {group.contact.email ? ` — ${group.contact.email}` : ' — no email on file'}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        className={`px-4 py-2 text-sm font-medium rounded-lg ${
                          hasEmail ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        }`}
                        disabled={!hasEmail}
                        onClick={() => draftEmail(group)}
                      >
                        Draft Email
                      </button>
                      {anyUnsent && (
                        <button
                          className="px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => setGroupEmailStatus(group, true)}
                        >
                          {busy ? '…' : 'Mark Sent'}
                        </button>
                      )}
                      {anySent && (
                        <button
                          className="px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => setGroupEmailStatus(group, false)}
                        >
                          {busy ? '…' : 'Mark Unsent'}
                        </button>
                      )}
                    </div>
                  </div>

                  {!hasEmail && group.allContacts.length > 0 && (
                    <div className="text-xs text-gray-700 mb-3 bg-gray-50 rounded-md p-2">
                      Other contacts on file: {group.allContacts.map((c) => `${c.name} (${c.role}${c.email ? `, ${c.email}` : ', no email'})`).join('; ')}
                    </div>
                  )}
                  {!hasEmail && group.allContacts.length === 0 && (
                    <div className="text-xs text-gray-700 mb-3 bg-gray-50 rounded-md p-2">
                      No contacts on file for this club at all — check Clubs.
                    </div>
                  )}

                  <div className="divide-y divide-gray-100 border-t border-gray-100">
                    {group.fixtures.map((f) => (
                      <div key={f.id} className="flex items-center gap-3 py-2 text-sm">
                        <div className="w-28 text-gray-900">{formatDisplayDate(f.date)}</div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          f.homeAway === 'A' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {f.homeAway === 'A' ? 'Away' : 'Home'}
                        </span>
                        {f.format && <span className="text-gray-700">{f.format}</span>}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClasses(f.planningStatus)}`}>
                          {f.planningStatus}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
