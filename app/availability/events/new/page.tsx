// app/availability/events/new/page.tsx
// Create a new public poll (visible to all members, no group required)

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { getButtonClasses, getInputClasses, getAlertClasses } from '@/config/theme-helpers';
import type { AvailabilityEventType, AvailabilitySlotType } from '@/types/availability';

// One row in the slot/option list — null slotId means it's a new (unsaved) row
interface SlotDraft {
  key: string;            // stable react key
  slotDatetime: string;   // ISO — blank for text polls
  slotLabel: string;
  displayDate: string;    // "YYYY-MM-DD" for date input
  displayTime: string;    // "HH:MM" for time input
}

function buildSlotDatetime(date: string, time: string): string {
  if (!date) return '';
  return new Date(`${date}T${time || '12:00'}:00`).toISOString();
}

function formatSlotDisplay(draft: SlotDraft, slotType: AvailabilitySlotType): string {
  if (slotType === 'text') return draft.slotLabel || '';
  if (draft.slotLabel) return draft.slotLabel;
  if (!draft.slotDatetime) return '';
  const d = new Date(draft.slotDatetime);
  if (isNaN(d.getTime())) return draft.displayDate;
  const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return draft.displayTime ? `${dateStr} at ${draft.displayTime}` : dateStr;
}

function isDraftFilled(draft: SlotDraft, slotType: AvailabilitySlotType): boolean {
  if (slotType === 'text') return draft.slotLabel.trim().length > 0;
  return draft.displayDate.length > 0;
}

let keyCounter = 0;
function nextKey() { return String(++keyCounter); }

function emptyDraft(): SlotDraft {
  return { key: nextKey(), slotDatetime: '', slotLabel: '', displayDate: '', displayTime: '' };
}

export default function NewPublicEventPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<AvailabilityEventType>('general');
  const [slotType, setSlotType] = useState<AvailabilitySlotType>('datetime');
  const [expiresAt, setExpiresAt] = useState('');
  const [showResponsesToRespondents, setShowResponsesToRespondents] = useState(true);
  const [notifyCreatorOnResponse, setNotifyCreatorOnResponse] = useState(false);

  // Always at least one ghost row
  const [drafts, setDrafts] = useState<SlotDraft[]>([emptyDraft()]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (submitError) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [submitError]);

  // When poll type changes, reset all drafts
  function handleSlotTypeChange(t: AvailabilitySlotType) {
    setSlotType(t);
    setDrafts([emptyDraft()]);
  }

  function updateDraft(key: string, patch: Partial<SlotDraft>) {
    setDrafts((prev) => {
      const updated = prev.map((d) => d.key === key ? { ...d, ...patch } : d);
      // If the last row now has content, append a new ghost row
      const last = updated[updated.length - 1];
      if (isDraftFilled(last, slotType)) {
        return [...updated, emptyDraft()];
      }
      return updated;
    });
  }

  function removeDraft(key: string) {
    setDrafts((prev) => {
      const filtered = prev.filter((d) => d.key !== key);
      // Always keep at least one ghost row
      if (filtered.length === 0 || isDraftFilled(filtered[filtered.length - 1], slotType)) {
        filtered.push(emptyDraft());
      }
      return filtered;
    });
  }

  // Sync slotDatetime when date or time changes
  function handleDateChange(key: string, displayDate: string) {
    setDrafts((prev) => {
      const updated = prev.map((d) => {
        if (d.key !== key) return d;
        const dt = buildSlotDatetime(displayDate, d.displayTime);
        return { ...d, displayDate, slotDatetime: dt };
      });
      const last = updated[updated.length - 1];
      if (isDraftFilled(last, slotType)) return [...updated, emptyDraft()];
      return updated;
    });
  }

  function handleTimeChange(key: string, displayTime: string) {
    setDrafts((prev) => prev.map((d) => {
      if (d.key !== key) return d;
      const dt = buildSlotDatetime(d.displayDate, displayTime);
      return { ...d, displayTime, slotDatetime: dt };
    }));
  }

  const filledDrafts = drafts.filter((d) => isDraftFilled(d, slotType));
  const hasUnsavedOptions = filledDrafts.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!title.trim()) { setSubmitError('Poll title is required.'); return; }
    if (!expiresAt) { setSubmitError('Please set an expiry date.'); return; }
    if (new Date(expiresAt) <= new Date()) { setSubmitError('Expiry date must be in the future.'); return; }
    if (filledDrafts.length === 0) {
      setSubmitError(slotType === 'text' ? 'Please add at least one option.' : 'Please add at least one date/time option.');
      return;
    }

    setSubmitting(true);
    try {
      const slotPayload = filledDrafts.map((d) => ({
        slotDatetime: slotType === 'datetime' ? d.slotDatetime : null,
        slotLabel: d.slotLabel.trim(),
      }));

      const res = await fetch('/api/availability/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          type,
          slotType,
          showResponsesToRespondents,
          notifyCreatorOnResponse,
          expiresAt: new Date(expiresAt).toISOString(),
          slots: slotPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error || 'Failed to create poll.'); return; }
      router.push(`/availability/events/${data.eventId}/manage`);
    } catch {
      setSubmitError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const displayName = session?.user?.name ?? undefined;
  const role = session?.user?.role ?? '';
  const inactiveBtn = 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 rounded-md px-3 py-1.5 text-sm border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <RouterBackLink fallbackHref="/availability" label="Polls" />
          <h1 className="text-2xl font-bold text-gray-900">New Public Poll</h1>
          <p className="text-sm text-gray-700 mt-1">
            Public polls are visible to all logged-in members — no group needed.
          </p>
        </div>

        {submitError && (
          <div className={getAlertClasses('danger') + ' mb-4'}>{submitError}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Poll Details ─────────────────────────────────────── */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Poll Details</h2>

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

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Poll type <span className="text-red-600">*</span>
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => handleSlotTypeChange('datetime')}
                  className={slotType === 'datetime' ? getButtonClasses('primary', 'sm') : inactiveBtn}>
                  Date / Time
                </button>
                <button type="button" onClick={() => handleSlotTypeChange('text')}
                  className={slotType === 'text' ? getButtonClasses('primary', 'sm') : inactiveBtn}>
                  Text options
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {slotType === 'datetime'
                  ? 'People vote on candidate dates and times.'
                  : 'People vote on free-text options (e.g. "Option A", "Option B").'}
              </p>
            </div>

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
              <p className="text-xs text-gray-700 mt-1">Responses will not be accepted after this date.</p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Show responses to all respondents
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowResponsesToRespondents(true)}
                  className={showResponsesToRespondents ? getButtonClasses('success', 'sm') : inactiveBtn}>Yes</button>
                <button type="button" onClick={() => setShowResponsesToRespondents(false)}
                  className={!showResponsesToRespondents ? getButtonClasses('danger', 'sm') : inactiveBtn}>No</button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notify me when someone responds
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setNotifyCreatorOnResponse(true)}
                  className={notifyCreatorOnResponse ? getButtonClasses('success', 'sm') : inactiveBtn}>Yes</button>
                <button type="button" onClick={() => setNotifyCreatorOnResponse(false)}
                  className={!notifyCreatorOnResponse ? getButtonClasses('danger', 'sm') : inactiveBtn}>No</button>
              </div>
            </div>
          </div>

          {/* ── Options ──────────────────────────────────────────── */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              {slotType === 'text' ? 'Options' : 'Date / Time Options'}
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              {slotType === 'text'
                ? 'Add the options people will vote on. At least one is required.'
                : 'Add the candidate dates people will vote on. At least one is required.'}
            </p>

            <div className="space-y-2">
              {drafts.map((draft, idx) => {
                const isGhost = !isDraftFilled(draft, slotType);
                return (
                  <div key={draft.key} className="flex items-start gap-2">
                    {slotType === 'text' ? (
                      <input
                        type="text"
                        value={draft.slotLabel}
                        onChange={(e) => updateDraft(draft.key, { slotLabel: e.target.value })}
                        className={getInputClasses(false) + ' flex-1'}
                        placeholder={isGhost ? 'Add an option…' : ''}
                        maxLength={200}
                      />
                    ) : (
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <input
                            type="date"
                            value={draft.displayDate}
                            onChange={(e) => handleDateChange(draft.key, e.target.value)}
                            className={getInputClasses(false)}
                            placeholder="Date"
                          />
                        </div>
                        <div>
                          <input
                            type="time"
                            value={draft.displayTime}
                            onChange={(e) => handleTimeChange(draft.key, e.target.value)}
                            className={getInputClasses(false)}
                          />
                        </div>
                      </div>
                    )}
                    {!isGhost && (
                      <button
                        type="button"
                        onClick={() => removeDraft(draft.key)}
                        className="mt-1 text-xs text-red-600 hover:text-red-800 font-medium shrink-0"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !hasUnsavedOptions}
              className={getButtonClasses('primary', 'md')}
            >
              {submitting ? 'Creating…' : 'Create Poll'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
