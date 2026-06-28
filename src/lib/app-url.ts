// src/lib/app-url.ts
// Single source of truth for the app's base URL when building links (emails, etc.).
// Order of preference:
//   1. The host of the current request — so links always match the domain the user
//      is actually on (custom domain vs vercel.app), with no env to misconfigure.
//   2. NEXT_PUBLIC_APP_URL  (explicit config)
//   3. NEXTAUTH_URL
//   4. A sensible production default.
//
// `headers()` is request-scoped (Next App Router) and works wherever this is called
// from a route handler / server component. In a non-request context (e.g. a cron
// job) it throws, and we fall back to the env config.

import { headers } from 'next/headers';

export async function getAppUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    if (host) {
      const proto = h.get('x-forwarded-proto') || 'https';
      return `${proto}://${host}`;
    }
  } catch {
    // Not in a request context — fall through to env config.
  }
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'https://portal.burgesshillbowlsclub.com'
  );
}
