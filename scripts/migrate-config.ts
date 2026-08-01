/**
 * migrate-config.ts
 *
 * Reads the live "Labels" sheet (PORTAL_CONFIG_SPREADSHEET_ID) and writes every
 * key/value pair into the new Postgres config table. Real, persisted tooling — also the
 * refresh script for this table, same pattern as migrate-members.ts.
 *
 * UPSERT, not wipe-and-reseed: unlike the other migrate-*.ts scripts, this one must NOT
 * delete existing rows first. The config table already has keys that only ever exist in
 * Postgres (maintenance_mode, age_reference_date, min_friendlies_for_competitions —
 * added directly during Step 0/2, never sourced from Sheets). Wiping the table would
 * destroy those. Every Sheets-sourced key is inserted or updated by key; anything
 * Postgres-only is left alone.
 *
 * No redaction: Labels holds system config (feature flags, thresholds, admin-use
 * category tags), not personal member data — nothing here needs the email/password
 * treatment the other migrate-*.ts scripts apply.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-config.ts
 */

import { getLabelConfig } from '../src/lib/config-sheets';
import { getSupabaseClient } from '../src/lib/supabase';

// getLabelConfig() reads Labels!A:B including row 1 — a pre-existing quirk in the live
// config-sheets.ts (not touched here, out of scope for this migration) means the header
// row itself ("Key" / "Value") leaks through as a spurious entry. Filtered out here
// rather than fixed at the source.
const NOT_REAL_CONFIG_KEYS = ['Key'];

async function main() {
  console.log('1. Reading live Labels config from Google Sheets...');
  const rawSheetConfig = await getLabelConfig();
  const sheetConfig: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawSheetConfig)) {
    if (!NOT_REAL_CONFIG_KEYS.includes(key)) sheetConfig[key] = value;
  }
  const keys = Object.keys(sheetConfig);
  console.log(`   -> ${keys.length} keys (filtered out header-row leak): ${keys.join(', ')}`);

  console.log('2. Checking which Postgres-only keys already exist (will be left untouched)...');
  const supabase = getSupabaseClient();
  const { data: existing, error: existingError } = await supabase.from('config').select('key');
  if (existingError) throw new Error(existingError.message);
  const postgresOnlyKeys = (existing ?? []).map((r) => r.key).filter((k) => !(k in sheetConfig));
  console.log(`   -> ${postgresOnlyKeys.length} Postgres-only key(s): ${postgresOnlyKeys.join(', ') || '(none)'}`);

  console.log('3. Upserting Sheets-sourced keys...');
  const rows = keys.map((key) => ({ key, value: sheetConfig[key] }));
  const { error: upsertError } = await supabase.from('config').upsert(rows, { onConflict: 'key' });
  if (upsertError) throw new Error(`config upsert failed: ${upsertError.message}`);
  console.log(`   -> ${rows.length} keys upserted`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('CONFIG MIGRATION FAILED:', err.message);
  process.exit(1);
});
