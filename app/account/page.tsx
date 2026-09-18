'use client';

// app/account/page.tsx
// My Account — two functions: a history of the member's own bar wallet
// transactions, and a membership card (tap to flip to a QR for the till).

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import QRCode from 'qrcode';

interface BarLedgerEntry {
  id: string;
  type: string;
  amountPence: number;
  balanceAfterPence: number;
  note: string | null;
  staff: string | null;
  paymentMethod: string | null;
  createdAt: string;
}

interface MembershipCardData {
  fullName: string;
  honorary: boolean;
  latestRenewedSeasonYear: number | null;
}

const fmt = (pence: number) => '£' + (pence / 100).toFixed(2);

function validUntilLabel(card: MembershipCardData): { text: string; renewalDue: boolean } {
  if (card.honorary) {
    return { text: 'Honorary Member — no expiry', renewalDue: false };
  }
  if (card.latestRenewedSeasonYear === null) {
    return { text: 'Not yet renewed', renewalDue: true };
  }
  // Interim rule — renewals has no stored expiry date yet (see
  // src/lib/renewals-supabase.ts's getLatestRenewedSeason). Membership runs through
  // to the end of February the year after the season it was renewed for.
  const validUntilDate = new Date(card.latestRenewedSeasonYear + 1, 2, 0);
  const formatted = validUntilDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return { text: 'Valid until ' + formatted, renewalDue: false };
}

type Tab = 'transactions' | 'card';

export default function MyAccountPage() {
  const { data: session, status } = useSession();
  const [tab, setTab] = useState<Tab>('card');

  const [history, setHistory] = useState<BarLedgerEntry[] | null>(null);
  const [hasAccount, setHasAccount] = useState(false);
  const [balancePence, setBalancePence] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState('');

  const [card, setCard] = useState<MembershipCardData | null>(null);
  const [cardError, setCardError] = useState('');
  const [showQr, setShowQr] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetch('/api/bar/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.account) {
          setHasAccount(data.account.exists);
          setBalancePence(data.account.balancePence);
          setHistory(data.account.history);
        } else {
          setHistoryError(data.error || 'Failed to load transactions');
        }
      })
      .catch(() => setHistoryError('Failed to load transactions'))
      .finally(() => setLoadingHistory(false));

    fetch('/api/account/membership-card')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setCardError(data.error);
        } else {
          setCard(data);
        }
      })
      .catch(() => setCardError('Failed to load membership card'));
  }, []);

  useEffect(() => {
    if (showQr && qrCanvasRef.current && session && session.user && session.user.userName) {
      QRCode.toCanvas(qrCanvasRef.current, session.user.userName, { width: 220 }).catch(() => {});
    }
  }, [showQr, session]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-2xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">My Account</h1>

        <div className="border-b border-gray-200 flex gap-6">
          {(['card', 'transactions'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                'pb-2 text-sm font-medium border-b-2 -mb-px ' +
                (tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700')
              }
            >
              {t === 'transactions' ? 'Transactions' : 'Membership Card'}
            </button>
          ))}
        </div>

        {tab === 'transactions' && (
          <div className="bg-white shadow rounded-lg p-5">
            {loadingHistory ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : historyError ? (
              <p className="text-sm text-red-600">{historyError}</p>
            ) : !hasAccount ? (
              <p className="text-sm text-gray-700">You don&apos;t have a bar account yet — one is created the first time you top up at the till.</p>
            ) : (
              <>
                <div className="flex justify-between items-baseline mb-4">
                  <span className="text-sm text-gray-700">Current balance</span>
                  <span className="text-xl font-bold text-gray-900">{fmt(balancePence)}</span>
                </div>
                {history === null || history.length === 0 ? (
                  <p className="text-sm text-gray-500">No transactions yet.</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {history.map((h) => (
                      <div key={h.id} className="flex justify-between text-sm py-2">
                        <div>
                          <div className="text-gray-900 capitalize">{h.type}</div>
                          <div className="text-xs text-gray-500">{new Date(h.createdAt).toLocaleString('en-GB')}</div>
                        </div>
                        <div className="text-right">
                          <div className={h.amountPence < 0 ? 'text-gray-900' : 'text-green-700'}>
                            {h.amountPence < 0 ? '−' : '+'}{fmt(Math.abs(h.amountPence))}
                          </div>
                          <div className="text-xs text-gray-500">Balance {fmt(h.balanceAfterPence)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'card' && (
          <div>
            {cardError ? (
              <p className="text-sm text-red-600">{cardError}</p>
            ) : card === null ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : (
              <>
                <button onClick={() => setShowQr(!showQr)} className="w-full text-left">
                  {!showQr ? (
                    <div className="bg-gradient-to-br from-blue-700 to-blue-900 text-white rounded-2xl shadow-lg p-6 aspect-[16/10] flex flex-col justify-between">
                      <div className="flex items-center gap-3">
                        <img src="/bhbc-logo.jpg" alt="BHBC Logo" className="h-12 w-auto rounded bg-white p-1" />
                        <div>
                          <div className="font-bold text-lg leading-tight">Burgess Hill Bowls Club</div>
                          <div className="text-blue-200 text-xs">Membership Card</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-2xl font-semibold">{card.fullName}</div>
                        <div className={'text-sm mt-1 ' + (validUntilLabel(card).renewalDue ? 'text-amber-300 font-medium' : 'text-blue-200')}>
                          {validUntilLabel(card).text}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white border border-gray-200 rounded-2xl shadow-lg p-6 aspect-[16/10] flex flex-col items-center justify-center">
                      <canvas ref={qrCanvasRef} />
                      <p className="text-xs text-gray-500 mt-3">Show this to bar staff to be found on the till instantly.</p>
                    </div>
                  )}
                </button>
                <p className="text-xs text-gray-500 mt-2 text-center">Tap the card to {showQr ? 'show your details' : 'show your QR code'}.</p>
                {validUntilLabel(card).renewalDue && (
                  <p className="text-sm text-gray-700 mt-4 text-center">
                    <Link href="/renewals" className="text-blue-600 hover:text-blue-800 font-medium">Renew your membership</Link>
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
