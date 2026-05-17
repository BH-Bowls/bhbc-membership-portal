// app/availability/new/page.tsx
// Create new availability event page

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { SearchableSelect } from '@/components/SearchableSelect';
import { getButtonClasses, getInputClasses, getAlertClasses } from '@/config/theme-helpers';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';

const DRAFT_KEY = 'AvailabilityNewEvent';

interface SlotEntry {
  id: string;          // local ID for React key
  slotDatetime: string; // ISO string built from date + time inputs
  slotLabel: string;
  dateInput: string;   // YYYY-MM-DD
  timeInput: string;   // HH:MM or ''
}

interface MemberOption {
  value: string;   // userName
  label: string;   // full name
}

interface VisitorEntry {
  id: string;
  visitorName: string;
  visitorEmail: string;
}

// Build ISO timestamp from date and optional time inputs
function buildSlotDatetime(dateInput: string, timeInput: string): string {
  if (!dateInput) {
    return '';
  }
  // If no time, treat as noon to represent all-day
  const time = timeInput || '12:00';
  return `${dateInput}T${time}:00.000Z`;
}

export default function NewAvailabilityPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = session && session.user ? session.user.role : '';

  // Form state — event details
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [showResponses, setShowResponses] = useState(true);
  const [notifyCreator, setNotifyCreator] = useState(false);

  // Slots state
  const [slots, setSlots] = useState<SlotEntry[]>([]);
  const [addingSlot, setAddingSlot] = useState(false);
  const [newSlotDate, setNewSlotDate] = useState('');
  const [newSlotTime, setNewSlotTime] = useState('');
  const [newSlotLabel, setNewSlotLabel] = useState('');

  // Invitees state
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [memberSearchValue, setMemberSearchValue] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<MemberOption[]>([]);
  const [visitors, setVisitors] = useState<VisitorEntry[]>([]);
  const [newVisitorName, setNewVisitorName] = useState('');
  const [newVisitorEmail, setNewVisitorEmail] = useState('');

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userName = session && session.user ? session.user.userName : '';

  // Restore draft on mount
  useEffect(() => {
    if (status === 'loading' || !userName) {
      return;
    }
    const draft = restoreDraft<any>(DRAFT_KEY, userName);
    if (draft) {
      setTitle(draft.title || '');
      setDescription(draft.description || '');
      setExpiresOn(draft.expiresOn || '');
      setVisibility(draft.visibility || 'public');
      setShowResponses(draft.showResponses !== undefined ? draft.showResponses : true);
      setNotifyCreator(draft.notifyCreator || false);
      setSlots(draft.slots || []);
    }
  }, [status, userName]);

  // Load member list for the invitee searchable select
  useEffect(() => {
    if (visibility !== 'private') {
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
        // Failed to load member list — show empty
      });
  }, [visibility]);

  // Auto-save draft when key fields change
  useEffect(() => {
    if (!userName) {
      return;
    }
    saveDraft(DRAFT_KEY, userName, {
      title, description, expiresOn, visibility, showResponses, notifyCreator, slots,
    });
  }, [title, description, expiresOn, visibility, showResponses, notifyCreator, slots, userName]);

  // Add a new slot from the inline form
  function handleAddSlot() {
    if (!newSlotDate) {
      return;
    }
    const datetime = buildSlotDatetime(newSlotDate, newSlotTime);
    const newSlot: SlotEntry = {
      id: `slot-${Date.now()}`,
      slotDatetime: datetime,
      slotLabel: newSlotLabel,
      dateInput: newSlotDate,
      timeInput: newSlotTime,
    };
    setSlots([...slots, newSlot]);
    setNewSlotDate('');
    setNewSlotTime('');
    setNewSlotLabel('');
    setAddingSlot(false);
  }

  // Remove a slot from the list
  function handleRemoveSlot(slotId: string) {
    setSlots(slots.filter((s) => s.id !== slotId));
  }

  // Add a member to the invitee list from the searchable select
  function handleSelectMember(userName: string) {
    setMemberSearchValue('');
    if (!userName) {
      return;
    }
    // Prevent duplicates
    for (const m of selectedMembers) {
      if (m.value === userName) {
        return;
      }
    }
    // Find the member in options
    for (const opt of memberOptions) {
      if (opt.value === userName) {
        setSelectedMembers([...selectedMembers, opt]);
        return;
      }
    }
  }

  // Remove a member from the invitee list
  function handleRemoveMember(userName: string) {
    setSelectedMembers(selectedMembers.filter((m) => m.value !== userName));
  }

  // Add a visitor to the invitee list
  function handleAddVisitor() {
    if (!newVisitorName.trim() || !newVisitorEmail.trim()) {
      return;
    }
    setVisitors([...visitors, {
      id: `vis-${Date.now()}`,
      visitorName: newVisitorName.trim(),
      visitorEmail: newVisitorEmail.trim(),
    }]);
    setNewVisitorName('');
    setNewVisitorEmail('');
  }

  // Remove a visitor from the invitee list
  function handleRemoveVisitor(id: string) {
    setVisitors(visitors.filter((v) => v.id !== id));
  }

  // Format a slot for display in the list
  function formatSlotDisplay(slot: SlotEntry): string {
    if (slot.slotLabel) {
      return slot.slotLabel;
    }
    const date = new Date(slot.slotDatetime);
    if (isNaN(date.getTime())) {
      return slot.dateInput;
    }
    if (slot.timeInput) {
      return `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} at ${slot.timeInput}`;
    }
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Submit the form
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!expiresOn) {
      setError('Expiry date is required.');
      return;
    }
    if (slots.length === 0) {
      setError('At least one slot is required.');
      return;
    }
    if (visibility === 'private' && selectedMembers.length === 0 && visitors.length === 0) {
      setError('Private events must have at least one invitee.');
      return;
    }

    // Build expiry ISO string (end of the chosen day)
    const expiryIso = `${expiresOn}T23:59:59.000Z`;

    setSubmitting(true);

    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        visibility,
        showResponsesToRespondents: showResponses,
        notifyCreatorOnResponse: notifyCreator,
        expiresAt: expiryIso,
        slots: slots.map((s) => ({
          slotDatetime: s.slotDatetime,
          slotLabel: s.slotLabel,
        })),
        memberInvitees: selectedMembers.map((m) => m.value),
        visitorInvitees: visitors.map((v) => ({
          visitorName: v.visitorName,
          visitorEmail: v.visitorEmail,
        })),
      };

      const res = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to create event.');
        setSubmitting(false);
        return;
      }

      // Clear the draft on success
      clearDraft(DRAFT_KEY, userName);

      // Redirect to the manage page
      router.push(`/availability/${data.eventId}/manage`);
    } catch (submitError) {
      console.error('[NewAvailabilityPage] Submit error:', submitError);
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session && session.user && session.user.name ? session.user.name : undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">

        {/* Back link */}
        <div className="mb-4">
          <RouterBackLink fallbackHref="/availability" label="Availability Planner" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">Create Availability Event</h1>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Section 1: Event Details */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Event Details</h2>

            {/* Title */}
            <div className="mb-4">
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-red-600">*</span>
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Club trip to Brighton"
                className={getInputClasses(!title.trim() && submitting)}
                required
              />
            </div>

            {/* Description */}
            <div className="mb-4">
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-500">(optional)</span>
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Add more details about this event…"
                className={getInputClasses(false)}
              />
            </div>

            {/* Expires On */}
            <div className="mb-4">
              <label htmlFor="expiresOn" className="block text-sm font-medium text-gray-700 mb-1">
                Closes on <span className="text-red-600">*</span>
              </label>
              <input
                id="expiresOn"
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                className={getInputClasses(false)}
                required
              />
              <p className="text-xs text-gray-700 mt-1">No responses will be accepted after this date.</p>
            </div>

            {/* Visibility toggle */}
            <div className="mb-4">
              <span className="block text-sm font-medium text-gray-700 mb-1">Visibility</span>
              <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
                <button
                  type="button"
                  onClick={() => setVisibility('public')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${visibility === 'public' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Public
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility('private')}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${visibility === 'private' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Private
                </button>
              </div>
              <p className="text-xs text-gray-700 mt-1">
                {visibility === 'public'
                  ? 'Visible to all members in the list.'
                  : 'Only visible to the people you invite.'}
              </p>
            </div>

            {/* Show responses toggle */}
            <div className="mb-4">
              <span className="block text-sm font-medium text-gray-700 mb-1">Show responses to all respondents</span>
              <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
                <button
                  type="button"
                  onClick={() => setShowResponses(true)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${showResponses ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setShowResponses(false)}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${!showResponses ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  No
                </button>
              </div>
            </div>

            {/* Notify creator toggle */}
            <div className="mb-2">
              <span className="block text-sm font-medium text-gray-700 mb-1">Notify me when someone responds</span>
              <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
                <button
                  type="button"
                  onClick={() => setNotifyCreator(true)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${notifyCreator ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setNotifyCreator(false)}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${!notifyCreator ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  No
                </button>
              </div>
              <p className="text-xs text-gray-700 mt-1">Useful for one-on-one polls where an immediate reply matters.</p>
            </div>
          </div>

          {/* Section 2: Slots */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Candidate Date/Times</h2>
            <p className="text-sm text-gray-700 mb-4">Add at least one date and time for respondents to vote on.</p>

            {/* Existing slots list */}
            {slots.length > 0 && (
              <ul className="divide-y divide-gray-200 mb-4">
                {slots.map((slot) => (
                  <li key={slot.id} className="flex items-center justify-between py-2">
                    <span className="text-sm text-gray-900">{formatSlotDisplay(slot)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSlot(slot.id)}
                      className="text-red-600 hover:text-red-700 text-sm ml-4"
                      aria-label="Remove slot"
                    >
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Add slot inline form */}
            {addingSlot ? (
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
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddSlot}
                    disabled={!newSlotDate}
                    className={getButtonClasses('primary', 'sm')}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddingSlot(false); setNewSlotDate(''); setNewSlotTime(''); setNewSlotLabel(''); }}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingSlot(true)}
                className={getButtonClasses('secondary', 'sm')}
              >
                + Add Slot
              </button>
            )}
          </div>

          {/* Section 3: Invitees (private only) */}
          {visibility === 'private' && (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Invitees</h2>
              <p className="text-sm text-gray-700 mb-4">Add at least one person to invite to this private event.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Members sub-section */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Members</h3>
                  <SearchableSelect
                    options={memberOptions.filter((opt) => !selectedMembers.some((m) => m.value === opt.value))}
                    value={memberSearchValue}
                    onChange={handleSelectMember}
                    placeholder="Search members…"
                  />
                  {selectedMembers.length > 0 && (
                    <ul className="mt-2 divide-y divide-gray-200">
                      {selectedMembers.map((m) => (
                        <li key={m.value} className="flex items-center justify-between py-1.5">
                          <span className="text-sm text-gray-900">{m.label}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.value)}
                            className="text-red-600 hover:text-red-700 text-sm"
                          >
                            &times;
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Visitors sub-section */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Visitors</h3>
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
                      onClick={handleAddVisitor}
                      disabled={!newVisitorName.trim() || !newVisitorEmail.trim()}
                      className={getButtonClasses('secondary', 'sm')}
                    >
                      Add Visitor
                    </button>
                  </div>
                  {visitors.length > 0 && (
                    <ul className="mt-2 divide-y divide-gray-200">
                      {visitors.map((v) => (
                        <li key={v.id} className="flex items-center justify-between py-1.5">
                          <div>
                            <span className="text-sm text-gray-900">{v.visitorName}</span>
                            <span className="text-xs text-gray-700 ml-2">{v.visitorEmail}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveVisitor(v.id)}
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
            </div>
          )}

          {/* Error alert */}
          {error && (
            <div className={getAlertClasses('danger')}>
              {error}
            </div>
          )}

          {/* Submit button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className={getButtonClasses('primary', 'lg')}
            >
              {submitting ? 'Creating…' : 'Create Event'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
