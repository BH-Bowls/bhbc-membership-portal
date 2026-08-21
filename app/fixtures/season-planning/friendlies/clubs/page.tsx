// app/fixtures/season-planning/friendlies/clubs/page.tsx
// Clubs list — every club in the directory, last year's fixture count, and
// a Contact button through to that club's full Info page (contact
// resolution, Draft Email, Mark Sent/Unsent, multi-season fixture history).
// Replaces the old club-grouped Outreach page.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SeasonPlanningTabs } from '@/components/SeasonPlanningTabs';
import { hasRole } from '@/lib/role-utils';
import type { ClubListEntry } from '@/lib/season-planning-supabase';

export default function FriendliesClubsPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const role = session && session.user ? session.user.role : '';
  const isAdmin = hasRole(role, 'Admin');
  const isCaptain = hasRole(role, 'Captain');
  const canAccess = isAdmin || isCaptain;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clubs, setClubs] = useState<ClubListEntry[]>([]);

  useEffect(() => {
    if (session === null) { router.push('/'); return; }
    if (session && !canAccess) { router.push('/'); return; }
  }, [session, canAccess, router]);

  useEffect(() => {
    if (!canAccess) return;
    fetch('/api/fixtures/season-planning/friendlies/clubs')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setClubs(data.clubs || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  if (!session || !canAccess) return null;

  return (
    <div className="min-h-screen bg-gray-50">

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Season Planning</h1>
        <p className="text-sm text-gray-700 mb-4">
          Clubs — last year's fixture count against each club, and a way in to contacts, outreach, and fixture history.
        </p>

        <SeasonPlanningTabs active="friendlies" />

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-700">Loading…</div>}

        {!loading && (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {clubs.map((club) => (
              <div key={club.clubName} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">{club.clubName}</div>
                  <div className="text-xs text-gray-700">
                    {club.lastYearFixtureCount === 0
                      ? 'No fixtures'
                      : `${club.lastYearFixtureCount} fixture${club.lastYearFixtureCount === 1 ? '' : 's'}`}
                    {' '}last year
                  </div>
                </div>
                <Link
                  href={`/fixtures/season-planning/friendlies/clubs/${encodeURIComponent(club.clubName)}`}
                  className="px-3 py-1.5 text-xs border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 font-medium"
                >
                  Contact
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
