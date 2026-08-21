// app/bar/account/page.tsx
// Member self-view of their own bar (cash) account — balance + history. Any logged-in
// member; if they have no account yet, it explains how to start one.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { BarLedgerEntry } from '@/lib/bar-supabase';

const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const TYPE_LABEL: Record<string, string> = {
  topup: 'Top-up', purchase: 'Purchase', refund: 'Refund', adjustment: 'Adjustment',
};

export default function MyBarAccountPage() {
  const { data: session, status } = useSession();
  const [balance, setBalance] = useState(0);
  const [exists, setExists] = useState(false);
  const [history, setHistory] = useState<BarLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/bar/me').then((r) => r.json()).then((d) => {
      if (d.account) {
        setExists(d.account.exists);
        setBalance(d.account.balancePence);
        setHistory(d.account.history ?? []);
      }
    }).finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">My Bar Account</h1>
        <p className="text-gray-600 text-sm mb-6">Your prepaid cash balance at the bar.</p>

        {loading ? (
          <div className="text-gray-400 text-center py-10">Loading…</div>
        ) : !exists ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-700">
            You don&apos;t have a bar cash account yet. Top up any amount (cash, paper notes) at the bar to start one —
            or keep paying by card as normal.
          </div>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-5 text-center">
              <div className="text-sm text-gray-500">Balance</div>
              <div className={`text-4xl font-bold ${balance <= 200 ? 'text-red-600' : 'text-green-700'}`}>{fmt(balance)}</div>
              {balance <= 200 && <div className="text-sm text-red-600 mt-1">Running low — top up at the bar.</div>}
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Recent activity</h2>
              {history.length === 0 ? <p className="text-gray-400 text-sm py-2">Nothing yet.</p> : history.map((h) => (
                <div key={h.id} className="flex justify-between items-center text-sm py-1.5 border-b border-gray-100 last:border-0">
                  <span className="text-gray-700">{new Date(h.createdAt).toLocaleDateString('en-GB')} · {TYPE_LABEL[h.type] ?? h.type}</span>
                  <span className={h.amountPence < 0 ? 'text-gray-800' : 'text-green-700 font-medium'}>
                    {h.amountPence < 0 ? '−' : '+'}{fmt(Math.abs(h.amountPence))}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
