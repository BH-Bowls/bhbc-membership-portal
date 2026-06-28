'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Offline indicator with two complementary signals (no polling):
 *
 *  1. `navigator.onLine` + the online/offline events — reliable on mobile (flight
 *     mode drops the interface), but unreliable on desktop (stays true while any
 *     interface, incl. loopback, is up).
 *  2. A transparent `window.fetch` wrapper that flips the banner on a genuine
 *     network failure (the fetch rejects with a TypeError) and clears it again on
 *     the next request that actually reaches a server. This catches the desktop /
 *     "connected but no internet" case that navigator.onLine misses.
 *
 * The wrapper passes every call straight through (args, response, and errors are
 * all forwarded untouched) so it can't change any request's behaviour.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  // Two independent signals; the banner shows if either says "down".
  const navOfflineRef = useRef(false);
  const fetchFailedRef = useRef(false);

  useEffect(() => {
    const recompute = () => setOffline(navOfflineRef.current || fetchFailedRef.current);

    // 1) navigator.onLine
    const updateNav = () => {
      navOfflineRef.current = !navigator.onLine;
      // A reported reconnect also clears any stale fetch-failure flag.
      if (navigator.onLine) fetchFailedRef.current = false;
      recompute();
    };
    updateNav();
    window.addEventListener('online', updateNav);
    window.addEventListener('offline', updateNav);

    // 2) fetch-failure detection
    const originalFetch = window.fetch.bind(window);
    const wrapped = async (...args: Parameters<typeof window.fetch>): Promise<Response> => {
      try {
        const res = await originalFetch(...args);
        if (fetchFailedRef.current) { fetchFailedRef.current = false; recompute(); } // reached a server → online
        return res;
      } catch (err) {
        // Genuine network failures reject with a TypeError ("Failed to fetch").
        // Ignore aborts and other errors so they don't trip the banner.
        if (err instanceof TypeError && !fetchFailedRef.current) {
          fetchFailedRef.current = true;
          recompute();
        }
        throw err;
      }
    };
    window.fetch = wrapped as typeof window.fetch;

    return () => {
      window.removeEventListener('online', updateNav);
      window.removeEventListener('offline', updateNav);
      if (window.fetch === (wrapped as typeof window.fetch)) window.fetch = originalFetch;
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-2 bg-amber-600 px-4 py-1.5 text-center text-sm font-medium text-white shadow">
      <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
      </svg>
      You appear to be offline — some things won’t load until you reconnect.
    </div>
  );
}
