'use client';

// app/account/page.tsx
// My Account — two functions: a history of the member's own bar wallet
// transactions, and a membership card (tap to flip to a QR for the till).

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { validUntilLabel } from '@/lib/membership-card';

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

// Membership fee card (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §7) — one entry for the
// member and one for each member they manage as a buddy
interface RenewalFeeItem {
  userName: string;
  fullName: string;
  isSelf: boolean;
  state: 'none' | 'draft' | 'payment_pending' | 'not_renewing' | 'outstanding' | 'paid' | 'voided';
  totalFee: number;
  outstanding: number;
  paymentReference: string;
}

interface RenewalFeesData {
  seasonYear: number;
  bankDetails: {
    bankName: string;
    bankSortCode: string;
    bankAccountNumber: string;
    bankAccountName: string;
  };
  stripeEnabled: boolean;
  items: RenewalFeeItem[];
}

const fmt = (pence: number) => '£' + (pence / 100).toFixed(2);
const fmtPounds = (pounds: number) => '£' + pounds.toFixed(2);

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

  const [fees, setFees] = useState<RenewalFeesData | null>(null);
  const [copiedReference, setCopiedReference] = useState<string | null>(null);

  // Pay online (spec §11.3): which outstanding renewals are ticked (all, by default)
  const [unticked, setUnticked] = useState<string[]>([]);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // Back from Stripe: 'waiting' until the webhook has recorded it
  const [paymentStatus, setPaymentStatus] = useState<'waiting' | 'recorded' | 'expired' | 'slow' | null>(null);

  const loadFees = () => {
    // The fee card is extra information — if it fails, the rest of the page still works
    fetch('/api/account/renewal-fees')
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setFees(data);
        }
      })
      .catch(() => {});
  };

  // Returned from Stripe (?payment=processing&session_id=…) — poll until the webhook
  // has recorded the payment. The redirect itself never records anything.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (params.get('payment') !== 'processing' || !sessionId) return;
    setTab('card');
    setPaymentStatus('waiting');
    let attempts = 0;
    let stopped = false;
    const check = () => {
      if (stopped) return;
      attempts += 1;
      fetch('/api/payments/stripe/status?session=' + encodeURIComponent(sessionId))
        .then((r) => r.json())
        .then((data) => {
          if (stopped) return;
          if (data.status === 'recorded') {
            setPaymentStatus('recorded');
            loadFees();
            window.history.replaceState(null, '', '/account');
          } else if (data.status === 'expired') {
            setPaymentStatus('expired');
          } else if (attempts >= 20) {
            setPaymentStatus('slow');
          } else {
            setTimeout(check, 2000);
          }
        })
        .catch(() => {
          if (!stopped && attempts < 20) setTimeout(check, 2000);
        });
    };
    check();
    return () => { stopped = true; };
  }, []);

  const payOnline = async (userNames: string[]) => {
    setPayError(null);
    setPaying(true);
    try {
      const res = await fetch('/api/payments/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userNames: userNames }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setPayError(data.error || 'Could not start the payment.');
        setPaying(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setPayError('Could not start the payment.');
      setPaying(false);
    }
  };

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

    loadFees();
  }, []);

  const copyReference = (reference: string) => {
    navigator.clipboard.writeText(reference).then(() => {
      setCopiedReference(reference);
      setTimeout(() => setCopiedReference(null), 1500);
    }).catch(() => {});
  };

  // Members whose fee card has something to show (voided and not-started show nothing,
  // apart from the existing "Renew your membership" link for the member themselves)
  const feeItems: RenewalFeeItem[] = [];
  if (fees) {
    for (const item of fees.items) {
      if (item.state === 'draft' || item.state === 'payment_pending' || item.state === 'outstanding' || item.state === 'paid') {
        feeItems.push(item);
      }
    }
  }
  let anyOutstanding = false;
  let selfHasFeeItem = false;
  let outstandingCount = 0;
  const tickedToPay: string[] = [];
  let tickedTotal = 0;
  for (const item of feeItems) {
    if (item.state === 'outstanding') {
      anyOutstanding = true;
      outstandingCount += 1;
      if (unticked.indexOf(item.userName) === -1) {
        tickedToPay.push(item.userName);
        tickedTotal += item.outstanding;
      }
    }
    if (item.isSelf) {
      selfHasFeeItem = true;
    }
  }

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
                {validUntilLabel(card).renewalDue && !selfHasFeeItem && (
                  <p className="text-sm text-gray-700 mt-4 text-center">
                    <Link href="/renewals" className="text-blue-600 hover:text-blue-800 font-medium">Renew your membership</Link>
                  </p>
                )}
              </>
            )}

            {paymentStatus === 'waiting' && (
              <div className="mt-6 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-4 py-3 text-sm">
                Payment received — updating your account…
              </div>
            )}
            {paymentStatus === 'recorded' && (
              <div className="mt-6 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm">
                Thank you — your payment has been recorded. Stripe will email you a receipt.
              </div>
            )}
            {paymentStatus === 'slow' && (
              <div className="mt-6 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 text-sm">
                Your payment is taking longer than usual to show here. There&apos;s no need to pay again — refresh this page in a few minutes.
              </div>
            )}
            {paymentStatus === 'expired' && (
              <div className="mt-6 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 text-sm">
                That payment page expired before it was paid. Nothing has been taken — you can start again below.
              </div>
            )}

            {fees && feeItems.length > 0 && (
              <div className="bg-white shadow rounded-lg p-5 mt-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">{fees.seasonYear} membership fees</h2>
                <div className="divide-y divide-gray-100">
                  {feeItems.map((item) => (
                    <div key={item.userName} className="py-3">
                      {feeItems.length > 1 || !item.isSelf ? (
                        <div className="text-sm font-medium text-gray-900">{item.fullName}{item.isSelf ? ' (you)' : ''}</div>
                      ) : null}
                      {item.state === 'draft' && (
                        <p className="text-sm text-amber-800 mt-1">
                          {item.isSelf ? 'Your renewal is' : 'This renewal is'} saved as a draft — it isn&apos;t complete until it&apos;s submitted.{' '}
                          {item.isSelf && (
                            <Link href="/renewals" className="text-blue-600 hover:text-blue-800 font-medium">Go to Renewals</Link>
                          )}
                        </p>
                      )}
                      {item.state === 'payment_pending' && (
                        <p className="text-sm text-blue-900 mt-1">
                          An online payment for {item.isSelf ? 'your' : 'this'} renewal is in progress. If the payment page was left without paying, you can cancel it on Renewals.{' '}
                          {item.isSelf && (
                            <Link href="/renewals" className="text-blue-600 hover:text-blue-800 font-medium">Go to Renewals</Link>
                          )}
                        </p>
                      )}
                      {item.state === 'outstanding' && (
                        <div className="mt-1">
                          <div className="flex justify-between items-baseline">
                            <span className="text-sm text-gray-700">Membership fee outstanding</span>
                            <span className="text-lg font-bold text-gray-900">{fmtPounds(item.outstanding)}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-sm text-gray-700">
                            <span>Bank transfer reference:</span>
                            <span className="font-mono font-semibold text-gray-900">{item.paymentReference}</span>
                            <button
                              type="button"
                              onClick={() => copyReference(item.paymentReference)}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                            >
                              {copiedReference === item.paymentReference ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                        </div>
                      )}
                      {item.state === 'paid' && (
                        <p className="text-sm text-green-700 mt-1">Membership paid — thank you.</p>
                      )}
                    </div>
                  ))}
                </div>

                {anyOutstanding && (
                  <div className="mt-4 border-t border-gray-200 pt-4 text-sm text-gray-700 space-y-2">
                    <p className="font-medium text-gray-900">How to pay</p>
                    {fees.stripeEnabled && (
                      <div className="pb-2">
                        <p><span className="font-medium">Online by card</span>{outstandingCount > 1 ? ', for the members ticked:' : ':'}</p>
                        {outstandingCount > 1 && (
                          <div className="mt-1 space-y-1">
                            {feeItems.map((item) => (
                              item.state !== 'outstanding' ? null : (
                                <label key={item.userName} className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={unticked.indexOf(item.userName) === -1}
                                    onChange={(e) => {
                                      const next: string[] = [];
                                      for (const u of unticked) {
                                        if (u !== item.userName) next.push(u);
                                      }
                                      if (!e.target.checked) next.push(item.userName);
                                      setUnticked(next);
                                    }}
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                                  />
                                  <span className="text-gray-900">{item.fullName} — {fmtPounds(item.outstanding)}</span>
                                </label>
                              )
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => payOnline(tickedToPay)}
                          disabled={paying || tickedToPay.length === 0 || paymentStatus === 'waiting'}
                          className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                        >
                          {paying ? 'Opening payment page…' : `Pay ${fmtPounds(tickedTotal)} online`}
                        </button>
                        {payError && <p className="text-sm text-red-700 mt-2">{payError}</p>}
                      </div>
                    )}
                    <div>
                      <p><span className="font-medium">By bank transfer</span>, using the reference shown above{feeItems.length > 1 ? ' for each member' : ''}:</p>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        {fees.bankDetails.bankAccountName && (<><dt className="text-gray-700">Account name</dt><dd className="text-gray-900">{fees.bankDetails.bankAccountName}</dd></>)}
                        {fees.bankDetails.bankName && (<><dt className="text-gray-700">Bank</dt><dd className="text-gray-900">{fees.bankDetails.bankName}</dd></>)}
                        {fees.bankDetails.bankSortCode && (<><dt className="text-gray-700">Sort code</dt><dd className="text-gray-900 font-mono">{fees.bankDetails.bankSortCode}</dd></>)}
                        {fees.bankDetails.bankAccountNumber && (<><dt className="text-gray-700">Account number</dt><dd className="text-gray-900 font-mono">{fees.bankDetails.bankAccountNumber}</dd></>)}
                      </dl>
                    </div>
                    <p><span className="font-medium">At the bar</span>, by card or cash.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
