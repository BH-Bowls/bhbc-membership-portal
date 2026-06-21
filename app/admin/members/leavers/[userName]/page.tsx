// app/admin/members/leavers/[userName]/page.tsx
// Read-only view of a single leaver, with a Reinstate action. Admin only.

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { getButtonClasses, getCardClasses } from '@/config/theme-helpers';
import type { LeaverDetail } from '@/lib/leavers-sheets';

export default function LeaverViewPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const userNameParam = decodeURIComponent(String(params.userName));

  const [leaver, setLeaver] = useState<LeaverDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReinstate, setShowReinstate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load the leaver's details
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/admin/leavers/${encodeURIComponent(userNameParam)}`);
        if (!res.ok) {
          setError(res.status === 404 ? 'Leaver not found.' : 'Failed to load leaver.');
          setLoading(false);
          return;
        }
        const json = await res.json();
        setLeaver(json.leaver);
        setLoading(false);
      } catch {
        setError('Failed to load leaver.');
        setLoading(false);
      }
    };
    load();
  }, [userNameParam]);

  // Reinstate this leaver, then return to the leavers list
  const confirmReinstate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(userNameParam)}/reinstate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to reinstate member.');
        setSubmitting(false);
        setShowReinstate(false);
        return;
      }
      router.push('/admin/members/leavers');
    } catch {
      setError('Failed to reinstate member.');
      setSubmitting(false);
      setShowReinstate(false);
    }
  };

  const navName = session && session.user && session.user.name ? session.user.name : undefined;
  const navRole = session && session.user ? session.user.role : undefined;

  // One read-only label/value row
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-gray-100 last:border-b-0">
      <span className="text-sm text-gray-700">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right">{value || '—'}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={navName} userRole={navRole} />

      <main className="max-w-2xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <button className="text-sm text-gray-700 mb-2 hover:text-gray-900" onClick={() => router.push('/admin/members/leavers')}>
          ← Back to leavers
        </button>

        {error ? (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>
        ) : null}

        {loading ? (
          <p className="text-sm text-gray-700">Loading…</p>
        ) : leaver === null ? null : (
          <>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">{leaver.firstName} {leaver.lastName}</h1>
            <p className="text-sm text-gray-700 mb-4">{leaver.userName} (read-only)</p>

            <div className={`${getCardClasses('md')} mb-4`}>
              <h2 className="text-base font-semibold text-gray-900 mb-2">Left the Club</h2>
              {row('Left Date', leaver.leftDate)}
              {row('Reason', leaver.leftReason)}
              {row('Notes', leaver.leftNotes)}
            </div>

            <div className={`${getCardClasses('md')} mb-4`}>
              <h2 className="text-base font-semibold text-gray-900 mb-2">Details</h2>
              {row('Known As', leaver.knownAs)}
              {row('Member Type', leaver.memberType)}
              {row('Age Demographic', leaver.ageDemographic)}
              {row('Year Started', leaver.yearStarted)}
              {row('Birthdate', leaver.birthdate)}
              {row('Email', leaver.emailAddress)}
              {row('Mobile', leaver.mobile)}
              {row('Landline', leaver.landline)}
              {row('Address 1', leaver.address1)}
              {row('Address 2', leaver.address2)}
              {row('Address 3', leaver.address3)}
              {row('Post Code', leaver.postCode)}
              {row('Honorary', leaver.honorary)}
              {row('Handicap', leaver.handicap)}
              {row('Role', leaver.role)}
            </div>

            <button className={getButtonClasses('primary', 'md')} onClick={() => setShowReinstate(true)}>
              Reinstate
            </button>
          </>
        )}
      </main>

      <ConfirmDialog
        isOpen={showReinstate}
        title="Reinstate Member"
        message={leaver ? `This will restore ${leaver.firstName} ${leaver.lastName} as an active member.` : ''}
        confirmLabel="Reinstate"
        confirmVariant="primary"
        confirmDisabled={submitting}
        onConfirm={confirmReinstate}
        onCancel={() => setShowReinstate(false)}
      >
        <p className="mb-4 text-left text-sm text-gray-700">
          You may wish to update their contact details and reset their password after reinstatement.
        </p>
      </ConfirmDialog>
    </div>
  );
}
