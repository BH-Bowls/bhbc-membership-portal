/**
 * migrate-leagues.ts
 *
 * Reads the live LeagueControl/LeagueTeams/LeagueSquad/LeagueMatches/LeagueSettings/
 * LeagueAttachments sheets (LEAGUES_SPREADSHEET_ID) and writes them into the new
 * Postgres leagues/league_teams/league_squad/league_matches/league_settings/
 * league_attachments tables (supabase/migrations/0038_leagues.sql). Same
 * "refresh Dev, rerun for the real Prod cutover" pattern as migrate-renewals.ts.
 *
 * Username validation: league_squad.username and league_attachments.added_by_username
 * both have FKs into `users` — validated against ALL usernames (active + leavers,
 * same table), same lesson as migrate-renewals.ts's leavers bug.
 *
 * league_matches.home_team_id/away_team_id have FKs into league_teams with NO cascade
 * (deliberate — see the migration's own comment: a team with recorded match history
 * must not be silently deletable). Teams are inserted before matches here for the
 * same reason; any match referencing a team that didn't make it in is skipped with a
 * warning rather than crashing the whole run.
 *
 * scheduled_date/play_by_date/entered_date are real Postgres `date` columns —
 * converted via parseUKDate (same tolerant UK/ISO parsing every other migration
 * script in this project uses), not passed through as raw sheet strings.
 * scheduled_time stays a plain HH:MM text column, passed through as-is.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-leagues.ts
 */

import { getGoogleSheetsClient, getLeaguesSpreadsheetId, getColumnMap } from '../src/lib/sheets';
import { getSupabaseClient } from '../src/lib/supabase';
import { parseUKDate } from '../src/lib/date-utils';

function sid(): string {
  return getLeaguesSpreadsheetId();
}

function toISODateOrNull(val: string | null | undefined): string | null {
  if (!val || !val.trim()) return null;
  const parsed = parseUKDate(val);
  if (isNaN(parsed.getTime())) {
    console.warn(`   !! Could not parse date "${val}" — left null`);
    return null;
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toIntOrNull(val: string | null | undefined): number | null {
  if (!val || !val.trim()) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

async function readSheet(sheetName: string): Promise<{ rows: any[][]; colMap: Record<string, number> } | null> {
  try {
    const colMap = await getColumnMap(sheetName, sid());
    const sheets = getGoogleSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sid(),
      range: `${sheetName}!A2:Z`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    return { rows: resp.data.values || [], colMap };
  } catch {
    return null;
  }
}

function getter(row: any[], colMap: Record<string, number>) {
  return (field: string): string => {
    const idx = colMap[field];
    return idx !== undefined ? (row[idx] ?? '').toString().trim() : '';
  };
}

async function main() {
  console.log('1. Reading live Leagues sheets + all usernames (active + leavers)...');
  const supabase = getSupabaseClient();
  const [controlTab, teamsTab, squadTab, matchesTab, settingsTab, attachmentsTab, allUsersResult] = await Promise.all([
    readSheet('LeagueControl'),
    readSheet('LeagueTeams'),
    readSheet('LeagueSquad'),
    readSheet('LeagueMatches'),
    readSheet('LeagueSettings'),
    readSheet('LeagueAttachments'),
    supabase.from('users').select('username'),
  ]);
  if (allUsersResult.error) throw new Error(`Failed to fetch usernames: ${allUsersResult.error.message}`);
  const usernames = new Set((allUsersResult.data ?? []).map((u) => (u.username as string).toLowerCase()));

  console.log('2. Wiping existing league tables (child-to-parent)...');
  const nilUuid = '00000000-0000-0000-0000-000000000000';
  const { error: e1 } = await supabase.from('league_attachments').delete().neq('attachment_id', '__never_matches__');
  if (e1) throw new Error(`Failed to wipe league_attachments: ${e1.message}`);
  const { error: e2 } = await supabase.from('league_matches').delete().neq('match_id', '__never_matches__');
  if (e2) throw new Error(`Failed to wipe league_matches: ${e2.message}`);
  const { error: e3 } = await supabase.from('league_squad').delete().neq('id', nilUuid);
  if (e3) throw new Error(`Failed to wipe league_squad: ${e3.message}`);
  const { error: e4 } = await supabase.from('league_teams').delete().neq('team_id', '__never_matches__');
  if (e4) throw new Error(`Failed to wipe league_teams: ${e4.message}`);
  const { error: e5 } = await supabase.from('leagues').delete().neq('league_id', '__never_matches__');
  if (e5) throw new Error(`Failed to wipe leagues: ${e5.message}`);

  console.log('3. Inserting leagues...');
  const leagueIds = new Set<string>();
  const leagueRows: any[] = [];
  if (controlTab) {
    const { rows, colMap } = controlTab;
    for (const row of rows) {
      const get = getter(row, colMap);
      const leagueId = get('league_id');
      if (!leagueId) continue;
      const type = get('type') || 'triples';
      leagueIds.add(leagueId);
      leagueRows.push({
        league_id: leagueId,
        name: get('name'),
        type,
        season: get('season'),
        status: get('status') || 'Not Started',
        squad_size: toIntOrNull(get('squad_size')) ?? (type === 'triples' ? 6 : 4),
        players_per_match: toIntOrNull(get('players_per_match')) ?? (type === 'triples' ? 3 : 2),
        date_label: get('date_label') || (type === 'triples' ? 'Play on/at' : 'Play by'),
        legs: toIntOrNull(get('legs')) === 1 ? 1 : 2,
        message: get('message'),
      });
    }
  }
  if (leagueRows.length > 0) {
    const { error } = await supabase.from('leagues').insert(leagueRows);
    if (error) throw new Error(`leagues insert failed: ${error.message}`);
  }
  console.log(`   -> ${leagueRows.length} leagues inserted`);

  console.log('4. Inserting league_teams...');
  const teamIds = new Set<string>();
  const teamRows: any[] = [];
  if (teamsTab) {
    const { rows, colMap } = teamsTab;
    for (const row of rows) {
      const get = getter(row, colMap);
      const teamId = get('team_id');
      const leagueId = get('league_id');
      if (!teamId || !leagueIds.has(leagueId)) continue;
      teamIds.add(teamId);
      teamRows.push({ team_id: teamId, league_id: leagueId, team_name: get('team_name') });
    }
  }
  if (teamRows.length > 0) {
    const { error } = await supabase.from('league_teams').insert(teamRows);
    if (error) throw new Error(`league_teams insert failed: ${error.message}`);
  }
  console.log(`   -> ${teamRows.length} league_teams inserted`);

  console.log('5. Inserting league_squad...');
  let squadSkipped = 0;
  const squadRows: any[] = [];
  if (squadTab) {
    const { rows, colMap } = squadTab;
    for (const row of rows) {
      const get = getter(row, colMap);
      const leagueId = get('league_id');
      const username = get('username');
      if (!leagueId || !username || !leagueIds.has(leagueId)) continue;
      if (!usernames.has(username.toLowerCase())) {
        console.warn(`   !! league_squad: "${username}" doesn't match any current username — skipped (league ${leagueId})`);
        squadSkipped++;
        continue;
      }
      const teamId = get('team_id');
      squadRows.push({
        league_id: leagueId,
        team_id: teamId && teamIds.has(teamId) ? teamId : null,
        username,
        position: get('position'),
        entered_date: toISODateOrNull(get('entered_date')) ?? new Date().toISOString().slice(0, 10),
      });
    }
  }
  if (squadRows.length > 0) {
    const { error } = await supabase.from('league_squad').insert(squadRows);
    if (error) throw new Error(`league_squad insert failed: ${error.message}`);
  }
  console.log(`   -> ${squadRows.length} league_squad rows inserted${squadSkipped > 0 ? ` (${squadSkipped} skipped — unmatched username)` : ''}`);

  console.log('6. Inserting league_matches...');
  let matchesSkipped = 0;
  const matchRows: any[] = [];
  if (matchesTab) {
    const { rows, colMap } = matchesTab;
    for (const row of rows) {
      const get = getter(row, colMap);
      const matchId = get('match_id');
      const leagueId = get('league_id');
      const homeTeamId = get('home_team_id');
      const awayTeamId = get('away_team_id');
      if (!matchId || !leagueIds.has(leagueId)) continue;
      if (!teamIds.has(homeTeamId) || !teamIds.has(awayTeamId)) {
        console.warn(`   !! league_matches: "${matchId}" references a missing team — skipped`);
        matchesSkipped++;
        continue;
      }
      matchRows.push({
        match_id: matchId,
        league_id: leagueId,
        matchday: toIntOrNull(get('matchday')) ?? 1,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        scheduled_date: toISODateOrNull(get('scheduled_date')),
        scheduled_time: get('scheduled_time') || null,
        play_by_date: toISODateOrNull(get('play_by_date')),
        home_score: toIntOrNull(get('home_score')),
        away_score: toIntOrNull(get('away_score')),
        home_adj: toIntOrNull(get('home_adj')),
        away_adj: toIntOrNull(get('away_adj')),
        home_points: toIntOrNull(get('home_points')),
        away_points: toIntOrNull(get('away_points')),
        status: get('status') || 'Scheduled',
      });
    }
  }
  if (matchRows.length > 0) {
    const { error } = await supabase.from('league_matches').insert(matchRows);
    if (error) throw new Error(`league_matches insert failed: ${error.message}`);
  }
  console.log(`   -> ${matchRows.length} league_matches rows inserted${matchesSkipped > 0 ? ` (${matchesSkipped} skipped — missing team)` : ''}`);

  console.log('7. Inserting league_settings (global message)...');
  if (settingsTab) {
    const { rows, colMap } = settingsTab;
    for (const row of rows) {
      const key = (row[colMap['key'] ?? 0] ?? '').toString().trim().toLowerCase();
      if (key === 'message') {
        const value = (row[colMap['value'] ?? 1] ?? '').toString();
        const { error } = await supabase.from('league_settings').upsert({ key: 'message', value }, { onConflict: 'key' });
        if (error) throw new Error(`league_settings insert failed: ${error.message}`);
        break;
      }
    }
  }
  console.log('   -> done');

  console.log('8. Inserting league_attachments...');
  let attachmentsSkipped = 0;
  const attachmentRows: any[] = [];
  if (attachmentsTab) {
    const { rows, colMap } = attachmentsTab;
    for (const row of rows) {
      const get = getter(row, colMap);
      const attachmentId = get('attachment_id');
      const leagueId = get('league_id');
      const addedBy = get('added_by_username');
      if (!attachmentId || !leagueIds.has(leagueId)) continue;
      if (!usernames.has(addedBy.toLowerCase())) {
        console.warn(`   !! league_attachments: added_by_username "${addedBy}" doesn't match any current username — ${attachmentId} skipped`);
        attachmentsSkipped++;
        continue;
      }
      attachmentRows.push({
        attachment_id: attachmentId,
        league_id: leagueId,
        type: get('type') || 'link',
        drive_file_id: get('drive_file_id') || null,
        url: get('url'),
        description: get('description'),
        file_name: get('file_name') || null,
        mime_type: get('mime_type') || null,
        file_size: toIntOrNull(get('file_size')),
        display_order: toIntOrNull(get('display_order')) ?? 0,
        added_at: get('added_at') || new Date().toISOString(),
        added_by_username: addedBy,
        is_deleted: get('is_deleted') === 'TRUE',
      });
    }
  }
  if (attachmentRows.length > 0) {
    const { error } = await supabase.from('league_attachments').insert(attachmentRows);
    if (error) throw new Error(`league_attachments insert failed: ${error.message}`);
  }
  console.log(`   -> ${attachmentRows.length} league_attachments rows inserted${attachmentsSkipped > 0 ? ` (${attachmentsSkipped} skipped — unmatched username)` : ''}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
