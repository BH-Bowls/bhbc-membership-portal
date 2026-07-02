// app/availability/groups/[groupId]/events/new/page.tsx
// Create a poll within a group. Two modes:
//   • Fixed dates / options — people vote yes/maybe/no on set dates or text options
//   • Find best date — tap candidate dates × times to generate slots, then trim the list

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { getButtonClasses, getInputClasses, getAlertClasses } from '@/config/theme-helpers';
import type { AvailabilitySlotType } from '@/types/availability';

// The three standard club session times.
const FIXED_TIMES = [
  { label: '10:00 am', value: '10:00' },
  { label: '2:00 pm', value: '14:00' },
  { label: '6:00 pm', value: '18:00' },
];

const DAYS_AHEAD = 28; // candidate-date picker shows ~4 weeks ahead

// A fixed-poll option row (datetime or text). Blank fields mean an unfilled ghost row.
interface SlotDraft {
  key: string;
  slotDatetime: string;
  slotLabel: string;
  displayDate: string;   // YYYY-MM-DD
  displayTime: string;   // HH:MM
}

// ── Date/time helpers ─────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().substring(0, 10);
}

// YYYY-MM-DD for a date offsetDays from today
function dateOffsetIso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().substring(0, 10);
}

// Candidate dates: tomorrow through today+DAYS_AHEAD
function buildCandidateDates(): string[] {
  const dates: string[] = [];
  for (let i = 1; i <= DAYS_AHEAD; i++) {
    dates.push(dateOffsetIso(i));
  }
  return dates;
}

// Build display parts from YYYY-MM-DD using numeric parts (never new Date(string))
function dayLabel(iso: string): string {
  const p = iso.split('-');
  if (p.length !== 3) return '';
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).toLocaleDateString('en-GB', { weekday: 'short' });
}
function dayNum(iso: string): string {
  const p = iso.split('-');
  if (p.length !== 3) return '';
  return String(Number(p[2]));
}
function monthLabel(iso: string): string {
  const p = iso.split('-');
  if (p.length !== 3) return '';
  return new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
}
// "Mon 7 Jul" for the slot-preview list
function friendlyDate(iso: string): string {
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}
function timeLabel(time: string): string {
  const found = FIXED_TIMES.find((t) => t.value === time);
  return found ? found.label : time;
}

// Build a UTC-safe ISO datetime from a date + time (slots are displayed with timeZone: 'UTC')
function buildSlotDatetime(date: string, time: string): string {
  if (!date) return '';
  return new Date(`${date}T${time || '12:00'}:00Z`).toISOString();
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

export default function NewGroupEventPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { data: session } = useSession();
  const router = useRouter();

  const [groupId, setGroupId] = useState('');
  React.useEffect(() => { params.then((p) => setGroupId(p.groupId)); }, [params]);

  const [groupName, setGroupName] = useState('');
  const [groupMemberCount, setGroupMemberCount] = useState(0);
  // Member-type group members, for the "select recipients" checklist
  const [memberOptions, setMemberOptions] = useState<Array<{ userName: string; name: string }>>([]);

  // Invite-email controls (mirrors the /friendlies publish email)
  const [sendEmailNow, setSendEmailNow] = useState(true);
  const [emailMode, setEmailMode] = useState<'all' | 'select'>('all');
  const [emailRecipients, setEmailRecipients] = useState<Set<string>>(new Set());
  const [emailMessage, setEmailMessage] = useState('');

  // Which kind of poll to create
  const [mode, setMode] = useState<'fixed' | 'finder'>('fixed');

  // Shared fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [showResponsesToRespondents, setShowResponsesToRespondents] = useState(true);
  const [notifyCreatorOnResponse, setNotifyCreatorOnResponse] = useState(false);

  // Fixed-mode fields
  const [slotType, setSlotType] = useState<AvailabilitySlotType>('datetime');
  const [drafts, setDrafts] = useState<SlotDraft[]>([emptyDraft()]);

  // Date-finder fields: tap candidate dates + times, then trim the generated slot list
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [selectedTimes, setSelectedTimes] = useState<Set<string>>(new Set(['10:00', '14:00', '18:00']));
  // Slot keys ("YYYY-MM-DD|HH:MM") the organiser has removed from the generated grid
  const [removedSlotKeys, setRemovedSlotKeys] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set after a successful create — drives the confirmation panel (incl. how many were emailed)
  const [createdResult, setCreatedResult] = useState<{ eventId: string; emailsSent: number; emailAttempted: boolean } | null>(null);

  // Scroll to the error banner whenever a submit error appears
  useEffect(() => {
    if (submitError) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [submitError]);

  // Load the group's name and member count for the header and the "sent to N members" note
  useEffect(() => {
    if (!groupId) return;
    fetch(`/api/availability/groups/${groupId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && data.group) setGroupName(data.group.name);
        if (data && data.members) {
          setGroupMemberCount(data.members.length);
          // Build the member checklist (member-type only; visitors always get emailed)
          const opts: Array<{ userName: string; name: string }> = [];
          const names = data.memberDisplayNames || {};
          for (let i = 0; i < data.members.length; i++) {
            const m = data.members[i];
            if (m.memberType === 'member' && m.userName) {
              opts.push({ userName: m.userName, name: names[m.userName] || m.userName });
            }
          }
          setMemberOptions(opts);
        }
      })
      .catch(() => {});
  }, [groupId]);

  // ── Fixed-mode option handlers (auto-append a trailing ghost row) ──

  function handleSlotTypeChange(t: AvailabilitySlotType) {
    setSlotType(t);
    setDrafts([emptyDraft()]);
  }

  function updateDraft(key: string, patch: Partial<SlotDraft>) {
    setDrafts((prev) => {
      const updated = prev.map((d) => d.key === key ? { ...d, ...patch } : d);
      const last = updated[updated.length - 1];
      if (isDraftFilled(last, slotType)) return [...updated, emptyDraft()];
      return updated;
    });
  }

  function removeDraft(key: string) {
    setDrafts((prev) => {
      const filtered = prev.filter((d) => d.key !== key);
      if (filtered.length === 0 || isDraftFilled(filtered[filtered.length - 1], slotType)) {
        filtered.push(emptyDraft());
      }
      return filtered;
    });
  }

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
      return { ...d, displayTime, slotDatetime: buildSlotDatetime(d.displayDate, displayTime) };
    }));
  }

  // ── Date-finder handlers ──

  function toggleDate(iso: string) {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso); else next.add(iso);
      return next;
    });
  }

  function toggleTime(t: string) {
    setSelectedTimes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  // Build the active slot list = each selected date × each selected time, minus any the
  // organiser has removed. Sorted by date then time so the preview reads naturally.
  const activeSlots: Array<{ date: string; time: string; key: string }> = [];
  {
    const dates = Array.from(selectedDates).sort();
    const times = Array.from(selectedTimes).sort();
    for (let di = 0; di < dates.length; di++) {
      for (let ti = 0; ti < times.length; ti++) {
        const key = `${dates[di]}|${times[ti]}`;
        if (!removedSlotKeys.has(key)) {
          activeSlots.push({ date: dates[di], time: times[ti], key });
        }
      }
    }
  }

  function removeSlot(key: string) {
    setRemovedSlotKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  function restoreAllSlots() {
    setRemovedSlotKeys(new Set());
  }

  // Filled fixed-mode rows (exclude the trailing ghost)
  const filledDrafts = drafts.filter((d) => isDraftFilled(d, slotType));

  function toggleRecipient(userName: string) {
    setEmailRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(userName)) next.delete(userName); else next.add(userName);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!groupId) return;
    if (!title.trim()) { setSubmitError('Poll title is required.'); return; }
    if (!expiresAt) { setSubmitError('Please set a closing date.'); return; }
    if (new Date(expiresAt) <= new Date()) { setSubmitError('Closing date must be in the future.'); return; }

    // Invite-email controls shared by both modes. When "select" mode has no one ticked,
    // the recipient list is empty and the server falls back to emailing everyone.
    const emailFields = {
      sendEmail: sendEmailNow,
      emailMessage: emailMessage.trim(),
      emailRecipientUsernames: (sendEmailNow && emailMode === 'select') ? Array.from(emailRecipients) : [],
    };

    // Build the payload differently per mode
    let payload: Record<string, unknown>;

    if (mode === 'finder') {
      // Date-finder: one datetime slot per active date×time combination
      if (activeSlots.length === 0) { setSubmitError('Select at least one date and time.'); return; }
      const slots = activeSlots.map((s) => ({
        slotDatetime: buildSlotDatetime(s.date, s.time),
        slotLabel: '',
      }));
      payload = {
        title: title.trim(),
        description: description.trim(),
        type: 'fixture',
        slotType: 'datetime',
        matchFinder: true,
        showResponsesToRespondents,
        notifyCreatorOnResponse,
        expiresAt: new Date(expiresAt).toISOString(),
        slots,
        ...emailFields,
      };
    } else {
      // Fixed dates / options
      if (filledDrafts.length === 0) {
        setSubmitError(slotType === 'text' ? 'Please add at least one option.' : 'Please add at least one date/time option.');
        return;
      }
      const slots = filledDrafts.map((d) => ({
        slotDatetime: slotType === 'datetime' ? d.slotDatetime : null,
        slotLabel: d.slotLabel.trim(),
      }));
      payload = {
        title: title.trim(),
        description: description.trim(),
        type: 'general',
        slotType,
        matchFinder: false,
        showResponsesToRespondents,
        notifyCreatorOnResponse,
        expiresAt: new Date(expiresAt).toISOString(),
        slots,
        ...emailFields,
      };
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/availability/groups/${groupId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error || 'Failed to create poll.'); return; }
      // Show a confirmation (with the email count) rather than redirecting silently
      setCreatedResult({
        eventId: data.eventId,
        emailsSent: typeof data.emailsSent === 'number' ? data.emailsSent : 0,
        emailAttempted: data.emailAttempted === true,
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setSubmitError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const displayName = session && session.user && session.user.name ? session.user.name : undefined;
  const role = session && session.user ? session.user.role : '';
  const inactiveBtn = 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 rounded-md px-3 py-1.5 text-sm border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm';
  const submitDisabled = submitting || (mode === 'finder' ? activeSlots.length === 0 : filledDrafts.length === 0);
  const candidateDates = buildCandidateDates();

  // Email confirmation message shown after a successful create
  let emailNote = '';
  let emailVariant: 'success' | 'warning' | 'info' = 'info';
  if (createdResult) {
    if (!createdResult.emailAttempted) {
      emailNote = 'No invite email was sent (you chose not to send now). You can email members any time from the poll’s Manage page.';
      emailVariant = 'info';
    } else if (createdResult.emailsSent > 0) {
      emailNote = `Invite email sent to ${createdResult.emailsSent} ${createdResult.emailsSent === 1 ? 'person' : 'people'}.`;
      emailVariant = 'success';
    } else {
      emailNote = 'No invite emails were sent — the chosen recipients have no email address on file.';
      emailVariant = 'warning';
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <RouterBackLink
            fallbackHref={groupId ? `/availability/groups/${groupId}` : '/availability'}
            label={groupName || 'Group'}
          />
          <h1 className="text-2xl font-bold text-gray-900">
            New Poll{groupName ? ` — ${groupName}` : ''}
          </h1>
        </div>

        {submitError && (
          <div className={getAlertClasses('danger') + ' mb-4'}>{submitError}</div>
        )}

        {createdResult ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className={getAlertClasses('success') + ' mb-3'}>
              <p className="font-medium text-gray-900">Poll created ✓</p>
            </div>
            {emailNote && (
              <div className={getAlertClasses(emailVariant) + ' mb-4 text-sm'}>{emailNote}</div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.push(`/availability/events/${createdResult.eventId}/manage`)}
                className={getButtonClasses('primary', 'md')}
              >
                Go to the poll
              </button>
              <button
                type="button"
                onClick={() => router.push(`/availability/groups/${groupId}`)}
                className={getButtonClasses('secondary', 'md')}
              >
                Back to group
              </button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Poll kind ─────────────────────────────────────────── */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">What kind of poll?</h2>
            <p className="text-xs text-gray-700 mb-4">
              {mode === 'finder'
                ? 'Find the best date for a match — people mark each date/time and you see which works for the squad.'
                : 'Ask people to pick from a set of dates or options.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setMode('fixed')}
                className={mode === 'fixed' ? getButtonClasses('primary', 'md') : inactiveBtn}>
                Fixed dates / options
              </button>
              <button type="button" onClick={() => setMode('finder')}
                className={mode === 'finder' ? getButtonClasses('primary', 'md') : inactiveBtn}>
                Find best date
              </button>
            </div>
          </div>

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
                placeholder={mode === 'finder' ? 'e.g. vs Lindfield (Aussie Pairs)' : 'e.g. When shall we meet?'}
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

            {/* Option type — only for fixed polls (date-finder is always date/time) */}
            {mode === 'fixed' && (
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
                <p className="text-xs text-gray-700 mt-1">
                  {slotType === 'datetime'
                    ? 'People vote on candidate dates and times.'
                    : 'People vote on free-text options (e.g. "Option A", "Option B").'}
                </p>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Closes On <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={getInputClasses(false)}
                min={todayIso()}
              />
              <p className="text-xs text-gray-700 mt-1">Responses will no longer be accepted after this date.</p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Show responses to all respondents</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowResponsesToRespondents(true)}
                  className={showResponsesToRespondents ? getButtonClasses('success', 'sm') : inactiveBtn}>Yes</button>
                <button type="button" onClick={() => setShowResponsesToRespondents(false)}
                  className={!showResponsesToRespondents ? getButtonClasses('danger', 'sm') : inactiveBtn}>No</button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notify me when someone responds</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setNotifyCreatorOnResponse(true)}
                  className={notifyCreatorOnResponse ? getButtonClasses('success', 'sm') : inactiveBtn}>Yes</button>
                <button type="button" onClick={() => setNotifyCreatorOnResponse(false)}
                  className={!notifyCreatorOnResponse ? getButtonClasses('danger', 'sm') : inactiveBtn}>No</button>
              </div>
            </div>
          </div>

          {/* ── Dates / Options ──────────────────────────────────── */}
          {mode === 'finder' ? (
            <>
              {/* Candidate dates */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-base font-semibold text-gray-900 mb-1">Candidate dates</h2>
                <p className="text-xs text-gray-700 mb-4">
                  Tap the dates to offer. {selectedDates.size > 0 ? `${selectedDates.size} selected.` : 'None selected yet.'}
                </p>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                  {candidateDates.map((iso) => {
                    const selected = selectedDates.has(iso);
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => toggleDate(iso)}
                        className={
                          'flex flex-col items-center py-2 px-1 rounded-lg border text-center transition-colors ' +
                          (selected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300')
                        }
                      >
                        <span className={'text-xs font-medium ' + (selected ? 'text-blue-100' : 'text-gray-500')}>{dayLabel(iso)}</span>
                        <span className="text-base font-bold leading-tight">{dayNum(iso)}</span>
                        <span className={'text-xs ' + (selected ? 'text-blue-200' : 'text-gray-500')}>{monthLabel(iso)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Times */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-base font-semibold text-gray-900 mb-1">Times</h2>
                <p className="text-xs text-gray-700 mb-4">Which times to offer on each date.</p>
                <div className="flex flex-wrap gap-3">
                  {FIXED_TIMES.map((t) => {
                    const on = selectedTimes.has(t.value);
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => toggleTime(t.value)}
                        className={on ? getButtonClasses('primary', 'md') : inactiveBtn}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Generated slots — trim before publishing */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-base font-semibold text-gray-900">Slots to offer</h2>
                  {removedSlotKeys.size > 0 && (
                    <button type="button" onClick={restoreAllSlots} className="text-xs text-blue-600 hover:underline">
                      Restore removed
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-700 mb-4">
                  Each date × time becomes a slot people mark. Remove any combination you don&apos;t want to offer.
                </p>

                {activeSlots.length === 0 ? (
                  <p className="text-sm text-gray-700">Pick at least one date and one time above.</p>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      {activeSlots.map((s) => (
                        <div key={s.key} className="flex items-center justify-between bg-gray-50 rounded border border-gray-100 px-3 py-1.5">
                          <span className="text-sm text-gray-900">{friendlyDate(s.date)} · {timeLabel(s.time)}</span>
                          <button
                            type="button"
                            onClick={() => removeSlot(s.key)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-700 mt-3">
                      {activeSlots.length} slot{activeSlots.length === 1 ? '' : 's'} will be created.
                    </p>
                  </>
                )}

                <div className={getAlertClasses('info') + ' mt-4 text-sm'}>
                  This poll will be sent to all <strong>{groupMemberCount}</strong>{' '}
                  {groupMemberCount === 1 ? 'member' : 'members'} of{' '}
                  <strong>{groupName || 'this group'}</strong>.{' '}
                  To invite additional people, add them to the group first.
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-1">
                {slotType === 'text' ? 'Options' : 'Date / Time Options'}
              </h2>
              <p className="text-xs text-gray-700 mb-4">
                {slotType === 'text'
                  ? 'Add the options people will vote on. At least one is required.'
                  : 'Add the candidate dates people will vote on. At least one is required.'}
              </p>

              <div className="space-y-2">
                {drafts.map((draft) => {
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
                          <input
                            type="date"
                            value={draft.displayDate}
                            onChange={(e) => handleDateChange(draft.key, e.target.value)}
                            className={getInputClasses(false)}
                            min={todayIso()}
                          />
                          <input
                            type="time"
                            value={draft.displayTime}
                            onChange={(e) => handleTimeChange(draft.key, e.target.value)}
                            className={getInputClasses(false)}
                          />
                        </div>
                      )}
                      {!isGhost && (
                        <button type="button" onClick={() => removeDraft(draft.key)}
                          className="mt-1 text-xs text-red-600 hover:text-red-800 font-medium shrink-0">
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className={getAlertClasses('info') + ' mt-4 text-sm'}>
                This poll will be sent to all <strong>{groupMemberCount}</strong>{' '}
                {groupMemberCount === 1 ? 'member' : 'members'} of{' '}
                <strong>{groupName || 'this group'}</strong>.{' '}
                To invite additional people, add them to the group first.
              </div>
            </div>
          )}

          {/* ── Invite email ──────────────────────────────────────── */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Invite email</h2>
            <p className="text-xs text-gray-700 mb-4">
              Email members a link to respond. Replies go to you, and the email tells them to contact you rather than the club address.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Send invite email now?</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSendEmailNow(true)}
                  className={sendEmailNow ? getButtonClasses('success', 'sm') : inactiveBtn}>Yes</button>
                <button type="button" onClick={() => setSendEmailNow(false)}
                  className={!sendEmailNow ? getButtonClasses('danger', 'sm') : inactiveBtn}>No</button>
              </div>
              {!sendEmailNow && (
                <p className="text-xs text-gray-700 mt-1">Everyone is still invited — you can email them later from the manage page.</p>
              )}
            </div>

            {sendEmailNow && (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Who to email</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEmailMode('all')}
                      className={emailMode === 'all' ? getButtonClasses('primary', 'sm') : inactiveBtn}>All members</button>
                    <button type="button" onClick={() => setEmailMode('select')}
                      className={emailMode === 'select' ? getButtonClasses('primary', 'sm') : inactiveBtn}>Choose…</button>
                  </div>
                </div>

                {emailMode === 'select' && (
                  <div className="mb-4">
                    {memberOptions.length === 0 ? (
                      <p className="text-xs text-gray-700">No members to choose from yet.</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-100 rounded p-2">
                        {memberOptions.map((m) => (
                          <label key={m.userName} className="flex items-center gap-2 text-sm text-gray-900">
                            <input
                              type="checkbox"
                              checked={emailRecipients.has(m.userName)}
                              onChange={() => toggleRecipient(m.userName)}
                              className="rounded border-gray-300"
                            />
                            {m.name}
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-700 mt-1">Visitors are always emailed. Tick nobody to email everyone.</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Message <span className="text-gray-500">(optional)</span>
                  </label>
                  <textarea
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    className={getInputClasses(false)}
                    rows={3}
                    maxLength={800}
                    placeholder="Add a note to the email…"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitDisabled}
              className={getButtonClasses('primary', 'md')}
            >
              {submitting ? 'Creating…' : 'Create Poll & Invite Group'}
            </button>
          </div>

        </form>
        )}
      </div>
    </div>
  );
}
