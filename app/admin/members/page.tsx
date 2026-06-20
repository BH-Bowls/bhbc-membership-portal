// app/admin/members/page.tsx
// Member Management hub — landing page linking to the Applications workflow and
// the Members & Leavers (archive / reinstate) section. Admin only (enforced in
// middleware.ts). Shows a count badge of applications awaiting action.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getCardClasses, getBadgeClasses } from '@/config/theme-helpers';

// Member Management hub page
export default function MembersHubPage() {
  const { data: session } = useSession();

  // Count of applications awaiting admin action (shown as a badge)
  const [pendingCount, setPendingCount] = useState<number>(0);

  // Load the pending-applications count on mount
  useEffect(() => {
    // Fetch the count; failures are non-fatal (badge simply stays hidden)
    fetch('/api/admin/applications/pending-count')
      .then((res) => {
        if (!res.ok) {
          return null;
        }
        return res.json();
      })
      .then((json) => {
        if (json && typeof json.count === 'number') {
          setPendingCount(json.count);
        }
      })
      .catch(() => {
        // Ignore — the badge is a non-critical hint
      });
  }, []);

  // Derive Navbar props from the session
  const userName = session && session.user && session.user.name ? session.user.name : undefined;
  const userRole = session && session.user ? session.user.role : undefined;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={userName} userRole={userRole} />

      <main className="max-w-3xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Page heading */}
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Member Management</h1>
        <p className="text-sm text-gray-700 mb-6">
          Process new applications and manage members joining or leaving the club.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Applications card */}
          <Link href="/admin/members/applications" className={`${getCardClasses('md')} block hover:shadow-md transition-shadow`}>
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Applications</h2>
              {pendingCount > 0 ? (
                <span className={getBadgeClasses('warning', 'md')}>{pendingCount} to action</span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-gray-700">
              Review and process new membership applications.
            </p>
          </Link>

          {/* Members & Leavers card */}
          <Link href="/admin/members/leavers" className={`${getCardClasses('md')} block hover:shadow-md transition-shadow`}>
            <h2 className="text-lg font-semibold text-gray-900">Members &amp; Leavers</h2>
            <p className="mt-2 text-sm text-gray-700">
              Archive departing members and reinstate leavers.
            </p>
          </Link>
        </div>
      </main>
    </div>
  );
}
