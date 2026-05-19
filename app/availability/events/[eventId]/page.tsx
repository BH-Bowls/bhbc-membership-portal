// app/availability/events/[eventId]/page.tsx
// Member response page for an availability event — shows the response grid and lets the user
// mark their availability for each candidate slot

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { useSessionRefresh } from '@/hooks/useSessionRefresh';
import {
  getButtonClasses,
  getBadgeClasses,
  getAlertClasses,
} from '@/config/theme-helpers';
import type {
  AvailabilityEventDetail,
  AvailabilitySlot,
  AvailabilityResponse,
  AvailabilityParticipantResponses,
} from '@/types/availability';

// Format an ISO datetime to two lines: date and time
function formatSlotDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatSlotTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  // Only show time if it is not midnight/noon default
  if (h === 0 && m === 0) return '';
  if (h === 12 && m === 0) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

// Format an ISO timestamp as a short expiry string
function formatExpiry(iso: string): string {
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

// Badge variant for event status
function statusBadgeVariant(status: string): 'success' | 'warning' | 'primary' | 'secondary' {
  if (status === 'open') return 'success';
  if (status === 'closed') return 'warning';
  if (status === 'concluded') return 'primary';
  return 'secondary';
}

// Capitalise first letter
function cap(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Colour class for a response badge (read-only)
function responseBadgeClass(response: AvailabilityResponse | undefined): string {
  if (response === 'yes') return 'bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-medium';
  if (response === 'maybe') return 'bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs font-medium';
  if (response === 'no') return 'bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-medium';
  return 'bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs';
}

// Label for a response
function responseLabel(response: AvailabilityResponse | undefined): string {
  if (response === 'yes') return '✓ Yes';
  if (response === 'maybe') return '? Maybe';
  if (response === 'no') return '✗ No';
  return '—';
}

export default function EventResponsePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { data: session } = useSession();
  useSessionRefresh();

  // Resolve eventId from the async params
  const [eventId, setEventId] = useState('');
  React.useEffect(() => {
    params.then((p) => setEventId(p.eventId));
  }, [params]);

  // Event detail data from the API
  const [detail, setDetail] = useState<AvailabilityEventDetail | null>(null);
  // Whether initial data is loading
  const [loading, setLoading] = useState(true);
  // Whether the user is not permitted to view this event (403)
  const [forbidden, setForbidden] = useState(false);
  // Error message for display
  const [fetchError, setFetchError] = useState<string | null>(null);

  // The current user's pending response selections (slotId → response)
  const [pendingResponses, setPendingResponses] = useState<Record<string, AvailabilityResponse>>({});

  // Save button state
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentUserName = session && session.user ? session.user.userName : '';
  const currentUserRole = session && session.user ? session.user.role : '';

  // Load event data when eventId is resolved
  useEffect(() => {
    if (!eventId) return;
    fetchDetail(eventId);
  }, [eventId]);

  // Fetch event detail from the API
  async function fetchDetail(eid: string) {
    setLoading(true);
    setFetchError(null);
    setForbidden(false);
    try {
      const res = await fetch(`/api/availability/events/${eid}`);
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.status === 404) {
        setFetchError('Event not found.');
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to load event');
      }
      const data: AvailabilityEventDetail = await res.json();
      setDetail(data);
      // Seed the pending responses from the user's existing answers
      setPendingResponses({ ...data.myResponses });
    } catch (err) {
      setFetchError('Failed to load event. Please refresh.');
      console.error('[EventResponsePage] fetchDetail error:', err);
    } finally {
      setLoading(false);
    }
  }

  // Toggle the current user's response for a slot
  function setResponse(slotId: string, response: AvailabilityResponse) {
    setPendingResponses(prev => {
      const next = { ...prev };
      next[slotId] = response;
      return next;
    });
  }

  // Whether the event is currently open and not expired
  function isEventAcceptingResponses(): boolean {
    if (!detail) return false;
    if (detail.event.status !== 'open') return false;
    if (new Date(detail.event.expiresAt) <= new Date()) return false;
    return true;
  }

  // Save the current user's responses to the API
  async function handleSave() {
    if (!eventId || !detail) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      // Build responses array from pendingResponses state
      const responsesPayload = [];
      const slotIds = Object.keys(pendingResponses);
      for (let i = 0; i < slotIds.length; i++) {
        responsesPayload.push({
          slotId: slotIds[i],
          response: pendingResponses[slotIds[i]],
        });
      }

      const res = await fetch(`/api/availability/events/${eventId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: responsesPayload }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSaveError(data.error || 'Failed to save responses.');
        return;
      }

      setSaveSuccess(true);
      // Re-fetch to get updated allResponses from server
      await fetchDetail(eventId);
    } catch (err) {
      console.error('[EventResponsePage] handleSave error:', err);
      setSaveError('An unexpected error occurred. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Whether the event is expired (but still open status)
  function isExpired(): boolean {
    if (!detail) return false;
    return new Date(detail.event.expiresAt) <= new Date();
  }

  const displayName = session && session.user && session.user.name ? session.user.name : undefined;
  const role = session && session.user ? session.user.role : '';

  // Determine the back link: group page if this is a group event, otherwise hub
  const backHref = detail && detail.event.groupId
    ? `/availability/groups/${detail.event.groupId}`
    : '/availability';
  const backLabel = detail && detail.event.groupId ? 'Group' : 'Availability';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">

        {/* 403 Forbidden message */}
        {forbidden && (
          <div className={getAlertClasses('danger') + ' mt-4'}>
            You are not a member of this group and cannot view this event.
          </div>
        )}

        {/* Error message */}
        {fetchError && (
          <div className={getAlertClasses('danger') + ' mt-4'}>
            {fetchError}
          </div>
        )}

        {/* Loading spinner */}
        {loading && !forbidden && (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-700">Loading event…</p>
          </div>
        )}

        {/* Main content once loaded */}
        {!loading && !forbidden && detail && (
          <>
            {/* ── Page header ──────────────────────────────────────── */}
            <div className="mb-4">
              <RouterBackLink fallbackHref={backHref} label={backLabel} />

              {/* Event title and badges */}
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-gray-900">{detail.event.title}</h1>
                <span className={getBadgeClasses(typeBadgeVariant(detail.event.type))}>
                  {cap(detail.event.type)}
                </span>
                <span className={getBadgeClasses(statusBadgeVariant(detail.event.status))}>
                  {cap(detail.event.status)}
                </span>
              </div>

              {/* Description */}
              {detail.event.description && (
                <p className="text-sm text-gray-700 mb-2">{detail.event.description}</p>
              )}

              {/* Metadata row */}
              <p className="text-xs text-gray-700 mb-2">
                Expires {formatExpiry(detail.event.expiresAt)}
              </p>

              {/* Manage link — shown to event creator or admin */}
              {(detail.event.createdByUsername === currentUserName ||
                currentUserRole.indexOf('Admin') !== -1) && (
                <Link
                  href={`/availability/events/${eventId}/manage`}
                  className={getButtonClasses('secondary', 'sm')}
                >
                  Manage Event
                </Link>
              )}
            </div>

            {/* ── Status banners ────────────────────────────────────── */}

            {/* Concluded: show winning slot and note */}
            {detail.event.status === 'concluded' && detail.concludedSlot && (
              <div className={getAlertClasses('success') + ' mb-4'}>
                <p className="font-medium text-green-900">
                  Event concluded — chosen date:{' '}
                  {detail.concludedSlot.slotLabel ||
                    formatSlotDate(detail.concludedSlot.slotDatetime)}
                </p>
                {detail.event.conclusionNote && (
                  <p className="text-sm mt-1 text-green-800">{detail.event.conclusionNote}</p>
                )}
              </div>
            )}

            {/* Expired but still open (no more responses accepted) */}
            {detail.event.status === 'open' && isExpired() && (
              <div className={getAlertClasses('warning') + ' mb-4'}>
                This event has expired — no more responses are being accepted.
              </div>
            )}

            {/* ── Save feedback ─────────────────────────────────────── */}
            {saveSuccess && (
              <div className={getAlertClasses('success') + ' mb-4'}>
                Your responses have been saved.
              </div>
            )}
            {saveError && (
              <div className={getAlertClasses('danger') + ' mb-4'}>
                {saveError}
              </div>
            )}

            {/* ── Response grid ─────────────────────────────────────── */}
            {detail.slots.length === 0 ? (
              <div className={getAlertClasses('info')}>
                No date slots have been added to this event yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      {/* Name column header */}
                      <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200 min-w-[120px]">
                        Name
                      </th>
                      {/* One column per slot */}
                      {detail.slots.map((slot: AvailabilitySlot) => (
                        <th
                          key={slot.slotId}
                          className={
                            'px-3 py-2 text-center text-xs font-medium text-gray-700 border-b border-gray-200 min-w-[100px] ' +
                            (detail.event.status === 'concluded' &&
                              detail.concludedSlot &&
                              detail.concludedSlot.slotId === slot.slotId
                              ? 'bg-green-50'
                              : 'bg-gray-50')
                          }
                        >
                          {slot.slotLabel ? (
                            <span>{slot.slotLabel}</span>
                          ) : (
                            <span>
                              <span className="block">{formatSlotDate(slot.slotDatetime)}</span>
                              {formatSlotTime(slot.slotDatetime) && (
                                <span className="block text-gray-700 font-normal">
                                  {formatSlotTime(slot.slotDatetime)}
                                </span>
                              )}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white text-gray-900">
                    {/* Current user row — always first, always editable */}
                    <tr className="bg-blue-50">
                      <td className="sticky left-0 bg-blue-50 px-3 py-2 text-sm font-medium text-gray-900 border-b border-gray-100">
                        You
                      </td>
                      {detail.slots.map((slot: AvailabilitySlot) => (
                        <td
                          key={slot.slotId}
                          className={
                            'px-2 py-2 text-center border-b border-gray-100 ' +
                            (detail.event.status === 'concluded' &&
                              detail.concludedSlot &&
                              detail.concludedSlot.slotId === slot.slotId
                              ? 'bg-green-50'
                              : '')
                          }
                        >
                          {isEventAcceptingResponses() ? (
                            // Editable three-button row for current user
                            <div className="flex gap-1 justify-center">
                              {/* Yes button */}
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
                              {/* Maybe button */}
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
                              {/* No button */}
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
                            // Read-only badge if event is not accepting responses
                            <span className={responseBadgeClass(pendingResponses[slot.slotId] as AvailabilityResponse | undefined)}>
                              {responseLabel(pendingResponses[slot.slotId] as AvailabilityResponse | undefined)}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>

                    {/* Other respondents — shown only if allowed */}
                    {detail.allResponses.map((participant: AvailabilityParticipantResponses) => (
                      <tr key={participant.displayName} className="hover:bg-gray-50">
                        <td className="sticky left-0 bg-white px-3 py-2 text-sm text-gray-900 border-b border-gray-100">
                          {participant.displayName}
                        </td>
                        {detail.slots.map((slot: AvailabilitySlot) => (
                          <td
                            key={slot.slotId}
                            className={
                              'px-2 py-2 text-center border-b border-gray-100 ' +
                              (detail.event.status === 'concluded' &&
                                detail.concludedSlot &&
                                detail.concludedSlot.slotId === slot.slotId
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

                    {/* Summary row: Yes/Maybe/No counts per slot */}
                    <SummaryRow slots={detail.slots} allResponses={detail.allResponses} myResponses={pendingResponses} />
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Save button ───────────────────────────────────────── */}
            {isEventAcceptingResponses() && (
              <div className="mt-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={getButtonClasses('primary', 'md')}
                >
                  {saving ? 'Saving…' : 'Save My Responses'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── SummaryRow sub-component ──────────────────────────────────────────────────
// Displays a per-slot Yes/Maybe/No count row at the bottom of the response grid

interface SummaryRowProps {
  slots: AvailabilitySlot[];
  allResponses: AvailabilityParticipantResponses[];
  myResponses: Record<string, AvailabilityResponse>;
}

function SummaryRow({ slots, allResponses, myResponses }: SummaryRowProps) {
  return (
    <tr className="bg-gray-50">
      <td className="sticky left-0 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 border-t border-gray-200">
        Summary
      </td>
      {slots.map((slot) => {
        // Count Yes/Maybe/No across all respondents including current user
        let yes = 0;
        let maybe = 0;
        let no = 0;

        // Count from other respondents
        for (let i = 0; i < allResponses.length; i++) {
          const r = allResponses[i].responses[slot.slotId];
          if (r === 'yes') yes = yes + 1;
          else if (r === 'maybe') maybe = maybe + 1;
          else if (r === 'no') no = no + 1;
        }

        // Count current user's pending response
        const myR = myResponses[slot.slotId];
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
  );
}
