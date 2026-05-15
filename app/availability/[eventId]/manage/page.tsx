// app/availability/[eventId]/manage/page.tsx
// Management page for an availability event — creator-only view with full controls

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { SearchableSelect } from '@/components/SearchableSelect';
import {
  getButtonClasses,
  getBadgeClasses,
  getAlertClasses,
  getInputClasses,
  getCardClasses,
} from '@/config/theme-helpers';
import type {
  AvailabilityManageDetail,
  AvailabilitySlot,
  AvailabilityResponse,
  AvailabilityParticipantResponses,
} from '@/types/availability';

// Format an ISO datetime as a slot column header
function formatSlotHeader(slot: AvailabilitySlot): { date: string; time: string } {
  if (slot.slotLabel) {
    return { date: slot.slotLabel, time: '' };
  }
  const d = new Date(slot.slotDatetime);
  if (isNaN(d.getTime())) {
    return { date: slot.slotDatetime, time: '' };
  }
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const hours = d.getUTCHours();
  const mins = d.getUTCMinutes();
  // Noon = all-day marker, do not show time
  const time = (hours === 12 && mins === 0) ? '' : `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  return { date, time };
}

// Format an ISO datetime as a human-readable label for the conclude dropdown
function formatSlotOption(slot: AvailabilitySlot): string {
  if (slot.slotLabel) {
    return slot.slotLabel;
  }
  const d = new Date(slot.slotDatetime);
  if (isNaN(d.getTime())) {
    return slot.slotDatetime;
  }
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// Format ISO date for display
function formatDate(iso: string): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '';
  }
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Read-only response badge
function ResponseBadge({ response }: { response: AvailabilityResponse | undefined }) {
  if (!response) {
    return <span className="text-gray-400 text-xs">—</span>;
  }
  if (response === 'yes') {
    return <span className="text-green-700 font-medium text-xs">✓</span>;
  }
  if (response === 'maybe') {
    return <span className="text-amber-600 font-medium text-xs">?</span>;
  }
  return <span className="text-red-600 font-medium text-xs">✗</span>;
}

interface MemberOption {
  value: string;
  label: string;
}

interface VisitorEntry {
  id: string;
  visitorName: string;
  visitorEmail: string;
}

export default function ManageAvailabilityPage({ params }: { params: { eventId: string } }) {
  const { data: session, status } = useSession();
  const { eventId } = params;
  const role = session && session.user ? session.user.role : '';

  const [detail, setDetail] = useState<AvailabilityManageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Edit event panel state
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editExpiresOn, setEditExpiresOn] = useState('');
  const [editShowResponses, setEditShowResponses] = useState(true);
  const [editNotifyCreator, setEditNotifyCreator] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Conclude panel state
  const [showConcludePanel, setShowConcludePanel] = useState(false);
  const [concludeSlotId, setConcludeSlotId] = useState('');
  const [concludeNote, setConcludeNote] = useState('');
  const [concludeNotify, setConcludeNotify] = useState(true);
  const [concluding, setConcluding] = useState(false);
  const [concludeError, setConcludeError] = useState<string | null>(null);

  // Status action state
  const [statusActing, setStatusActing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Add slot state
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [newSlotDate, setNewSlotDate] = useState('');
  const [newSlotTime, setNewSlotTime] = useState('');
  const [newSlotLabel, setNewSlotLabel] = useState('');
  const [addingSlot, setAddingSlot] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);

  // Delete slot confirmation
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);

  // Add invitees state
  const [showAddInvitees, setShowAddInvitees] = useState(false);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [memberSearchValue, setMemberSearchValue] = useState('');
  const [newInviteMembers, setNewInviteMembers] = useState<MemberOption[]>([]);
  const [newInviteVisitors, setNewInviteVisitors] = useState<VisitorEntry[]>([]);
  const [newVisitorName, setNewVisitorName] = useState('');
  const [newVisitorEmail, setNewVisitorEmail] = useState('');
  const [addingInvitees, setAddingInvitees] = useState(false);
  const [inviteesError, setInviteesError] = useState<string | null>(null);
  const [inviteesSuccess, setInviteesSuccess] = useState<string | null>(null);

  // Load member options when invitees panel opens
  useEffect(() => {
    if (!showAddInvitees) {
      return;
    }
    fetch('/api/members/lookup')
      .then((res) => res.json())
      .then((data) => {
        const opts: MemberOption[] = [];
        if (data && Array.isArray(data.members)) {
          for (const m of data.members) {
            opts.push({ value: m.userName, label: m.fullName || m.userName });
          }
        }
        setMemberOptions(opts);
      })
      .catch(() => {
        // Ignore fetch error — member search will just be empty
      });
  }, [showAddInvitees]);

  // Fetch manage detail on mount
  useEffect(() => {
    if (status === 'loading') {
      return;
    }
    fetchDetail();
  }, [status, eventId]);

  async function fetchDetail() {
    try {
      setError(null);
      setForbidden(false);
      const res = await fetch(`/api/availability/${eventId}/manage`);

      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }

      if (res.status === 404) {
        setError('Event not found.');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        throw new Error('Failed to load event');
      }

      const data: AvailabilityManageDetail = await res.json();
      setDetail(data);
      setLoading(false);
    } catch (fetchError) {
      console.error('[ManageAvailabilityPage] Fetch error:', fetchError);
      setError('Failed to load event. Please refresh.');
      setLoading(false);
    }
  }

  // Open the edit panel and pre-populate fields
  function handleOpenEdit() {
    if (!detail) {
      return;
    }
    setEditTitle(detail.event.title);
    setEditDescription(detail.event.description);
    // Extract YYYY-MM-DD from ISO string for the date input
    const d = new Date(detail.event.expiresAt);
    if (!isNaN(d.getTime())) {
      setEditExpiresOn(d.toISOString().substring(0, 10));
    } else {
      setEditExpiresOn('');
    }
    setEditShowResponses(detail.event.showResponsesToRespondents);
    setEditNotifyCreator(detail.event.notifyCreatorOnResponse);
    setEditError(null);
    setShowEditPanel(true);
  }

  // Save event edits
  async function handleSaveEdit() {
    if (!editTitle.trim()) {
      setEditError('Title is required.');
      return;
    }
    setEditSaving(true);
    setEditError(null);

    try {
      // Build expiry as end-of-day ISO string
      const expiryIso = editExpiresOn ? `${editExpiresOn}T23:59:59.000Z` : undefined;

      const body: Record<string, any> = {
        title: editTitle.trim(),
        description: editDescription.trim(),
        showResponsesToRespondents: editShowResponses,
        notifyCreatorOnResponse: editNotifyCreator,
      };
      if (expiryIso) {
        body.expiresAt = expiryIso;
      }

      const res = await fetch(`/api/availability/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setEditError(data.error || 'Failed to save changes.');
        setEditSaving(false);
        return;
      }

      setShowEditPanel(false);
      setEditSaving(false);
      // Reload to reflect changes
      await fetchDetail();
    } catch (saveError) {
      console.error('[ManageAvailabilityPage] Edit save error:', saveError);
      setEditError('Something went wrong. Please try again.');
      setEditSaving(false);
    }
  }

  // Close an open event
  async function handleClose() {
    setStatusActing(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/availability/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatusError(data.error || 'Failed to close event.');
        setStatusActing(false);
        return;
      }
      setStatusActing(false);
      await fetchDetail();
    } catch (err) {
      console.error('[ManageAvailabilityPage] Close error:', err);
      setStatusError('Something went wrong.');
      setStatusActing(false);
    }
  }

  // Reopen a closed/concluded event
  async function handleReopen() {
    setStatusActing(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/availability/${eventId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatusError(data.error || 'Failed to reopen event.');
        setStatusActing(false);
        return;
      }
      setStatusActing(false);
      await fetchDetail();
    } catch (err) {
      console.error('[ManageAvailabilityPage] Reopen error:', err);
      setStatusError('Something went wrong.');
      setStatusActing(false);
    }
  }

  // Archive the event
  async function handleArchive() {
    if (!window.confirm('Archive this event? It will be hidden from all views.')) {
      return;
    }
    setStatusActing(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/availability/${eventId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatusError(data.error || 'Failed to archive event.');
        setStatusActing(false);
        return;
      }
      // Redirect to list after archive
      window.location.href = '/availability';
    } catch (err) {
      console.error('[ManageAvailabilityPage] Archive error:', err);
      setStatusError('Something went wrong.');
      setStatusActing(false);
    }
  }

  // Submit conclude form
  async function handleConclude() {
    if (!concludeSlotId) {
      setConcludeError('Please choose the winning slot.');
      return;
    }
    setConcluding(true);
    setConcludeError(null);
    try {
      const res = await fetch(`/api/availability/${eventId}/conclude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concludedSlotId: concludeSlotId,
          conclusionNote: concludeNote,
          notifyRespondents: concludeNotify,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setConcludeError(data.error || 'Failed to conclude event.');
        setConcluding(false);
        return;
      }
      setShowConcludePanel(false);
      setConcluding(false);
      setConcludeSlotId('');
      setConcludeNote('');
      setConcludeNotify(true);
      await fetchDetail();
    } catch (err) {
      console.error('[ManageAvailabilityPage] Conclude error:', err);
      setConcludeError('Something went wrong.');
      setConcluding(false);
    }
  }

  // Add a new slot
  async function handleAddSlot() {
    if (!newSlotDate) {
      setSlotError('Date is required.');
      return;
    }
    setAddingSlot(true);
    setSlotError(null);
    try {
      const time = newSlotTime || '12:00';
      const slotDatetime = `${newSlotDate}T${time}:00.000Z`;

      const res = await fetch(`/api/availability/${eventId}/slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotDatetime, slotLabel: newSlotLabel }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSlotError(data.error || 'Failed to add slot.');
        setAddingSlot(false);
        return;
      }
      setShowAddSlot(false);
      setAddingSlot(false);
      setNewSlotDate('');
      setNewSlotTime('');
      setNewSlotLabel('');
      await fetchDetail();
    } catch (err) {
      console.error('[ManageAvailabilityPage] Add slot error:', err);
      setSlotError('Something went wrong.');
      setAddingSlot(false);
    }
  }

  // Delete a slot
  async function handleDeleteSlot(slotId: string) {
    if (!window.confirm('Remove this slot? All responses to it will also be deleted.')) {
      return;
    }
    setDeletingSlotId(slotId);
    try {
      const res = await fetch(`/api/availability/${eventId}/slots/${slotId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to delete slot.');
        setDeletingSlotId(null);
        return;
      }
      setDeletingSlotId(null);
      await fetchDetail();
    } catch (err) {
      console.error('[ManageAvailabilityPage] Delete slot error:', err);
      alert('Something went wrong.');
      setDeletingSlotId(null);
    }
  }

  // Add member to the new invitees list
  function handleSelectInviteeMember(userName: string) {
    setMemberSearchValue('');
    if (!userName) {
      return;
    }
    // Prevent duplicates
    for (const m of newInviteMembers) {
      if (m.value === userName) {
        return;
      }
    }
    for (const opt of memberOptions) {
      if (opt.value === userName) {
        setNewInviteMembers([...newInviteMembers, opt]);
        return;
      }
    }
  }

  // Remove member from new invitees list
  function handleRemoveInviteeMember(userName: string) {
    setNewInviteMembers(newInviteMembers.filter((m) => m.value !== userName));
  }

  // Add visitor to new invitees list
  function handleAddInviteeVisitor() {
    if (!newVisitorName.trim() || !newVisitorEmail.trim()) {
      return;
    }
    setNewInviteVisitors([...newInviteVisitors, {
      id: `vis-${Date.now()}`,
      visitorName: newVisitorName.trim(),
      visitorEmail: newVisitorEmail.trim(),
    }]);
    setNewVisitorName('');
    setNewVisitorEmail('');
  }

  // Remove visitor from new invitees list
  function handleRemoveInviteeVisitor(id: string) {
    setNewInviteVisitors(newInviteVisitors.filter((v) => v.id !== id));
  }

  // Submit new invitees
  async function handleAddInvitees() {
    if (newInviteMembers.length === 0 && newInviteVisitors.length === 0) {
      setInviteesError('Add at least one invitee.');
      return;
    }
    setAddingInvitees(true);
    setInviteesError(null);
    setInviteesSuccess(null);
    try {
      const res = await fetch(`/api/availability/${eventId}/invitees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberUserNames: newInviteMembers.map((m) => m.value),
          visitorInvitees: newInviteVisitors.map((v) => ({
            visitorName: v.visitorName,
            visitorEmail: v.visitorEmail,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setInviteesError(data.error || 'Failed to add invitees.');
        setAddingInvitees(false);
        return;
      }
      setAddingInvitees(false);
      setNewInviteMembers([]);
      setNewInviteVisitors([]);
      setInviteesSuccess(`Added ${data.addedCount} invitee${data.addedCount !== 1 ? 's' : ''}.`);
      await fetchDetail();
    } catch (err) {
      console.error('[ManageAvailabilityPage] Add invitees error:', err);
      setInviteesError('Something went wrong.');
      setAddingInvitees(false);
    }
  }

  // Build per-slot totals from responseSummary
  function getSlotSummary(slotId: string) {
    if (!detail) {
      return { yesCount: 0, maybeCount: 0, noCount: 0 };
    }
    for (const s of detail.responseSummary) {
      if (s.slotId === slotId) {
        return s;
      }
    }
    return { yesCount: 0, maybeCount: 0, noCount: 0 };
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session && session.user ? session.user.name : undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-5xl">

        {/* Back link */}
        <div className="mb-4">
          <RouterBackLink href="/availability" label="Availability Planner" />
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-12">
            <p className="text-gray-700">Loading event&hellip;</p>
          </div>
        )}

        {/* 403 */}
        {forbidden && (
          <div className={getAlertClasses('warning')}>
            You do not have permission to manage this event.
          </div>
        )}

        {/* Error */}
        {error && (
          <div className={getAlertClasses('danger')}>
            {error}
          </div>
        )}

        {/* Main content */}
        {!loading && !error && !forbidden && detail && (
          <div>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div>
                <div className="flex flex-wrap items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold text-gray-900">{detail.event.title}</h1>
                  {/* Status badge */}
                  {detail.event.status === 'open' && (
                    <span className={getBadgeClasses('success', 'sm')}>Open</span>
                  )}
                  {detail.event.status === 'closed' && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">Closed</span>
                  )}
                  {detail.event.status === 'concluded' && (
                    <span className={getBadgeClasses('primary', 'sm')}>Concluded</span>
                  )}
                  {detail.event.status === 'archived' && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-700">Archived</span>
                  )}
                </div>
                {detail.event.description && (
                  <p className="text-gray-700 text-sm mt-1">{detail.event.description}</p>
                )}
                <p className="text-sm text-gray-700 mt-1">
                  Expires {formatDate(detail.event.expiresAt)}
                </p>
              </div>

              {/* Header action buttons */}
              <div className="flex flex-wrap gap-2">
                {detail.event.status !== 'archived' && (
                  <button
                    type="button"
                    onClick={handleOpenEdit}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    Edit Event
                  </button>
                )}
                <Link
                  href={`/availability/${eventId}`}
                  className={getButtonClasses('secondary', 'sm')}
                >
                  View as Member
                </Link>
              </div>
            </div>

            {/* Edit event panel */}
            {showEditPanel && (
              <div className="bg-white shadow rounded-lg p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Edit Event</h2>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Title <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className={getInputClasses(false)}
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={3}
                    className={getInputClasses(false)}
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Closes on</label>
                  <input
                    type="date"
                    value={editExpiresOn}
                    onChange={(e) => setEditExpiresOn(e.target.value)}
                    className={getInputClasses(false)}
                  />
                </div>

                <div className="mb-4">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Show responses to all respondents</span>
                  <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
                    <button
                      type="button"
                      onClick={() => setEditShowResponses(true)}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${editShowResponses ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditShowResponses(false)}
                      className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${!editShowResponses ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      No
                    </button>
                  </div>
                </div>

                <div className="mb-4">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Notify me when someone responds</span>
                  <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
                    <button
                      type="button"
                      onClick={() => setEditNotifyCreator(true)}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${editNotifyCreator ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditNotifyCreator(false)}
                      className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${!editNotifyCreator ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      No
                    </button>
                  </div>
                </div>

                {editError && (
                  <div className={`${getAlertClasses('danger')} mb-4`}>{editError}</div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={editSaving}
                    className={getButtonClasses('primary', 'sm')}
                  >
                    {editSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowEditPanel(false); setEditError(null); }}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Status controls */}
            <div className="bg-white shadow rounded-lg p-4 mb-6">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm font-medium text-gray-700 mr-2">Event status:</span>

                {/* Open → can close or conclude */}
                {detail.event.status === 'open' && (
                  <>
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={statusActing}
                      className={getButtonClasses('secondary', 'sm')}
                    >
                      Close Event
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowConcludePanel(true); setConcludeError(null); }}
                      className={getButtonClasses('primary', 'sm')}
                    >
                      Conclude Event
                    </button>
                  </>
                )}

                {/* Closed → can reopen or conclude */}
                {detail.event.status === 'closed' && (
                  <>
                    <button
                      type="button"
                      onClick={handleReopen}
                      disabled={statusActing}
                      className={getButtonClasses('secondary', 'sm')}
                    >
                      Reopen Event
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowConcludePanel(true); setConcludeError(null); }}
                      className={getButtonClasses('primary', 'sm')}
                    >
                      Conclude Event
                    </button>
                  </>
                )}

                {/* Concluded → can reopen */}
                {detail.event.status === 'concluded' && (
                  <button
                    type="button"
                    onClick={handleReopen}
                    disabled={statusActing}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    Reopen Event
                  </button>
                )}

                {/* Archive — always available */}
                {detail.event.status !== 'archived' && (
                  <button
                    type="button"
                    onClick={handleArchive}
                    disabled={statusActing}
                    className="px-3 py-1.5 text-sm font-medium rounded-md border border-red-300 text-red-700 bg-white hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    Archive Event
                  </button>
                )}
              </div>

              {statusError && (
                <p className="text-sm text-red-700 mt-2">{statusError}</p>
              )}
            </div>

            {/* Conclude panel */}
            {showConcludePanel && (
              <div className="bg-white shadow rounded-lg p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Conclude Event</h2>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Winning slot <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={concludeSlotId}
                    onChange={(e) => setConcludeSlotId(e.target.value)}
                    className={getInputClasses(false)}
                  >
                    <option value="">— Choose the winning slot —</option>
                    {detail.slots.map((slot) => (
                      <option key={slot.slotId} value={slot.slotId}>
                        {formatSlotOption(slot)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Conclusion note <span className="text-gray-500">(optional)</span>
                  </label>
                  <textarea
                    value={concludeNote}
                    onChange={(e) => setConcludeNote(e.target.value)}
                    rows={3}
                    placeholder="e.g. We'll go with Saturday 14 June at 2pm — see you there!"
                    className={getInputClasses(false)}
                  />
                </div>

                <div className="mb-4 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="concludeNotify"
                    checked={concludeNotify}
                    onChange={(e) => setConcludeNotify(e.target.checked)}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                  />
                  <label htmlFor="concludeNotify" className="text-sm text-gray-700">
                    Send notification email to all respondents
                  </label>
                </div>

                {concludeError && (
                  <div className={`${getAlertClasses('danger')} mb-4`}>{concludeError}</div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleConclude}
                    disabled={concluding}
                    className={getButtonClasses('primary', 'sm')}
                  >
                    {concluding ? 'Concluding…' : 'Confirm Conclusion'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowConcludePanel(false); setConcludeError(null); }}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Response grid */}
            {detail.slots.length > 0 && (
              <div className="bg-white shadow rounded-lg overflow-x-auto mb-6">
                <div className="px-4 py-3 border-b border-gray-200">
                  <h2 className="text-base font-semibold text-gray-900">Responses</h2>
                </div>
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider bg-gray-50 w-32">
                        Respondent
                      </th>
                      {detail.slots.map((slot) => {
                        const { date, time } = formatSlotHeader(slot);
                        const isConcluded = detail.event.concludedSlotId === slot.slotId;
                        return (
                          <th
                            key={slot.slotId}
                            className={`px-3 py-3 text-center text-xs font-medium uppercase tracking-wider ${
                              isConcluded ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-700'
                            }`}
                          >
                            <div>{date}</div>
                            {time && <div className="text-xs font-normal">{time}</div>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {/* Participant rows */}
                    {detail.allResponses.length === 0 ? (
                      <tr>
                        <td
                          colSpan={detail.slots.length + 1}
                          className="px-4 py-6 text-center text-sm text-gray-700 italic"
                        >
                          No responses yet.
                        </td>
                      </tr>
                    ) : (
                      detail.allResponses.map((participant: AvailabilityParticipantResponses, idx: number) => (
                        <tr key={idx}>
                          <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                            {participant.displayName}
                          </td>
                          {detail.slots.map((slot) => (
                            <td key={slot.slotId} className="px-3 py-3 text-center">
                              <ResponseBadge response={participant.responses[slot.slotId]} />
                            </td>
                          ))}
                        </tr>
                      ))
                    )}

                    {/* Summary row */}
                    <tr className="bg-gray-50 border-t-2 border-gray-200">
                      <td className="px-4 py-3 text-xs font-medium text-gray-700 uppercase">
                        Totals
                      </td>
                      {detail.slots.map((slot) => {
                        const s = getSlotSummary(slot.slotId);
                        return (
                          <td key={slot.slotId} className="px-3 py-2 text-center">
                            <div className="flex flex-col gap-0.5 items-center text-xs">
                              <span className="text-green-700">{s.yesCount} ✓</span>
                              <span className="text-amber-600">{s.maybeCount} ?</span>
                              <span className="text-red-600">{s.noCount} ✗</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Slots section */}
            <div className="bg-white shadow rounded-lg p-6 mb-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Slots</h2>

              {detail.slots.length === 0 ? (
                <p className="text-sm text-gray-700 italic mb-4">No slots yet.</p>
              ) : (
                <ul className="divide-y divide-gray-200 mb-4">
                  {detail.slots.map((slot) => {
                    const { date, time } = formatSlotHeader(slot);
                    const isOpen = detail.event.status === 'open';
                    const isDeleting = deletingSlotId === slot.slotId;
                    return (
                      <li key={slot.slotId} className="flex items-center justify-between py-2">
                        <div>
                          <span className="text-sm text-gray-900">{date}</span>
                          {time && <span className="text-xs text-gray-700 ml-2">{time}</span>}
                        </div>
                        {isOpen && (
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => handleDeleteSlot(slot.slotId)}
                            className="text-red-600 hover:text-red-700 text-sm ml-4 disabled:opacity-50"
                            aria-label="Remove slot"
                          >
                            {isDeleting ? '…' : '×'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Add slot form */}
              {detail.event.status === 'open' && (
                showAddSlot ? (
                  <div className="border border-gray-200 rounded-md p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Date <span className="text-red-600">*</span>
                        </label>
                        <input
                          type="date"
                          value={newSlotDate}
                          onChange={(e) => setNewSlotDate(e.target.value)}
                          className={getInputClasses(false)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Time <span className="text-gray-500">(optional)</span>
                        </label>
                        <input
                          type="time"
                          value={newSlotTime}
                          onChange={(e) => setNewSlotTime(e.target.value)}
                          className={getInputClasses(false)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Label override <span className="text-gray-500">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={newSlotLabel}
                        onChange={(e) => setNewSlotLabel(e.target.value)}
                        placeholder="e.g. Saturday afternoon"
                        className={getInputClasses(false)}
                      />
                    </div>

                    {slotError && (
                      <p className="text-sm text-red-700">{slotError}</p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddSlot}
                        disabled={addingSlot || !newSlotDate}
                        className={getButtonClasses('primary', 'sm')}
                      >
                        {addingSlot ? 'Adding…' : 'Add'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddSlot(false);
                          setNewSlotDate('');
                          setNewSlotTime('');
                          setNewSlotLabel('');
                          setSlotError(null);
                        }}
                        className={getButtonClasses('secondary', 'sm')}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddSlot(true)}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    + Add Slot
                  </button>
                )
              )}
            </div>

            {/* Invitees section (private events only) */}
            {detail.event.visibility === 'private' && (
              <div className="bg-white shadow rounded-lg p-6 mb-6">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Invitees</h2>

                {detail.invitees.length === 0 ? (
                  <p className="text-sm text-gray-700 italic mb-4">No invitees.</p>
                ) : (
                  <div className="overflow-x-auto mb-4">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Name</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Type</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Notified</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Responded</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {detail.invitees.map((inv) => {
                          const displayName = inv.inviteeType === 'member'
                            ? (detail.inviteeDisplayNames[inv.userName] || inv.userName)
                            : inv.visitorName;
                          const hasResponded = detail.allResponses.some((r) => {
                            if (inv.inviteeType === 'member') {
                              return r.respondentType === 'member' && r.displayName === displayName;
                            }
                            return r.respondentType === 'visitor' && r.displayName === inv.visitorName;
                          });
                          return (
                            <tr key={inv.inviteeId}>
                              <td className="px-4 py-2 text-gray-900">{displayName}</td>
                              <td className="px-4 py-2 text-gray-700 capitalize">{inv.inviteeType}</td>
                              <td className="px-4 py-2 text-gray-700">
                                {inv.notifiedAt ? (
                                  <span className="text-green-700">Yes</span>
                                ) : (
                                  <span className="text-gray-500">No</span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-gray-700">
                                {hasResponded ? (
                                  <span className="text-green-700">Yes</span>
                                ) : (
                                  <span className="text-gray-500">No</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Add more invitees */}
                {detail.event.status === 'open' && (
                  showAddInvitees ? (
                    <div className="border border-gray-200 rounded-md p-4 space-y-4">
                      <h3 className="text-sm font-semibold text-gray-900">Add More Invitees</h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Members */}
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-2">Members</p>
                          <SearchableSelect
                            options={memberOptions.filter((opt) => !newInviteMembers.some((m) => m.value === opt.value))}
                            value={memberSearchValue}
                            onChange={handleSelectInviteeMember}
                            placeholder="Search members…"
                          />
                          {newInviteMembers.length > 0 && (
                            <ul className="mt-2 divide-y divide-gray-200">
                              {newInviteMembers.map((m) => (
                                <li key={m.value} className="flex items-center justify-between py-1">
                                  <span className="text-sm text-gray-900">{m.label}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveInviteeMember(m.value)}
                                    className="text-red-600 hover:text-red-700 text-sm"
                                  >
                                    &times;
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* Visitors */}
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-2">Visitors</p>
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={newVisitorName}
                              onChange={(e) => setNewVisitorName(e.target.value)}
                              placeholder="Full name"
                              className={getInputClasses(false)}
                            />
                            <input
                              type="email"
                              value={newVisitorEmail}
                              onChange={(e) => setNewVisitorEmail(e.target.value)}
                              placeholder="Email address"
                              className={getInputClasses(false)}
                            />
                            <button
                              type="button"
                              onClick={handleAddInviteeVisitor}
                              disabled={!newVisitorName.trim() || !newVisitorEmail.trim()}
                              className={getButtonClasses('secondary', 'sm')}
                            >
                              Add Visitor
                            </button>
                          </div>
                          {newInviteVisitors.length > 0 && (
                            <ul className="mt-2 divide-y divide-gray-200">
                              {newInviteVisitors.map((v) => (
                                <li key={v.id} className="flex items-center justify-between py-1">
                                  <div>
                                    <span className="text-sm text-gray-900">{v.visitorName}</span>
                                    <span className="text-xs text-gray-700 ml-2">{v.visitorEmail}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveInviteeVisitor(v.id)}
                                    className="text-red-600 hover:text-red-700 text-sm"
                                  >
                                    &times;
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      {inviteesError && (
                        <p className="text-sm text-red-700">{inviteesError}</p>
                      )}
                      {inviteesSuccess && (
                        <p className="text-sm text-green-700">{inviteesSuccess}</p>
                      )}

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleAddInvitees}
                          disabled={addingInvitees}
                          className={getButtonClasses('primary', 'sm')}
                        >
                          {addingInvitees ? 'Adding…' : 'Add Invitees'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddInvitees(false);
                            setNewInviteMembers([]);
                            setNewInviteVisitors([]);
                            setInviteesError(null);
                          }}
                          className={getButtonClasses('secondary', 'sm')}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setShowAddInvitees(true); setInviteesSuccess(null); }}
                      className={getButtonClasses('secondary', 'sm')}
                    >
                      + Add More Invitees
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
