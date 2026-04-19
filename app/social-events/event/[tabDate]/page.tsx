// app/social-events/event/[tabDate]/page.tsx
// Event Details page - shows attendees and their attendance status

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';
import { getButtonClasses } from '@/config/theme-helpers';
import type { SocialEvent, SocialEventAttendee } from '@/lib/game-management/types';

export default function EventDetailsPage() {
  const { data: session } = useSession();
  const params = useParams();
  const tabDate = params.tabDate as string;
  usePhoneBackNavigation('/social-events');

  const [event, setEvent] = useState<SocialEvent | null>(null);
  const [attendees, setAttendees] = useState<SocialEventAttendee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEventDetails();
  }, [tabDate]);

  async function fetchEventDetails() {
    setLoading(true);
    try {
      const response = await fetch(`/api/social-events/event/${tabDate}`);
      const data = await response.json();

      if (data.event && data.attendees) {
        setEvent(data.event);
        setAttendees(data.attendees);
      } else {
        alert('Event not found');
      }
    } catch (error) {
      console.error('Failed to load event:', error);
      alert('Failed to load event details. Please try again.');
    } finally {
      setLoading(false);
    }
  }

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

  // Group attendees by attendance status
  const attending = attendees.filter(a => a.attendance === 'Y');
  const notAttending = attendees.filter(a => a.attendance === 'N');
  const maybe = attendees.filter(a => a.attendance === 'M');
  const waitlist = attendees.filter(a => a.attendance === 'W');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading event details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-600">Event not found</p>
            <Link href="/social-events" className={`mt-4 inline-block ${getButtonClasses('secondary', 'md')}`}>
              Back to Events
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Back button */}
        <div className="mb-6">
          <Link href="/social-events" className={getButtonClasses('secondary', 'md')}>← Back to Events</Link>
        </div>

        {/* Event header */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold mb-2 text-gray-900">{event.eventName}</h1>
              <p className="text-lg text-gray-600">
                {new Date(event.date).toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                {' at '}
                {event.time}
              </p>
            </div>
            {getStatusBadge(event.status)}
          </div>

          <div className="space-y-2 text-gray-700">
            {event.location && (
              <p>
                <span className="font-medium">Location:</span> {event.location}
              </p>
            )}

            {event.description && (
              <p className="mt-3">{event.description}</p>
            )}

            {event.maxPlayers > 0 && (
              <p>
                <span className="font-medium">Capacity:</span> {event.entered} / {event.maxPlayers}
                {event.selected > 0 && ` (${event.selected} attending)`}
                {event.reserves > 0 && ` + ${event.reserves} on waitlist`}
              </p>
            )}
          </div>

          {/* Manage button for admins */}
          {session?.user.role === 'Admin' && (
            <div className="mt-4">
              <Link
                href={`/social-events/manage/event/${event.tabDate}`}
                className={getButtonClasses('primary', 'md')}
              >
                Manage Event
              </Link>
            </div>
          )}
        </div>

        {/* Attendees section */}
        <div className="space-y-6">
          {/* Attending */}
          {attending.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center text-gray-900">
                <span className="inline-block w-3 h-3 rounded-full bg-green-500 mr-2"></span>
                Attending ({attending.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {attending.map((attendee, idx) => (
                  <div key={idx} className="text-gray-700">
                    {attendee.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Maybe */}
          {maybe.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center text-gray-900">
                <span className="inline-block w-3 h-3 rounded-full bg-yellow-500 mr-2"></span>
                Maybe ({maybe.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {maybe.map((attendee, idx) => (
                  <div key={idx} className="text-gray-700">
                    {attendee.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Waitlist */}
          {waitlist.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center text-gray-900">
                <span className="inline-block w-3 h-3 rounded-full bg-blue-500 mr-2"></span>
                Waitlist ({waitlist.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {waitlist.map((attendee, idx) => (
                  <div key={idx} className="text-gray-700">
                    {attendee.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Not Attending */}
          {notAttending.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center text-gray-900">
                <span className="inline-block w-3 h-3 rounded-full bg-red-500 mr-2"></span>
                Not Attending ({notAttending.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {notAttending.map((attendee, idx) => (
                  <div key={idx} className="text-gray-900">
                    {attendee.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No responses yet */}
          {attendees.length === 0 && (
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <p className="text-gray-600">No responses yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
