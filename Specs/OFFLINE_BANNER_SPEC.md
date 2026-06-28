# Spec: Global "You appear to be offline" banner

Portable feature brief — implement idiomatically for this repo (file names/paths may differ).

## Goal
Show a small global banner when the device/app can't reach the internet, so users get a
clear "offline" signal instead of a silent spinner. Cheap — **no polling, no per-request
changes at call sites.**

## Two complementary signals (both needed)
1. **`navigator.onLine` + `online`/`offline` events** — reliable on **mobile** (flight mode
   drops the interface). **Unreliable on desktop**: stays `true` while any interface (incl.
   loopback) is up, so it alone misses "connected to a LAN but no internet".
2. **A transparent `window.fetch` wrapper** — flips the banner ON when a real request rejects
   with a **`TypeError`** (genuine network failure / server unreachable), and clears it when
   the next request actually reaches a server. This catches the desktop / Vercel case that
   signal 1 misses.

## Implementation (a single client component, mounted once in the root layout)
- `'use client'`. Track an `offline` boolean in state.
- Keep two refs: `navOfflineRef` and `fetchFailedRef`. `recompute()` sets state =
  `navOfflineRef.current || fetchFailedRef.current` (only re-renders on a real flip).
- **navigator layer:** on mount and on `online`/`offline` events, set
  `navOfflineRef = !navigator.onLine`. On a reported reconnect (`navigator.onLine === true`)
  also clear `fetchFailedRef` (so a stale fetch failure doesn't keep the banner up).
- **fetch layer:**
  - `const originalFetch = window.fetch.bind(window)` — **bind to window** or you get
    "Illegal invocation" in some browsers.
  - Replace `window.fetch` with a wrapper that does
    `try { const r = await originalFetch(...args); clear fetchFailed; return r } catch (e)
     { if (e instanceof TypeError) set fetchFailed; throw e }`.
    It must **forward args, the response, and re-throw errors untouched** — purely passive.
  - Only treat `TypeError` as offline (ignore `AbortError` etc.).
  - On cleanup, only restore `window.fetch` if it's still our wrapper.
- Render: when `offline`, a `fixed top-0 inset-x-0 z-[200]` amber bar with a warning icon and
  "You appear to be offline — some things won't load until you reconnect." (escape the
  apostrophe for JSX). Return `null` otherwise.
- Add `<OfflineBanner />` once in the **root layout** `<body>` (it's a client component;
  fine inside a server layout).

## Gotchas / things learned
- `window.fetch.bind(window)` is mandatory.
- HTTP errors (4xx/5xx) **resolve** — they are NOT offline. Only a thrown `TypeError` is.
- **localhost is a misleading test**: requests to localhost succeed even in OS flight mode
  (loopback), so the banner won't fire there. Test with **DevTools → Network → Offline**
  (blocks all requests + sets navigator.onLine false) or against the real remote server.
- Trade-off accepted: "connected to wifi but no internet" with no requests in flight won't
  show until the next failed request — fine without adding a reachability ping.
