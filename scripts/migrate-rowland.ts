/**
 * migrate-rowland.ts
 *
 * Reads the live RowlandControl + 4 per-competition match sheets + RowlandSettings
 * sheet (ROWLAND_SPREADSHEET_ID, via rowland-sheets.ts — kept read-only for exactly
 * this) and writes them into the new Postgres rowland_comps/rowland_matches/
 * rowland_settings tables (see supabase/migrations/0048_rowland.sql). Same "refresh
 * Dev, rerun for the real Prod cutover" pattern as the other migrate-*.ts scripts.
 *
 * Teams are identified by club_name now, not the legacy club_id the sheets stored
 * (club_profiles never had a club_id column at all — see the Rowland redesign section
 * of specs/Phase_0_1_Migration_Plan.md). The sheets stored both a hand-entered club_id
 * AND a hand-entered club_name for each team — this script prefers a case-insensitive
 * match against the real club_profiles.club_name list (using the canonical spelling
 * when found) and only falls back to the sheet's own raw text when no club_profiles
 * row matches at all (e.g. a club that's since been renamed or removed). There's no
 * FK on home_club_name/away_club_name, so an unresolved name doesn't block the row —
 * it's just flagged so it can be checked by hand.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-rowland.ts
 */

import {
  getAllRowlandComps,
  getRowlandMatches,
  getRowlandMessage,
} from '../src/lib/rowland-sheets';
import type { SheetMatch, SheetTeamRef } from '../src/lib/rowland-sheets';
import { getSupabaseClient } from '../src/lib/supabase';
import type { RowlandCompId } from '../src/types/rowland';
import { ROWLAND_SHEET_NAMES } from '../src/types/rowland';

async function main() {
  console.log('1. Reading RowlandControl + 4 match sheets + RowlandSettings + club_profiles...');
  const supabase = getSupabaseClient();

  const [comps, message, clubRowsResult] = await Promise.all([
    getAllRowlandComps(),
    getRowlandMessage(),
    supabase.from('club_profiles').select('club_name'),
  ]);
  if (clubRowsResult.error) throw new Error(`Failed to fetch club_profiles: ${clubRowsResult.error.message}`);

  const clubNameByLower = new Map<string, string>();
  for (const row of clubRowsResult.data ?? []) {
    if (row.club_name) clubNameByLower.set(String(row.club_name).toLowerCase(), row.club_name);
  }

  let unresolvedTeams = 0;
  function resolveClubName(raw: string): string {
    const canonical = clubNameByLower.get(raw.toLowerCase());
    if (canonical) return canonical;
    console.warn(`   !! No club_profiles match for "${raw}" — kept as-is`);
    unresolvedTeams++;
    return raw;
  }
  function resolveTeam(team: SheetTeamRef | null): { clubName: string | null; teamLetter: string } {
    if (!team) return { clubName: null, teamLetter: '' };
    return { clubName: resolveClubName(team.clubName), teamLetter: team.teamLetter };
  }

  const matchesByComp = new Map<RowlandCompId, SheetMatch[]>();
  let totalMatches = 0;
  for (const compId of Object.keys(ROWLAND_SHEET_NAMES) as RowlandCompId[]) {
    const matches = await getRowlandMatches(compId);
    matchesByComp.set(compId, matches);
    totalMatches += matches.length;
  }
  console.log(`   -> ${comps.length} competitions, ${totalMatches} matches, message ${message ? 'present' : 'empty'}`);

  console.log('2. Wiping existing rowland_matches/rowland_comps/rowland_settings...');
  const { error: wipeMatchesError } = await supabase.from('rowland_matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (wipeMatchesError) throw new Error(`Failed to wipe rowland_matches: ${wipeMatchesError.message}`);
  const { error: wipeCompsError } = await supabase.from('rowland_comps').delete().neq('comp_id', '__never_matches__');
  if (wipeCompsError) throw new Error(`Failed to wipe rowland_comps: ${wipeCompsError.message}`);
  const { error: wipeSettingsError } = await supabase.from('rowland_settings').delete().neq('key', '__never_matches__');
  if (wipeSettingsError) throw new Error(`Failed to wipe rowland_settings: ${wipeSettingsError.message}`);

  console.log('3. Inserting rowland_comps rows...');
  const compsToInsert = comps.map((c) => ({
    comp_id: c.compId,
    comp_name: c.compName,
    season: c.season,
    status: c.status,
    num_teams: c.numTeams,
    prelim_play_by: c.prelimPlayBy,
    r1_play_by: c.r1PlayBy,
    r2_play_by: c.r2PlayBy,
    qf_play_by: c.qfPlayBy,
    sf_play_by: c.sfPlayBy,
    f_play_by: c.fPlayBy,
  }));
  if (compsToInsert.length > 0) {
    const { error } = await supabase.from('rowland_comps').insert(compsToInsert);
    if (error) throw new Error(`rowland_comps insert failed: ${error.message}`);
  }
  console.log(`   -> ${compsToInsert.length} rowland_comps rows inserted`);

  console.log('4. Inserting rowland_matches rows...');
  const matchesToInsert: any[] = [];
  for (const [compId, matches] of matchesByComp) {
    for (const m of matches) {
      const home = resolveTeam(m.homeTeam);
      const away = resolveTeam(m.awayTeam);
      matchesToInsert.push({
        comp_id: compId,
        match_id: m.matchId,
        round: m.round,
        position: m.position,
        home_club_name: home.clubName,
        home_team_letter: home.teamLetter,
        away_club_name: away.clubName,
        away_team_letter: away.teamLetter,
        home_players: m.homePlayers,
        away_players: m.awayPlayers,
        home_score: m.homeScore,
        away_score: m.awayScore,
        winner_side: m.winnerSide,
        status: m.status,
        play_by_date: m.playByDate,
        played_date: m.playedDate,
        notes: m.notes,
        score_sheet_url: m.scoreSheetUrl,
      });
    }
  }
  if (matchesToInsert.length > 0) {
    const { error } = await supabase.from('rowland_matches').insert(matchesToInsert);
    if (error) throw new Error(`rowland_matches insert failed: ${error.message}`);
  }
  console.log(`   -> ${matchesToInsert.length} rowland_matches rows inserted${unresolvedTeams > 0 ? ` (${unresolvedTeams} team names unresolved against club_profiles — see warnings above)` : ''}`);

  console.log('5. Saving rowland_settings message row...');
  const { error: messageError } = await supabase.from('rowland_settings').upsert({ key: 'message', value: message });
  if (messageError) throw new Error(`rowland_settings insert failed: ${messageError.message}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
