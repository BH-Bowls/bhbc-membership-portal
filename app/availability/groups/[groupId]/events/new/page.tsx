// app/availability/groups/[groupId]/events/new/page.tsx
// Create a new event within a group — form for title, type, slots, settings

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { getButtonClasses, getInputClasses, getAlertClasses } from '@/config/theme-helpers';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';
import type { AvailabilityEventType } from '@/types/availability';

// Draft key prefix — appended with groupId for uniqueness per group
const DRAFT_KEY_PREFIX = 'AvailabilityNewGroupEvent-';

// Shape of a slot entry in the form
interface SlotEntry {
  slotDatetime: string; // ISO datetime string built from date + time fields
  slotLabel: string;    // optional user-supplied label
  displayDate: string;  // "YYYY-MM-DD" for the date input
  displayTime: string;  // "HH:MM" for the time input
}

// Shape of form draft saved to sessionStorage
interface EventDraft {
  title: string;
  description: string;
  type: AvailabilityEventType;
  expiresAt: string;
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  slots: SlotEntry[];
}

// Build an ISO datetime string from separate date and time strings
// Returns empty string if the date is missing
function buildSlotDatetime(date: string, time: string): string {
  if (!date) return '';
  // Use noon UTC as default if no time provided
  const timeStr = time ? time : '12:00';
  return new Date(`${date}T${timeStr}:00`).toISOString();
}

export default function NewGroupEventPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { data: session } = useSession();
  const router = useRouter();

  // Resolve groupId from the async params
  const [groupId, setGroupId] = useState('');
  React.useEffect(() => {
    params.then((p) => setGroupId(p.groupId));
  }, [params]);

  // Group name loaded for display in heading and invitee note
  const [groupName, setGroupName] = useState('');
  const [groupMemberCount, setGroupMemberCount] = useState(0);

  // Form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<AvailabilityEventType>('general');
  const [expiresAt, setExpiresAt] = useState('');
  const [showResponsesToRespondents, setShowResponsesToRespondents] = useState(true);
  const [notifyCreatorOnResponse, setNotifyCreatorOnResponse] = useState(false);

  // Slot list
  const [slots, setSlots] = useState<SlotEntry[]>([]);
  // Fields for the add-slot inline form
  const [newSlotDate, setNewSlotDate] = useState('');
  const [newSlotTime, setNewSlotTime] = useState('');
  const [newSlotLabel, setNewSlotLabel] = useState('');
  const [slotError, setSlotError] = useState<string | null>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const userName = session && session.user ? session.user.userName : '';

  // Load group name and draft once groupId is resolved
  useEffect(() => {
    if (!groupId) return;
    loadGroupName(groupId);
    // Restore draft if available
    if (userName) {
      const draftKey = DRAFT_KEY_PREFIX + groupId;
      const draft = restoreDraft<EventDraft>(draftKey, userName);
      if (draft) {
        setTitle(draft.title);
        setDescription(draft.description);
        setType(draft.type);
        setExpiresAt(draft.expiresAt);
        setShowResponsesToRespondents(draft.showResponsesToRespondents);
        setNotifyCreatorOnResponse(draft.notifyCreatorOnResponse);
        setSlots(draft.slots);
      }
    }
  }, [groupId, userName]);

  // Save draft whenever form fields change
  useEffect(() => {
    if (!groupId || !userName) return;
    const draftKey = DRAFT_KEY_PREFIX + groupId;
    const draft: EventDraft = {
      title,
      description,
      type,
      expiresAt,
      showResponsesToRespondents,
      notifyCreatorOnResponse,
      slots,
    };
    saveDraft(draftKey, userName, draft);
  }, [title, description, type, expiresAt, showResponsesToRespondents, notifyCreatorOnResponse, slots, groupId, userName]);

  // Fetch the group name from the API for display
  async function loadGroupName(gid: string) {
    try {
      const res = await fetch(`/api/availability/groups/${gid}`);
      if (res.ok) {
        const data = await res.json();
        if (data.group) {
          setGroupName(data.group.name);
        }
        if (data.members) {
          setGroupMemberCount(data.members.length);
        }
      }
    } catch (err) {
      console.error('[NewGroupEventPage] loadGroupName error:', err);
    }
  }

  // Add a slot to the list
  function addSlot() {
    setSlotError(null);
    if (!newSlotDate) {
      setSlotError('Please select a date for the slot.');
      return;
    }
    const slotDatetime = buildSlotDatetime(newSlotDate, newSlotTime);
    setSlots(prev => [...prev, {
      slotDatetime,
      slotLabel: newSlotLabel.trim(),
      displayDate: newSlotDate,
      displayTime: newSlotTime,
    }]);
    // Clear slot input fields
    setNewSlotDate('');
    setNewSlotTime('');
    setNewSlotLabel('');
  }

  // Remove a slot from the list by index
  function removeSlot(index: number) {
    setSlots(prev => prev.filter((_, i) => i !== index));
  }

  // Format a slot for display in the list (date + time or label)
  function formatSlotDisplay(slot: SlotEntry): string {
    if (slot.slotLabel) return slot.slotLabel;
    if (!slot.slotDatetime) return 'Unknown date';
    const d = new Date(slot.slotDatetime);
    if (isNaN(d.getTime())) return slot.displayDate;
    const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (slot.displayTime) {
      return `${dateStr} at ${slot.displayTime}`;
    }
    return dateStr;
  }

  // Submit the create-event form
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    // Validate required fields
    if (!title.trim()) {
      setSubmitError('Event title is required.');
      return;
    }
    if (!expiresAt) {
      setSubmitError('Please set an expiry date.');
      return;
    }
    // Expiry must be in the future
    if (new Date(expiresAt) <= new Date()) {
      setSubmitError('Expiry date must be in the future.');
      return;
    }
    if (slots.length === 0) {
      setSubmitError('Please add at least one date/time slot.');
      return;
    }

    setSubmitting(true);
    try {
      // Build the payload — convert slot entries to the API shape
      const slotPayload = [];
      for (let i = 0; i < slots.length; i++) {
        slotPayload.push({
          slotDatetime: slots[i].slotDatetime,
          slotLabel: slots[i].slotLabel,
        });
      }

      // POST to the group events API endpoint
      const res = await fetch(`/api/availability/groups/${groupId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          type,
          showResponsesToRespondents,
          notifyCreatorOnResponse,
          expiresAt: new Date(expiresAt).toISOString(),
          slots: slotPayload,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error || 'Failed to create event.');
        return;
      }

      // Clear draft on success
      const draftKey = DRAFT_KEY_PREFIX + groupId;
      clearDraft(draftKey, userName);

      // Navigate to the manage page for the new event
      router.push(`/availability/events/${data.eventId}/manage`);
    } catch (err) {
      console.error('[NewGroupEventPage] handleSubmit error:', err);
      setSubmitError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const displayName = session && session.user && session.user.name ? session.user.name : undefined;
  const role = session && session.user ? session.user.role : '';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Page header */}
        <div className="mb-6">
          <RouterBackLink
            fallbackHref={groupId ? `/availability/groups/${groupId}` : '/availability'}
            label={groupName || 'Group'}
          />
          <h1 className="text-2xl font-bold text-gray-900">
            New Event{groupName ? ` — ${groupName}` : ''}
          </h1>
        </div>

        {/* Submission error */}
        {submitError && (
          <div className={getAlertClasses('danger') + ' mb-4'}>
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Section 1: Event Details ──────────────────────────── */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Event Details</h2>

            {/* Title */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={getInputClasses(false)}
                placeholder="e.g. When shall we meet?"
                maxLength={200}
              />
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-500">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={getInputClasses(false)}
                rows={2}
                maxLength={500}
              />
            </div>

            {/* Event type toggle */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Event Type
              </label>
              <div className="flex gap-2">
                {(['general', 'fixture', 'signup'] as AvailabilityEventType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={type === t
                      ? getButtonClasses('primary', 'sm')
                      : getButtonClasses('secondary', 'sm')}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-700 mt-1">
                General = scheduling poll · Fixture = match-related · Signup = sign-up poll
              </p>
            </div>

            {/* Expires on */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expires On <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={getInputClasses(false)}
                min={new Date().toISOString().substring(0, 10)}
              />
              <p className="text-xs text-gray-700 mt-1">
                Responses will no longer be accepted after this date.
              </p>
            </div>

            {/* Show responses to respondents */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Show responses to all respondents
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowResponsesToRespondents(true)}
                  className={showResponsesToRespondents
                    ? getButtonClasses('primary', 'sm')
                    : getButtonClasses('secondary', 'sm')}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setShowResponsesToRespondents(false)}
                  className={!showResponsesToRespondents
                    ? getButtonClasses('primary', 'sm')
                    : getButtonClasses('secondary', 'sm')}
                >
                  No
                </button>
              </div>
            </div>

            {/* Notify on response */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notify me when someone responds
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNotifyCreatorOnResponse(true)}
                  className={notifyCreatorOnResponse
                    ? getButtonClasses('primary', 'sm')
                    : getButtonClasses('secondary', 'sm')}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setNotifyCreatorOnResponse(false)}
                  className={!notifyCreatorOnResponse
                    ? getButtonClasses('primary', 'sm')
                    : getButtonClasses('secondary', 'sm')}
                >
                  No
                </button>
              </div>
              <p className="text-xs text-gray-700 mt-1">
                Useful for one-on-one polls where an immediate reply matters. Off by default.
              </p>
            </div>
          </div>

          {/* ── Section 2: Date/Time Slots ────────────────────────── */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Date / Time Slots</h2>
            <p className="text-xs text-gray-700 mb-3">Add the candidate dates people will vote on. At least one is required.</p>

            {/* Existing slots */}
            {slots.length > 0 && (
              <ul className="mb-4 space-y-2">
                {slots.map((slot, i) => (
                  <li key={i} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                    <span className="text-sm text-gray-900">{formatSlotDisplay(slot)}</span>
                    <button
                      type="button"
                      onClick={() => removeSlot(i)}
                      className="text-xs text-red-600 hover:text-red-800 ml-2 font-medium"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Add slot inline form */}
            {slotError && (
              <p className="text-xs text-red-600 mb-2">{slotError}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Date <span className="text-red-600">*</span></label>
                <input
                  type="date"
                  value={newSlotDate}
                  onChange={(e) => setNewSlotDate(e.target.value)}
                  className={getInputClasses(false)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Time (optional)</label>
                <input
                  type="time"
                  value={newSlotTime}
                  onChange={(e) => setNewSlotTime(e.target.value)}
                  className={getInputClasses(false)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Label override (optional)</label>
                <input
                  type="text"
                  value={newSlotLabel}
                  onChange={(e) => setNewSlotLabel(e.target.value)}
                  className={getInputClasses(false)}
                  placeholder="e.g. Weekend morning"
                  maxLength={100}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={addSlot}
              className={getButtonClasses('secondary', 'sm')}
            >
              + Add Slot
            </button>

            {/* Invitee note: who will receive this event */}
            <div className={getAlertClasses('info') + ' mt-4 text-sm'}>
              This event will be sent to all{' '}
              <strong>{groupMemberCount}</strong>{' '}
              {groupMemberCount === 1 ? 'member' : 'members'} of{' '}
              <strong>{groupName || 'this group'}</strong>.{' '}
              To invite additional people, add them to the group first.
            </div>
          </div>

          {/* Submit button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className={getButtonClasses('primary', 'md')}
            >
              {submitting ? 'Creating…' : 'Create Event'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
