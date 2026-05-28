// app/availability/page.tsx
// Availability Planner hub page — shows the user's groups and public events

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { useSessionRefresh } from '@/hooks/useSessionRefresh';
import { getButtonClasses, getBadgeClasses, getAlertClasses } from '@/config/theme-helpers';
import type { AvailabilityGroupSummary, AvailabilityEventSummary } from '@/types/availability';

// sessionStorage cache key for the hub page
const CACHE_KEY = 'AvailabilityHubCache';

// Shape of cached hub data
interface HubCache {
  groups: AvailabilityGroupSummary[];
  publicEvents: AvailabilityEventSummary[];
}

// Format an ISO timestamp as a short date string for display
function formatExpiry(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Return a human-readable relative time string (e.g. "3 days ago")
function relativeTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return '1 week ago';
  if (diffWeeks < 5) return `${diffWeeks} weeks ago`;
  return formatExpiry(iso);
}

// Return badge variant for an event status
function statusBadgeVariant(status: string): 'success' | 'warning' | 'secondary' | 'danger' | 'primary' {
  if (status === 'open') return 'success';
  if (status === 'closed') return 'warning';
  if (status === 'concluded') return 'primary';
  if (status === 'archived') return 'secondary';
  return 'secondary';
}

// Return badge variant for an event type
function typeBadgeVariant(type: string): 'primary' | 'secondary' | 'warning' {
  if (type === 'fixture') return 'warning';
  if (type === 'signup') return 'secondary';
  return 'primary';
}

// Capitalise first letter for display
function capitalise(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function AvailabilityHubPage() {
  // Load session for navbar and user identity
  const { data: session } = useSession();
  useSessionRefresh();

  // Groups visible to this user
  const [groups, setGroups] = useState<AvailabilityGroupSummary[]>([]);
  // Public events visible to all members
  const [publicEvents, setPublicEvents] = useState<AvailabilityEventSummary[]>([]);
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
        setGroups(parsed.groups);
        setPublicEvents(parsed.publicEvents);
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

  // Fetch groups and public events sequentially (no Promise.all per coding standards)
  async function fetchHubData({ silent }: { silent: boolean }) {
    // Only show spinner if not using cached data
    if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      // Step 1: fetch the user's groups
      const groupsRes = await fetch('/api/availability/groups');
      if (!groupsRes.ok) {
        throw new Error('Failed to load groups');
      }
      const groupsData = await groupsRes.json();
      const fetchedGroups: AvailabilityGroupSummary[] = groupsData.groups || [];

      // Step 2: fetch public events (no group_id set)
      const eventsRes = await fetch('/api/availability/events');
      if (!eventsRes.ok) {
        throw new Error('Failed to load public events');
      }
      const eventsData = await eventsRes.json();
      const fetchedEvents: AvailabilityEventSummary[] = eventsData.events || [];

      // Update state with fresh data
      setGroups(fetchedGroups);
      setPublicEvents(fetchedEvents);

      // Persist to sessionStorage for instant back-navigation
      const toCache: HubCache = { groups: fetchedGroups, publicEvents: fetchedEvents };
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

  // Split public events into three sections for display
  const userName = session && session.user ? session.user.userName : '';

  // Awaiting response: open events where hasResponded is false
  const awaitingResponse: AvailabilityEventSummary[] = [];
  // Already responded: open or closed events where hasResponded is true
  const responded: AvailabilityEventSummary[] = [];
  // Concluded or closed (all statuses except open without response)
  const concludedOrClosed: AvailabilityEventSummary[] = [];

  // Categorise each public event into the correct section
  for (let i = 0; i < publicEvents.length; i++) {
    const ev = publicEvents[i];
    // Concluded or archived events go to the bottom section
    if (ev.status === 'concluded' || ev.status === 'archived') {
      concludedOrClosed.push(ev);
    } else if (ev.status === 'closed') {
      // Closed events go to concluded/closed section
      concludedOrClosed.push(ev);
    } else if (ev.status === 'open') {
      // Open: split by whether the user has responded
      if (ev.hasResponded) {
        responded.push(ev);
      } else {
        awaitingResponse.push(ev);
      }
    }
  }

  // Whether the concluded/closed section is expanded
  const [showConcluded, setShowConcluded] = useState(false);

  const role = session && session.user ? session.user.role : '';
  const displayName = session && session.user && session.user.name ? session.user.name : undefined;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">

        {/* Page header with action buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
            <p className="text-sm text-gray-700 mt-1">Coordinate dates and decisions with your groups</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Create a public poll (visible to all members) */}
            <Link href="/availability/events/new" className={getButtonClasses('secondary', 'md')}>
              Create Public Poll
            </Link>
            {/* Create a new group */}
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
            <p className="mt-3 text-gray-700">Loading polls…</p>
          </div>
        ) : (
          <>
            {/* ── Your Groups section ───────────────────────────────────── */}
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

            {/* ── Public Events section ─────────────────────────────────── */}
            {publicEvents.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Public Polls</h2>

                {/* Sub-section: awaiting response */}
                {awaitingResponse.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-2">
                      Awaiting your response
                    </h3>
                    <div className="space-y-3">
                      {awaitingResponse.map((ev) => (
                        <EventCard key={ev.eventId} event={ev} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Sub-section: already responded */}
                {responded.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-2">
                      You&apos;ve responded
                    </h3>
                    <div className="space-y-3">
                      {responded.map((ev) => (
                        <EventCard key={ev.eventId} event={ev} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Sub-section: concluded or closed (collapsible) */}
                {concludedOrClosed.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowConcluded(!showConcluded)}
                      className="flex items-center gap-2 text-sm font-medium text-gray-700 uppercase tracking-wide mb-2 hover:text-gray-900"
                    >
                      <span>Concluded or Closed ({concludedOrClosed.length})</span>
                      <span className="text-gray-500">{showConcluded ? '▲' : '▼'}</span>
                    </button>
                    {showConcluded && (
                      <div className="space-y-3">
                        {concludedOrClosed.map((ev) => (
                          <EventCard key={ev.eventId} event={ev} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── EventCard sub-component ───────────────────────────────────────────────────
// Displays a single public event summary card

interface EventCardProps {
  event: AvailabilityEventSummary;
}

function EventCard({ event }: EventCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 text-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        {/* Event title links to response page */}
        <Link
          href={`/availability/events/${event.eventId}`}
          className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
        >
          {event.title}
        </Link>
        {/* Type and status badges */}
        <div className="flex flex-wrap gap-1">
          <span className={getBadgeClasses(typeBadgeVariant(event.type), 'sm')}>
            {capitalise(event.type)}
          </span>
          <span className={getBadgeClasses(statusBadgeVariant(event.status), 'sm')}>
            {capitalise(event.status)}
          </span>
        </div>
      </div>

      {/* Event metadata row */}
      <div className="text-xs text-gray-700 space-y-0.5">
        <p>Created by {event.createdByName}</p>
        <p>
          {event.slotCount} {event.slotCount === 1 ? 'option' : 'options'} ·{' '}
          {event.responseCount} {event.responseCount === 1 ? 'response' : 'responses'} ·{' '}
          Expires {formatExpiry(event.expiresAt)}
        </p>
        {/* Show winning slot if concluded */}
        {event.status === 'concluded' && event.concludedSlotLabel && (
          <p className="text-green-700 font-medium">
            Chosen: {event.concludedSlotLabel}
          </p>
        )}
      </div>
    </div>
  );
}
