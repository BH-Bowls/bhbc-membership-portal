/**
 * backfill-club-ids.ts
 *
 * One-time backfill: reads the live Match Day Contacts sheet's club_id/club_name pairs
 * and writes club_id into the matching club_profiles row (matched case-insensitively by
 * club_name). See supabase/migrations/0047_club_id_legacy.sql for why club_id needs to
 * exist in Postgres at all — it's not derivable from club_name, so this is the only way
 * to preserve the values Rowland's existing (unmigrated) match data already references.
 *
 * Safe to re-run — it's an idempotent update keyed by club_name, not an insert.
 *
 * Run: npx dotenv -e .env.local -- npx tsx scripts/backfill-club-ids.ts
 */

import { getClubIdentifiers } from '../src/lib/clubs-sheets';
import { getSupabaseClient } from '../src/lib/supabase';

async function main() {
  const clubs = await getClubIdentifiers();
  console.log(`Read ${clubs.length} club_id/club_name pairs from the sheet.`);

  const supabase = getSupabaseClient();
  let updated = 0;
  let unmatched: string[] = [];

  for (const { clubId, clubName } of clubs) {
    if (!clubId || !clubName) continue;
    const { data, error } = await supabase
      .from('club_profiles')
      .update({ club_id: clubId })
      .ilike('club_name', clubName)
      .select('club_name');

    if (error) {
      console.error(`Failed to update ${clubName}:`, error.message);
      continue;
    }
    if (!data || data.length === 0) {
      unmatched.push(clubName);
      continue;
    }
    updated++;
  }

  console.log(`Updated ${updated} club_profiles rows.`);
  if (unmatched.length > 0) {
    console.log(`No matching club_profiles row for: ${unmatched.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
