'use client';

// src/components/BarTerminalPayment.tsx
// The till's "waiting for the card" dialog for the Square Terminal
// (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §10). Checks the payment every 2 seconds; the
// server records the sale / top-up / fee as soon as Square says it's paid, so the till
// only has to show the result.

import { useEffect, useRef, useState } from 'react';

export interface TerminalCheckout {
  id: string;
  kind: 'sale' | 'topup' | 'membership';
  amountPence: number;
  status: string;              // PENDING, IN_PROGRESS, CANCEL_REQUESTED, CANCELED, COMPLETED
  cancelReason: string | null;
  recorded: boolean;
  recordError: string | null;
  result: Record<string, unknown> | null;
  payload?: Record<string, unknown>;   // what was sent: userName, staff, items (sale)
}

const CANCEL_REASONS: Record<string, string> = {
  BUYER_CANCELED: 'The customer cancelled on the Terminal.',
  SELLER_CANCELED: 'Cancelled.',
  TIMED_OUT: 'The Terminal timed out waiting for the card.',
};

function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/** Still waiting on Square, or paid but the server hasn't finished recording it yet. */
function stillWaiting(c: TerminalCheckout): boolean {
  if (c.status === 'CANCELED') return false;
  if (c.status === 'COMPLETED') return !c.recorded && !c.recordError;
  return true;
}

export default function BarTerminalPayment({ checkout: initial, notice, onPaid, onCancelled, onManual }: {
  checkout: TerminalCheckout;
  notice?: string;                                   // e.g. "The Terminal was already waiting for this"
  onPaid: (checkout: TerminalCheckout) => void;      // paid (recorded, or with a problem shown)
  onCancelled: () => void;                           // nothing was taken
  onManual?: () => void;                             // took it on the Terminal keypad instead
}) {
  const [checkout, setCheckout] = useState<TerminalCheckout>(initial);
  const [cancelling, setCancelling] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [confirmManual, setConfirmManual] = useState(false);
  const [polls, setPolls] = useState(0);
  const paidReported = useRef(false);
  const openedAt = useRef(Date.now());
  // Still PENDING after this long = the Terminal hasn't picked it up (off, asleep, no signal)
  const notPickedUp = checkout.status === 'PENDING' && Date.now() - openedAt.current > 20000;

  // Poll until it's finished — less often once it looks like the Terminal isn't there
  useEffect(() => {
    if (!stillWaiting(checkout)) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/bar/square/${encodeURIComponent(checkout.id)}`, { cache: 'no-store' });
        const data = await res.json();
        if (res.ok && data.checkout) {
          setCheckout(data.checkout);
          setConnectionError('');
        } else {
          setConnectionError(data.error || 'Can’t reach Square');
        }
      } catch {
        setConnectionError('No connection');
      } finally {
        setPolls((n) => n + 1);   // schedules the next check even when this one failed
      }
    }, notPickedUp ? 5000 : 2000);
    return () => clearTimeout(timer);
  }, [checkout, polls, notPickedUp]);

  // Paid and recorded cleanly — show "Paid" until the bar person taps OK
  const paidCleanly = checkout.status === 'COMPLETED' && checkout.recorded && !checkout.recordError;
  function reportPaid() {
    if (paidReported.current) return;
    paidReported.current = true;
    onPaid(checkout);
  }

  async function cancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/bar/square/${encodeURIComponent(checkout.id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (res.ok && data.checkout) setCheckout(data.checkout);
      else setConnectionError(data.error || 'Couldn’t cancel — try again');
    } catch {
      setConnectionError('No connection — couldn’t cancel');
    } finally {
      setCancelling(false);
    }
  }

  let body;
  if (checkout.status === 'CANCELED') {
    body = (
      <>
        <p className="text-lg font-semibold text-gray-900">Card payment cancelled</p>
        <p className="text-sm text-gray-700 mt-1">
          {(checkout.cancelReason && CANCEL_REASONS[checkout.cancelReason]) || 'Cancelled.'} Nothing was taken.
        </p>
        {onManual && confirmManual ? (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
            <p className="text-sm text-gray-900">
              Only if <strong>{pounds(checkout.amountPence)}</strong> was taken on the Terminal&apos;s own keypad instead.
            </p>
            <div className="flex gap-2">
              <button onClick={onManual} className="flex-1 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700">Yes, record it</button>
              <button onClick={() => setConfirmManual(false)} className="flex-1 py-2 rounded-lg border border-gray-300 bg-white font-medium hover:bg-gray-50">No</button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-2">
            <button onClick={onCancelled} className="py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">OK</button>
            {onManual && (
              <button onClick={() => setConfirmManual(true)} className="py-2 text-sm text-gray-700 underline">
                Taken on the Terminal&apos;s keypad instead…
              </button>
            )}
          </div>
        )}
      </>
    );
  } else if (paidCleanly) {
    body = (
      <>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-10 w-10 text-green-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="mt-3 text-2xl font-bold text-gray-900">Paid {pounds(checkout.amountPence)}</p>
        <p className="text-sm text-gray-700 mt-1">Card payment taken on the Terminal.</p>
        <button onClick={reportPaid} className="mt-5 w-full py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700">OK</button>
      </>
    );
  } else if (checkout.status === 'COMPLETED' && checkout.recordError) {
    body = (
      <>
        <p className="text-lg font-semibold text-gray-900">Paid {pounds(checkout.amountPence)} on the Terminal</p>
        {checkout.recordError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            <p>{checkout.recordError}</p>
            <p className="mt-1 font-medium">Don&apos;t take the payment again — it&apos;s listed for the committee to sort out.</p>
          </div>
        )}
        <button onClick={() => onPaid(checkout)} className="mt-5 w-full py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">OK</button>
      </>
    );
  } else {
    let status = 'Sent to the Terminal — waiting for the card…';
    if (checkout.status === 'IN_PROGRESS') status = 'The customer is paying on the Terminal…';
    if (checkout.status === 'CANCEL_REQUESTED') status = 'Cancelling…';
    if (checkout.status === 'COMPLETED') status = 'Paid — recording it…';
    body = (
      <>
        <p className="text-sm text-gray-700">Card payment</p>
        <p className="text-4xl font-bold text-gray-900 my-2">{pounds(checkout.amountPence)}</p>
        <div className="flex items-center justify-center gap-2 text-gray-900">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span>{status}</span>
        </div>
        {connectionError && <p className="mt-2 text-sm text-amber-800">{connectionError} — still checking…</p>}
        {notPickedUp && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-gray-900 text-left">
            The Terminal hasn&apos;t picked this up yet. Check it&apos;s switched on, awake and connected to the
            Wi-Fi. If not, press Cancel. Square gives up by itself after 5 minutes.
          </div>
        )}
        {checkout.status !== 'COMPLETED' && checkout.status !== 'CANCEL_REQUESTED' && (
          <button onClick={cancel} disabled={cancelling}
            className="mt-5 w-full py-3 rounded-lg border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50">
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
        {notice && stillWaiting(checkout) && <p className="mb-3 text-sm font-medium text-amber-800">{notice}</p>}
        {body}
      </div>
    </div>
  );
}
