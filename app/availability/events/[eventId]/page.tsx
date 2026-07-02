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
  AvailabilityInvitee,
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

// UTC date key YYYY-MM-DD for grouping slots by date in the matrix
function slotDateKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// UTC time HH:MM for grouping slots by time column in the matrix
function slotTimeKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
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

interface RosterParticipant {
  key: string;
  displayName: string;
  responses: Record<string, AvailabilityResponse>;
}

// Merge the group roster with responders so the responses modal lists non-responders
// too (shown as "—" for the slot). Excludes the caller, who is rendered as the "You" row.
// For non-group polls (no roster), this is just the responders — unchanged behaviour.
function buildRosterParticipants(
  detail: AvailabilityEventDetail,
  callerUserName: string
): RosterParticipant[] {
  const rows: RosterParticipant[] = [];
  const memberResp: Record<string, Record<string, AvailabilityResponse>> = {};
  const visitorResp: Record<string, Record<string, AvailabilityResponse>> = {};
  for (let i = 0; i < detail.allResponses.length; i++) {
    const p = detail.allResponses[i];
    if (p.respondentType === 'member' && p.userName) memberResp[p.userName] = p.responses;
    else if (p.respondentType === 'visitor') visitorResp[p.displayName] = p.responses;
  }

  // Roster members (including non-responders), caller excluded
  const seenMembers: Record<string, boolean> = {};
  for (let i = 0; i < detail.invitees.length; i++) {
    const inv = detail.invitees[i];
    if (inv.inviteeType === 'member' && inv.userName && inv.userName !== callerUserName) {
      if (seenMembers[inv.userName]) continue;
      seenMembers[inv.userName] = true;
      const dn = detail.inviteeDisplayNames[inv.userName] || inv.userName;
      rows.push({ key: 'm:' + inv.userName, displayName: dn, responses: memberResp[inv.userName] || {} });
    }
  }
  // Member respondents not in the roster (e.g. left the group since replying)
  for (let i = 0; i < detail.allResponses.length; i++) {
    const p = detail.allResponses[i];
    if (p.respondentType === 'member' && p.userName && p.userName !== callerUserName && !seenMembers[p.userName]) {
      seenMembers[p.userName] = true;
      rows.push({ key: 'm:' + p.userName, displayName: p.displayName, responses: p.responses });
    }
  }
  // Visitors (roster + any extra respondents)
  const seenVisitors: Record<string, boolean> = {};
  for (let i = 0; i < detail.invitees.length; i++) {
    const inv = detail.invitees[i];
    if (inv.inviteeType === 'visitor') {
      const dn = inv.visitorName || inv.visitorEmail || 'Guest';
      if (seenVisitors[dn]) continue;
      seenVisitors[dn] = true;
      rows.push({ key: 'v:' + (inv.inviteeId || dn), displayName: dn, responses: visitorResp[dn] || {} });
    }
  }
  for (let i = 0; i < detail.allResponses.length; i++) {
    const p = detail.allResponses[i];
    if (p.respondentType === 'visitor' && !seenVisitors[p.displayName]) {
      seenVisitors[p.displayName] = true;
      rows.push({ key: 'v:' + p.displayName, displayName: p.displayName, responses: p.responses });
    }
  }
  return rows;
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

  // Clear a pending response (remove the slot from the map). On save, slots that were
  // previously saved but are now absent are sent as 'none' to delete the stored response.
  function clearResponse(slotId: string) {
    setPendingResponses(prev => {
      const next = { ...prev };
      delete next[slotId];
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
      const responsesPayload: Array<{ slotId: string; response: AvailabilityResponse | 'none' }> = [];
      const slotIds = Object.keys(pendingResponses);
      for (let i = 0; i < slotIds.length; i++) {
        responsesPayload.push({ slotId: slotIds[i], response: pendingResponses[slotIds[i]] });
      }
      // Slots that were saved before but have since been cleared → send 'none' to delete them
      const originalSlotIds = Object.keys(detail.myResponses);
      for (let i = 0; i < originalSlotIds.length; i++) {
        const sid = originalSlotIds[i];
        if (pendingResponses[sid] === undefined) {
          responsesPayload.push({ slotId: sid, response: 'none' });
        }
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

            {/* ── Slot list or matrix ───────────────────────────────── */}
            {detail.slots.length === 0 ? (
              <div className={getAlertClasses('info')}>
                No options have been added to this poll yet.
              </div>
            ) : detail.event.matchFinder && detail.event.slotType === 'datetime' ? (
              // Matrix view for match-finder events: rows = dates, columns = times
              <MatchMatrix
                slots={detail.slots}
                pendingResponses={pendingResponses}
                allResponses={detail.allResponses}
                accepting={isEventAcceptingResponses()}
                concludedSlotId={detail.event.concludedSlotId}
                onSetResponse={setResponse}
                onClearResponse={clearResponse}
                onViewSlot={setModalSlotId}
                eventId={eventId}
                canManage={detail.canManageGroup === true}
                callerUserName={currentUserName}
                invitees={detail.invitees}
                inviteeDisplayNames={detail.inviteeDisplayNames}
                onSaveSelf={handleSave}
                savingSelf={saving}
                onProxySaved={() => fetchDetail(eventId)}
              />
            ) : detail.event.groupId ? (
              // Group events: full roster grid (every member, including non-responders).
              // Editable for the caller's own row; group managers can edit everyone.
              <RosterGrid
                detail={detail}
                callerUserName={currentUserName}
                accepting={isEventAcceptingResponses()}
                onSaved={() => fetchDetail(eventId)}
              />
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
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-medium text-gray-900">{getSlotLabel(slot)}</span>
                        {isChosen && (
                          <span className={getBadgeClasses('success', 'sm')}>Chosen</span>
                        )}
                      </div>

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

            {/* ── Save button (flat-list polls only). Group events use RosterGrid and
                 match-finders use MatchMatrix — both render their own save buttons. ── */}
            {isEventAcceptingResponses() && !detail.event.groupId && !detail.event.matchFinder && (
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

      {/* ── Match matrix (fixture events) ────────────────────────── */}
      {/* rendered inline above via MatchMatrix component */}

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
              {/* Everyone else in the roster — non-responders included, shown as "—" */}
              {buildRosterParticipants(detail, currentUserName).map((p) => (
                <div key={p.key} className="flex items-center justify-between px-4 py-3">
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

// ── MatchMatrix ────────────────────────────────────────────────────────────────
// Matrix UI for fixture-type events: rows = unique dates, columns = unique times

interface MatchMatrixProps {
  slots: AvailabilitySlot[];
  pendingResponses: Record<string, AvailabilityResponse>;
  allResponses: AvailabilityParticipantResponses[];
  accepting: boolean;
  concludedSlotId: string;
  onSetResponse: (slotId: string, r: AvailabilityResponse) => void;
  onClearResponse: (slotId: string) => void;
  onViewSlot: (slotId: string) => void;
  // Self-save (caller's own responses) — handled by the parent
  eventId: string;
  onSaveSelf: () => void;
  savingSelf: boolean;
  // Manager proxy editing
  canManage: boolean;
  callerUserName: string;
  invitees: AvailabilityInvitee[];
  inviteeDisplayNames: Record<string, string>;
  onProxySaved: () => void;
}

function MatchMatrix({
  slots,
  pendingResponses,
  allResponses,
  accepting,
  concludedSlotId,
  onSetResponse,
  onClearResponse,
  onViewSlot,
  eventId,
  onSaveSelf,
  savingSelf,
  canManage,
  callerUserName,
  invitees,
  inviteeDisplayNames,
  onProxySaved,
}: MatchMatrixProps) {
  // Manager proxy editing — whose availability is being entered ('' = the caller).
  const [respondingAs, setRespondingAs] = useState<string>('');
  const [proxyEdits, setProxyEdits] = useState<Record<string, AvailabilityResponse>>({});
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);

  // True when editing someone other than the caller
  const isProxy = respondingAs !== '' && respondingAs !== callerUserName;

  // Build the list of members a manager can respond for (from the invitee roster)
  const memberOptions: Array<{ userName: string; displayName: string }> = [];
  const seenOpt: Record<string, boolean> = {};
  for (let i = 0; i < invitees.length; i++) {
    const inv = invitees[i];
    if (inv.inviteeType === 'member' && inv.userName && !seenOpt[inv.userName]) {
      seenOpt[inv.userName] = true;
      const dn = inv.userName === callerUserName ? 'You' : (inviteeDisplayNames[inv.userName] || inv.userName);
      memberOptions.push({ userName: inv.userName, displayName: dn });
    }
  }

  // Switch the proxy target, seeding the edit buffer from that member's saved responses
  function selectRespondingAs(userName: string) {
    setProxyError(null);
    if (userName === '' || userName === callerUserName) {
      setRespondingAs('');
      setProxyEdits({});
      return;
    }
    setRespondingAs(userName);
    const seed: Record<string, AvailabilityResponse> = {};
    for (let i = 0; i < allResponses.length; i++) {
      const p = allResponses[i];
      if (p.respondentType === 'member' && p.userName === userName) {
        const slotIds = Object.keys(p.responses);
        for (let j = 0; j < slotIds.length; j++) {
          seed[slotIds[j]] = p.responses[slotIds[j]];
        }
        break;
      }
    }
    setProxyEdits(seed);
  }

  // The response currently shown for a cell (caller's pending, or the proxied member's)
  function currentResponse(slotId: string): AvailabilityResponse | undefined {
    if (isProxy) return proxyEdits[slotId];
    return pendingResponses[slotId];
  }

  // Cycle a cell. Caller edits go through the parent; proxy edits stay local until saved.
  function cycleCell(slotId: string, cur: AvailabilityResponse | undefined) {
    if (isProxy) {
      setProxyEdits((prev) => {
        const next = { ...prev };
        if (cur === undefined) next[slotId] = 'yes';
        else if (cur === 'yes') next[slotId] = 'maybe';
        else if (cur === 'maybe') next[slotId] = 'no';
        else delete next[slotId];
        return next;
      });
      return;
    }
    if (cur === undefined) onSetResponse(slotId, 'yes');
    else if (cur === 'yes') onSetResponse(slotId, 'maybe');
    else if (cur === 'maybe') onSetResponse(slotId, 'no');
    else onClearResponse(slotId);
  }

  // Save the proxied member's responses via the respond API (onBehalfOf). Every slot is
  // sent — set to its value, or 'none' to clear — so the member's row matches the grid.
  async function saveProxy() {
    setProxySaving(true);
    setProxyError(null);
    try {
      const responses: Array<{ slotId: string; response: AvailabilityResponse | 'none' }> = [];
      for (let i = 0; i < slots.length; i++) {
        const sid = slots[i].slotId;
        const v = proxyEdits[sid];
        responses.push({ slotId: sid, response: v ? v : 'none' });
      }
      const res = await fetch(`/api/availability/events/${eventId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses, onBehalfOf: respondingAs }),
      });
      if (!res.ok) {
        const d = await res.json();
        setProxyError(d.error || 'Failed to save responses.');
        return;
      }
      // Reset to the caller and let the parent refetch fresh data
      setRespondingAs('');
      setProxyEdits({});
      onProxySaved();
    } catch {
      setProxyError('An unexpected error occurred. Please try again.');
    } finally {
      setProxySaving(false);
    }
  }
  // Derive unique sorted dates and times from the slot list
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
    if (dk && tk) {
      slotMap[dk + '|' + tk] = slots[i];
    }
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
      {/* Manager proxy selector — enter availability for a member who replied another way */}
      {accepting && canManage && memberOptions.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-gray-700">Responding as:</label>
          <select
            value={respondingAs === '' ? callerUserName : respondingAs}
            onChange={(e) => selectRespondingAs(e.target.value)}
            className="rounded-md border border-gray-300 text-sm text-gray-900 px-2 py-1 shadow-sm"
          >
            {memberOptions.map((m) => (
              <option key={m.userName} value={m.userName}>{m.displayName}</option>
            ))}
          </select>
          {isProxy && (
            <span className={getBadgeClasses('warning', 'sm')}>Editing on their behalf</span>
          )}
        </div>
      )}

      <p className="text-xs text-gray-700 mb-3">
        Tap each cell to cycle Yes → Maybe → No → clear.
      </p>
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
                    // Cell shows the caller's response, or the proxied member's when a
                    // manager is responding on someone else's behalf.
                    const myR = currentResponse(slot.slotId);
                    const isChosen = slot.slotId === concludedSlotId;
                    const counts = slotCounts(slot.slotId, allResponses, pendingResponses);
                    return (
                      <td key={tk} className="py-1">
                        <div className={'rounded border ' + (isChosen ? 'ring-2 ring-green-400' : '')}>
                          {accepting ? (
                            <button
                              type="button"
                              onClick={() => cycleCell(slot.slotId, myR)}
                              className={'w-full h-10 rounded text-sm font-bold border transition-colors ' + cellClass(myR)}
                              title={`${formatSlotDate(slot.slotDatetime)} — tap to cycle Yes / Maybe / No / clear`}
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

      {/* Save controls — match-finders own their save button (the parent's is hidden) */}
      {accepting && (
        <div className="mt-4">
          {proxyError && (
            <div className={getAlertClasses('danger') + ' mb-3 text-sm'}>{proxyError}</div>
          )}
          {isProxy ? (
            <button
              type="button"
              onClick={saveProxy}
              disabled={proxySaving}
              className={getButtonClasses('primary', 'md')}
            >
              {proxySaving ? 'Saving…' : 'Save their responses'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onSaveSelf}
              disabled={savingSelf}
              className={getButtonClasses('primary', 'md')}
            >
              {savingSelf ? 'Saving…' : 'Save My Responses'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── RosterGrid ─────────────────────────────────────────────────────────────────
// Full roster grid for GROUP events: rows = every group member (from the invitee
// roster, including non-responders) + any visitor respondents; columns = slots.
// The caller's own row is always editable; group managers can edit every member row.

interface RosterGridProps {
  detail: AvailabilityEventDetail;
  callerUserName: string;
  accepting: boolean;
  onSaved: () => void;
}

interface RosterMemberRow {
  userName: string;
  displayName: string;
  editable: boolean;
  isSelf: boolean;
}

interface RosterVisitorRow {
  key: string;
  displayName: string;
  responses: Record<string, AvailabilityResponse>;
}

function rosterCellClass(r: AvailabilityResponse | undefined, editable: boolean): string {
  let base = 'w-full h-8 rounded text-xs font-bold border flex items-center justify-center ';
  if (r === 'yes') base += 'bg-green-500 text-white border-green-500';
  else if (r === 'maybe') base += 'bg-yellow-400 text-white border-yellow-400';
  else if (r === 'no') base += 'bg-red-100 text-red-700 border-red-300';
  else base += 'bg-gray-50 text-gray-700 border-gray-200';
  if (editable) base += ' hover:opacity-80 transition-opacity cursor-pointer';
  return base;
}

function rosterCellLabel(r: AvailabilityResponse | undefined): string {
  if (r === 'yes') return '✓';
  if (r === 'maybe') return '?';
  if (r === 'no') return '✗';
  return '—';
}

function RosterGrid({ detail, callerUserName, accepting, onSaved }: RosterGridProps) {
  const slots = detail.slots;
  const canManage = detail.canManageGroup === true;

  // Original (saved) responses keyed by member userName
  const originalByUser = React.useMemo(() => {
    const map: Record<string, Record<string, AvailabilityResponse>> = {};
    map[callerUserName] = { ...detail.myResponses };
    for (let i = 0; i < detail.allResponses.length; i++) {
      const p = detail.allResponses[i];
      if (p.respondentType === 'member' && p.userName) {
        map[p.userName] = { ...p.responses };
      }
    }
    return map;
  }, [detail, callerUserName]);

  // Member rows: caller first, then invitee members, then any extra member respondents
  const memberRows = React.useMemo(() => {
    const seen: Record<string, boolean> = {};
    const rows: RosterMemberRow[] = [];
    const add = (userName: string, displayName: string, isSelf: boolean) => {
      if (!userName || seen[userName]) return;
      seen[userName] = true;
      const editable = accepting && (isSelf || canManage);
      rows.push({ userName, displayName, editable, isSelf });
    };
    add(callerUserName, 'You', true);
    for (let i = 0; i < detail.invitees.length; i++) {
      const inv = detail.invitees[i];
      if (inv.inviteeType === 'member' && inv.userName) {
        const dn = detail.inviteeDisplayNames[inv.userName] || inv.userName;
        add(inv.userName, dn, inv.userName === callerUserName);
      }
    }
    for (let i = 0; i < detail.allResponses.length; i++) {
      const p = detail.allResponses[i];
      if (p.respondentType === 'member' && p.userName) {
        add(p.userName, p.displayName, p.userName === callerUserName);
      }
    }
    return rows;
  }, [detail, callerUserName, accepting, canManage]);

  // Visitor rows (read-only) — shown so the roster is complete
  const visitorRows = React.useMemo(() => {
    const rows: RosterVisitorRow[] = [];
    const seen: Record<string, boolean> = {};
    const respByName: Record<string, Record<string, AvailabilityResponse>> = {};
    for (let i = 0; i < detail.allResponses.length; i++) {
      const p = detail.allResponses[i];
      if (p.respondentType === 'visitor') respByName[p.displayName] = p.responses;
    }
    for (let i = 0; i < detail.invitees.length; i++) {
      const inv = detail.invitees[i];
      if (inv.inviteeType === 'visitor') {
        const dn = inv.visitorName || inv.visitorEmail || 'Guest';
        if (seen[dn]) continue;
        seen[dn] = true;
        rows.push({ key: inv.inviteeId, displayName: dn, responses: respByName[dn] || {} });
      }
    }
    for (let i = 0; i < detail.allResponses.length; i++) {
      const p = detail.allResponses[i];
      if (p.respondentType === 'visitor' && !seen[p.displayName]) {
        seen[p.displayName] = true;
        rows.push({ key: 'r:' + p.displayName, displayName: p.displayName, responses: p.responses });
      }
    }
    return rows;
  }, [detail]);

  const [edits, setEdits] = useState<Record<string, Record<string, AvailabilityResponse | 'none'>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function effective(userName: string, slotId: string): AvailabilityResponse | undefined {
    const ue = edits[userName];
    if (ue && ue[slotId] !== undefined) {
      const v = ue[slotId];
      return v === 'none' ? undefined : v;
    }
    const orig = originalByUser[userName];
    if (orig && orig[slotId] !== undefined) return orig[slotId];
    return undefined;
  }

  function cycle(userName: string, slotId: string) {
    const cur = effective(userName, slotId);
    let next: AvailabilityResponse | 'none';
    if (cur === undefined) next = 'yes';
    else if (cur === 'yes') next = 'maybe';
    else if (cur === 'maybe') next = 'no';
    else next = 'none';
    setEdits((prev) => {
      const copy = { ...prev };
      const row = { ...(copy[userName] || {}) };
      row[slotId] = next;
      copy[userName] = row;
      return copy;
    });
    setSuccess(false);
  }

  // Per-slot tallies using the live (edited) values for members + saved values for visitors
  function slotTally(slotId: string): { yes: number; maybe: number; no: number; none: number } {
    let yes = 0; let maybe = 0; let no = 0; let none = 0;
    for (let i = 0; i < memberRows.length; i++) {
      const r = effective(memberRows[i].userName, slotId);
      if (r === 'yes') yes += 1;
      else if (r === 'maybe') maybe += 1;
      else if (r === 'no') no += 1;
      else none += 1;
    }
    for (let i = 0; i < visitorRows.length; i++) {
      const r = visitorRows[i].responses[slotId];
      if (r === 'yes') yes += 1;
      else if (r === 'maybe') maybe += 1;
      else if (r === 'no') no += 1;
      else none += 1;
    }
    return { yes, maybe, no, none };
  }

  function isDirty(): boolean {
    const userNames = Object.keys(edits);
    for (let i = 0; i < userNames.length; i++) {
      if (Object.keys(edits[userNames[i]]).length > 0) return true;
    }
    return false;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const userNames = Object.keys(edits);
      for (let i = 0; i < userNames.length; i++) {
        const un = userNames[i];
        const row = edits[un];
        const slotIds = Object.keys(row);
        if (slotIds.length === 0) continue;
        const responses: Array<{ slotId: string; response: AvailabilityResponse | 'none' }> = [];
        for (let j = 0; j < slotIds.length; j++) {
          responses.push({ slotId: slotIds[j], response: row[slotIds[j]] });
        }
        const body: { responses: typeof responses; onBehalfOf?: string } = { responses };
        if (un !== callerUserName) body.onBehalfOf = un;
        const res = await fetch(`/api/availability/events/${detail.event.eventId}/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const d = await res.json();
          setError(d.error || 'Failed to save responses.');
          return;
        }
      }
      setSuccess(true);
      setEdits({});
      onSaved();
    } catch (err) {
      console.error('[RosterGrid] handleSave error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const concludedSlotId = detail.event.concludedSlotId;
  const respondedCount = memberRows.filter((m) => {
    for (let i = 0; i < slots.length; i++) {
      if (effective(m.userName, slots[i].slotId) !== undefined) return true;
    }
    return false;
  }).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-xs text-gray-700">
          {respondedCount} of {memberRows.length} responded.
          {accepting ? ' Tap a cell to cycle Yes → Maybe → No → clear.' : ''}
          {accepting && canManage ? ' You can edit any member’s row.' : ''}
        </p>
      </div>

      {error && (
        <div className={getAlertClasses('danger') + ' mb-3 text-sm'}>{error}</div>
      )}
      {success && (
        <div className={getAlertClasses('success') + ' mb-3 text-sm'}>Responses saved.</div>
      )}

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200 min-w-[120px]">
                Member
              </th>
              {slots.map((slot: AvailabilitySlot) => (
                <th
                  key={slot.slotId}
                  className={
                    'px-2 py-2 text-center text-xs font-medium text-gray-700 border-b border-gray-200 min-w-[72px] ' +
                    (concludedSlotId === slot.slotId ? 'bg-green-50' : 'bg-gray-50')
                  }
                >
                  {getSlotLabel(slot)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {memberRows.map((m) => (
              <tr key={m.userName} className={m.isSelf ? 'bg-blue-50/40' : ''}>
                <td className={'sticky left-0 z-10 px-3 py-1.5 text-sm border-b border-gray-100 ' + (m.isSelf ? 'bg-blue-50 font-medium text-gray-900' : 'bg-white text-gray-900')}>
                  {m.displayName}
                </td>
                {slots.map((slot: AvailabilitySlot) => {
                  const r = effective(m.userName, slot.slotId);
                  return (
                    <td key={slot.slotId} className="px-1 py-1 border-b border-gray-100 text-center">
                      {m.editable ? (
                        <button
                          type="button"
                          onClick={() => cycle(m.userName, slot.slotId)}
                          className={rosterCellClass(r, true)}
                        >
                          {rosterCellLabel(r)}
                        </button>
                      ) : (
                        <div className={rosterCellClass(r, false)}>{rosterCellLabel(r)}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            {visitorRows.map((v) => (
              <tr key={v.key}>
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-sm text-gray-700 border-b border-gray-100">
                  {v.displayName} <span className="text-xs text-gray-700">(guest)</span>
                </td>
                {slots.map((slot: AvailabilitySlot) => (
                  <td key={slot.slotId} className="px-1 py-1 border-b border-gray-100 text-center">
                    <div className={rosterCellClass(v.responses[slot.slotId], false)}>
                      {rosterCellLabel(v.responses[slot.slotId])}
                    </div>
                  </td>
                ))}
              </tr>
            ))}

            {/* Summary row */}
            <tr className="bg-gray-50">
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 border-t border-gray-200">
                Summary
              </td>
              {slots.map((slot: AvailabilitySlot) => {
                const t = slotTally(slot.slotId);
                return (
                  <td key={slot.slotId} className="px-1 py-2 text-center border-t border-gray-200">
                    <div className="flex flex-col items-center gap-0.5 text-xs">
                      <span className="text-green-700 font-medium">{t.yes}✓</span>
                      {t.maybe > 0 && <span className="text-yellow-700 font-medium">{t.maybe}?</span>}
                      {t.no > 0 && <span className="text-red-700 font-medium">{t.no}✗</span>}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {accepting && (
        <div className="mt-4">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty()}
            className={getButtonClasses('primary', 'md')}
          >
            {saving ? 'Saving…' : 'Save Responses'}
          </button>
        </div>
      )}
    </div>
  );
}
