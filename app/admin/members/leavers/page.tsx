// app/admin/members/leavers/page.tsx
// Leavers — list past members with View (read-only details) and Reinstate.
// Admin only (enforced in middleware.ts). Archiving lives on the Members page.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { getButtonClasses, getCardClasses, getInputClasses } from '@/config/theme-helpers';
import type { Leaver } from '@/lib/leavers-sheets';

// sessionStorage key for the leavers list (back-button cache).
const LEAVERS_CACHE_KEY = 'AdminLeaversCache';

export default function LeaversPage() {
  const { data: session } = useSession();

  const [leavers, setLeavers] = useState<Leaver[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [reinstateTarget, setReinstateTarget] = useState<Leaver | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  // On mount: show cached leavers instantly, then refresh
  useEffect(() => {
    const cached = sessionStorage.getItem(LEAVERS_CACHE_KEY);
    if (cached) {
      try {
        setLeavers(JSON.parse(cached));
      } catch {
        // Ignore corrupt cache — the fetch will replace it
      }
    }
    loadLeavers();
  }, []);

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
      await loadLeavers();
    } catch {
      setError('Failed to reinstate member.');
      setSubmitting(false);
    }
  };

  const userName = session && session.user && session.user.name ? session.user.name : undefined;
  const userRole = session && session.user ? session.user.role : undefined;

  // Filter leavers by the search term (name match)
  const searchLower = search.trim().toLowerCase();
  const filtered: Leaver[] = [];
  if (leavers) {
    for (let i = 0; i < leavers.length; i++) {
      const l = leavers[i];
      const fullName = `${l.firstName} ${l.lastName}`.toLowerCase();
      if (searchLower === '' || fullName.includes(searchLower)) {
        filtered.push(l);
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={userName} userRole={userRole} />

      <main className="max-w-3xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <Link href="/admin/members" className="text-sm text-gray-700 mb-2 inline-block hover:text-gray-900">← Member Management</Link>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Leavers</h1>
        <p className="text-sm text-gray-700 mb-4">Past members. View their details or reinstate them as active members.</p>

        {error ? (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">{notice}</div>
        ) : null}

        <div className={`${getCardClasses('md')}`}>
          {leavers === null ? (
            <p className="text-sm text-gray-700">Loading leavers…</p>
          ) : leavers.length === 0 ? (
            <p className="text-sm text-gray-700">No leavers recorded.</p>
          ) : (
            <div>
              <input
                type="text"
                placeholder="Search by name…"
                className={`${getInputClasses()} mb-3`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {filtered.length === 0 ? (
                <p className="text-sm text-gray-700">No leavers match your search.</p>
              ) : null}
              {filtered.map((l) => (
                <div key={l.userName} className="border-b border-gray-100 py-2 last:border-b-0 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{l.firstName} {l.lastName}</p>
                    <p className="text-xs text-gray-700">
                      {l.memberType}{l.leftDate ? ` · Left ${l.leftDate}` : ''}{l.leftReason ? ` · ${l.leftReason}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Link href={`/admin/members/leavers/${encodeURIComponent(l.userName)}`} className={getButtonClasses('secondary', 'sm')}>
                      View
                    </Link>
                    <button className={getButtonClasses('primary', 'sm')} onClick={() => { setError(null); setNotice(null); setReinstateTarget(l); }}>
                      Reinstate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

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
