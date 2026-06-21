// app/admin/members/list/page.tsx
// Members lookup — searchable list of active members with Edit and Archive
// actions, plus a button to create a new member. Admin only (middleware.ts).

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { getButtonClasses, getInputClasses, getCardClasses } from '@/config/theme-helpers';

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

// Build today's date as YYYY-MM-DD for the archive date input default.
function todayInput(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function MembersListPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [members, setMembers] = useState<ActiveMember[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Archive modal state
  const [archiveTarget, setArchiveTarget] = useState<ActiveMember | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [archiveReason, setArchiveReason] = useState('Lapsed');
  const [archiveDate, setArchiveDate] = useState(todayInput());
  const [archiveNotes, setArchiveNotes] = useState('');

  // Load the active members list
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

  useEffect(() => {
    loadMembers();
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
    } catch {
      setError('Failed to archive member.');
      setSubmitting(false);
    }
  };

  const userName = session && session.user && session.user.name ? session.user.name : undefined;
  const userRole = session && session.user ? session.user.role : undefined;

  // Filter members by the search term (name match)
  const searchLower = search.trim().toLowerCase();
  const filtered: ActiveMember[] = [];
  if (members) {
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const fullName = `${m.firstName} ${m.lastName}`.toLowerCase();
      if (searchLower === '' || fullName.includes(searchLower)) {
        filtered.push(m);
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={userName} userRole={userRole} />

      <main className="max-w-3xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <Link href="/admin/members" className="text-sm text-gray-700 mb-2 inline-block hover:text-gray-900">← Member Management</Link>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h1 className="text-2xl font-bold text-gray-900">Members</h1>
          <div className="flex gap-2 flex-shrink-0">
            <button className={getButtonClasses('secondary', 'sm')} onClick={() => router.push('/admin/members/email-inclusion')}>
              Email Inclusion
            </button>
            <button className={getButtonClasses('primary', 'sm')} onClick={() => router.push('/admin/members/list/new')}>
              Add Member
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-700 mb-4">Look up a member to edit or archive, or add a new one.</p>

        {error ? (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">{notice}</div>
        ) : null}

        <div className={`${getCardClasses('md')}`}>
          <input
            type="text"
            placeholder="Search by name…"
            className={`${getInputClasses()} mb-3`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {members === null ? (
            <p className="text-sm text-gray-700">Loading members…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-700">No members match your search.</p>
          ) : (
            <div>
              {filtered.map((m) => (
                <div key={m.userName} className="border-b border-gray-100 py-2 last:border-b-0 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{m.firstName} {m.lastName}</p>
                    <p className="text-xs text-gray-700">
                      {m.memberType}{m.yearStarted ? ` · Joined ${m.yearStarted}` : ''}{m.emailAddress ? ` · ${m.emailAddress}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Link href={`/admin/members/list/${encodeURIComponent(m.userName)}`} className={getButtonClasses('primary', 'sm')}>
                      Edit
                    </Link>
                    <button className={getButtonClasses('secondary', 'sm')} onClick={() => openArchive(m)}>
                      Archive
                    </button>
                  </div>
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
    </div>
  );
}
