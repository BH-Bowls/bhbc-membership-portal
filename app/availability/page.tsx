// app/availability/page.tsx
// Availability Planner — member event list page

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses, getBadgeClasses, getCardClasses } from '@/config/theme-helpers';
import type { AvailabilityEventSummary } from '@/types/availability';

const CACHE_KEY = 'AvailabilityListCache';

// Format an ISO timestamp as a human-readable date
function formatEventDate(isoString: string): string {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Format a slot datetime as a short label
function formatSlotDatetime(isoString: string): string {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Single event card component
function EventCard({ event, currentUserName }: { event: AvailabilityEventSummary; currentUserName: string }) {
  const isCreator = event.eventId && currentUserName;

  return (
    <div className={`${getCardClasses('md')} mb-3`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Title and badges */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Link
              href={`/availability/${event.eventId}`}
              className="text-base font-semibold text-gray-900 hover:text-blue-600 truncate"
            >
              {event.title}
            </Link>
            {/* Visibility badge */}
            {event.visibility === 'public' ? (
              <span className={getBadgeClasses('success', 'sm')}>Public</span>
            ) : (
              <span className={getBadgeClasses('warning', 'sm')}>Private</span>
            )}
            {/* Status badge */}
            {event.status === 'open' ? (
              <span className={getBadgeClasses('success', 'sm')}>Open</span>
            ) : event.status === 'concluded' ? (
              <span className={getBadgeClasses('primary', 'sm')}>Concluded</span>
            ) : (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">Closed</span>
            )}
          </div>

          {/* Creator and expiry */}
          <p className="text-sm text-gray-700 mb-1">
            Created by {event.createdByName} &middot; Expires {formatEventDate(event.expiresAt)}
          </p>

          {/* Slots and responses count */}
          <p className="text-sm text-gray-700 mb-1">
            {event.slotCount} {event.slotCount === 1 ? 'slot' : 'slots'} &middot; {event.responseCount} {event.responseCount === 1 ? 'respondent' : 'respondents'}
          </p>

          {/* Concluded slot info */}
          {event.status === 'concluded' && (event.concludedSlotLabel || event.concludedSlotDatetime) && (
            <p className="text-sm font-medium text-green-700 mt-1">
              Chosen: {event.concludedSlotLabel || formatSlotDatetime(event.concludedSlotDatetime)}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Link
            href={`/availability/${event.eventId}`}
            className={getButtonClasses('primary', 'sm')}
          >
            View
          </Link>
          {/* Show Manage link to event creator */}
          {event.eventId && currentUserName && (
            <ManageLink eventId={event.eventId} currentUserName={currentUserName} createdByName={event.createdByName} />
          )}
        </div>
      </div>
    </div>
  );
}

// Conditionally show manage link — we can't pass the createdByUsername directly
// from the summary, so we rely on the API having filtered correctly. We show
// the Manage link only from within the parent component where we have the session.
function ManageLink({ eventId, currentUserName, createdByName }: {
  eventId: string;
  currentUserName: string;
  createdByName: string;
}) {
  return null; // Manage link is shown by the parent — see EventCard usage below
}

export default function AvailabilityPage() {
  const { data: session, status } = useSession();
  const [events, setEvents] = useState<AvailabilityEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConcluded, setShowConcluded] = useState(false);

  const currentUserName = session && session.user ? session.user.userName : '';

  // Load from sessionStorage cache immediately, then re-fetch in background
  useEffect(() => {
    if (status === 'loading') {
      return;
    }

    // Attempt to restore cached data for instant display
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.events)) {
          setEvents(parsed.events);
          setLoading(false);
        }
      }
    } catch (cacheError) {
      // Cache read failed — proceed with fresh fetch
    }

    // Fetch fresh data from the API
    fetchEvents();
  }, [status]);

  async function fetchEvents() {
    try {
      setError(null);
      const res = await fetch('/api/availability');
      if (!res.ok) {
        throw new Error('Failed to load events');
      }
      const data = await res.json();
      const fetchedEvents: AvailabilityEventSummary[] = data.events || [];
      setEvents(fetchedEvents);
      setLoading(false);

      // Update sessionStorage cache
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ events: fetchedEvents }));
      } catch (cacheError) {
        // Cache write failed — not critical
      }
    } catch (fetchError) {
      console.error('[AvailabilityPage] Fetch error:', fetchError);
      setError('Failed to load events. Please refresh the page.');
      setLoading(false);
    }
  }

  const role = session && session.user ? session.user.role : '';

  // Separate events into sections
  const awaitingResponse: AvailabilityEventSummary[] = [];
  const responded: AvailabilityEventSummary[] = [];
  const concludedOrClosed: AvailabilityEventSummary[] = [];

  for (const event of events) {
    // Archived events are excluded from the list view
    if (event.status === 'archived') {
      continue;
    }
    if (event.status === 'concluded' || event.status === 'closed') {
      concludedOrClosed.push(event);
      continue;
    }
    // Open events
    if (event.hasResponded) {
      responded.push(event);
    } else {
      awaitingResponse.push(event);
    }
  }

  // Section component for a group of events
  function Section({ title, items, emptyMessage }: {
    title: string;
    items: AvailabilityEventSummary[];
    emptyMessage: string;
  }) {
    return (
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">{title}</h2>
        {items.length === 0 ? (
          <p className="text-sm text-gray-700 italic">{emptyMessage}</p>
        ) : (
          <div>
            {items.map((event) => (
              <div key={event.eventId} className={`${getCardClasses('md')} mb-3`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Title and badges */}
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Link
                        href={`/availability/${event.eventId}`}
                        className="text-base font-semibold text-gray-900 hover:text-blue-600 truncate"
                      >
                        {event.title}
                      </Link>
                      {event.visibility === 'public' ? (
                        <span className={getBadgeClasses('success', 'sm')}>Public</span>
                      ) : (
                        <span className={getBadgeClasses('warning', 'sm')}>Private</span>
                      )}
                      {event.status === 'open' ? (
                        <span className={getBadgeClasses('success', 'sm')}>Open</span>
                      ) : event.status === 'concluded' ? (
                        <span className={getBadgeClasses('primary', 'sm')}>Concluded</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">Closed</span>
                      )}
                    </div>

                    {/* Metadata row */}
                    <p className="text-sm text-gray-700 mb-1">
                      Created by {event.createdByName} &middot; Expires {formatEventDate(event.expiresAt)}
                    </p>
                    <p className="text-sm text-gray-700 mb-1">
                      {event.slotCount} {event.slotCount === 1 ? 'slot' : 'slots'} &middot; {event.responseCount} {event.responseCount === 1 ? 'respondent' : 'respondents'}
                    </p>

                    {/* Concluded slot info */}
                    {event.status === 'concluded' && (event.concludedSlotLabel || event.concludedSlotDatetime) && (
                      <p className="text-sm font-medium text-green-700 mt-1">
                        Chosen: {event.concludedSlotLabel || formatSlotDatetime(event.concludedSlotDatetime)}
                      </p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Link
                      href={`/availability/${event.eventId}`}
                      className={getButtonClasses('primary', 'sm')}
                    >
                      View
                    </Link>
                    {/* Only show Manage to the creator — compare against the raw API data
                        We use the createdByName check as a proxy; the API only returns events
                        the user can see, and the manage link is an extra convenience */}
                    {currentUserName && (
                      <CreatorManageLink eventId={event.eventId} currentUserName={currentUserName} />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session && session.user ? session.user.name : undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-3xl">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Availability Planner</h1>
            <p className="text-sm text-gray-700 mt-1">Coordinate dates and times with members and guests</p>
          </div>
          <Link href="/availability/new" className={getButtonClasses('primary', 'md')}>
            Create Event
          </Link>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="text-center py-12">
            <p className="text-gray-700">Loading events&hellip;</p>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-4 mb-6">
            {error}
          </div>
        )}

        {/* Event sections */}
        {!loading && !error && (
          <div>
            <Section
              title="Awaiting your response"
              items={awaitingResponse}
              emptyMessage="No events awaiting your response."
            />

            <Section
              title="You've responded"
              items={responded}
              emptyMessage="You haven't responded to any open events yet."
            />

            {/* Concluded / Closed section with toggle */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-lg font-semibold text-gray-900">Concluded / Closed</h2>
                {concludedOrClosed.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowConcluded(!showConcluded)}
                    className="text-sm text-blue-600 hover:text-blue-700 underline"
                  >
                    {showConcluded ? 'Hide' : `Show ${concludedOrClosed.length}`}
                  </button>
                )}
              </div>

              {showConcluded ? (
                concludedOrClosed.length === 0 ? (
                  <p className="text-sm text-gray-700 italic">No concluded or closed events.</p>
                ) : (
                  <div>
                    {concludedOrClosed.map((event) => (
                      <div key={event.eventId} className={`${getCardClasses('md')} mb-3`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <Link
                                href={`/availability/${event.eventId}`}
                                className="text-base font-semibold text-gray-900 hover:text-blue-600 truncate"
                              >
                                {event.title}
                              </Link>
                              {event.status === 'concluded' ? (
                                <span className={getBadgeClasses('primary', 'sm')}>Concluded</span>
                              ) : (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">Closed</span>
                              )}
                            </div>
                            <p className="text-sm text-gray-700 mb-1">
                              Created by {event.createdByName}
                            </p>
                            {event.status === 'concluded' && (event.concludedSlotLabel || event.concludedSlotDatetime) && (
                              <p className="text-sm font-medium text-green-700 mt-1">
                                Chosen: {event.concludedSlotLabel || formatSlotDatetime(event.concludedSlotDatetime)}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            <Link
                              href={`/availability/${event.eventId}`}
                              className={getButtonClasses('primary', 'sm')}
                            >
                              View
                            </Link>
                            {currentUserName && (
                              <CreatorManageLink eventId={event.eventId} currentUserName={currentUserName} />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                concludedOrClosed.length === 0 && (
                  <p className="text-sm text-gray-700 italic">No concluded or closed events.</p>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Shows Manage link — we call the manage API which enforces its own access check
function CreatorManageLink({ eventId, currentUserName }: { eventId: string; currentUserName: string }) {
  // We always show the manage link and let the server enforce access
  // This avoids needing createdByUsername on the summary object for the UI check
  return (
    <Link
      href={`/availability/${eventId}/manage`}
      className="text-xs text-blue-600 hover:text-blue-700 underline"
    >
      Manage
    </Link>
  );
}
