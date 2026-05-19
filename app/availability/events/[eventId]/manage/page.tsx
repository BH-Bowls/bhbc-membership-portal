// app/availability/events/[eventId]/manage/page.tsx
// Management page for an availability event — response grid, status controls, slots, invitees

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { useSessionRefresh } from '@/hooks/useSessionRefresh';
import {
  getButtonClasses,
  getInputClasses,
  getBadgeClasses,
  getAlertClasses,
} from '@/config/theme-helpers';
import type {
  AvailabilityManageDetail,
  AvailabilitySlot,
  AvailabilityParticipantResponses,
  AvailabilityResponse,
  AvailabilityInvitee,
  AvailabilityEventType,
} from '@/types/availability';

// Format ISO datetime for slot header display (date line)
function fmtSlotDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Format ISO datetime for slot header display (time line)
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

// Format a date for the expiry field
function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Format a date as YYYY-MM-DD for date input default value
function toDateInputValue(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().substring(0, 10);
}

// Response badge styling
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

// Badge variant for event status
function statusBadgeVariant(status: string): 'success' | 'warning' | 'primary' | 'secondary' {
  if (status === 'open') return 'success';
  if (status === 'closed') return 'warning';
  if (status === 'concluded') return 'primary';
  return 'secondary';
}

// Badge variant for event type
function typeBadgeVariant(type: string): 'primary' | 'secondary' | 'warning' {
  if (type === 'fixture') return 'warning';
  if (type === 'signup') return 'secondary';
  return 'primary';
}

function cap(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Build ISO datetime from date input (YYYY-MM-DD) and optional time (HH:MM)
function buildSlotDatetime(date: string, time: string): string {
  if (!date) return '';
  const t = time ? time : '12:00';
  return new Date(`${date}T${t}:00`).toISOString();
}

export default function ManageEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { data: session } = useSession();
  useSessionRefresh();
  const router = useRouter();

  // Resolve eventId from async params
  const [eventId, setEventId] = useState('');
  React.useEffect(() => {
    params.then((p) => setEventId(p.eventId));
  }, [params]);

  // Manage page data from the API
  const [detail, setDetail] = useState<AvailabilityManageDetail | null>(null);
  // Whether initial data is loading
  const [loading, setLoading] = useState(true);
  // Whether the user is not the creator/admin (403)
  const [forbidden, setForbidden] = useState(false);
  // General error message
  const [error, setError] = useState<string | null>(null);
  // Success toast
  const [toast, setToast] = useState<string | null>(null);

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Whether the edit event panel is shown
  const [showEditPanel, setShowEditPanel] = useState(false);
  // Edit form fields
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editType, setEditType] = useState<AvailabilityEventType>('general');
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [editShowResponses, setEditShowResponses] = useState(true);
  const [editNotify, setEditNotify] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Status action state
  const [statusActioning, setStatusActioning] = useState(false);

  // Whether the conclude panel is shown
  const [showConcludePanel, setShowConcludePanel] = useState(false);
  // Conclude form state
  const [concludeSlotId, setConcludeSlotId] = useState('');
  const [concludeNote, setConcludeNote] = useState('');
  const [concludeNotify, setConcludeNotify] = useState(false);
  const [concluding, setConcluding] = useState(false);
  const [concludeError, setConcludeError] = useState<string | null>(null);

  // Archive confirmation state
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Add slot form state
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [newSlotDate, setNewSlotDate] = useState('');
  const [newSlotTime, setNewSlotTime] = useState('');
  const [newSlotLabel, setNewSlotLabel] = useState('');
  const [addSlotError, setAddSlotError] = useState<string | null>(null);
  const [addSlotSaving, setAddSlotSaving] = useState(false);

  // Which slot is being deleted (to show spinner on that button)
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);

  const currentUserName = session && session.user ? session.user.userName : '';
  const currentUserRole = session && session.user ? session.user.role : '';

  // Load manage detail when eventId is resolved
  useEffect(() => {
    if (!eventId) return;
    fetchDetail(eventId);
  }, [eventId]);

  // Fetch the manage detail from the API
  async function fetchDetail(eid: string) {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch(`/api/availability/events/${eid}/manage`);
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.status === 404) {
        setError('Event not found.');
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to load event');
      }
      const data: AvailabilityManageDetail = await res.json();
      setDetail(data);
    } catch (err) {
      setError('Failed to load event. Please refresh.');
      console.error('[ManageEventPage] fetchDetail error:', err);
    } finally {
      setLoading(false);
    }
  }

  // Open the edit panel and populate fields
  function openEditPanel() {
    if (!detail) return;
    setEditTitle(detail.event.title);
    setEditDescription(detail.event.description);
    setEditType(detail.event.type);
    setEditExpiresAt(toDateInputValue(detail.event.expiresAt));
    setEditShowResponses(detail.event.showResponsesToRespondents);
    setEditNotify(detail.event.notifyCreatorOnResponse);
    setEditError(null);
    setShowEditPanel(true);
  }

  // Save event edits
  async function handleSaveEdit() {
    if (!eventId) return;
    setEditError(null);
    if (!editTitle.trim()) {
      setEditError('Title is required.');
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/availability/events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim(),
          type: editType,
          expiresAt: new Date(editExpiresAt).toISOString(),
          showResponsesToRespondents: editShowResponses,
          notifyCreatorOnResponse: editNotify,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setEditError(d.error || 'Failed to save changes.');
        return;
      }
      setShowEditPanel(false);
      setToast('Event updated.');
      await fetchDetail(eventId);
    } catch (err) {
      console.error('[ManageEventPage] handleSaveEdit error:', err);
      setEditError('An unexpected error occurred.');
    } finally {
      setEditSaving(false);
    }
  }

  // Change event status (open → closed or closed → open)
  async function handleStatusChange(newStatus: string) {
    if (!eventId) return;
    setStatusActioning(true);
    try {
      let res;
      if (newStatus === 'open') {
        // Use the reopen endpoint
        res = await fetch(`/api/availability/events/${eventId}/reopen`, {
          method: 'POST',
        });
      } else {
        // Update status directly
        res = await fetch(`/api/availability/events/${eventId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
      }
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to update event status.');
        return;
      }
      setToast(`Event ${newStatus === 'open' ? 're-opened' : 'closed'}.`);
      await fetchDetail(eventId);
    } catch (err) {
      console.error('[ManageEventPage] handleStatusChange error:', err);
      setError('Failed to update event status.');
    } finally {
      setStatusActioning(false);
    }
  }

  // Conclude the event with the selected slot
  async function handleConclude() {
    if (!eventId) return;
    setConcludeError(null);
    if (!concludeSlotId) {
      setConcludeError('Please select the winning slot.');
      return;
    }
    setConcluding(true);
    try {
      const res = await fetch(`/api/availability/events/${eventId}/conclude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concludedSlotId: concludeSlotId,
          conclusionNote: concludeNote.trim(),
          notifyRespondents: concludeNotify,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setConcludeError(d.error || 'Failed to conclude event.');
        return;
      }
      setShowConcludePanel(false);
      setToast('Event concluded.');
      await fetchDetail(eventId);
    } catch (err) {
      console.error('[ManageEventPage] handleConclude error:', err);
      setConcludeError('An unexpected error occurred.');
    } finally {
      setConcluding(false);
    }
  }

  // Archive the event
  async function handleArchive() {
    if (!eventId) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/availability/events/${eventId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to archive event.');
        return;
      }
      // Navigate back after archiving
      if (detail && detail.event.groupId) {
        router.push(`/availability/groups/${detail.event.groupId}`);
      } else {
        router.push('/availability');
      }
    } catch (err) {
      console.error('[ManageEventPage] handleArchive error:', err);
      setError('Failed to archive event.');
    } finally {
      setArchiving(false);
      setShowArchiveConfirm(false);
    }
  }

  // Add a new slot to the event
  async function handleAddSlot() {
    if (!eventId) return;
    setAddSlotError(null);
    if (!newSlotDate) {
      setAddSlotError('Please select a date.');
      return;
    }
    setAddSlotSaving(true);
    try {
      const slotDatetime = buildSlotDatetime(newSlotDate, newSlotTime);
      const res = await fetch(`/api/availability/events/${eventId}/slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotDatetime,
          slotLabel: newSlotLabel.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setAddSlotError(d.error || 'Failed to add slot.');
        return;
      }
      setNewSlotDate('');
      setNewSlotTime('');
      setNewSlotLabel('');
      setShowAddSlot(false);
      setToast('Slot added.');
      await fetchDetail(eventId);
    } catch (err) {
      console.error('[ManageEventPage] handleAddSlot error:', err);
      setAddSlotError('An unexpected error occurred.');
    } finally {
      setAddSlotSaving(false);
    }
  }

  // Delete a slot (cascades to its responses)
  async function handleDeleteSlot(slotId: string) {
    if (!eventId) return;
    // Confirm before deleting because responses will be lost
    if (!window.confirm('Removing this slot will also permanently delete all responses to it. Continue?')) return;
    setDeletingSlotId(slotId);
    try {
      const res = await fetch(`/api/availability/events/${eventId}/slots/${slotId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to delete slot.');
        return;
      }
      setToast('Slot removed.');
      await fetchDetail(eventId);
    } catch (err) {
      console.error('[ManageEventPage] handleDeleteSlot error:', err);
      setError('Failed to delete slot.');
    } finally {
      setDeletingSlotId(null);
    }
  }

  const displayName = session && session.user && session.user.name ? session.user.name : undefined;
  const role = session && session.user ? session.user.role : '';

  // Back link: group page for group events, hub for public events
  const backHref = detail && detail.event.groupId
    ? `/availability/groups/${detail.event.groupId}`
    : '/availability';
  const backLabel = detail && detail.event.groupId ? 'Group' : 'Availability';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">

        {/* Toast */}
        {toast && (
          <div className={getAlertClasses('success') + ' mb-4'}>
            {toast}
          </div>
        )}

        {/* 403 Forbidden */}
        {forbidden && (
          <div className={getAlertClasses('danger') + ' mt-4'}>
            You do not have permission to manage this event.
          </div>
        )}

        {/* Error */}
        {error && (
          <div className={getAlertClasses('danger') + ' mb-4'}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !forbidden && (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-700">Loading event…</p>
          </div>
        )}

        {/* Main content */}
        {!loading && !forbidden && detail && (
          <>
            {/* ── Header ────────────────────────────────────────────── */}
            <div className="mb-4">
              <RouterBackLink fallbackHref={backHref} label={backLabel} />

              {/* Title and badges */}
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-gray-900">{detail.event.title}</h1>
                <span className={getBadgeClasses(typeBadgeVariant(detail.event.type))}>
                  {cap(detail.event.type)}
                </span>
                <span className={getBadgeClasses(statusBadgeVariant(detail.event.status))}>
                  {cap(detail.event.status)}
                </span>
              </div>

              {/* Metadata */}
              <p className="text-xs text-gray-700 mb-3">
                Expires {fmtDate(detail.event.expiresAt)}
              </p>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={openEditPanel}
                  className={getButtonClasses('secondary', 'sm')}
                >
                  Edit Event
                </button>
                <Link
                  href={`/availability/events/${eventId}`}
                  className={getButtonClasses('secondary', 'sm')}
                >
                  View as Member
                </Link>
              </div>
            </div>

            {/* ── Edit event panel ────────────────────────────────── */}
            {showEditPanel && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Edit Event</h2>
                {editError && (
                  <div className={getAlertClasses('danger') + ' mb-3 text-sm'}>{editError}</div>
                )}
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className={getInputClasses(false)} maxLength={200} />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className={getInputClasses(false)} rows={2} maxLength={500} />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
                  <div className="flex gap-2">
                    {(['general', 'fixture', 'signup'] as AvailabilityEventType[]).map((t) => (
                      <button key={t} type="button" onClick={() => setEditType(t)}
                        className={editType === t ? getButtonClasses('primary', 'sm') : getButtonClasses('secondary', 'sm')}>
                        {cap(t)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expires On</label>
                  <input type="date" value={editExpiresAt} onChange={(e) => setEditExpiresAt(e.target.value)} className={getInputClasses(false)} />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Show responses to respondents</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditShowResponses(true)} className={editShowResponses ? getButtonClasses('primary', 'sm') : getButtonClasses('secondary', 'sm')}>Yes</button>
                    <button type="button" onClick={() => setEditShowResponses(false)} className={!editShowResponses ? getButtonClasses('primary', 'sm') : getButtonClasses('secondary', 'sm')}>No</button>
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notify me when someone responds</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditNotify(true)} className={editNotify ? getButtonClasses('primary', 'sm') : getButtonClasses('secondary', 'sm')}>Yes</button>
                    <button type="button" onClick={() => setEditNotify(false)} className={!editNotify ? getButtonClasses('primary', 'sm') : getButtonClasses('secondary', 'sm')}>No</button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSaveEdit} disabled={editSaving} className={getButtonClasses('primary', 'sm')}>
                    {editSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={() => setShowEditPanel(false)} className={getButtonClasses('secondary', 'sm')}>Cancel</button>
                </div>
              </div>
            )}

            {/* ── Status controls ──────────────────────────────────── */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
              <h2 className="text-sm font-medium text-gray-700 mb-2">Event Status</h2>
              <div className="flex flex-wrap gap-2">
                {/* Open: allow closing */}
                {detail.event.status === 'open' && (
                  <button
                    onClick={() => handleStatusChange('closed')}
                    disabled={statusActioning}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    {statusActioning ? 'Updating…' : 'Close Event'}
                  </button>
                )}

                {/* Closed: allow reopening or concluding */}
                {detail.event.status === 'closed' && (
                  <>
                    <button
                      onClick={() => handleStatusChange('open')}
                      disabled={statusActioning}
                      className={getButtonClasses('secondary', 'sm')}
                    >
                      {statusActioning ? 'Updating…' : 'Reopen'}
                    </button>
                    <button
                      onClick={() => { setConcludeSlotId(''); setConcludeNote(''); setConcludeNotify(false); setConcludeError(null); setShowConcludePanel(true); }}
                      className={getButtonClasses('primary', 'sm')}
                    >
                      Conclude Event
                    </button>
                  </>
                )}

                {/* Concluded: allow reopening */}
                {detail.event.status === 'concluded' && (
                  <button
                    onClick={() => handleStatusChange('open')}
                    disabled={statusActioning}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    {statusActioning ? 'Updating…' : 'Reopen'}
                  </button>
                )}

                {/* Archive — always available (for non-archived events) */}
                {detail.event.status !== 'archived' && (
                  <button
                    onClick={() => setShowArchiveConfirm(true)}
                    className={getButtonClasses('danger', 'sm')}
                  >
                    Archive Event
                  </button>
                )}
              </div>
            </div>

            {/* ── Archive confirmation ──────────────────────────────── */}
            {showArchiveConfirm && (
              <div className={getAlertClasses('warning') + ' mb-4'}>
                <p className="font-medium text-gray-900 mb-1">Archive this event?</p>
                <p className="text-sm text-gray-700 mb-3">Archiving removes the event from all views.</p>
                <div className="flex gap-2">
                  <button onClick={handleArchive} disabled={archiving} className={getButtonClasses('danger', 'sm')}>
                    {archiving ? 'Archiving…' : 'Confirm Archive'}
                  </button>
                  <button onClick={() => setShowArchiveConfirm(false)} className={getButtonClasses('secondary', 'sm')}>Cancel</button>
                </div>
              </div>
            )}

            {/* ── Conclude panel ────────────────────────────────────── */}
            {showConcludePanel && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Conclude Event</h2>
                {concludeError && (
                  <div className={getAlertClasses('danger') + ' mb-3 text-sm'}>{concludeError}</div>
                )}
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Choose the winning slot <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={concludeSlotId}
                    onChange={(e) => setConcludeSlotId(e.target.value)}
                    className={getInputClasses(false)}
                  >
                    <option value="">— Select a slot —</option>
                    {detail.slots.map((slot: AvailabilitySlot) => (
                      <option key={slot.slotId} value={slot.slotId}>
                        {slot.slotLabel || fmtSlotDate(slot.slotDatetime) + (fmtSlotTime(slot.slotDatetime) ? ' ' + fmtSlotTime(slot.slotDatetime) : '')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Conclusion note (optional)
                  </label>
                  <textarea
                    value={concludeNote}
                    onChange={(e) => setConcludeNote(e.target.value)}
                    className={getInputClasses(false)}
                    rows={2}
                    placeholder="e.g. See you there!"
                    maxLength={500}
                  />
                </div>
                <div className="mb-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={concludeNotify}
                      onChange={(e) => setConcludeNotify(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    Send notification email to all respondents
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleConclude} disabled={concluding} className={getButtonClasses('primary', 'sm')}>
                    {concluding ? 'Concluding…' : 'Confirm Conclusion'}
                  </button>
                  <button onClick={() => setShowConcludePanel(false)} className={getButtonClasses('secondary', 'sm')}>Cancel</button>
                </div>
              </div>
            )}

            {/* ── Response grid ─────────────────────────────────────── */}
            <div className="mb-6">
              <h2 className="text-base font-semibold text-gray-900 mb-2">Responses</h2>
              {detail.slots.length === 0 ? (
                <p className="text-sm text-gray-700">No slots added yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200 min-w-[120px]">
                          Name
                        </th>
                        {detail.slots.map((slot: AvailabilitySlot) => (
                          <th
                            key={slot.slotId}
                            className={
                              'px-3 py-2 text-center text-xs font-medium text-gray-700 border-b border-gray-200 min-w-[90px] ' +
                              (detail.event.status === 'concluded' &&
                                detail.event.concludedSlotId === slot.slotId
                                ? 'bg-green-50'
                                : 'bg-gray-50')
                            }
                          >
                            {slot.slotLabel || (
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
                      {/* All respondents — read-only for manager */}
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
                                  detail.event.concludedSlotId === slot.slotId
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

                      {/* Empty state */}
                      {detail.allResponses.length === 0 && (
                        <tr>
                          <td colSpan={detail.slots.length + 1} className="px-3 py-4 text-sm text-gray-700 text-center">
                            No responses yet.
                          </td>
                        </tr>
                      )}

                      {/* Summary row: Yes/Maybe/No counts */}
                      <tr className="bg-gray-50">
                        <td className="sticky left-0 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 border-t border-gray-200">
                          Summary
                        </td>
                        {detail.slots.map((slot: AvailabilitySlot) => {
                          // Find pre-calculated summary for this slot
                          let yesCount = 0;
                          let maybeCount = 0;
                          let noCount = 0;
                          for (let i = 0; i < detail.responseSummary.length; i++) {
                            if (detail.responseSummary[i].slotId === slot.slotId) {
                              yesCount = detail.responseSummary[i].yesCount;
                              maybeCount = detail.responseSummary[i].maybeCount;
                              noCount = detail.responseSummary[i].noCount;
                              break;
                            }
                          }
                          return (
                            <td key={slot.slotId} className="px-2 py-2 text-center border-t border-gray-200">
                              <div className="flex flex-col gap-0.5 items-center text-xs">
                                {yesCount > 0 && <span className="text-green-700 font-medium">{yesCount}✓</span>}
                                {maybeCount > 0 && <span className="text-yellow-700 font-medium">{maybeCount}?</span>}
                                {noCount > 0 && <span className="text-red-700 font-medium">{noCount}✗</span>}
                                {yesCount === 0 && maybeCount === 0 && noCount === 0 && (
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
            </div>

            {/* ── Slots section ─────────────────────────────────────── */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">Slots</h2>
                {/* Only allow adding slots when event is open */}
                {detail.event.status === 'open' && (
                  <button
                    onClick={() => { setAddSlotError(null); setShowAddSlot(!showAddSlot); }}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    + Add Slot
                  </button>
                )}
              </div>

              {/* Add slot form */}
              {showAddSlot && (
                <div className="mb-4 border border-gray-100 rounded p-3 bg-gray-50">
                  {addSlotError && (
                    <p className="text-xs text-red-600 mb-2">{addSlotError}</p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Date *</label>
                      <input type="date" value={newSlotDate} onChange={(e) => setNewSlotDate(e.target.value)} className={getInputClasses(false)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Time (optional)</label>
                      <input type="time" value={newSlotTime} onChange={(e) => setNewSlotTime(e.target.value)} className={getInputClasses(false)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Label (optional)</label>
                      <input type="text" value={newSlotLabel} onChange={(e) => setNewSlotLabel(e.target.value)} className={getInputClasses(false)} placeholder="Label override" maxLength={100} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleAddSlot} disabled={addSlotSaving} className={getButtonClasses('primary', 'sm')}>
                      {addSlotSaving ? 'Adding…' : 'Add Slot'}
                    </button>
                    <button onClick={() => setShowAddSlot(false)} className={getButtonClasses('secondary', 'sm')}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Current slots list */}
              {detail.slots.length === 0 ? (
                <p className="text-sm text-gray-700">No slots yet.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.slots.map((slot: AvailabilitySlot) => (
                    <li key={slot.slotId} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                      <span className="text-sm text-gray-900">
                        {slot.slotLabel || (fmtSlotDate(slot.slotDatetime) + (fmtSlotTime(slot.slotDatetime) ? ' ' + fmtSlotTime(slot.slotDatetime) : ''))}
                      </span>
                      {/* Remove slot — only when event is open */}
                      {detail.event.status === 'open' && (
                        <button
                          onClick={() => handleDeleteSlot(slot.slotId)}
                          disabled={deletingSlotId === slot.slotId}
                          className="text-xs text-red-600 hover:text-red-800 font-medium ml-3"
                        >
                          {deletingSlotId === slot.slotId ? 'Removing…' : '✕ Remove'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── Invitees section (group events only) ─────────────── */}
            {detail.event.groupId && detail.invitees.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Invitees</h2>
                <p className="text-xs text-gray-700 mb-3">
                  To invite more people, add them to the group.{' '}
                  <Link
                    href={`/availability/groups/${detail.event.groupId}`}
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Go to group →
                  </Link>
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-gray-900">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Name</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Type</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Notified</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Responded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {detail.invitees.map((inv: AvailabilityInvitee) => {
                        // Check if this invitee has any responses in the detail
                        let hasResponded = false;
                        for (let i = 0; i < detail.allResponses.length; i++) {
                          const p = detail.allResponses[i];
                          if (inv.inviteeType === 'member') {
                            // Check by display name (resolved from userName)
                            const resolvedName = detail.inviteeDisplayNames[inv.userName] || inv.userName;
                            if (p.displayName === resolvedName) {
                              hasResponded = true;
                              break;
                            }
                          } else {
                            // Visitor: check by visitor name
                            if (p.displayName === inv.visitorName) {
                              hasResponded = true;
                              break;
                            }
                          }
                        }
                        const displayInveeName = inv.inviteeType === 'member'
                          ? (detail.inviteeDisplayNames[inv.userName] || inv.userName)
                          : inv.visitorName;
                        return (
                          <tr key={inv.inviteeId} className="hover:bg-gray-50">
                            <td className="px-3 py-2">{displayInveeName}</td>
                            <td className="px-3 py-2">
                              <span className={getBadgeClasses(inv.inviteeType === 'visitor' ? 'secondary' : 'primary', 'sm')}>
                                {cap(inv.inviteeType)}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {inv.notifiedAt ? (
                                <span className="text-green-700 text-xs">✓ {fmtDate(inv.notifiedAt)}</span>
                              ) : (
                                <span className="text-gray-500 text-xs">Pending</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {hasResponded ? (
                                <span className="text-green-700 text-xs">✓ Yes</span>
                              ) : (
                                <span className="text-gray-500 text-xs">No</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
