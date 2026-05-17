// app/availability/[eventId]/page.tsx
// Member response page for an availability event

'use client';

import { useState, useEffect, use } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { getButtonClasses, getBadgeClasses, getAlertClasses } from '@/config/theme-helpers';
import type {
  AvailabilityEventDetail,
  AvailabilitySlot,
  AvailabilityResponse,
  AvailabilityParticipantResponses,
} from '@/types/availability';

// Format an ISO datetime for column headers
function formatSlotHeader(slot: AvailabilitySlot): { date: string; time: string } {
  if (slot.slotLabel) {
    return { date: slot.slotLabel, time: '' };
  }
  const d = new Date(slot.slotDatetime);
  if (isNaN(d.getTime())) {
    return { date: slot.slotDatetime, time: '' };
  }
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  // If time is noon (all-day marker), don't show it
  const hours = d.getUTCHours();
  const mins = d.getUTCMinutes();
  const time = (hours === 12 && mins === 0) ? '' : `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  return { date, time };
}

// Format expiry date for display
function formatExpiry(isoString: string): string {
  if (!isoString) {
    return '';
  }
  const d = new Date(isoString);
  if (isNaN(d.getTime())) {
    return '';
  }
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Response button component — shows three clickable options
function ResponseButtons({
  slotId,
  current,
  onChange,
  disabled,
}: {
  slotId: string;
  current: AvailabilityResponse | undefined;
  onChange: (slotId: string, response: AvailabilityResponse) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-1 justify-center">
      {/* Yes button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(slotId, 'yes')}
        className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
          current === 'yes'
            ? 'bg-green-600 text-white'
            : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        title="Yes"
      >
        ✓
      </button>
      {/* Maybe button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(slotId, 'maybe')}
        className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
          current === 'maybe'
            ? 'bg-amber-500 text-white'
            : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        title="Maybe"
      >
        ?
      </button>
      {/* No button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(slotId, 'no')}
        className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
          current === 'no'
            ? 'bg-red-600 text-white'
            : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        title="No"
      >
        ✗
      </button>
    </div>
  );
}

// Read-only response badge for other respondents
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

export default function AvailabilityEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { data: session, status } = useSession();
  const { eventId } = use(params);
  const role = session && session.user ? session.user.role : '';

  const [detail, setDetail] = useState<AvailabilityEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Track current user's draft responses (editable)
  const [myResponses, setMyResponses] = useState<Record<string, AvailabilityResponse>>({});

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentUserName = session && session.user ? session.user.userName : '';
  const isCreator = detail && detail.event && detail.event.createdByUsername === currentUserName;

  // Fetch event detail on mount
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
      const res = await fetch(`/api/availability/${eventId}`);

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

      const data: AvailabilityEventDetail = await res.json();
      setDetail(data);

      // Initialise draft responses from existing saved responses
      setMyResponses(data.myResponses || {});

      setLoading(false);
    } catch (fetchError) {
      console.error('[AvailabilityEventPage] Fetch error:', fetchError);
      setError('Failed to load event. Please refresh.');
      setLoading(false);
    }
  }

  // Update a single slot response in the draft
  function handleResponseChange(slotId: string, response: AvailabilityResponse) {
    setMyResponses({ ...myResponses, [slotId]: response });
    setSaveSuccess(false);
  }

  // Save all responses
  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    // Build responses array from current draft
    const responsesArray: Array<{ slotId: string; response: AvailabilityResponse }> = [];
    for (const slotId of Object.keys(myResponses)) {
      responsesArray.push({ slotId, response: myResponses[slotId] });
    }

    if (responsesArray.length === 0) {
      setSaveError('Please respond to at least one slot before saving.');
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/availability/${eventId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: responsesArray }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setSaveError(data.error || 'Failed to save responses.');
        setSaving(false);
        return;
      }

      setSaveSuccess(true);
      setSaving(false);

      // Refresh to pick up any updated allResponses grid
      await fetchDetail();
    } catch (saveErr) {
      console.error('[AvailabilityEventPage] Save error:', saveErr);
      setSaveError('Something went wrong. Please try again.');
      setSaving(false);
    }
  }

  // Determine whether the response form is disabled
  function isResponseDisabled(): boolean {
    if (!detail) {
      return true;
    }
    if (detail.event.status !== 'open') {
      return true;
    }
    const expiry = new Date(detail.event.expiresAt);
    if (expiry <= new Date()) {
      return true;
    }
    return false;
  }

  // Build per-slot totals from allResponses
  function buildSlotTotals(slots: AvailabilitySlot[], allResponses: AvailabilityParticipantResponses[]) {
    const totals: Record<string, { yes: number; maybe: number; no: number }> = {};
    for (const slot of slots) {
      totals[slot.slotId] = { yes: 0, maybe: 0, no: 0 };
    }
    for (const participant of allResponses) {
      for (const slotId of Object.keys(participant.responses)) {
        const resp = participant.responses[slotId];
        if (totals[slotId]) {
          if (resp === 'yes') {
            totals[slotId].yes += 1;
          } else if (resp === 'maybe') {
            totals[slotId].maybe += 1;
          } else if (resp === 'no') {
            totals[slotId].no += 1;
          }
        }
      }
    }
    return totals;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session && session.user && session.user.name ? session.user.name : undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-5xl">

        {/* Back link */}
        <div className="mb-4">
          <RouterBackLink fallbackHref="/availability" label="Availability Planner" />
        </div>

        {/* Loading state */}
        {loading && (
          <div className="text-center py-12">
            <p className="text-gray-700">Loading event&hellip;</p>
          </div>
        )}

        {/* 403 — not invited */}
        {forbidden && (
          <div className={getAlertClasses('warning')}>
            You have not been invited to this event.
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className={getAlertClasses('danger')}>
            {error}
          </div>
        )}

        {/* Event content */}
        {!loading && !error && !forbidden && detail && (
          <div>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{detail.event.title}</h1>
                {detail.event.description && (
                  <p className="text-gray-700 mt-1">{detail.event.description}</p>
                )}
                <p className="text-sm text-gray-700 mt-2">
                  Created by {detail.event.createdByName} &middot; Closes {formatExpiry(detail.event.expiresAt)}
                </p>
              </div>
              {isCreator && (
                <Link
                  href={`/availability/${eventId}/manage`}
                  className={getButtonClasses('secondary', 'sm')}
                >
                  Manage Event
                </Link>
              )}
            </div>

            {/* Status banners */}
            {detail.event.status === 'concluded' && (
              <div className={`${getAlertClasses('success')} mb-4`}>
                <p className="font-semibold">This event has been concluded.</p>
                {detail.concludedSlot && (
                  <p className="mt-1">
                    Chosen date: <strong>
                      {detail.concludedSlot.slotLabel || (() => {
                        const d = new Date(detail.concludedSlot.slotDatetime);
                        return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                      })()}
                    </strong>
                  </p>
                )}
                {detail.event.conclusionNote && (
                  <p className="mt-1 text-sm">{detail.event.conclusionNote}</p>
                )}
              </div>
            )}

            {detail.event.status === 'open' && new Date(detail.event.expiresAt) <= new Date() && (
              <div className={`${getAlertClasses('warning')} mb-4`}>
                This event has expired — no more responses are being accepted.
              </div>
            )}

            {detail.event.status === 'closed' && (
              <div className={`${getAlertClasses('info')} mb-4`}>
                This event is closed — no more responses are being accepted.
              </div>
            )}

            {/* Response grid */}
            {detail.slots.length > 0 && (
              <div className="bg-white shadow rounded-lg overflow-x-auto mb-6">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider bg-gray-50 w-32">
                        Respondent
                      </th>
                      {detail.slots.map((slot) => {
                        const { date, time } = formatSlotHeader(slot);
                        const isConcluded = slot.slotId === detail.event.concludedSlotId;
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
                    {/* Current user's editable row */}
                    <tr className="bg-blue-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                        You
                      </td>
                      {detail.slots.map((slot) => (
                        <td key={slot.slotId} className="px-3 py-3 text-center">
                          <ResponseButtons
                            slotId={slot.slotId}
                            current={myResponses[slot.slotId]}
                            onChange={handleResponseChange}
                            disabled={isResponseDisabled()}
                          />
                        </td>
                      ))}
                    </tr>

                    {/* Other respondents (read-only) */}
                    {detail.allResponses.map((participant, idx) => (
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
                    ))}

                    {/* Slot summary row */}
                    {(() => {
                      const totals = buildSlotTotals(detail.slots, detail.allResponses);
                      return (
                        <tr className="bg-gray-50 border-t-2 border-gray-200">
                          <td className="px-4 py-3 text-xs font-medium text-gray-700 uppercase">
                            Totals
                          </td>
                          {detail.slots.map((slot) => {
                            const t = totals[slot.slotId];
                            return (
                              <td key={slot.slotId} className="px-3 py-2 text-center">
                                <div className="flex flex-col gap-0.5 items-center text-xs">
                                  <span className="text-green-700">{t.yes} ✓</span>
                                  <span className="text-amber-600">{t.maybe} ?</span>
                                  <span className="text-red-600">{t.no} ✗</span>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            )}

            {/* Save button and feedback */}
            {!isResponseDisabled() && (
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className={getButtonClasses('primary', 'md')}
                >
                  {saving ? 'Saving…' : 'Save My Responses'}
                </button>

                {saveSuccess && (
                  <span className="text-sm text-green-700 font-medium">
                    Responses saved.
                  </span>
                )}

                {saveError && (
                  <span className="text-sm text-red-700">
                    {saveError}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
