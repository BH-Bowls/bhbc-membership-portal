// src/lib/maintenance.ts
// Maintenance-mode flag, checked at two enforcement points:
//   1. authenticateUser() (src/lib/auth-sheets.ts) — blocks new non-Admin logins
//   2. proxy.ts — redirects already-logged-in non-Admin sessions on their next request
// proxy.ts (formerly middleware.ts) can call this because Next.js 16's Proxy convention
// defaults to the Node.js runtime, not Edge — the old middleware.ts filename defaulted to
// Edge, which can't load the googleapis-based Sheets client this depends on.
// Reads a `maintenance_mode` key ('true'/'false') from the Labels sheet in the Portal
// Config spreadsheet, via the same getLabelConfig() the label-printing feature already
// uses — no extra Sheets read cost. That row must exist in the sheet already (key column
// A, value column B) since updateLabelConfig only updates existing rows, never inserts.
//
// In-memory TTL cache to avoid hitting the Sheets read-quota on every login attempt.
// This only needs to be eventually consistent within a few seconds, not instantaneous —
// a cold serverless instance does one fresh fetch, which is fine.

import { getLabelConfig } from './config-sheets';

const CACHE_TTL_MS = 20_000; // 20s

let cachedValue: boolean | null = null;
let cachedAt = 0;

export async function isMaintenanceModeOn(): Promise<boolean> {
  const now = Date.now();
  if (cachedValue !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedValue;
  }

  const config = await getLabelConfig();
  // Sheets auto-converts a typed "true"/"false" to its native boolean type, and the API
  // returns boolean cells as the formatted string "TRUE"/"FALSE" (uppercase) — so this
  // must be a case-insensitive comparison, not a strict === 'true'.
  const rawValue = config.maintenance_mode || '';
  cachedValue = rawValue.trim().toLowerCase() === 'true';
  cachedAt = now;
  return cachedValue;
}
