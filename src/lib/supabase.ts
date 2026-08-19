// src/lib/supabase.ts
// Supabase (Postgres) client setup + env var getters
// Mirrors the lazy-loading, clear-error-message pattern already used in sheets.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// ENVIRONMENT VARIABLE GETTERS (Lazy Loading)
// ============================================================================

export function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error('SUPABASE_URL environment variable is not set. Check your .env.local file.');
  }
  return url;
}

export function getSupabaseServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not set. Check your .env.local file.');
  }
  return key;
}

// ============================================================================
// CLIENT (Lazy Singleton)
// ============================================================================

let _supabaseClient: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the service role key.
 * Never import or expose this client (or the service role key) in browser code.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_supabaseClient) return _supabaseClient;

  _supabaseClient = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return _supabaseClient;
}
