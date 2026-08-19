// app/rowland/enter/status/page.tsx
// Token-based Rowland entry status page (no login required) — ?token=xxx from the
// confirmation email.

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface StatusData {
  clubName: string;
  trophy: 'edward' | 'gladys';
  teamNumber: number;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  amountDue: string;
  amountReceived: string;
  paymentStatus: 'Unpaid' | 'Partial' | 'Paid';
}

const STATUS_STYLES: Record<StatusData['paymentStatus'], { badge: string; label: string }> = {
  Unpaid: { badge: 'bg-red-100 text-red-700', label: 'Unpaid' },
  Partial: { badge: 'bg-yellow-100 text-yellow-700', label: 'Partially Paid' },
  Paid: { badge: 'bg-green-100 text-green-700', label: 'Paid' },
};

// useSearchParams() (for ?token=) needs a Suspense boundary for static export — next
// dev doesn't enforce this, next build does.
export default function RowlandEntryStatusPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-b from-green-50 to-white" />}>
      <RowlandEntryStatusInner />
    </Suspense>
  );
}

function RowlandEntryStatusInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError('No token provided.');
      setLoading(false);
      return;
    }
    fetch(`/api/rowland/enter/status?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Failed to load status');
        setData(body);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-lg w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Rowland Cup Entry Status</h1>

        {loading && <p className="text-gray-600 text-center">Loading…</p>}

        {!loading && error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-center">
            {error}
          </div>
        )}

        {!loading && data && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-gray-700">{data.clubName}</p>
              <p className="font-semibold text-gray-900">
                {data.trophy === 'edward' ? 'Edward Rowland' : 'Gladys Rowland'} — Team {data.teamNumber}
              </p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-700">Contact:</span><span className="text-gray-900 font-medium">{data.contactName}</span></div>
              <div className="flex justify-between"><span className="text-gray-700">Phone:</span><span className="text-gray-900 font-medium">{data.contactPhone}</span></div>
              <div className="flex justify-between"><span className="text-gray-700">Email:</span><span className="text-gray-900 font-medium">{data.contactEmail}</span></div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-xs text-gray-600 mb-2">
                Payment shown below is for {data.clubName}'s whole Rowland Cup entry, not just this team.
              </p>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">Amount Due:</span>
                <span className="text-gray-900 font-medium">£{data.amountDue}</span>
              </div>
              <div className="flex justify-between text-sm mb-3">
                <span className="text-gray-700">Amount Received:</span>
                <span className="text-gray-900 font-medium">£{data.amountReceived}</span>
              </div>
              <div className="text-center">
                <span className={`inline-block text-xs font-medium px-3 py-1 rounded-full ${STATUS_STYLES[data.paymentStatus].badge}`}>
                  {STATUS_STYLES[data.paymentStatus].label}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
