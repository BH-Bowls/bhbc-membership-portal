// app/rowland/enter/page.tsx
// Public Rowland Cup team entry form (no login required)

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { formatOrdinalDate } from '@/lib/date-utils';

interface ContactForm {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

const EMPTY_CONTACT: ContactForm = { contactName: '', contactPhone: '', contactEmail: '' };

interface TeamSlot {
  trophy: 'edward' | 'gladys';
  teamNumber: 1 | 2;
  label: string;
}

// useSearchParams() (for ?from=admin) needs a Suspense boundary for static export —
// next dev doesn't enforce this, next build does. This thin wrapper is the whole
// reason the form itself isn't the default export.
export default function RowlandEnterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-b from-green-50 to-white" />}>
      <RowlandEnterForm />
    </Suspense>
  );
}

function RowlandEnterForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const fromAdmin = searchParams.get('from') === 'admin';

  // Form setup data
  const [clubs, setClubs] = useState<string[]>([]);
  const [feePerTeam, setFeePerTeam] = useState(16);
  const [deadline, setDeadline] = useState('');
  const [loadingSetup, setLoadingSetup] = useState(true);

  // Form state
  const [clubName, setClubName] = useState('');
  const [edwardCount, setEdwardCount] = useState<0 | 1 | 2>(0);
  const [gladysCount, setGladysCount] = useState<0 | 1 | 2>(0);
  // Always keep 2 slots per trophy in state so switching the count back up doesn't
  // lose what was already typed.
  const [edwardContacts, setEdwardContacts] = useState<ContactForm[]>([{ ...EMPTY_CONTACT }, { ...EMPTY_CONTACT }]);
  const [gladysContacts, setGladysContacts] = useState<ContactForm[]>([{ ...EMPTY_CONTACT }, { ...EMPTY_CONTACT }]);
  const [consentToPublish, setConsentToPublish] = useState(false);

  // Honeypot field (should remain empty)
  const [website, setWebsite] = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ amountDue: string; paymentReference: string } | null>(null);

  useEffect(() => {
    fetch('/api/rowland/enter')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setClubs(data.clubs || []);
        setFeePerTeam(data.feePerTeam || 16);
        setDeadline(data.deadline || '');
      })
      .catch(() => setError('Could not load the entry form. Please try again later.'))
      .finally(() => setLoadingSetup(false));
  }, []);

  // The ordered list of team slots implied by the two counts — what actually gets shown/submitted.
  const teamSlots: TeamSlot[] = [];
  for (let i = 1; i <= edwardCount; i++) teamSlots.push({ trophy: 'edward', teamNumber: i as 1 | 2, label: `Edward Rowland — Team ${i}` });
  for (let i = 1; i <= gladysCount; i++) teamSlots.push({ trophy: 'gladys', teamNumber: i as 1 | 2, label: `Gladys Rowland — Team ${i}` });

  const totalTeams = edwardCount + gladysCount;
  const amountDue = (totalTeams * feePerTeam).toFixed(2);

  function getContact(slot: TeamSlot): ContactForm {
    const arr = slot.trophy === 'edward' ? edwardContacts : gladysContacts;
    return arr[slot.teamNumber - 1];
  }

  function updateContact(slot: TeamSlot, field: keyof ContactForm, value: string) {
    const setArr = slot.trophy === 'edward' ? setEdwardContacts : setGladysContacts;
    setArr((prev) => {
      const next = [...prev];
      next[slot.teamNumber - 1] = { ...next[slot.teamNumber - 1], [field]: value };
      return next;
    });
  }

  function copyContactFrom(target: TeamSlot, source: TeamSlot) {
    const sourceContact = getContact(source);
    const setArr = target.trophy === 'edward' ? setEdwardContacts : setGladysContacts;
    setArr((prev) => {
      const next = [...prev];
      next[target.teamNumber - 1] = { ...sourceContact };
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (totalTeams === 0) {
      setError('Please enter at least one team.');
      return;
    }
    if (!consentToPublish) {
      setError('Please agree to your contact details being shared with opponent clubs before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/rowland/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clubName,
          edwardTeams: edwardCount,
          gladysTeams: gladysCount,
          teams: teamSlots.map((slot) => ({
            trophy: slot.trophy,
            teamNumber: slot.teamNumber,
            ...getContact(slot),
          })),
          consentToPublish,
          website, // Honeypot
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit entry');
      }

      setResult({ amountDue: data.amountDue, paymentReference: data.paymentReference });
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingSetup) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center">
        <p className="text-gray-600">Loading…</p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-lg w-full">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">Entry Submitted!</h1>
          <p className="text-gray-700 mb-6 text-center">
            A confirmation email has been sent to each contact you gave. Please pay the
            entry fee using the details below.
          </p>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <div className="flex justify-between py-1">
              <span className="text-gray-700">Total Entry Fee:</span>
              <span className="font-bold text-gray-900">£{result.amountDue}</span>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-700">Bank:</span><span className="text-gray-900 font-medium">HSBC</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Sort Code:</span><span className="text-gray-900 font-medium">40-15-16</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Account Number:</span><span className="text-gray-900 font-medium">81554948</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Account Name:</span><span className="text-gray-900 font-medium">Burgess Hill Bowls Club</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Reference:</span><span className="text-red-600 font-bold">{result.paymentReference}</span></div>
          </div>

          {deadline && (
            <p className="text-sm text-gray-700 mt-4 text-center">
              Entry and payment must reach us no later than <strong>{formatOrdinalDate(deadline)}</strong>.
            </p>
          )}

          <button
            onClick={() => {
              if (fromAdmin) router.push('/rowland/admin');
              else window.location.href = 'https://www.burgesshillbowlsclub.com/rowland';
            }}
            className="w-full mt-6 bg-green-700 text-white px-6 py-3 rounded-md font-medium hover:bg-green-800"
          >
            {fromAdmin ? 'Back to Admin' : 'Return Home'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      <div className="bg-green-700 text-white py-6">
        <div className="max-w-2xl mx-auto px-4">
          <h1 className="text-2xl font-bold text-gray-900">Burgess Hill Bowls Club</h1>
          <p className="text-green-100 mt-1">Rowland Cup — Team Entry</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-lg p-6 md:p-8">
          <p className="text-gray-700 mb-6">
            Enter your club's team(s) for the Edward Rowland and/or Gladys Rowland
            competitions below. The entry fee is £{feePerTeam.toFixed(2)} per team.
            {deadline && <> Entry and payment must reach us no later than <strong>{formatOrdinalDate(deadline)}</strong>.</>}
          </p>

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Honeypot field - hidden from users */}
            <div className="hidden" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                type="text"
                id="website"
                name="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            {/* Club */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Club <span className="text-red-500">*</span>
              </label>
              <select
                value={clubName}
                onChange={(e) => setClubName(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
              >
                <option value="">Select your club…</option>
                {clubs.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            {/* Team counts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Teams for Edward Rowland</label>
                <select
                  value={edwardCount}
                  onChange={(e) => setEdwardCount(Number(e.target.value) as 0 | 1 | 2)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Teams for Gladys Rowland</label>
                <select
                  value={gladysCount}
                  onChange={(e) => setGladysCount(Number(e.target.value) as 0 | 1 | 2)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>
            </div>

            {/* Contact per team */}
            {teamSlots.map((slot, index) => {
              const priorSlots = teamSlots.slice(0, index);
              const contact = getContact(slot);
              return (
                <div key={`${slot.trophy}-${slot.teamNumber}`} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-900">{slot.label} — Contact</h3>
                    {priorSlots.length > 0 && (
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const source = priorSlots.find((s) => `${s.trophy}-${s.teamNumber}` === e.target.value);
                          if (source) copyContactFrom(slot, source);
                          e.target.value = '';
                        }}
                        className="text-sm border border-gray-300 rounded-md px-2 py-1 text-gray-700"
                      >
                        <option value="">Same contact as…</option>
                        {priorSlots.map((s) => (
                          <option key={`${s.trophy}-${s.teamNumber}`} value={`${s.trophy}-${s.teamNumber}`}>{s.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={contact.contactName}
                        onChange={(e) => updateContact(slot, 'contactName', e.target.value)}
                        required
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Phone <span className="text-red-500">*</span></label>
                      <input
                        type="tel"
                        value={contact.contactPhone}
                        onChange={(e) => updateContact(slot, 'contactPhone', e.target.value)}
                        required
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Email <span className="text-red-500">*</span></label>
                      <input
                        type="email"
                        value={contact.contactEmail}
                        onChange={(e) => updateContact(slot, 'contactEmail', e.target.value)}
                        required
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {totalTeams > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex justify-between text-gray-900">
                  <span>{totalTeams} team{totalTeams !== 1 ? 's' : ''} × £{feePerTeam.toFixed(2)}</span>
                  <span className="font-bold">£{amountDue}</span>
                </div>
              </div>
            )}

            {/* Consent */}
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="consent"
                checked={consentToPublish}
                onChange={(e) => setConsentToPublish(e.target.checked)}
                required
                className="mt-1"
              />
              <label htmlFor="consent" className="text-sm text-gray-700">
                I agree that the above name(s) and contact details may be shared with
                opponent clubs during the competition. <span className="text-red-500">*</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting || totalTeams === 0}
              className="w-full bg-green-700 text-white px-6 py-3 rounded-md font-medium hover:bg-green-800 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit Entry'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
