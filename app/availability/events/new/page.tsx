// app/availability/events/new/page.tsx
// Create a new public event (visible to all members, no group required)

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { getButtonClasses, getInputClasses, getAlertClasses } from '@/config/theme-helpers';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';
import type { AvailabilityEventType } from '@/types/availability';

// Draft key for this form — single shared draft per user
const DRAFT_KEY = 'AvailabilityNewPublicEvent';

// Shape of a slot entry in the form
interface SlotEntry {
  slotDatetime: string; // ISO datetime string
  slotLabel: string;    // optional label override
  displayDate: string;  // "YYYY-MM-DD" for the date input field
  displayTime: string;  // "HH:MM" for the time input field
}

// Shape of the form draft saved to sessionStorage
interface EventDraft {
  title: string;
  description: string;
  type: AvailabilityEventType;
  expiresAt: string;
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  slots: SlotEntry[];
}

// Build an ISO datetime string from separate date and time inputs
function buildSlotDatetime(date: string, time: string): string {
  if (!date) return '';
  // Default to noon if no time provided
  const timeStr = time ? time : '12:00';
  return new Date(`${date}T${timeStr}:00`).toISOString();
}

export default function NewPublicEventPage() {
  const { data: session } = useSession();
  const router = useRouter();

  // Form field state
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

  // Restore draft on mount once session is resolved
  useEffect(() => {
    if (!userName) return;
    const draft = restoreDraft<EventDraft>(DRAFT_KEY, userName);
    if (draft) {
      setTitle(draft.title);
      setDescription(draft.description);
      setType(draft.type);
      setExpiresAt(draft.expiresAt);
      setShowResponsesToRespondents(draft.showResponsesToRespondents);
      setNotifyCreatorOnResponse(draft.notifyCreatorOnResponse);
      setSlots(draft.slots);
    }
  }, [userName]);

  // Save draft whenever any form field changes
  useEffect(() => {
    if (!userName) return;
    const draft: EventDraft = {
      title,
      description,
      type,
      expiresAt,
      showResponsesToRespondents,
      notifyCreatorOnResponse,
      slots,
    };
    saveDraft(DRAFT_KEY, userName, draft);
  }, [title, description, type, expiresAt, showResponsesToRespondents, notifyCreatorOnResponse, slots, userName]);

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
    // Clear add-slot form fields
    setNewSlotDate('');
    setNewSlotTime('');
    setNewSlotLabel('');
  }

  // Remove a slot from the list by index
  function removeSlot(index: number) {
    setSlots(prev => prev.filter((_, i) => i !== index));
  }

  // Format a slot for display in the list
  function formatSlotDisplay(slot: SlotEntry): string {
    if (slot.slotLabel) return slot.slotLabel;
    if (!slot.slotDatetime) return 'Unknown date';
    const d = new Date(slot.slotDatetime);
    if (isNaN(d.getTime())) return slot.displayDate;
    const dateStr = d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    if (slot.displayTime) {
      return `${dateStr} at ${slot.displayTime}`;
    }
    return dateStr;
  }

  // Submit the create-public-event form
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    // Client-side validation
    if (!title.trim()) {
      setSubmitError('Event title is required.');
      return;
    }
    if (!expiresAt) {
      setSubmitError('Please set an expiry date.');
      return;
    }
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
      // Build the slot payload for the API
      const slotPayload = [];
      for (let i = 0; i < slots.length; i++) {
        slotPayload.push({
          slotDatetime: slots[i].slotDatetime,
          slotLabel: slots[i].slotLabel,
        });
      }

      // POST to the public events endpoint
      const res = await fetch('/api/availability/events', {
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
      clearDraft(DRAFT_KEY, userName);
      // Navigate to manage page for the new event
      router.push(`/availability/events/${data.eventId}/manage`);
    } catch (err) {
      console.error('[NewPublicEventPage] handleSubmit error:', err);
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
          <RouterBackLink fallbackHref="/availability" label="Availability" />
          <h1 className="text-2xl font-bold text-gray-900">New Public Event</h1>
          <p className="text-sm text-gray-700 mt-1">
            Public events are visible to all logged-in members — no group or invite list needed.
          </p>
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
                placeholder="e.g. Club pairs — available dates?"
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

            {/* Event type */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
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

            {/* Expiry */}
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
                Responses will not be accepted after this date.
              </p>
            </div>

            {/* Show responses */}
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
            <p className="text-xs text-gray-700 mb-3">
              Add the candidate dates people will vote on. At least one is required.
            </p>

            {/* Existing slots list */}
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

            {/* Add slot form */}
            {slotError && (
              <p className="text-xs text-red-600 mb-2">{slotError}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
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
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Time (optional)
                </label>
                <input
                  type="time"
                  value={newSlotTime}
                  onChange={(e) => setNewSlotTime(e.target.value)}
                  className={getInputClasses(false)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Label override (optional)
                </label>
                <input
                  type="text"
                  value={newSlotLabel}
                  onChange={(e) => setNewSlotLabel(e.target.value)}
                  className={getInputClasses(false)}
                  placeholder="e.g. Saturday morning"
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
          </div>

          {/* Submit */}
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
