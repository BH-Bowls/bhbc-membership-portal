// app/admin/members/leavers/page.tsx
// Members & Leavers — archive an active member to the Leavers sheet, or reinstate
// a leaver back into Members. Admin only (enforced in middleware.ts).

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { getButtonClasses, getInputClasses, getCardClasses } from '@/config/theme-helpers';
import type { Leaver } from '@/lib/leavers-sheets';

// sessionStorage key for the leavers list (back-button cache).
const LEAVERS_CACHE_KEY = 'AdminLeaversCache';

// A trimmed active member as returned by GET /api/admin/members.
interface ActiveMember {
  userName: string;
  firstName: string;
  lastName: string;
  knownAs: string;
  memberType: string;
  yearStarted: number | null;
  emailAddress: string;
}

// Build today's date as YYYY-MM-DD for the date input default.
function todayInput(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function LeaversPage() {
  const { data: session } = useSession();

  // Active members (for archiving) and leavers (for reinstating)
  const [members, setMembers] = useState<ActiveMember[] | null>(null);
  const [leavers, setLeavers] = useState<Leaver[] | null>(null);

  // Search filter for the active members list
  const [search, setSearch] = useState('');

  // Banners
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modal state
  const [archiveTarget, setArchiveTarget] = useState<ActiveMember | null>(null);
  const [reinstateTarget, setReinstateTarget] = useState<Leaver | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Archive form fields
  const [archiveReason, setArchiveReason] = useState('Lapsed');
  const [archiveDate, setArchiveDate] = useState(todayInput());
  const [archiveNotes, setArchiveNotes] = useState('');

  // Load the active members list (re-fetched each visit)
  const loadMembers = async () => {
    try {
      const res = await fetch('/api/admin/members');
      if (!res.ok) {
        setError('Failed to load members.');
        setMembers([]);
        return;
      }
      const json = await res.json();
      setMembers(json.members || []);
    } catch {
      setError('Failed to load members.');
      setMembers([]);
    }
  };

  // Load the leavers list, persisting to sessionStorage for back-navigation
  const loadLeavers = async () => {
    try {
      const res = await fetch('/api/admin/leavers');
      if (!res.ok) {
        setError('Failed to load leavers.');
        setLeavers([]);
        return;
      }
      const json = await res.json();
      const list: Leaver[] = json.leavers || [];
      setLeavers(list);
      sessionStorage.setItem(LEAVERS_CACHE_KEY, JSON.stringify(list));
    } catch {
      setError('Failed to load leavers.');
      setLeavers([]);
    }
  };

  // On mount: show cached leavers instantly, then refresh both lists
  useEffect(() => {
    const cached = sessionStorage.getItem(LEAVERS_CACHE_KEY);
    if (cached) {
      try {
        setLeavers(JSON.parse(cached));
      } catch {
        // Ignore corrupt cache — the fetch will replace it
      }
    }
    loadMembers();
    loadLeavers();
  }, []);

  // Open the archive modal for a member, resetting the form
  const openArchive = (member: ActiveMember) => {
    setError(null);
    setNotice(null);
    setArchiveTarget(member);
    setArchiveReason('Lapsed');
    setArchiveDate(todayInput());
    setArchiveNotes('');
  };

  // Confirm archiving the selected member
  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(archiveTarget.userName)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: archiveReason, leftDate: archiveDate, notes: archiveNotes }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to archive member.');
        setSubmitting(false);
        return;
      }
      setNotice(`${archiveTarget.firstName} ${archiveTarget.lastName} has been archived.`);
      setArchiveTarget(null);
      setSubmitting(false);
      await loadMembers();
      await loadLeavers();
    } catch {
      setError('Failed to archive member.');
      setSubmitting(false);
    }
  };

  // Confirm reinstating the selected leaver
  const confirmReinstate = async () => {
    if (!reinstateTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(reinstateTarget.userName)}/reinstate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to reinstate member.');
        setSubmitting(false);
        return;
      }
      setNotice(`${reinstateTarget.firstName} ${reinstateTarget.lastName} has been reinstated.`);
      setReinstateTarget(null);
      setSubmitting(false);
      await loadMembers();
      await loadLeavers();
    } catch {
      setError('Failed to reinstate member.');
      setSubmitting(false);
    }
  };

  // Derive Navbar props
  const userName = session && session.user && session.user.name ? session.user.name : undefined;
  const userRole = session && session.user ? session.user.role : undefined;

  // Filter active members by the search term (name match)
  const searchLower = search.trim().toLowerCase();
  const filteredMembers: ActiveMember[] = [];
  if (members) {
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const fullName = `${m.firstName} ${m.lastName}`.toLowerCase();
      if (searchLower === '' || fullName.includes(searchLower)) {
        filteredMembers.push(m);
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={userName} userRole={userRole} />

      <main className="max-w-3xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Members &amp; Leavers</h1>
        <p className="text-sm text-gray-700 mb-4">
          Archive members who have left and reinstate leavers who return.
        </p>

        {error ? (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">{notice}</div>
        ) : null}

        {/* Active members — archive */}
        <div className={`${getCardClasses('md')} mb-4`}>
          <h2 className="text-base font-semibold text-gray-900 mb-2">Active Members</h2>
          <input
            type="text"
            placeholder="Search by name…"
            className={`${getInputClasses()} mb-3`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {members === null ? (
            <p className="text-sm text-gray-700">Loading members…</p>
          ) : filteredMembers.length === 0 ? (
            <p className="text-sm text-gray-700">No members match your search.</p>
          ) : (
            <div>
              {filteredMembers.map((m) => (
                <div key={m.userName} className="border-b border-gray-100 py-2 last:border-b-0 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{m.firstName} {m.lastName}</p>
                    <p className="text-xs text-gray-700">
                      {m.memberType}{m.yearStarted ? ` · Joined ${m.yearStarted}` : ''}{m.emailAddress ? ` · ${m.emailAddress}` : ''}
                    </p>
                  </div>
                  <button className={getButtonClasses('secondary', 'sm')} onClick={() => openArchive(m)}>
                    Archive
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Leavers — reinstate */}
        <div className={`${getCardClasses('md')} mb-4`}>
          <h2 className="text-base font-semibold text-gray-900 mb-2">Leavers</h2>
          {leavers === null ? (
            <p className="text-sm text-gray-700">Loading leavers…</p>
          ) : leavers.length === 0 ? (
            <p className="text-sm text-gray-700">No leavers recorded.</p>
          ) : (
            <div>
              {leavers.map((l) => (
                <div key={l.userName} className="border-b border-gray-100 py-2 last:border-b-0 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{l.firstName} {l.lastName}</p>
                    <p className="text-xs text-gray-700">
                      {l.memberType}{l.leftDate ? ` · Left ${l.leftDate}` : ''}{l.leftReason ? ` · ${l.leftReason}` : ''}
                    </p>
                  </div>
                  <button className={getButtonClasses('primary', 'sm')} onClick={() => { setError(null); setNotice(null); setReinstateTarget(l); }}>
                    Reinstate
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Archive modal */}
      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Member"
        message={archiveTarget ? `Move ${archiveTarget.firstName} ${archiveTarget.lastName} to the Leavers sheet.` : ''}
        confirmLabel="Archive"
        confirmVariant="danger"
        confirmDisabled={submitting || !archiveDate}
        onConfirm={confirmArchive}
        onCancel={() => setArchiveTarget(null)}
      >
        <div className="mb-3 text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
          <select className={getInputClasses()} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)}>
            <option>Lapsed</option>
            <option>Resigned</option>
            <option>Deceased</option>
          </select>
        </div>
        <div className="mb-3 text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1">Left Date</label>
          <input type="date" className={getInputClasses()} value={archiveDate} onChange={(e) => setArchiveDate(e.target.value)} />
        </div>
        <div className="mb-4 text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
          <textarea className={getInputClasses()} rows={2} value={archiveNotes} onChange={(e) => setArchiveNotes(e.target.value)} />
        </div>
      </ConfirmDialog>

      {/* Reinstate modal */}
      <ConfirmDialog
        isOpen={reinstateTarget !== null}
        title="Reinstate Member"
        message={reinstateTarget ? `This will restore ${reinstateTarget.firstName} ${reinstateTarget.lastName} as an active member.` : ''}
        confirmLabel="Reinstate"
        confirmVariant="primary"
        confirmDisabled={submitting}
        onConfirm={confirmReinstate}
        onCancel={() => setReinstateTarget(null)}
      >
        <p className="mb-4 text-left text-sm text-gray-700">
          You may wish to update their contact details and reset their password after reinstatement.
        </p>
      </ConfirmDialog>
    </div>
  );
}
