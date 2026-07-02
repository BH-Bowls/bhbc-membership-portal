// app/availability/guest/[eventId]/page.tsx
// Visitor response page — no auth required. Token from URL query param.

'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getBadgeClasses, getButtonClasses, getAlertClasses } from '@/config/theme-helpers';
import type {
  AvailabilityEvent,
  AvailabilitySlot,
  AvailabilityParticipantResponses,
  AvailabilityResponse,
} from '@/types/availability';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSlotDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtSlotTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (h === 0 && m === 0) return '';
  if (h === 12 && m === 0) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// UTC date key YYYY-MM-DD for grouping slots by date (matrix rows)
function slotDateKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// UTC time HH:MM for grouping slots by time (matrix columns)
function slotTimeKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function typeBadgeVariant(type: string): 'primary' | 'secondary' | 'warning' {
  if (type === 'fixture') return 'warning';
  if (type === 'signup') return 'secondary';
  return 'primary';
}

function cap(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getSlotLabel(slot: AvailabilitySlot): string {
  if (slot.slotLabel) return slot.slotLabel;
  const date = fmtSlotDate(slot.slotDatetime);
  const time = fmtSlotTime(slot.slotDatetime);
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

// ── GuestPageInner ─────────────────────────────────────────────────────────────

interface GuestPageInnerProps {
  eventId: string;
}

function GuestPageInner({ eventId }: GuestPageInnerProps) {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [event, setEvent] = useState<AvailabilityEvent | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [visitorName, setVisitorName] = useState('');
  const [allResponses, setAllResponses] = useState<AvailabilityParticipantResponses[]>([]);
  const [concludedSlot, setConcludedSlot] = useState<AvailabilitySlot | null>(null);

  const [loading, setLoading] = useState(true);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [pendingResponses, setPendingResponses] = useState<Record<string, AvailabilityResponse>>({});
  // Snapshot of saved responses, so cleared slots can be sent as 'none' on save
  const [originalResponses, setOriginalResponses] = useState<Record<string, AvailabilityResponse>>({});

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [honeypot, setHoneypot] = useState('');

  // Slot ID currently shown in the responses modal (null = closed)
  const [modalSlotId, setModalSlotId] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    if (!token) { setLoading(false); return; }
    fetchGuestData(eventId, token);
  }, [eventId, token]);

  async function fetchGuestData(eid: string, tok: string) {
    setLoading(true);
    setFetchError(null);
    setTokenInvalid(false);
    try {
      const res = await fetch(`/api/availability/guest/${eid}?token=${encodeURIComponent(tok)}`);
      if (res.status === 401 || res.status === 404) { setTokenInvalid(true); return; }
      if (!res.ok) throw new Error('Failed to load event');
      const data = await res.json();
      setEvent(data.event);
      setSlots(data.slots);
      setVisitorName(data.invitee ? data.invitee.visitorName : '');
      setAllResponses(data.allResponses || []);
      setConcludedSlot(data.concludedSlot || null);
      setPendingResponses(data.myResponses || {});
      setOriginalResponses(data.myResponses || {});
    } catch (err) {
      setFetchError('Failed to load event. Please try again or check the link from your email.');
      console.error('[GuestPage] fetchGuestData error:', err);
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

  // Clear a pending response (used by the matrix tap-to-cycle). Slots that were saved
  // before and are now absent are sent as 'none' on save to delete the stored response.
  function clearResponse(slotId: string) {
    setPendingResponses(prev => {
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
  }

  function isAcceptingResponses(): boolean {
    if (!event) return false;
    if (event.status !== 'open') return false;
    if (new Date(event.expiresAt) <= new Date()) return false;
    return true;
  }

  async function handleSave() {
    if (!eventId || !token) return;
    if (honeypot) { setSaveSuccess(true); return; }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const responsesPayload: Array<{ slotId: string; response: AvailabilityResponse | 'none' }> = [];
      const slotIds = Object.keys(pendingResponses);
      for (let i = 0; i < slotIds.length; i++) {
        responsesPayload.push({ slotId: slotIds[i], response: pendingResponses[slotIds[i]] });
      }
      // Slots saved before but since cleared → send 'none' to delete them
      const originalSlotIds = Object.keys(originalResponses);
      for (let i = 0; i < originalSlotIds.length; i++) {
        const sid = originalSlotIds[i];
        if (pendingResponses[sid] === undefined) {
          responsesPayload.push({ slotId: sid, response: 'none' });
        }
      }
      const res = await fetch(`/api/availability/guest/${eventId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, responses: responsesPayload }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || 'Failed to save responses.'); return; }
      setSaveSuccess(true);
      await fetchGuestData(eventId, token);
    } catch (err) {
      console.error('[GuestPage] handleSave error:', err);
      setSaveError('An unexpected error occurred. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!token) {
    return (
      <div className={getAlertClasses('danger') + ' mt-6 mx-auto max-w-md'}>
        This link appears to be incomplete. Please check the email you received and try again.
      </div>
    );
  }

  if (tokenInvalid) {
    return (
      <div className={getAlertClasses('warning') + ' mt-6 mx-auto max-w-md'}>
        This link is no longer valid or has expired.
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className={getAlertClasses('danger') + ' mt-6 mx-auto max-w-md'}>
        {fetchError}
      </div>
    );
  }

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
  const modalSlot = modalSlotId ? (slots.find(s => s.slotId === modalSlotId) ?? null) : null;
  const myDisplayName = visitorName || 'You';

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 text-gray-900">

      {/* Visitor greeting */}
      {visitorName && (
        <p className="text-lg text-gray-700 mb-4">Hello, <strong>{visitorName}</strong></p>
      )}

      {/* Event title and type badge */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
        <span className={getBadgeClasses(typeBadgeVariant(event.type))}>
          {cap(event.type)}
        </span>
      </div>

      {event.description && (
        <p className="text-sm text-gray-700 mb-2">{event.description}</p>
      )}

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

      {saveSuccess && (
        <div className={getAlertClasses('success') + ' mb-4'}>
          Your responses have been saved. You can update them any time using this link.
        </div>
      )}

      {saveError && (
        <div className={getAlertClasses('danger') + ' mb-4'}>
          {saveError}
        </div>
      )}

      {/* ── Slot poll: compact matrix (match-finder) or flat list ─── */}
      {slots.length === 0 ? (
        <div className={getAlertClasses('info')}>
          No date slots have been added to this event yet.
        </div>
      ) : event.matchFinder && event.slotType === 'datetime' ? (
        <div className="mb-6">
          <GuestMatrix
            slots={slots}
            pendingResponses={pendingResponses}
            allResponses={allResponses}
            readOnly={readOnly}
            concludedSlotId={event.concludedSlotId}
            onSetResponse={setResponse}
            onClearResponse={clearResponse}
            onViewSlot={setModalSlotId}
          />
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {slots.map((slot) => {
            const isChosen =
              event.status === 'concluded' &&
              concludedSlot != null &&
              concludedSlot.slotId === slot.slotId;
            const counts = slotCounts(slot.slotId, allResponses, pendingResponses);
            const totalResponded = counts.yes + counts.maybe + counts.no;
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
                {!readOnly ? (
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

      {/* Save button */}
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

      {/* ── Responses modal ───────────────────────────────────────── */}
      {modalSlotId && modalSlot && (
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
              {/* Visitor's own row */}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-gray-900">{myDisplayName}</span>
                <span className={responseBadgeClass(pendingResponses[modalSlotId] as AvailabilityResponse | undefined)}>
                  {responseLabel(pendingResponses[modalSlotId] as AvailabilityResponse | undefined)}
                </span>
              </div>
              {/* Other respondents */}
              {allResponses.map((p) => (
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

// ── GuestMatrix ────────────────────────────────────────────────────────────────
// Compact date×time grid for match-finder polls (rows = dates, columns = times),
// mirroring the logged-in MatchMatrix but for a single respondent (the guest).
// Tap a cell to cycle Yes → Maybe → No → clear.

interface GuestMatrixProps {
  slots: AvailabilitySlot[];
  pendingResponses: Record<string, AvailabilityResponse>;
  allResponses: AvailabilityParticipantResponses[];
  readOnly: boolean;
  concludedSlotId: string;
  onSetResponse: (slotId: string, r: AvailabilityResponse) => void;
  onClearResponse: (slotId: string) => void;
  onViewSlot: (slotId: string) => void;
}

function GuestMatrix({
  slots,
  pendingResponses,
  allResponses,
  readOnly,
  concludedSlotId,
  onSetResponse,
  onClearResponse,
  onViewSlot,
}: GuestMatrixProps) {
  // Derive unique sorted dates (rows) and times (columns) from the slot list
  const dateKeys: string[] = [];
  const timeKeys: string[] = [];
  const seenDates = new Set<string>();
  const seenTimes = new Set<string>();
  for (let i = 0; i < slots.length; i++) {
    const dk = slotDateKey(slots[i].slotDatetime);
    const tk = slotTimeKey(slots[i].slotDatetime);
    if (dk && !seenDates.has(dk)) { seenDates.add(dk); dateKeys.push(dk); }
    if (tk && !seenTimes.has(tk)) { seenTimes.add(tk); timeKeys.push(tk); }
  }
  dateKeys.sort();
  timeKeys.sort();

  // slotMap: dateKey + '|' + timeKey → AvailabilitySlot
  const slotMap: Record<string, AvailabilitySlot> = {};
  for (let i = 0; i < slots.length; i++) {
    const dk = slotDateKey(slots[i].slotDatetime);
    const tk = slotTimeKey(slots[i].slotDatetime);
    if (dk && tk) slotMap[dk + '|' + tk] = slots[i];
  }

  function cycleCell(slotId: string, cur: AvailabilityResponse | undefined) {
    if (cur === undefined) onSetResponse(slotId, 'yes');
    else if (cur === 'yes') onSetResponse(slotId, 'maybe');
    else if (cur === 'maybe') onSetResponse(slotId, 'no');
    else onClearResponse(slotId);
  }

  function cellClass(myR: AvailabilityResponse | undefined): string {
    if (myR === 'yes') return 'bg-green-500 text-white border-green-500';
    if (myR === 'maybe') return 'bg-yellow-400 text-white border-yellow-400';
    if (myR === 'no') return 'bg-red-100 text-red-700 border-red-200';
    return 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50';
  }

  function cellLabel(myR: AvailabilityResponse | undefined): string {
    if (myR === 'yes') return '✓';
    if (myR === 'maybe') return '?';
    if (myR === 'no') return '✗';
    return '—';
  }

  return (
    <div>
      {!readOnly && (
        <p className="text-xs text-gray-700 mb-3">
          Tap each cell to cycle Yes → Maybe → No → clear.
        </p>
      )}
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="min-w-full border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-gray-700 pb-1 pr-2 min-w-[80px]">Date</th>
              {timeKeys.map((tk) => {
                const h = parseInt(tk.split(':')[0], 10);
                const suffix = h < 12 ? 'am' : 'pm';
                const h12 = h > 12 ? h - 12 : h;
                const label = `${h12}:${tk.split(':')[1]} ${suffix}`;
                return (
                  <th key={tk} className="text-center text-xs font-medium text-gray-700 pb-1 min-w-[72px]">
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {dateKeys.map((dk) => {
              const d = new Date(dk + 'T12:00:00Z');
              const dateLabel = d.toLocaleDateString('en-GB', {
                weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
              });
              return (
                <tr key={dk}>
                  <td className="text-xs text-gray-900 font-medium pr-2 py-1 whitespace-nowrap">{dateLabel}</td>
                  {timeKeys.map((tk) => {
                    const slot = slotMap[dk + '|' + tk];
                    if (!slot) {
                      return <td key={tk} className="py-1"><div className="h-10 rounded bg-gray-50 border border-gray-100" /></td>;
                    }
                    const myR = pendingResponses[slot.slotId] as AvailabilityResponse | undefined;
                    const isChosen = slot.slotId === concludedSlotId;
                    const counts = slotCounts(slot.slotId, allResponses, pendingResponses);
                    return (
                      <td key={tk} className="py-1">
                        <div className={'rounded border ' + (isChosen ? 'ring-2 ring-green-400' : '')}>
                          {!readOnly ? (
                            <button
                              type="button"
                              onClick={() => cycleCell(slot.slotId, myR)}
                              className={'w-full h-10 rounded text-sm font-bold border transition-colors ' + cellClass(myR)}
                              title={`${fmtSlotDate(slot.slotDatetime)} — tap to cycle Yes / Maybe / No / clear`}
                            >
                              {cellLabel(myR)}
                            </button>
                          ) : (
                            <div className={'w-full h-10 rounded text-sm font-bold border flex items-center justify-center ' + cellClass(myR)}>
                              {cellLabel(myR)}
                            </div>
                          )}
                          <div className="flex justify-center gap-1 pt-0.5 pb-0.5">
                            <span className="text-green-700 text-xs font-medium">{counts.yes}</span>
                            <span className="text-yellow-700 text-xs">/</span>
                            <span className="text-yellow-700 text-xs font-medium">{counts.maybe}</span>
                          </div>
                          {(counts.yes + counts.maybe + counts.no) > 0 && (
                            <div className="flex justify-center pb-0.5">
                              <button
                                type="button"
                                onClick={() => onViewSlot(slot.slotId)}
                                className="text-blue-600 text-xs hover:underline"
                              >
                                detail
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── GuestPageWrapper ───────────────────────────────────────────────────────────

export default function GuestEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { status } = useSession();
  const router = useRouter();
  const [eventId, setEventId] = React.useState('');
  React.useEffect(() => {
    params.then((p) => setEventId(p.eventId));
  }, [params]);

  // Mirror the friendlies token flow: a logged-in member who follows a poll link
  // is sent to the full response page (normal navbar, free to navigate the app)
  // rather than the stripped token view. Guests stay on this token page and get a
  // Log in button on the navbar via isTokenMode.
  const isLoggedIn = status === 'authenticated';
  React.useEffect(() => {
    if (isLoggedIn && eventId) {
      router.replace(`/availability/events/${eventId}`);
    }
  }, [isLoggedIn, eventId, router]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar showLogoOnly isTokenMode />

      {isLoggedIn ? (
        <div className="text-center py-16">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-3 text-gray-700">Loading…</p>
        </div>
      ) : (
        <Suspense fallback={
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-700">Loading…</p>
          </div>
        }>
          {eventId && <GuestPageInner eventId={eventId} />}
        </Suspense>
      )}
    </div>
  );
}
