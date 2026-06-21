// app/admin/members/page.tsx
// Member Management hub — three cards: Applications, Members, Leavers.
// Admin only (enforced in middleware.ts). Shows count badges per section.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getCardClasses, getBadgeClasses } from '@/config/theme-helpers';

// Member Management hub page
export default function MembersHubPage() {
  const { data: session } = useSession();

  // Counts shown as badges on each card
  const [pendingApplications, setPendingApplications] = useState<number | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [leaverCount, setLeaverCount] = useState<number | null>(null);

  // Load the three counts on mount (each failure is non-fatal)
  useEffect(() => {
    fetch('/api/admin/applications/pending-count')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && typeof json.count === 'number') setPendingApplications(json.count);
      })
      .catch(() => {});

    fetch('/api/admin/members')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && Array.isArray(json.members)) setMemberCount(json.members.length);
      })
      .catch(() => {});

    fetch('/api/admin/leavers')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && Array.isArray(json.leavers)) setLeaverCount(json.leavers.length);
      })
      .catch(() => {});
  }, []);

  // Derive Navbar props from the session
  const userName = session && session.user && session.user.name ? session.user.name : undefined;
  const userRole = session && session.user ? session.user.role : undefined;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={userName} userRole={userRole} />

      <main className="max-w-3xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Member Management</h1>
        <p className="text-sm text-gray-700 mb-6">
          Process applications, manage members, and handle leavers.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Applications card */}
          <Link href="/admin/members/applications" className={`${getCardClasses('md')} block hover:shadow-md transition-shadow`}>
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Applications</h2>
              {pendingApplications && pendingApplications > 0 ? (
                <span className={getBadgeClasses('warning', 'md')}>{pendingApplications} to action</span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-gray-700">Review and process new membership applications.</p>
          </Link>

          {/* Members card */}
          <Link href="/admin/members/list" className={`${getCardClasses('md')} block hover:shadow-md transition-shadow`}>
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Members</h2>
              {memberCount !== null ? (
                <span className={getBadgeClasses('primary', 'md')}>{memberCount}</span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-gray-700">Look up, edit, archive, or add a member.</p>
          </Link>

          {/* Leavers card */}
          <Link href="/admin/members/leavers" className={`${getCardClasses('md')} block hover:shadow-md transition-shadow`}>
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Leavers</h2>
              {leaverCount !== null ? (
                <span className={getBadgeClasses('secondary', 'md')}>{leaverCount}</span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-gray-700">View past members and reinstate them.</p>
          </Link>
        </div>
      </main>
    </div>
  );
}
