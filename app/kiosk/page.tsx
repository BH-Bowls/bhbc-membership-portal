// app/kiosk/page.tsx
// Kiosk PIN entry page for clubhouse tablet access
// Simple PIN-based authentication for shared tablet use

'use client';

import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function KioskLoginPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect to friendlies if already logged in
  useEffect(() => {
    if (status === 'authenticated' && session) {
      router.push('/friendlies');
    }
  }, [status, session, router]);

  // Show loading while checking session
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-blue-600 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-blue-100">Loading...</p>
        </div>
      </div>
    );
  }

  // If authenticated, show nothing while redirecting
  if (status === 'authenticated') {
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!pin || pin.length < 4) {
      setError('Please enter the PIN');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Authenticate using the clubhouse kiosk credentials
      const result = await signIn('credentials', {
        identifier: 'clubhouse',
        password: pin,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid PIN');
        setPin('');
      } else {
        // Successful login - redirect to friendlies (main kiosk landing page)
        router.push('/friendlies');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handlePinChange(value: string) {
    // Only allow digits
    const digits = value.replace(/\D/g, '');
    setPin(digits);
    setError('');
  }

  return (
    <div className="min-h-screen bg-blue-600 flex flex-col items-center justify-center p-4">
      {/* Club branding */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white mb-2 text-gray-900">
          Burgess Hill Bowls Club
        </h1>
        <p className="text-blue-100 text-xl">
          Clubhouse Kiosk
        </p>
      </div>

      {/* PIN entry card */}
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <h2 className="text-2xl font-semibold text-gray-900 text-center mb-6">
          Enter PIN to Continue
        </h2>

        <form onSubmit={handleSubmit}>
          {/* PIN input - large touch-friendly */}
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => handlePinChange(e.target.value)}
            placeholder="••••••"
            maxLength={8}
            autoFocus
            disabled={loading}
            className="w-full text-center text-4xl tracking-[0.5em] py-4 px-6 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
          />

          {/* Error message */}
          {error && (
            <p className="mt-4 text-center text-red-600 font-medium">
              {error}
            </p>
          )}

          {/* Submit button - large touch-friendly */}
          <button
            type="submit"
            disabled={loading || !pin}
            className="w-full mt-6 py-4 px-6 text-xl font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-3">
                <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Signing in...
              </span>
            ) : (
              'Enter'
            )}
          </button>
        </form>
      </div>

      {/* Footer */}
      <p className="mt-8 text-blue-100 text-sm">
        For member login, visit the main site
      </p>
    </div>
  );
}
