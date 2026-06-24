'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';

function UnlockForm() {
  const params = useSearchParams();

  // Only allow same-site relative redirects (guard against open redirects)
  const fromParam = params.get('from') || '/fixtures';
  const from = fromParam.startsWith('/') && !fromParam.startsWith('//') ? fromParam : '/fixtures';

  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // Full reload so the Navbar re-reads the members_area cookie and shows
        // the "Members Area Active" indicator.
        window.location.href = from;
      } else {
        setError(data.error || 'Incorrect PIN. Please try again.');
        setPin('');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/bhbc-logo.jpg" alt="Burgess Hill Bowls Club" width={72} height={72} className="rounded-full" />
          <h1 className="mt-4 text-xl font-bold text-gray-900">Burgess Hill Bowls Club</h1>
          <p className="mt-1 text-sm text-gray-600">Enter the access PIN to view the club pages.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Access PIN"
            aria-label="Access PIN"
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-lg tracking-widest focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          {error && <p className="text-center text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !pin.trim()}
            className="w-full rounded-lg bg-green-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? 'Checking…' : 'Continue'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-500">
          Club member?{' '}
          <a href="/login" className="font-semibold text-green-700 hover:underline">Log in</a>
        </p>
      </div>
    </div>
  );
}

export default function UnlockPage() {
  return (
    <Suspense fallback={null}>
      <UnlockForm />
    </Suspense>
  );
}
