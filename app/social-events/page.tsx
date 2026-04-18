// app/social-events/page.tsx
// Main Social Events page - displays list of social events

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { getButtonClasses } from '@/config/theme-helpers';
import { calculateCapacity, formatCapacity, getCapacityBadgeColor } from '@/lib/game-management/capacity';
import type { SocialEvent } from '@/lib/game-management/types';
import { hasRole } from '@/lib/role-utils';
import { EnteredPlayersModal } from '@/components/game-management/EnteredPlayersModal';

type FilterType = 'all' | 'O' | 'upcoming';

export default function SocialEventsPage() {
  const { data: session } = useSession();
  const [events, setEvents] = useState<SocialEvent[]>([]);
  const [filter, setFilter] = useState<FilterType>('O');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEventForModal, setSelectedEventForModal] = useState<SocialEvent | null>(null);
  const [detailsModalEvent, setDetailsModalEvent] = useState<SocialEvent | null>(null);

  useEffect(() => {
    fetchEvents();
  }, []);

  async function fetchEvents() {
    setLoading(true);
    try {
      const response = await fetch('/api/social-events/events');
      const data = await response.json();
      if (data.events) {
        setEvents(data.events);
      }
    } catch (error) {
      alert('Failed to load events. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  }

  const filteredEvents = events.filter(event => {
    switch (filter) {
      case 'O':
        return event.status === 'O';
      case 'upcoming':
        return ['', 'O', 'X', 'S'].includes(event.status);
      default:
        return true;
    }
  });

  function getStatusBadge(status: string) {
    const badges: { [key: string]: { label: string; color: string } } = {
      '': { label: 'Upcoming', color: 'bg-gray-500' },
      'O': { label: 'Open', color: 'bg-green-500' },
      'X': { label: 'Closed', color: 'bg-yellow-500' },
      'S': { label: 'Confirmed', color: 'bg-blue-500' },
      'P': { label: 'Completed', color: 'bg-purple-500' },
      'C': { label: 'Cancelled', color: 'bg-red-500' },
      'A': { label: 'Archived', color: 'bg-gray-400' },
    };

    const badge = badges[status] || badges[''];

    return (
      <span className={`inline-block px-2 py-1 text-xs font-semibold text-white rounded ${badge.color}`}>
        {badge.label}
      </span>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Social Events</h1>

          {hasRole(session?.user?.role, 'Admin') && (
            <Link
              href="/social-events/manage"
              className={getButtonClasses('primary', 'md')}
            >
              Manage Events
            </Link>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 font-medium border-b-2 ${
              filter === 'all'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            All Events
          </button>

          <button
            onClick={() => setFilter('O')}
            className={`px-4 py-2 font-medium border-b-2 ${
              filter === 'O'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Open for Entry
          </button>

          <button
            onClick={() => setFilter('upcoming')}
            className={`px-4 py-2 font-medium border-b-2 ${
              filter === 'upcoming'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Upcoming
          </button>
        </div>

        {/* Events list */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading events...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <p className="text-gray-600">No events found for this filter.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredEvents.map((event, index) => (
              <div
                key={event.tabName && event.tabName.trim() ? event.tabName : `${event.date}-${event.eventName}-${event.time}-${index}`}
                className="bg-white rounded-lg shadow border border-gray-200 p-4"
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    {event.detailsUrl ? (
                      <h3
                        className="font-bold text-lg text-blue-600 hover:text-blue-800 cursor-pointer hover:underline"
                        title={event.description || 'Click for details'}
                        onClick={() => setDetailsModalEvent(event)}
                      >
                        {event.eventName}
                      </h3>
                    ) : event.description ? (
                      <h3
                        className="font-bold text-lg cursor-help"
                        title={event.description}
                      >
                        {event.eventName}
                      </h3>
                    ) : (
                      <h3 className="font-bold text-lg text-gray-900">{event.eventName}</h3>
                    )}
                    <p className="text-sm text-gray-600">
                      {new Date(event.date).toLocaleDateString('en-GB', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                      {' at '}
                      {event.time}
                    </p>
                  </div>
                  {getStatusBadge(event.status)}
                </div>

                <div className="space-y-1 text-sm mb-4">
                  {event.location && (
                    <p>
                      <span className="font-medium">Location:</span> {event.location}
                    </p>
                  )}

                  {event.description && (
                    <p className="text-gray-700">{event.description}</p>
                  )}

                  {/* Show capacity for open events */}
                  {event.status === 'O' && event.maxPlayers > 0 && (() => {
                    const capacity = calculateCapacity(event);
                    const badgeColor = getCapacityBadgeColor(capacity);
                    return (
                      <p>
                        <span className="font-medium">Capacity:</span>{' '}
                        <button
                          onClick={() => {
                            setSelectedEventForModal(event);
                            setIsModalOpen(true);
                          }}
                          className={`inline-block px-2 py-0.5 text-xs font-semibold text-white rounded ${badgeColor} hover:opacity-80 cursor-pointer`}
                        >
                          {formatCapacity(capacity)}
                        </button>
                      </p>
                    );
                  })()}

                  {event.status === 'O' && (!event.maxPlayers || event.maxPlayers === 0) && (
                    <button
                      onClick={() => {
                        setSelectedEventForModal(event);
                        setIsModalOpen(true);
                      }}
                      className="text-green-600 hover:text-green-700 hover:underline cursor-pointer"
                    >
                      <span className="font-medium">{event.entered}</span> attendees registered
                    </button>
                  )}
                </div>

                {/* View Details button for confirmed/completed events */}
                {['S', 'P'].includes(event.status) && (
                  <Link
                    href={`/social-events/event/${event.tabDate}`}
                    className={`block w-full text-center ${getButtonClasses('primary', 'md')}`}
                  >
                    View Details
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Modal for viewing and managing entered attendees */}
        {selectedEventForModal && (
          <EnteredPlayersModal
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setSelectedEventForModal(null);
            }}
            gameId={selectedEventForModal.tabName}
            gameType="social-events"
            gameName={`${selectedEventForModal.eventName} - ${selectedEventForModal.date}`}
            currentUserRole={session?.user?.role}
            maxPlayers={selectedEventForModal.maxPlayers}
            onPlayersChanged={() => {
              // Refresh events list when attendees are added/removed
              fetchEvents();
            }}
          />
        )}

        {/* Modal for viewing event details (Google Doc) */}
        {detailsModalEvent && detailsModalEvent.detailsUrl && (
          <>
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-40"
              onClick={() => setDetailsModalEvent(null)}
            />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col">
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">{detailsModalEvent.eventName}</h2>
                    {detailsModalEvent.description && (
                      <p className="text-sm text-gray-600 mt-1">{detailsModalEvent.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setDetailsModalEvent(null)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <iframe
                    src={(() => {
                      // Convert Google Doc URL to embeddable preview URL
                      const url = detailsModalEvent.detailsUrl!;
                      // Extract doc ID from various Google Doc URL formats
                      const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
                      if (match) {
                        return `https://docs.google.com/document/d/${match[1]}/preview`;
                      }
                      // If not a Google Doc, try to embed directly
                      return url;
                    })()}
                    className="w-full h-full border-0"
                    title={`Details for ${detailsModalEvent.eventName}`}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
