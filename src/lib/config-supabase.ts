// src/lib/config-supabase.ts
// Read and write key-value config from the Postgres `config` table.
// Same function names and signatures as config-sheets.ts so call sites don't need to change
// when this replaces it — see specs/Phase_0_1_Migration_Plan.md, Step 0.

import { getSupabaseClient } from './supabase';

/** Fetch all key-value pairs from the config table as a plain Record. */
export async function getLabelConfig(): Promise<Record<string, string>> {
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
export async function updateLabelConfig(updates: Record<string, string>): Promise<void> {
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
