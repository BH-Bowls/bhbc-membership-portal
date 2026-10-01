'use client';

// src/hooks/useOnlineStatus.ts
// Shared offline detection — two complementary signals, no polling:
//  1. navigator.onLine + the online/offline events — reliable on mobile (flight mode
//     drops the interface), but unreliable on desktop (stays true while any interface,
//     incl. loopback, is up).
//  2. A transparent window.fetch wrapper that flips to "offline" on a genuine network
//     failure (the fetch rejects with a TypeError) and clears it again on the next
//     request that actually reaches a server. Catches the desktop "connected but no
//     internet" case that navigator.onLine misses.
//
// Moved out of OfflineBanner (which now just renders this) so the bar till can also
// read the same signal to gate offline-only behaviour. The fetch wrap and event
// listeners are installed exactly once, module-level, and shared by every caller —
// installing them per-component-instance would stack multiple wrapper layers if the
// banner and the till are both mounted at once.

import { useEffect, useState } from 'react';

type Listener = (offline: boolean) => void;

let offlineState = false;
let navOffline = false;
let fetchFailed = false;
const listeners = new Set<Listener>();
let installed = false;

function recompute() {
  const next = navOffline || fetchFailed;
  if (next !== offlineState) {
    offlineState = next;
    listeners.forEach((l) => l(offlineState));
  }
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const updateNav = () => {
    navOffline = !navigator.onLine;
    if (navigator.onLine) fetchFailed = false; // a reported reconnect clears any stale fetch-failure flag
    recompute();
  };
  updateNav();
  window.addEventListener('online', updateNav);
  window.addEventListener('offline', updateNav);

  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (...args: Parameters<typeof window.fetch>): Promise<Response> => {
    try {
      const res = await originalFetch(...args);
      if (fetchFailed) { fetchFailed = false; recompute(); } // reached a server -> online
      return res;
    } catch (err) {
      // Genuine network failures reject with a TypeError ("Failed to fetch").
      // Ignore aborts and other errors so they don't trip the flag.
      if (err instanceof TypeError && !fetchFailed) {
        fetchFailed = true;
        recompute();
      }
      throw err;
    }
  }) as typeof window.fetch;
}

function subscribe(listener: Listener): () => void {
  install();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useOnlineStatus(): { offline: boolean; retry: () => Promise<boolean> } {
  const [offline, setOffline] = useState(offlineState);
  useEffect(() => subscribe(setOffline), []);

  // A lightweight, always-available request through the wrapped fetch — its own
  // success/failure updates offlineState via recompute() before this resolves.
  async function retry(): Promise<boolean> {
    try {
      await fetch('/', { method: 'HEAD', cache: 'no-store' });
    } catch { /* offlineState already flipped by the wrapper above */ }
    return !offlineState;
  }

  return { offline, retry };
}
