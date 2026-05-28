// app/availability/events/[eventId]/page.tsx
// Member response page for an availability event — vertical poll-style layout

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

function formatSlotDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatSlotTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (h === 0 && m === 0) return '';
  if (h === 12 && m === 0) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

function formatExpiry(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function typeBadgeVariant(type: string): 'primary' | 'secondary' | 'warning' {
  if (type === 'fixture') return 'warning';
  if (type === 'signup') return 'secondary';
  return 'primary';
}

function statusBadgeVariant(status: string): 'success' | 'warning' | 'primary' | 'secondary' {
  if (status === 'open') return 'success';
  if (status === 'closed') return 'warning';
  if (status === 'concluded') return 'primary';
  return 'secondary';
}

function cap(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getSlotLabel(slot: AvailabilitySlot): string {
  if (slot.slotLabel) return slot.slotLabel;
  const date = formatSlotDate(slot.slotDatetime);
  const time = formatSlotTime(slot.slotDatetime);
  return time ? `${date} · ${time}` : date;
}

function responseBadgeClass(response: AvailabilityResponse | undefined): string {
  if (response === 'yes') return 'bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-medium';
  if (response === 'maybe') return 'bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs font-medium';
  if (response === 'no') return 'bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-medium';
  return 'bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-xs';
}

function responseLabel(response: AvailabilityResponse | undefined): string {
  if (response === 'yes') return '✓ Yes';
  if (response === 'maybe') return '? Maybe';
  if (response === 'no') return '✗ No';
  return '—';
}

function slotCounts(
  slotId: string,
  allResponses: AvailabilityParticipantResponses[],
  myResponses: Record<string, AvailabilityResponse>
): { yes: number; maybe: number; no: number } {
  let yes = 0;
  let maybe = 0;
  let no = 0;
  for (let i = 0; i < allResponses.length; i++) {
    const r = allResponses[i].responses[slotId];
    if (r === 'yes') yes = yes + 1;
    else if (r === 'maybe') maybe = maybe + 1;
    else if (r === 'no') no = no + 1;
  }
  const myR = myResponses[slotId];
  if (myR === 'yes') yes = yes + 1;
  else if (myR === 'maybe') maybe = maybe + 1;
  else if (myR === 'no') no = no + 1;
  return { yes, maybe, no };
}

export default function EventResponsePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { data: session } = useSession();
  useSessionRefresh();

  const [eventId, setEventId] = useState('');
  React.useEffect(() => {
    params.then((p) => setEventId(p.eventId));
  }, [params]);

  const [detail, setDetail] = useState<AvailabilityEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [pendingResponses, setPendingResponses] = useState<Record<string, AvailabilityResponse>>({});

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Slot ID currently shown in the responses modal (null = closed)
  const [modalSlotId, setModalSlotId] = useState<string | null>(null);

  const currentUserName = session && session.user ? session.user.userName : '';
  const currentUserRole = session && session.user ? session.user.role : '';

  useEffect(() => {
    if (!eventId) return;
    fetchDetail(eventId);
  }, [eventId]);

  async function fetchDetail(eid: string) {
    setLoading(true);
    setFetchError(null);
    setForbidden(false);
    try {
      const res = await fetch(`/api/availability/events/${eid}`);
      if (res.status === 403) { setForbidden(true); return; }
      if (res.status === 404) { setFetchError('Event not found.'); return; }
      if (!res.ok) throw new Error('Failed to load event');
      const data: AvailabilityEventDetail = await res.json();
      setDetail(data);
      setPendingResponses({ ...data.myResponses });
    } catch (err) {
      setFetchError('Failed to load event. Please refresh.');
      console.error('[EventResponsePage] fetchDetail error:', err);
    } finally {
      setLoading(false);
    }
  }

  function setResponse(slotId: string, response: AvailabilityResponse) {
    setPendingResponses(prev => {
      const next = { ...prev };
      next[slotId] = response;
      return next;
    });
  }

  function isEventAcceptingResponses(): boolean {
    if (!detail) return false;
    if (detail.event.status !== 'open') return false;
    if (new Date(detail.event.expiresAt) <= new Date()) return false;
    return true;
  }

  async function handleSave() {
    if (!eventId || !detail) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const responsesPayload = [];
      const slotIds = Object.keys(pendingResponses);
      for (let i = 0; i < slotIds.length; i++) {
        responsesPayload.push({ slotId: slotIds[i], response: pendingResponses[slotIds[i]] });
      }
      const res = await fetch(`/api/availability/events/${eventId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: responsesPayload }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || 'Failed to save responses.'); return; }
      setSaveSuccess(true);
      await fetchDetail(eventId);
    } catch (err) {
      console.error('[EventResponsePage] handleSave error:', err);
      setSaveError('An unexpected error occurred. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function isExpired(): boolean {
    if (!detail) return false;
    return new Date(detail.event.expiresAt) <= new Date();
  }

  const displayName = session && session.user && session.user.name ? session.user.name : undefined;
  const role = session && session.user ? session.user.role : '';
  const backHref = detail && detail.event.groupId ? `/availability/groups/${detail.event.groupId}` : '/availability';
  const backLabel = detail && detail.event.groupId ? 'Group' : 'Polls';

  const modalSlot = modalSlotId ? (detail?.slots.find(s => s.slotId === modalSlotId) ?? null) : null;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">

        {forbidden && (
          <div className={getAlertClasses('danger') + ' mt-4'}>
            You are not a member of this group and cannot view this event.
          </div>
        )}

        {fetchError && (
          <div className={getAlertClasses('danger') + ' mt-4'}>
            {fetchError}
          </div>
        )}

        {loading && !forbidden && (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-700">Loading poll…</p>
          </div>
        )}

        {!loading && !forbidden && detail && (
          <>
            {/* ── Page header ──────────────────────────────────────── */}
            <div className="mb-4">
              <RouterBackLink fallbackHref={backHref} label={backLabel} />
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-gray-900">{detail.event.title}</h1>
                <span className={getBadgeClasses(typeBadgeVariant(detail.event.type))}>
                  {cap(detail.event.type)}
                </span>
                <span className={getBadgeClasses(statusBadgeVariant(detail.event.status))}>
                  {cap(detail.event.status)}
                </span>
              </div>
              {detail.event.description && (
                <p className="text-sm text-gray-700 mb-2">{detail.event.description}</p>
              )}
              <p className="text-xs text-gray-700 mb-2">Expires {formatExpiry(detail.event.expiresAt)}</p>
              {(detail.event.createdByUsername === currentUserName ||
                currentUserRole.indexOf('Admin') !== -1) && (
                <Link href={`/availability/events/${eventId}/manage`} className={getButtonClasses('secondary', 'sm')}>
                  Manage Poll
                </Link>
              )}
            </div>

            {/* ── Status banners ────────────────────────────────────── */}
            {detail.event.status === 'concluded' && detail.concludedSlot && (
              <div className={getAlertClasses('success') + ' mb-4'}>
                <p className="font-medium text-green-900">
                  Poll concluded — chosen option:{' '}
                  {detail.concludedSlot.slotLabel || (detail.concludedSlot.slotDatetime ? formatSlotDate(detail.concludedSlot.slotDatetime) : '')}
                </p>
                {detail.event.conclusionNote && (
                  <p className="text-sm mt-1 text-green-800">{detail.event.conclusionNote}</p>
                )}
              </div>
            )}

            {detail.event.status === 'open' && isExpired() && (
              <div className={getAlertClasses('warning') + ' mb-4'}>
                This event has expired — no more responses are being accepted.
              </div>
            )}

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

            {/* ── Slot poll list ────────────────────────────────────── */}
            {detail.slots.length === 0 ? (
              <div className={getAlertClasses('info')}>
                No options have been added to this poll yet.
              </div>
            ) : (
              <div className="space-y-3">
                {detail.slots.map((slot: AvailabilitySlot) => {
                  const isChosen =
                    detail.event.status === 'concluded' &&
                    detail.concludedSlot != null &&
                    detail.concludedSlot.slotId === slot.slotId;
                  const counts = slotCounts(slot.slotId, detail.allResponses, pendingResponses);
                  const totalResponded = counts.yes + counts.maybe + counts.no;
                  const accepting = isEventAcceptingResponses();
                  const myR = pendingResponses[slot.slotId] as AvailabilityResponse | undefined;

                  return (
                    <div
                      key={slot.slotId}
                      className={
                        'bg-white rounded-lg border p-4 ' +
                        (isChosen ? 'border-green-400' : 'border-gray-200')
                      }
                    >
                      {/* Slot label */}
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-medium text-gray-900">{getSlotLabel(slot)}</span>
                        {isChosen && (
                          <span className={getBadgeClasses('success', 'sm')}>Chosen</span>
                        )}
                      </div>

                      {/* Response buttons (if open) or read-only badge */}
                      {accepting ? (
                        <div className="flex gap-2 mb-3">
                          <button
                            onClick={() => setResponse(slot.slotId, 'yes')}
                            className={
                              'flex-1 py-2 text-sm rounded-md font-medium border transition-colors ' +
                              (myR === 'yes'
                                ? 'bg-green-500 text-white border-green-500'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-green-50')
                            }
                          >
                            ✓ Yes
                          </button>
                          <button
                            onClick={() => setResponse(slot.slotId, 'maybe')}
                            className={
                              'flex-1 py-2 text-sm rounded-md font-medium border transition-colors ' +
                              (myR === 'maybe'
                                ? 'bg-yellow-400 text-white border-yellow-400'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-yellow-50')
                            }
                          >
                            ? Maybe
                          </button>
                          <button
                            onClick={() => setResponse(slot.slotId, 'no')}
                            className={
                              'flex-1 py-2 text-sm rounded-md font-medium border transition-colors ' +
                              (myR === 'no'
                                ? 'bg-red-500 text-white border-red-500'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-red-50')
                            }
                          >
                            ✗ No
                          </button>
                        </div>
                      ) : myR ? (
                        <div className="mb-3 text-sm text-gray-700">
                          Your response:{' '}
                          <span className={responseBadgeClass(myR)}>{responseLabel(myR)}</span>
                        </div>
                      ) : null}

                      {/* Summary counts + view responses link */}
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex gap-4">
                          <span className="text-green-700 font-medium">✓ {counts.yes}</span>
                          <span className="text-yellow-700 font-medium">? {counts.maybe}</span>
                          <span className="text-red-700 font-medium">✗ {counts.no}</span>
                        </div>
                        {totalResponded > 0 && (
                          <button
                            onClick={() => setModalSlotId(slot.slotId)}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            View responses
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Save button ───────────────────────────────────────── */}
            {isEventAcceptingResponses() && (
              <div className="mt-6">
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

      {/* ── Responses modal ───────────────────────────────────────── */}
      {modalSlotId && detail && modalSlot && (
        <div
          className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4"
          onClick={() => setModalSlotId(null)}
        >
          <div
            className="bg-white rounded-t-xl sm:rounded-xl shadow-xl w-full max-w-sm max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">{getSlotLabel(modalSlot)}</h3>
              <button
                onClick={() => setModalSlotId(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-1"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
              {/* Current user row */}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-gray-900">You</span>
                <span className={responseBadgeClass(pendingResponses[modalSlotId] as AvailabilityResponse | undefined)}>
                  {responseLabel(pendingResponses[modalSlotId] as AvailabilityResponse | undefined)}
                </span>
              </div>
              {/* Other respondents */}
              {detail.allResponses.map((p: AvailabilityParticipantResponses) => (
                <div key={p.displayName} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-gray-900">{p.displayName}</span>
                  <span className={responseBadgeClass(p.responses[modalSlotId])}>
                    {responseLabel(p.responses[modalSlotId])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
