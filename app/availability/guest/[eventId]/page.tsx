// app/availability/guest/[eventId]/page.tsx
// Visitor response page — no auth required. Token from URL query param.
// Allows visitors (non-members) to respond to availability polls via a unique link.

'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getBadgeClasses, getButtonClasses, getAlertClasses } from '@/config/theme-helpers';
import type {
  AvailabilityEvent,
  AvailabilitySlot,
  AvailabilityParticipantResponses,
  AvailabilityResponse,
} from '@/types/availability';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Format ISO datetime date line for slot header
function fmtSlotDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Format ISO datetime time line for slot header (returns empty if no meaningful time)
function fmtSlotTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (h === 0 && m === 0) return '';
  if (h === 12 && m === 0) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

// Format ISO timestamp as display date
function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Badge variant for event type
function typeBadgeVariant(type: string): 'primary' | 'secondary' | 'warning' {
  if (type === 'fixture') return 'warning';
  if (type === 'signup') return 'secondary';
  return 'primary';
}

// Capitalise first letter
function cap(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// CSS classes for read-only response badges
function responseBadgeClass(response: AvailabilityResponse | undefined): string {
  if (response === 'yes') return 'bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-medium';
  if (response === 'maybe') return 'bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs font-medium';
  if (response === 'no') return 'bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-medium';
  return 'bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs';
}

function responseLabel(response: AvailabilityResponse | undefined): string {
  if (response === 'yes') return '✓ Yes';
  if (response === 'maybe') return '? Maybe';
  if (response === 'no') return '✗ No';
  return '—';
}

// ── GuestPageInner ─────────────────────────────────────────────────────────────
// Inner component that reads useSearchParams — must be inside Suspense boundary

interface GuestPageInnerProps {
  eventId: string;
}

function GuestPageInner({ eventId }: GuestPageInnerProps) {
  const searchParams = useSearchParams();
  // Read the visitor token from the URL query string
  const token = searchParams.get('token') || '';

  // Event data returned by the guest endpoint
  const [event, setEvent] = useState<AvailabilityEvent | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [visitorName, setVisitorName] = useState('');
  const [myResponses, setMyResponses] = useState<Record<string, AvailabilityResponse>>({});
  const [allResponses, setAllResponses] = useState<AvailabilityParticipantResponses[]>([]);
  const [concludedSlot, setConcludedSlot] = useState<AvailabilitySlot | null>(null);

  // Loading and error state
  const [loading, setLoading] = useState(true);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Visitor's pending response selections
  const [pendingResponses, setPendingResponses] = useState<Record<string, AvailabilityResponse>>({});

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Honeypot field value — should always be empty for real visitors
  const [honeypot, setHoneypot] = useState('');

  // Load event data when eventId and token are available
  useEffect(() => {
    if (!eventId) return;
    // If no token, show an error immediately without fetching
    if (!token) {
      setLoading(false);
      return;
    }
    fetchGuestData(eventId, token);
  }, [eventId, token]);

  // Fetch event data using the visitor token
  async function fetchGuestData(eid: string, tok: string) {
    setLoading(true);
    setFetchError(null);
    setTokenInvalid(false);
    try {
      const res = await fetch(
        `/api/availability/guest/${eid}?token=${encodeURIComponent(tok)}`
      );
      if (res.status === 401 || res.status === 404) {
        setTokenInvalid(true);
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to load event');
      }
      const data = await res.json();
      setEvent(data.event);
      setSlots(data.slots);
      setVisitorName(data.invitee ? data.invitee.visitorName : '');
      setMyResponses(data.myResponses || {});
      setAllResponses(data.allResponses || []);
      setConcludedSlot(data.concludedSlot || null);
      // Seed pending responses from existing ones
      setPendingResponses(data.myResponses || {});
    } catch (err) {
      setFetchError('Failed to load event. Please try again or check the link from your email.');
      console.error('[GuestPage] fetchGuestData error:', err);
    } finally {
      setLoading(false);
    }
  }

  // Toggle the visitor's response for a slot
  function setResponse(slotId: string, response: AvailabilityResponse) {
    setPendingResponses(prev => {
      const next = { ...prev };
      next[slotId] = response;
      return next;
    });
  }

  // Whether the event is currently accepting responses
  function isAcceptingResponses(): boolean {
    if (!event) return false;
    if (event.status !== 'open') return false;
    if (new Date(event.expiresAt) <= new Date()) return false;
    return true;
  }

  // Save the visitor's responses
  async function handleSave() {
    if (!eventId || !token) return;

    // Honeypot check: if the hidden field is filled, do nothing (bot detected)
    // Return silently so bots don't know they were rejected
    if (honeypot) {
      setSaveSuccess(true);
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      // Build responses array
      const responsesPayload = [];
      const slotIds = Object.keys(pendingResponses);
      for (let i = 0; i < slotIds.length; i++) {
        responsesPayload.push({
          slotId: slotIds[i],
          response: pendingResponses[slotIds[i]],
        });
      }

      const res = await fetch(`/api/availability/guest/${eventId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          responses: responsesPayload,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSaveError(data.error || 'Failed to save responses.');
        return;
      }

      setSaveSuccess(true);
      // Re-fetch to get fresh response data
      await fetchGuestData(eventId, token);
    } catch (err) {
      console.error('[GuestPage] handleSave error:', err);
      setSaveError('An unexpected error occurred. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // No token in the URL
  if (!token) {
    return (
      <div className={getAlertClasses('danger') + ' mt-6 mx-auto max-w-md'}>
        This link appears to be incomplete. Please check the email you received and try again.
      </div>
    );
  }

  // Token was rejected or event not found
  if (tokenInvalid) {
    return (
      <div className={getAlertClasses('warning') + ' mt-6 mx-auto max-w-md'}>
        This link is no longer valid or has expired.
      </div>
    );
  }

  // General fetch error
  if (fetchError) {
    return (
      <div className={getAlertClasses('danger') + ' mt-6 mx-auto max-w-md'}>
        {fetchError}
      </div>
    );
  }

  // Loading spinner
  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p className="mt-3 text-gray-700">Loading event…</p>
      </div>
    );
  }

  if (!event) return null;

  const isExpired = new Date(event.expiresAt) <= new Date();
  const readOnly = !isAcceptingResponses();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 text-gray-900">

      {/* Visitor greeting */}
      {visitorName && (
        <p className="text-lg text-gray-700 mb-4">Hello, <strong>{visitorName}</strong></p>
      )}

      {/* Event title and badges */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
        <span className={getBadgeClasses(typeBadgeVariant(event.type))}>
          {cap(event.type)}
        </span>
      </div>

      {/* Description */}
      {event.description && (
        <p className="text-sm text-gray-700 mb-2">{event.description}</p>
      )}

      {/* Expiry date */}
      <p className="text-xs text-gray-700 mb-4">Expires {fmtDate(event.expiresAt)}</p>

      {/* Concluded banner */}
      {event.status === 'concluded' && concludedSlot && (
        <div className={getAlertClasses('success') + ' mb-4'}>
          <p className="font-medium text-green-900">
            Event concluded — chosen date:{' '}
            {concludedSlot.slotLabel || fmtSlotDate(concludedSlot.slotDatetime)}
          </p>
          {event.conclusionNote && (
            <p className="text-sm mt-1 text-green-800">{event.conclusionNote}</p>
          )}
        </div>
      )}

      {/* Expired warning */}
      {isExpired && event.status === 'open' && (
        <div className={getAlertClasses('warning') + ' mb-4'}>
          This event is no longer accepting responses.
        </div>
      )}

      {/* Save success message */}
      {saveSuccess && (
        <div className={getAlertClasses('success') + ' mb-4'}>
          Your responses have been saved. You can update them any time using this link.
        </div>
      )}

      {/* Save error */}
      {saveError && (
        <div className={getAlertClasses('danger') + ' mb-4'}>
          {saveError}
        </div>
      )}

      {/* ── Response grid ───────────────────────────────────────── */}
      {slots.length === 0 ? (
        <div className={getAlertClasses('info')}>
          No date slots have been added to this event yet.
        </div>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200 min-w-[120px]">
                  Name
                </th>
                {slots.map((slot) => (
                  <th
                    key={slot.slotId}
                    className={
                      'px-3 py-2 text-center text-xs font-medium text-gray-700 border-b border-gray-200 min-w-[100px] ' +
                      (event.status === 'concluded' &&
                        concludedSlot &&
                        concludedSlot.slotId === slot.slotId
                        ? 'bg-green-50'
                        : 'bg-gray-50')
                    }
                  >
                    {slot.slotLabel ? (
                      <span>{slot.slotLabel}</span>
                    ) : (
                      <span>
                        <span className="block">{fmtSlotDate(slot.slotDatetime)}</span>
                        {fmtSlotTime(slot.slotDatetime) && (
                          <span className="block text-gray-700 font-normal">
                            {fmtSlotTime(slot.slotDatetime)}
                          </span>
                        )}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white text-gray-900">
              {/* Visitor's own row — editable if accepting responses */}
              <tr className="bg-blue-50">
                <td className="sticky left-0 bg-blue-50 px-3 py-2 text-sm font-medium text-gray-900 border-b border-gray-100">
                  {visitorName || 'You'}
                </td>
                {slots.map((slot) => (
                  <td
                    key={slot.slotId}
                    className={
                      'px-2 py-2 text-center border-b border-gray-100 ' +
                      (event.status === 'concluded' &&
                        concludedSlot &&
                        concludedSlot.slotId === slot.slotId
                        ? 'bg-green-50'
                        : '')
                    }
                  >
                    {!readOnly ? (
                      // Editable three-button row
                      <div className="flex gap-1 justify-center">
                        {/* Yes */}
                        <button
                          onClick={() => setResponse(slot.slotId, 'yes')}
                          className={
                            'px-2 py-1 text-xs rounded font-medium border transition-colors ' +
                            (pendingResponses[slot.slotId] === 'yes'
                              ? 'bg-green-500 text-white border-green-500'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-green-50')
                          }
                          title="Yes"
                        >
                          ✓
                        </button>
                        {/* Maybe */}
                        <button
                          onClick={() => setResponse(slot.slotId, 'maybe')}
                          className={
                            'px-2 py-1 text-xs rounded font-medium border transition-colors ' +
                            (pendingResponses[slot.slotId] === 'maybe'
                              ? 'bg-yellow-400 text-white border-yellow-400'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-yellow-50')
                          }
                          title="Maybe"
                        >
                          ?
                        </button>
                        {/* No */}
                        <button
                          onClick={() => setResponse(slot.slotId, 'no')}
                          className={
                            'px-2 py-1 text-xs rounded font-medium border transition-colors ' +
                            (pendingResponses[slot.slotId] === 'no'
                              ? 'bg-red-500 text-white border-red-500'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-red-50')
                          }
                          title="No"
                        >
                          ✗
                        </button>
                      </div>
                    ) : (
                      // Read-only badge
                      <span className={responseBadgeClass(pendingResponses[slot.slotId] as AvailabilityResponse | undefined)}>
                        {responseLabel(pendingResponses[slot.slotId] as AvailabilityResponse | undefined)}
                      </span>
                    )}
                  </td>
                ))}
              </tr>

              {/* Other respondents — shown only if show_responses_to_respondents is true */}
              {allResponses.map((participant) => (
                <tr key={participant.displayName} className="hover:bg-gray-50">
                  <td className="sticky left-0 bg-white px-3 py-2 text-sm text-gray-900 border-b border-gray-100">
                    {participant.displayName}
                  </td>
                  {slots.map((slot) => (
                    <td
                      key={slot.slotId}
                      className={
                        'px-2 py-2 text-center border-b border-gray-100 ' +
                        (event.status === 'concluded' &&
                          concludedSlot &&
                          concludedSlot.slotId === slot.slotId
                          ? 'bg-green-50'
                          : '')
                      }
                    >
                      <span className={responseBadgeClass(participant.responses[slot.slotId])}>
                        {responseLabel(participant.responses[slot.slotId])}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}

              {/* Summary row */}
              <tr className="bg-gray-50">
                <td className="sticky left-0 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 border-t border-gray-200">
                  Summary
                </td>
                {slots.map((slot) => {
                  // Count Yes/Maybe/No across all respondents + visitor's pending response
                  let yes = 0;
                  let maybe = 0;
                  let no = 0;
                  for (let i = 0; i < allResponses.length; i++) {
                    const r = allResponses[i].responses[slot.slotId];
                    if (r === 'yes') yes = yes + 1;
                    else if (r === 'maybe') maybe = maybe + 1;
                    else if (r === 'no') no = no + 1;
                  }
                  const myR = pendingResponses[slot.slotId];
                  if (myR === 'yes') yes = yes + 1;
                  else if (myR === 'maybe') maybe = maybe + 1;
                  else if (myR === 'no') no = no + 1;
                  return (
                    <td key={slot.slotId} className="px-2 py-2 text-center border-t border-gray-200">
                      <div className="flex flex-col gap-0.5 items-center text-xs">
                        {yes > 0 && <span className="text-green-700 font-medium">{yes}✓</span>}
                        {maybe > 0 && <span className="text-yellow-700 font-medium">{maybe}?</span>}
                        {no > 0 && <span className="text-red-700 font-medium">{no}✗</span>}
                        {yes === 0 && maybe === 0 && no === 0 && (
                          <span className="text-gray-500">—</span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Save button — only shown when accepting responses */}
      {!readOnly && (
        <button
          onClick={handleSave}
          disabled={saving}
          className={getButtonClasses('primary', 'md')}
        >
          {saving ? 'Saving…' : 'Save My Responses'}
        </button>
      )}

      {/* Honeypot — hidden from humans, bots fill it in */}
      <input
        type="text"
        name="website"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        style={{ display: 'none' }}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
    </div>
  );
}

// ── GuestPageWrapper ───────────────────────────────────────────────────────────
// Resolves params and wraps GuestPageInner in a Suspense boundary (required for
// useSearchParams in Next.js App Router)

export default function GuestEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  // Resolve eventId from async params
  const [eventId, setEventId] = React.useState('');
  React.useEffect(() => {
    params.then((p) => setEventId(p.eventId));
  }, [params]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Branded header — no nav (public page, no session) */}
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-4 max-w-4xl">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-lg font-bold text-gray-900">Burgess Hill Bowls Club</p>
              <p className="text-xs text-gray-700">Availability Planner</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main content — Suspense wraps useSearchParams */}
      <Suspense fallback={
        <div className="text-center py-16">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-3 text-gray-700">Loading…</p>
        </div>
      }>
        {eventId && <GuestPageInner eventId={eventId} />}
      </Suspense>
    </div>
  );
}
