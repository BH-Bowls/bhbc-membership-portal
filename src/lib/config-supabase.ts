// src/lib/config-supabase.ts
// Read and write key-value config from the Postgres `config` table. Holds every app-wide
// setting, not just Labels — maintenance_mode, age_reference_date, min_friendlies_for_
// competitions, and the Labels printing fields all live in the same table. See
// specs/Phase_0_1_Migration_Plan.md, Step 0.

import { getSupabaseClient } from './supabase';

/** Fetch all key-value pairs from the config table as a plain Record. */
export async function getConfig(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('config').select('key, value');
  if (error) {
    throw new Error(`Failed to fetch config: ${error.message}`);
  }

  const config: Record<string, string> = {};
  for (const row of data ?? []) {
    config[row.key] = row.value;
  }
  return config;
}

/**
 * Update specific keys in the config table. Only updates rows whose key already exists —
 * matches config-sheets.ts's behaviour (it does not insert new keys either).
 */
export async function updateConfig(updates: Record<string, string>): Promise<void> {
  const supabase = getSupabaseClient();

  for (const [key, value] of Object.entries(updates)) {
    const { error } = await supabase
      .from('config')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key);
    if (error) {
      throw new Error(`Failed to update config key "${key}": ${error.message}`);
    }
  }
}
