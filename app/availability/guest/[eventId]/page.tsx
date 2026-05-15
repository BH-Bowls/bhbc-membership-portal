// app/availability/guest/[eventId]/page.tsx
// Visitor response page — accessed via unique token link, no authentication required

'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses, getAlertClasses } from '@/config/theme-helpers';
import type {
  AvailabilityEvent,
  AvailabilitySlot,
  AvailabilityResponse,
  AvailabilityParticipantResponses,
} from '@/types/availability';

// Format an ISO datetime for slot column headers
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

// Response button for the visitor's editable row
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
      {/* Yes */}
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
      {/* Maybe */}
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
      {/* No */}
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

export default function GuestAvailabilityPage({ params }: { params: { eventId: string } }) {
  const { eventId } = params;
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [event, setEvent] = useState<AvailabilityEvent | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [visitorName, setVisitorName] = useState('');
  const [concludedSlot, setConcludedSlot] = useState<AvailabilitySlot | null>(null);
  const [allResponses, setAllResponses] = useState<AvailabilityParticipantResponses[]>([]);

  const [loading, setLoading] = useState(true);
  const [tokenError, setTokenError] = useState(false);

  // Track visitor's draft responses
  const [myResponses, setMyResponses] = useState<Record<string, AvailabilityResponse>>({});
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Honeypot field (hidden — bots fill this in)
  const [website, setWebsite] = useState('');

  // Fetch event detail using token
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    fetchDetail();
  }, [token, eventId]);

  async function fetchDetail() {
    try {
      const res = await fetch(`/api/availability/guest/${eventId}?token=${encodeURIComponent(token!)}`);

      if (res.status === 401 || res.status === 404) {
        setTokenError(true);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setTokenError(true);
        setLoading(false);
        return;
      }

      const data = await res.json();
      setEvent(data.event);
      setSlots(data.slots || []);
      setVisitorName(data.invitee ? data.invitee.visitorName : '');
      setConcludedSlot(data.concludedSlot || null);
      setAllResponses(data.allResponses || []);
      setMyResponses(data.myResponses || {});
      setLoading(false);
    } catch (fetchError) {
      console.error('[GuestAvailabilityPage] Fetch error:', fetchError);
      setTokenError(true);
      setLoading(false);
    }
  }

  // Update a single slot response
  function handleResponseChange(slotId: string, response: AvailabilityResponse) {
    setMyResponses({ ...myResponses, [slotId]: response });
    setSaveSuccess(false);
  }

  // Save responses via guest respond endpoint
  async function handleSave() {
    // Honeypot check — silently ignore if bot filled the hidden field
    if (website) {
      setSaveSuccess(true);
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

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
      const res = await fetch(`/api/availability/guest/${eventId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          responses: responsesArray,
          website,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setSaveError(data.error || 'Failed to save responses.');
        setSaving(false);
        return;
      }

      setSaveSuccess(true);
      setSaving(false);
      // Re-fetch to update allResponses grid if shown
      await fetchDetail();
    } catch (saveErr) {
      console.error('[GuestAvailabilityPage] Save error:', saveErr);
      setSaveError('Something went wrong. Please try again.');
      setSaving(false);
    }
  }

  // Check if responses can be submitted
  function isResponseDisabled(): boolean {
    if (!event) {
      return true;
    }
    if (event.status !== 'open') {
      return true;
    }
    const expiry = new Date(event.expiresAt);
    if (expiry <= new Date()) {
      return true;
    }
    return false;
  }

  // Build per-slot totals from allResponses
  function buildSlotTotals() {
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
      {/* Navbar in guest mode — no user menu */}
      <Navbar showLogoOnly={true} />

      <div className="container mx-auto px-4 py-8 max-w-5xl">

        {/* Missing token */}
        {!token && (
          <div className={getAlertClasses('warning')}>
            This link appears to be incomplete. Please check the email you received and try again.
          </div>
        )}

        {/* Loading */}
        {token && loading && (
          <div className="text-center py-12">
            <p className="text-gray-700">Loading&hellip;</p>
          </div>
        )}

        {/* Invalid/expired token */}
        {token && !loading && tokenError && (
          <div className={getAlertClasses('warning')}>
            This link is no longer valid or has expired.
          </div>
        )}

        {/* Event content */}
        {token && !loading && !tokenError && event && (
          <div>
            {/* Header */}
            <div className="mb-6">
              {visitorName && (
                <p className="text-gray-700 mb-2">Hello <strong>{visitorName}</strong>,</p>
              )}
              <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
              {event.description && (
                <p className="text-gray-700 mt-1">{event.description}</p>
              )}
              <p className="text-sm text-gray-700 mt-2">
                Created by {event.createdByName} &middot; Closes {formatExpiry(event.expiresAt)}
              </p>
            </div>

            {/* Concluded banner */}
            {event.status === 'concluded' && (
              <div className={`${getAlertClasses('success')} mb-4`}>
                <p className="font-semibold">This event has been concluded.</p>
                {concludedSlot && (
                  <p className="mt-1">
                    Chosen date: <strong>
                      {concludedSlot.slotLabel || (() => {
                        const d = new Date(concludedSlot.slotDatetime);
                        return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                      })()}
                    </strong>
                  </p>
                )}
                {event.conclusionNote && (
                  <p className="mt-1 text-sm">{event.conclusionNote}</p>
                )}
              </div>
            )}

            {/* Expired but still open */}
            {event.status === 'open' && new Date(event.expiresAt) <= new Date() && (
              <div className={`${getAlertClasses('warning')} mb-4`}>
                This event has expired — no more responses are being accepted.
              </div>
            )}

            {/* Closed */}
            {event.status === 'closed' && (
              <div className={`${getAlertClasses('info')} mb-4`}>
                This event is no longer accepting responses.
              </div>
            )}

            {/* Response grid */}
            {slots.length > 0 && (
              <div className="bg-white shadow rounded-lg overflow-x-auto mb-6">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider bg-gray-50 w-32">
                        Respondent
                      </th>
                      {slots.map((slot) => {
                        const { date, time } = formatSlotHeader(slot);
                        const isConcluded = slot.slotId === event.concludedSlotId;
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
                    {/* Visitor's own editable row */}
                    <tr className="bg-blue-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                        You
                      </td>
                      {slots.map((slot) => (
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
                    {allResponses.map((participant, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                          {participant.displayName}
                        </td>
                        {slots.map((slot) => (
                          <td key={slot.slotId} className="px-3 py-3 text-center">
                            <ResponseBadge response={participant.responses[slot.slotId]} />
                          </td>
                        ))}
                      </tr>
                    ))}

                    {/* Summary row */}
                    {(() => {
                      const totals = buildSlotTotals();
                      return (
                        <tr className="bg-gray-50 border-t-2 border-gray-200">
                          <td className="px-4 py-3 text-xs font-medium text-gray-700 uppercase">
                            Totals
                          </td>
                          {slots.map((slot) => {
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

            {/* Honeypot field — hidden from real users, bots fill it in */}
            <div style={{ display: 'none' }} aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                id="website"
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            {/* Save button and feedback */}
            {!isResponseDisabled() && (
              <div>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className={getButtonClasses('primary', 'md')}
                >
                  {saving ? 'Saving…' : 'Save My Responses'}
                </button>

                {saveSuccess && (
                  <div className={`${getAlertClasses('success')} mt-4`}>
                    Your responses have been saved. You can update them any time using this link.
                  </div>
                )}

                {saveError && (
                  <div className={`${getAlertClasses('danger')} mt-4`}>
                    {saveError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
