// src/lib/maintenance.ts
// Maintenance-mode flag, checked at two enforcement points:
//   1. authenticateUser() (src/lib/auth-sheets.ts) — blocks new non-Admin logins
//   2. middleware.ts — redirects already-logged-in non-Admin sessions on their next request
// See specs/Phase_0_1_Migration_Plan.md, Step 0.
//
// In-memory TTL cache to avoid hitting Postgres on every request/login attempt. Same
// per-instance caveat as the diary/announcements caches (Caching & Egress Strategy in the
// plan): a cold serverless instance does one fresh fetch, which is fine — this only needs
// to be *eventually* consistent within a few seconds, not instantaneous.

import { getLabelConfig } from './config-supabase';

const CACHE_TTL_MS = 20_000; // 20s, within the plan's 15-30s range

let cachedValue: boolean | null = null;
let cachedAt = 0;

export async function isMaintenanceModeOn(): Promise<boolean> {
  const now = Date.now();
  if (cachedValue !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedValue;
  }

  const config = await getLabelConfig();
  cachedValue = config.maintenance_mode === 'true';
  cachedAt = now;
  return cachedValue;
}
