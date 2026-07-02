// app/availability/events/[eventId]/manage/page.tsx
// Management page for an availability event — response grid, status controls, slots, invitees

'use client';

import React, { useEffect, useRef, useState } from 'react';
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
function fmtSlotDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Format ISO datetime for slot header display (time line)
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

// A row in the manage response grid — one per roster member/visitor, including those
// who have not responded (their responses map is empty → every cell renders "—").
interface ManageRow {
  key: string;
  displayName: string;
  responses: Record<string, AvailabilityResponse>;
}

// Merge the group roster (invitees) with the responders so the grid shows non-responders
// too. For non-group polls (no roster) this is just the responders — unchanged behaviour.
function buildManageRows(detail: AvailabilityManageDetail): ManageRow[] {
  const rows: ManageRow[] = [];
  const memberResp: Record<string, Record<string, AvailabilityResponse>> = {};
  const visitorResp: Record<string, Record<string, AvailabilityResponse>> = {};
  for (let i = 0; i < detail.allResponses.length; i++) {
    const p = detail.allResponses[i];
    if (p.respondentType === 'member' && p.userName) memberResp[p.userName] = p.responses;
    else if (p.respondentType === 'visitor') visitorResp[p.displayName] = p.responses;
  }

  // Roster members first (including non-responders)
  const seenMembers: Record<string, boolean> = {};
  for (let i = 0; i < detail.invitees.length; i++) {
    const inv = detail.invitees[i];
    if (inv.inviteeType === 'member' && inv.userName) {
      if (seenMembers[inv.userName]) continue;
      seenMembers[inv.userName] = true;
      const dn = detail.inviteeDisplayNames[inv.userName] || inv.userName;
      rows.push({ key: 'm:' + inv.userName, displayName: dn, responses: memberResp[inv.userName] || {} });
    }
  }
  // Member respondents not in the roster (e.g. left the group since replying)
  for (let i = 0; i < detail.allResponses.length; i++) {
    const p = detail.allResponses[i];
    if (p.respondentType === 'member' && p.userName && !seenMembers[p.userName]) {
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

// Build ISO datetime from date input (YYYY-MM-DD) and optional time (HH:MM)
function buildSlotDatetime(date: string, time: string): string {
  if (!date) return '';
  const t = time ? time : '12:00';
  // Parse the typed wall-clock time as UTC ('Z') so it round-trips unchanged —
  // slots are displayed/edited everywhere with UTC (getUTCHours / timeZone: 'UTC').
  return new Date(`${date}T${t}:00Z`).toISOString();
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

  // ── Editable slot drafts ──────────────────────────────────────────────────
  // Each draft is either an existing slot (slotId set) or a new ghost row (slotId null)
  interface SlotDraft {
    key: string;
    slotId: string | null;
    slotDatetime: string;   // ISO or ''
    slotLabel: string;
    displayDate: string;
    displayTime: string;
    isDirty: boolean;
  }

  const [slotDrafts, setSlotDrafts] = useState<SlotDraft[]>([]);
  const [slotsEdited, setSlotsEdited] = useState(false); // any change vs saved state
  const [savingSlots, setSavingSlots] = useState(false);
  const [slotSaveError, setSlotSaveError] = useState<string | null>(null);
  // Which slot is being deleted (to show spinner on that button)
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);

  // Republish / reminder state
  const [republishing, setRepublishing] = useState(false);
  const [republishResult, setRepublishResult] = useState<string | null>(null);
  const [republishTarget, setRepublishTarget] = useState<'nonresponders' | 'all' | 'selected'>('nonresponders');
  const [republishMessage, setRepublishMessage] = useState('');
  const [republishSelected, setRepublishSelected] = useState<Set<string>>(new Set());
  // True when the last republish actually sent at least one email (drives the banner colour)
  const [republishSent, setRepublishSent] = useState(false);

  const currentUserName = session && session.user ? session.user.userName : '';
  const currentUserRole = session && session.user ? session.user.role : '';

  // Load manage detail when eventId is resolved
  useEffect(() => {
    if (!eventId) return;
    fetchDetail(eventId);
  }, [eventId]);

  const draftKeyRef = useRef(0);
  function newDraftKey() { return String(++draftKeyRef.current); }
  function emptySlotDraft(): SlotDraft {
    return { key: newDraftKey(), slotId: null, slotDatetime: '', slotLabel: '', displayDate: '', displayTime: '', isDirty: false };
  }

  function slotsToSlotDrafts(slots: AvailabilitySlot[]): SlotDraft[] {
    const drafts: SlotDraft[] = slots.map((s) => {
      const dt = s.slotDatetime || '';
      let displayDate = '';
      let displayTime = '';
      if (dt) {
        const d = new Date(dt);
        if (!isNaN(d.getTime())) {
          displayDate = d.toISOString().substring(0, 10);
          const h = d.getUTCHours();
          const m = d.getUTCMinutes();
          if (!(h === 0 && m === 0) && !(h === 12 && m === 0)) {
            displayTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          }
        }
      }
      return { key: newDraftKey(), slotId: s.slotId, slotDatetime: dt, slotLabel: s.slotLabel, displayDate, displayTime, isDirty: false };
    });
    drafts.push(emptySlotDraft());
    return drafts;
  }

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
      setSlotDrafts(slotsToSlotDrafts(data.slots));
      setSlotsEdited(false);
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
      setToast('Poll updated.');
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
      setToast(`Poll ${newStatus === 'open' ? 're-opened' : 'closed'}.`);
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
      setToast('Poll concluded.');
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

  const pollSlotType = detail?.event?.slotType || 'datetime';

  function isDraftFilled(d: SlotDraft): boolean {
    if (pollSlotType === 'text') return d.slotLabel.trim().length > 0;
    return d.displayDate.length > 0;
  }

  function updateSlotDraft(key: string, patch: Partial<SlotDraft>) {
    setSlotDrafts((prev) => {
      const updated = prev.map((d) => d.key === key ? { ...d, ...patch, isDirty: true } : d);
      const last = updated[updated.length - 1];
      if (isDraftFilled(last)) return [...updated, emptySlotDraft()];
      return updated;
    });
    setSlotsEdited(true);
  }

  function handleDraftDateChange(key: string, displayDate: string) {
    setSlotDrafts((prev) => {
      const updated = prev.map((d) => {
        if (d.key !== key) return d;
        const dt = buildSlotDatetime(displayDate, d.displayTime);
        return { ...d, displayDate, slotDatetime: dt, isDirty: true };
      });
      const last = updated[updated.length - 1];
      if (isDraftFilled(last)) return [...updated, emptySlotDraft()];
      return updated;
    });
    setSlotsEdited(true);
  }

  function handleDraftTimeChange(key: string, displayTime: string) {
    setSlotDrafts((prev) => prev.map((d) => {
      if (d.key !== key) return d;
      return { ...d, displayTime, slotDatetime: buildSlotDatetime(d.displayDate, displayTime), isDirty: true };
    }));
    setSlotsEdited(true);
  }

  // Save all dirty drafts (new and edited)
  async function handleUpdateSlots() {
    if (!eventId || !detail) return;
    setSlotSaveError(null);
    setSavingSlots(true);
    try {
      const filledDrafts = slotDrafts.filter((d) => isDraftFilled(d));
      for (const d of filledDrafts) {
        if (!d.isDirty) continue;
        const body = {
          slotDatetime: pollSlotType === 'datetime' ? d.slotDatetime || null : null,
          slotLabel: d.slotLabel.trim(),
        };
        if (d.slotId) {
          // Update existing slot
          const res = await fetch(`/api/availability/events/${eventId}/slots/${d.slotId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const err = await res.json();
            setSlotSaveError(err.error || 'Failed to update option.');
            return;
          }
        } else {
          // New slot
          const res = await fetch(`/api/availability/events/${eventId}/slots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const err = await res.json();
            setSlotSaveError(err.error || 'Failed to add option.');
            return;
          }
        }
      }
      setToast('Options updated.');
      await fetchDetail(eventId);
    } catch (err) {
      console.error('[ManageEventPage] handleUpdateSlots error:', err);
      setSlotSaveError('An unexpected error occurred.');
    } finally {
      setSavingSlots(false);
    }
  }

  // Delete a slot (cascades to its responses)
  async function handleDeleteSlot(slotId: string) {
    if (!eventId) return;
    if (!window.confirm('Removing this option will also permanently delete all responses to it. Continue?')) return;
    setDeletingSlotId(slotId);
    try {
      const res = await fetch(`/api/availability/events/${eventId}/slots/${slotId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to remove option.');
        return;
      }
      setToast('Option removed.');
      await fetchDetail(eventId);
    } catch (err) {
      console.error('[ManageEventPage] handleDeleteSlot error:', err);
      setError('Failed to remove option.');
    } finally {
      setDeletingSlotId(null);
    }
  }

  // Toggle a member in the "choose recipients" list for republish
  function toggleRepublishSelected(userName: string) {
    setRepublishSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userName)) next.delete(userName); else next.add(userName);
      return next;
    });
  }

  // Republish / remind — re-send the poll email to the chosen recipients, with a message
  async function handleRepublish() {
    if (!eventId) return;
    setRepublishing(true);
    setRepublishResult(null);
    setRepublishSent(false);
    try {
      const res = await fetch(`/api/availability/events/${eventId}/nudge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: republishTarget,
          selectedUserNames: republishTarget === 'selected' ? Array.from(republishSelected) : [],
          message: republishMessage.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRepublishResult(data.error || 'Failed to send emails.');
      } else if (data.sentCount === 0) {
        setRepublishResult('No emails sent — none of the selected people have an email address on file.');
      } else {
        setRepublishResult(`Email sent to ${data.sentCount} ${data.sentCount === 1 ? 'person' : 'people'}.`);
        setRepublishSent(true);
      }
    } catch {
      setRepublishResult('An unexpected error occurred.');
    } finally {
      setRepublishing(false);
    }
  }

  const displayName = session && session.user && session.user.name ? session.user.name : undefined;
  const role = session && session.user ? session.user.role : '';

  // Back link: group page for group events, hub for public events
  const backHref = detail && detail.event.groupId
    ? `/availability/groups/${detail.event.groupId}`
    : '/availability';
  const backLabel = detail && detail.event.groupId ? 'Group' : 'Polls';

  // Neutral "unselected toggle" style — matches the create page. Unselected toggle buttons
  // must read as "no colour" (outline), not as the orange 'secondary' variant which looks red.
  const inactiveBtn = 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 rounded-md px-3 py-1.5 text-sm border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm';

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
            <p className="mt-3 text-gray-700">Loading poll…</p>
          </div>
        )}

        {/* Main content */}
        {!loading && !forbidden && detail && (
          <>
            {/* ── Header ────────────────────────────────────────────── */}
            <div className="mb-4">
              <a href={backHref} className="text-blue-600 hover:text-blue-800 mb-2 inline-block">
                ← {backLabel}
              </a>

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
                  Edit Poll
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
                <h2 className="text-base font-semibold text-gray-900 mb-3">Edit Poll</h2>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Poll Type</label>
                  <div className="flex gap-2">
                    {(['general', 'fixture', 'signup'] as AvailabilityEventType[]).map((t) => (
                      <button key={t} type="button" onClick={() => setEditType(t)}
                        className={editType === t ? getButtonClasses('primary', 'sm') : inactiveBtn}>
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
                    <button type="button" onClick={() => setEditShowResponses(true)} className={editShowResponses ? getButtonClasses('success', 'sm') : inactiveBtn}>Yes</button>
                    <button type="button" onClick={() => setEditShowResponses(false)} className={!editShowResponses ? getButtonClasses('danger', 'sm') : inactiveBtn}>No</button>
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notify me when someone responds</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditNotify(true)} className={editNotify ? getButtonClasses('success', 'sm') : inactiveBtn}>Yes</button>
                    <button type="button" onClick={() => setEditNotify(false)} className={!editNotify ? getButtonClasses('danger', 'sm') : inactiveBtn}>No</button>
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
              <h2 className="text-sm font-medium text-gray-700 mb-2">Poll Status</h2>
              <div className="flex flex-wrap gap-2">
                {/* Open: allow closing */}
                {detail.event.status === 'open' && (
                  <button
                    onClick={() => handleStatusChange('closed')}
                    disabled={statusActioning}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    {statusActioning ? 'Updating…' : 'Close Poll'}
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
                      Conclude Poll
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
                    Archive Poll
                  </button>
                )}
              </div>
            </div>

            {/* ── Archive confirmation ──────────────────────────────── */}
            {showArchiveConfirm && (
              <div className={getAlertClasses('warning') + ' mb-4'}>
                <p className="font-medium text-gray-900 mb-1">Archive this poll?</p>
                <p className="text-sm text-gray-700 mb-3">Archiving removes the poll from all views.</p>
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
                <h2 className="text-base font-semibold text-gray-900 mb-3">Conclude Poll</h2>
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
                    <option value="">— Select an option —</option>
                    {detail.slots.map((slot: AvailabilitySlot) => (
                      <option key={slot.slotId} value={slot.slotId}>
                        {slot.slotLabel || (slot.slotDatetime ? fmtSlotDate(slot.slotDatetime) + (fmtSlotTime(slot.slotDatetime) ? ' ' + fmtSlotTime(slot.slotDatetime) : '') : '')}
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
                            {slot.slotLabel || (slot.slotDatetime ? (
                              <span>
                                <span className="block">{fmtSlotDate(slot.slotDatetime)}</span>
                                {fmtSlotTime(slot.slotDatetime) && (
                                  <span className="block text-gray-700 font-normal">
                                    {fmtSlotTime(slot.slotDatetime)}
                                  </span>
                                )}
                              </span>
                            ) : '')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white text-gray-900">
                      {/* Every roster member (responders + non-responders) — read-only.
                          Non-responders show "—" across all slots. */}
                      {buildManageRows(detail).map((participant) => (
                        <tr key={participant.key} className="hover:bg-gray-50">
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
                      {buildManageRows(detail).length === 0 && (
                        <tr>
                          <td colSpan={detail.slots.length + 1} className="px-3 py-4 text-sm text-gray-700 text-center">
                            No members or responses yet.
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

            {/* ── Match Results (match-finder events only) ─────────── */}
            {detail.event.matchFinder && detail.slots.length > 0 && (
              <MatchResults
                eventId={eventId}
                slots={detail.slots}
                responseSummary={detail.responseSummary}
                title={detail.event.title}
                initialOffered={detail.event.offeredSlotIds || []}
              />
            )}

            {/* ── Options section ────────────────────────────────────── */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
              <h2 className="text-base font-semibold text-gray-900 mb-3">
                {pollSlotType === 'text' ? 'Options' : 'Date / Time Options'}
              </h2>

              {slotSaveError && (
                <p className="text-xs text-red-600 mb-2">{slotSaveError}</p>
              )}

              {detail.event.status === 'open' ? (
                <>
                  <div className="space-y-2 mb-3">
                    {slotDrafts.map((draft) => {
                      const isGhost = !isDraftFilled(draft);
                      return (
                        <div key={draft.key} className="flex items-start gap-2">
                          {pollSlotType === 'text' ? (
                            <input
                              type="text"
                              value={draft.slotLabel}
                              onChange={(e) => updateSlotDraft(draft.key, { slotLabel: e.target.value })}
                              className={getInputClasses(false) + ' flex-1'}
                              placeholder={isGhost ? 'Add an option…' : ''}
                              maxLength={200}
                            />
                          ) : (
                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <input
                                type="date"
                                value={draft.displayDate}
                                onChange={(e) => handleDraftDateChange(draft.key, e.target.value)}
                                className={getInputClasses(false)}
                              />
                              <input
                                type="time"
                                value={draft.displayTime}
                                onChange={(e) => handleDraftTimeChange(draft.key, e.target.value)}
                                className={getInputClasses(false)}
                              />
                            </div>
                          )}
                          {!isGhost && (
                            <button
                              onClick={() => draft.slotId ? handleDeleteSlot(draft.slotId) : setSlotDrafts((prev) => {
                                const f = prev.filter((d) => d.key !== draft.key);
                                const last = f[f.length - 1];
                                if (!last || isDraftFilled(last)) f.push(emptySlotDraft());
                                setSlotsEdited(true);
                                return f;
                              })}
                              disabled={!!deletingSlotId && deletingSlotId === draft.slotId}
                              className="mt-1 text-xs text-red-600 hover:text-red-800 font-medium shrink-0"
                            >
                              {deletingSlotId && deletingSlotId === draft.slotId ? 'Removing…' : '✕ Remove'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {slotsEdited && (
                    <button
                      onClick={handleUpdateSlots}
                      disabled={savingSlots}
                      className={getButtonClasses('primary', 'sm')}
                    >
                      {savingSlots ? 'Saving…' : 'Update Options'}
                    </button>
                  )}
                </>
              ) : (
                // Read-only slot list when event is not open
                detail.slots.length === 0 ? (
                  <p className="text-sm text-gray-700">No options yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.slots.map((slot: AvailabilitySlot) => (
                      <li key={slot.slotId} className="bg-gray-50 rounded px-3 py-2 text-sm text-gray-900">
                        {slot.slotLabel || (fmtSlotDate(slot.slotDatetime) + (fmtSlotTime(slot.slotDatetime) ? ' ' + fmtSlotTime(slot.slotDatetime) : ''))}
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>

            {/* ── Republish / remind ────────────────────────────────── */}
            {detail.event.groupId && detail.event.status === 'open' && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h2 className="text-base font-semibold text-gray-900 mb-1">Send a reminder</h2>
                <p className="text-xs text-gray-700 mb-3">
                  Re-send the poll email. Replies go to you, not the club address.
                </p>

                {republishResult && (
                  <div className={getAlertClasses(republishSent ? 'success' : 'warning') + ' mb-3 text-sm'}>
                    {republishResult}
                  </div>
                )}

                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Who to email</label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setRepublishTarget('nonresponders')}
                      className={republishTarget === 'nonresponders' ? getButtonClasses('primary', 'sm') : inactiveBtn}>
                      Non-responders
                    </button>
                    <button type="button" onClick={() => setRepublishTarget('all')}
                      className={republishTarget === 'all' ? getButtonClasses('primary', 'sm') : inactiveBtn}>
                      Everyone
                    </button>
                    <button type="button" onClick={() => setRepublishTarget('selected')}
                      className={republishTarget === 'selected' ? getButtonClasses('primary', 'sm') : inactiveBtn}>
                      Choose…
                    </button>
                  </div>
                </div>

                {republishTarget === 'selected' && (
                  <div className="mb-3 space-y-1 max-h-48 overflow-y-auto border border-gray-100 rounded p-2">
                    {detail.invitees
                      .filter((i: AvailabilityInvitee) => i.inviteeType === 'member' && i.userName !== '')
                      .map((i: AvailabilityInvitee) => {
                        const name = detail.inviteeDisplayNames[i.userName] || i.userName;
                        return (
                          <label key={i.userName} className="flex items-center gap-2 text-sm text-gray-900">
                            <input
                              type="checkbox"
                              checked={republishSelected.has(i.userName)}
                              onChange={() => toggleRepublishSelected(i.userName)}
                              className="rounded border-gray-300"
                            />
                            {name}
                          </label>
                        );
                      })}
                  </div>
                )}

                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Message <span className="text-gray-500">(optional)</span>
                  </label>
                  <textarea
                    value={republishMessage}
                    onChange={(e) => setRepublishMessage(e.target.value)}
                    className={getInputClasses(false)}
                    rows={2}
                    maxLength={800}
                    placeholder="Add a note to the email…"
                  />
                </div>

                <button
                  onClick={handleRepublish}
                  disabled={republishing}
                  className={getButtonClasses('secondary', 'sm')}
                >
                  {republishing ? 'Sending…' : 'Send email'}
                </button>
              </div>
            )}

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

// ── MatchResults ───────────────────────────────────────────────────────────────
// Ranked results panel for fixture-type events. Shows slots sorted by yes count,
// a select-3 toggle, and a copy-to-clipboard summary.

interface MatchResultsProps {
  eventId: string;
  slots: AvailabilitySlot[];
  responseSummary: Array<{ slotId: string; yesCount: number; maybeCount: number; noCount: number }>;
  title: string;
  initialOffered: string[];
}

function MatchResults({ eventId, slots, responseSummary, title, initialOffered }: MatchResultsProps) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set(initialOffered));
  const [copied, setCopied] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  // Snapshot of what is persisted, so we can show "unsaved changes" vs "saved"
  const [savedSel, setSavedSel] = React.useState<Set<string>>(new Set(initialOffered));

  // Build ranked list: merge slots with counts, sort by yes desc then yes+maybe desc
  interface RankedSlot {
    slot: AvailabilitySlot;
    yes: number;
    maybe: number;
    no: number;
  }

  const summaryMap: Record<string, { yesCount: number; maybeCount: number; noCount: number }> = {};
  for (let i = 0; i < responseSummary.length; i++) {
    summaryMap[responseSummary[i].slotId] = {
      yesCount: responseSummary[i].yesCount,
      maybeCount: responseSummary[i].maybeCount,
      noCount: responseSummary[i].noCount,
    };
  }

  const ranked: RankedSlot[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const counts = summaryMap[s.slotId] || { yesCount: 0, maybeCount: 0, noCount: 0 };
    ranked.push({ slot: s, yes: counts.yesCount, maybe: counts.maybeCount, no: counts.noCount });
  }

  // Sort: yes desc, then yes+maybe desc as tiebreak
  ranked.sort((a, b) => {
    if (b.yes !== a.yes) return b.yes - a.yes;
    return (b.yes + b.maybe) - (a.yes + a.maybe);
  });

  function toggleSelect(slotId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) {
        next.delete(slotId);
      } else {
        if (next.size >= 3) return prev;
        next.add(slotId);
      }
      return next;
    });
  }

  // Format slot as "Tue 8 Jul 10am" for the copy text
  function formatSlotForCopy(slot: AvailabilitySlot): string {
    if (slot.slotLabel) return slot.slotLabel;
    if (!slot.slotDatetime) return '';
    const d = new Date(slot.slotDatetime);
    if (isNaN(d.getTime())) return '';
    const datePart = d.toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });
    const h = d.getUTCHours();
    const suffix = h < 12 ? 'am' : 'pm';
    const h12 = h > 12 ? h - 12 : h;
    const timePart = `${h12}${suffix}`;
    return `${datePart} ${timePart}`;
  }

  function handleCopy() {
    const lines: string[] = [];
    for (let i = 0; i < ranked.length; i++) {
      if (selected.has(ranked[i].slot.slotId)) {
        lines.push(formatSlotForCopy(ranked[i].slot));
      }
    }
    const text = `${title} — we can offer:\n${lines.map((l, idx) => `${idx + 1}. ${l}`).join('\n')}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  // Persist the current selection so it survives navigation/refresh
  async function handleSaveSelection() {
    setSaving(true);
    setSaveError(null);
    try {
      const slotIds = Array.from(selected);
      const res = await fetch(`/api/availability/events/${eventId}/offered`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotIds }),
      });
      if (!res.ok) {
        const d = await res.json();
        setSaveError(d.error || 'Failed to save selection.');
        return;
      }
      setSavedSel(new Set(slotIds));
    } catch {
      setSaveError('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  }

  // Whether the current selection differs from what is persisted
  function selectionDirty(): boolean {
    if (selected.size !== savedSel.size) return true;
    let dirty = false;
    selected.forEach((id) => { if (!savedSel.has(id)) dirty = true; });
    return dirty;
  }

  const hasResponses = ranked.some((r) => r.yes + r.maybe + r.no > 0);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-gray-900">Match Results</h2>
      </div>

      {!hasResponses && (
        <p className="text-sm text-gray-700 mb-3">No responses yet — results will appear here as the squad replies.</p>
      )}

      <div className="space-y-2">
        {ranked.map((r, idx) => {
          const isSelected = selected.has(r.slot.slotId);
          const label = r.slot.slotLabel || formatSlotForCopy(r.slot);
          return (
            <div
              key={r.slot.slotId}
              className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3"
            >
              <span className="text-sm font-medium text-gray-500 w-4 shrink-0">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{label}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-green-700 text-xs font-medium">✓ {r.yes}</span>
                  <span className="text-yellow-700 text-xs font-medium">? {r.maybe}</span>
                  <span className="text-red-700 text-xs font-medium">✗ {r.no}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleSelect(r.slot.slotId)}
                disabled={!isSelected && selected.size >= 3}
                className={
                  'shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-bold transition-colors ' +
                  (isSelected
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : selected.size >= 3
                    ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                    : 'border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-600')
                }
                title={isSelected ? 'Deselect' : selected.size >= 3 ? 'Max 3 selected' : 'Select this date'}
              >
                {isSelected ? '✓' : ''}
              </button>
            </div>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
          <p className="text-sm text-gray-700 mb-2">
            {selected.size} date{selected.size === 1 ? '' : 's'} selected — copy to share with opponent, and save so the selection sticks:
          </p>
          {saveError && (
            <p className="text-xs text-red-600 mb-2">{saveError}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 transition-colors"
            >
              {copied ? '✓ Copied!' : 'Copy dates'}
            </button>
            <button
              type="button"
              onClick={handleSaveSelection}
              disabled={saving || !selectionDirty()}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : selectionDirty() ? 'Save selection' : '✓ Saved'}
            </button>
          </div>
        </div>
      )}

      {/* When the saved selection was cleared down to nothing but there is a persisted set */}
      {selected.size === 0 && savedSel.size > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={handleSaveSelection}
            disabled={saving}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Clear saved selection'}
          </button>
        </div>
      )}
    </div>
  );
}
