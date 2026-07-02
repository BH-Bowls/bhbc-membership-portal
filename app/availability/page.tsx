// app/availability/page.tsx
// Availability Planner hub page — lists the user's groups. Polls are created and
// answered from within a group; there are no standalone/public polls.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { useSessionRefresh } from '@/hooks/useSessionRefresh';
import { getButtonClasses, getBadgeClasses, getAlertClasses } from '@/config/theme-helpers';
import type { AvailabilityGroupSummary } from '@/types/availability';

// sessionStorage cache key for the hub page
const CACHE_KEY = 'AvailabilityHubCache';

// Shape of cached hub data
interface HubCache {
  groups: AvailabilityGroupSummary[];
}

export default function AvailabilityHubPage() {
  // Load session for navbar and user identity
  const { data: session } = useSession();
  useSessionRefresh();

  // Groups visible to this user
  const [groups, setGroups] = useState<AvailabilityGroupSummary[]>([]);
  // Whether data is still loading for the first time
  const [loading, setLoading] = useState(true);
  // Error message if fetching fails
  const [error, setError] = useState<string | null>(null);

  // Fetch hub data on mount — show cache instantly, then re-fetch silently
  useEffect(() => {
    // Check sessionStorage for cached hub data
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsed: HubCache = JSON.parse(cached);
        // Show cached data immediately so back-navigation feels instant
        setGroups(parsed.groups || []);
        setLoading(false);
        // Re-fetch in background to get fresh data
        fetchHubData({ silent: true });
        return;
      } catch {
        // Corrupt cache — ignore and fetch fresh
      }
    }
    // No cache — fetch with loading spinner
    fetchHubData({ silent: false });
  }, []);

  // Fetch the user's groups
  async function fetchHubData({ silent }: { silent: boolean }) {
    // Only show spinner if not using cached data
    if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      // Fetch the user's groups
      const groupsRes = await fetch('/api/availability/groups');
      if (!groupsRes.ok) {
        throw new Error('Failed to load groups');
      }
      const groupsData = await groupsRes.json();
      const fetchedGroups: AvailabilityGroupSummary[] = groupsData.groups || [];

      // Update state with fresh data
      setGroups(fetchedGroups);

      // Persist to sessionStorage for instant back-navigation
      const toCache: HubCache = { groups: fetchedGroups };
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(toCache));
    } catch (err) {
      // Only show error if this was a foreground fetch (user is waiting)
      if (!silent) {
        setError('Failed to load availability data. Please refresh the page.');
      }
      console.error('[AvailabilityHubPage] fetchHubData error:', err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  const role = session && session.user ? session.user.role : '';
  const displayName = session && session.user && session.user.name ? session.user.name : undefined;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">

        {/* Page header with action button */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
            <p className="text-sm text-gray-700 mt-1">Coordinate dates and decisions with your groups</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Polls are created from within a group (group → Create Poll → Fixed dates / Find best date). */}
            <Link href="/availability/groups/new" className={getButtonClasses('primary', 'md')}>
              Create Group
            </Link>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className={getAlertClasses('danger') + ' mb-4'}>
            {error}
          </div>
        )}

        {/* Loading spinner shown only on first load (no cached data) */}
        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-700">Loading groups…</p>
          </div>
        ) : (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Your Groups</h2>

            {groups.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                <p className="text-gray-700">You are not in any groups yet. Create one to get started.</p>
                <div className="mt-4">
                  <Link href="/availability/groups/new" className={getButtonClasses('primary', 'md')}>
                    Create Group
                  </Link>
                </div>
              </div>
            ) : (
              // Two-column grid on desktop, single column on mobile
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {groups.map((group) => (
                  <Link
                    key={group.groupId}
                    href={`/availability/groups/${group.groupId}`}
                    className="block bg-white rounded-lg border border-gray-200 p-4 text-gray-900 hover:bg-gray-50 transition-colors"
                  >
                    {/* Group name and archived indicator */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-semibold text-blue-600 text-base">{group.name}</h3>
                      {group.status === 'archived' && (
                        <span className={getBadgeClasses('secondary', 'sm')}>Archived</span>
                      )}
                    </div>

                    {/* Optional description */}
                    {group.description && (
                      <p className="text-sm text-gray-700 mb-3">{group.description}</p>
                    )}

                    {/* Member count and open event count badges */}
                    <div className="flex flex-wrap gap-2">
                      <span className={getBadgeClasses('primary', 'sm')}>
                        {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
                      </span>
                      {group.openEventCount > 0 && (
                        <span className={getBadgeClasses('success', 'sm')}>
                          {group.openEventCount} open {group.openEventCount === 1 ? 'poll' : 'polls'}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
