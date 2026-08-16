/**
 * migrate-invite-games.ts
 *
 * Reads the live InviteGames + InviteGamesAttachments sheets (Members spreadsheet)
 * and writes them into the new Postgres invite_games/invite_game_attachments tables
 * (supabase/migrations/0044_invite_games.sql). Same "refresh Dev, rerun for the real
 * Prod cutover" pattern as migrate-suggestions.ts.
 *
 * closing_date/game_date are real Postgres `date` columns — converted via parseUKDate
 * (same tolerant UK/ISO parsing every other migration script in this project uses).
 *
 * Username validation: created_by_username/updated_by_username (invite_games) and
 * added_by_username (invite_game_attachments) all have FKs into `users` — validated
 * against ALL usernames (active + leavers, same table), same lesson as
 * migrate-renewals.ts's leavers bug. A game with an unresolvable created_by_username
 * is skipped entirely (it's NOT NULL); updated_by_username is nulled instead since
 * it's optional. An attachment whose game was skipped, or whose added_by_username
 * doesn't resolve, is skipped too.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-invite-games.ts
 */

import { getGoogleSheetsClient, getSpreadsheetId, getColumnMap } from '../src/lib/sheets';
import { getSupabaseClient } from '../src/lib/supabase';
import { parseUKDate } from '../src/lib/date-utils';

const GAMES_SHEET = 'InviteGames';
const ATTACHMENTS_SHEET = 'InviteGamesAttachments';

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
  const spreadsheetId = getSpreadsheetId();
  try {
    const colMap = await getColumnMap(sheetName, spreadsheetId);
    const sheets = getGoogleSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:AZ`,
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
  console.log('1. Reading live Invite Games sheets + all usernames (active + leavers)...');
  const supabase = getSupabaseClient();
  const [gamesTab, attachmentsTab, allUsersResult] = await Promise.all([
    readSheet(GAMES_SHEET),
    readSheet(ATTACHMENTS_SHEET),
    supabase.from('users').select('username'),
  ]);
  if (allUsersResult.error) throw new Error(`Failed to fetch usernames: ${allUsersResult.error.message}`);
  const usernames = new Set((allUsersResult.data ?? []).map((u) => (u.username as string).toLowerCase()));

  console.log('2. Wiping existing invite_game_attachments + invite_games (child-to-parent)...');
  const { error: e1 } = await supabase.from('invite_game_attachments').delete().neq('attachment_id', '__never_matches__');
  if (e1) throw new Error(`Failed to wipe invite_game_attachments: ${e1.message}`);
  const { error: e2 } = await supabase.from('invite_games').delete().neq('invite_game_id', '__never_matches__');
  if (e2) throw new Error(`Failed to wipe invite_games: ${e2.message}`);

  console.log('3. Inserting invite_games...');
  let gamesSkipped = 0;
  const validGameIds = new Set<string>();
  const gameRows: any[] = [];
  if (gamesTab) {
    const { rows, colMap } = gamesTab;
    for (const row of rows) {
      const get = getter(row, colMap);
      const inviteGameId = get('invite_game_id');
      if (!inviteGameId) continue;
      const createdBy = get('created_by_username');
      if (!usernames.has(createdBy.toLowerCase())) {
        console.warn(`   !! invite_games: created_by_username "${createdBy}" doesn't match any current username — ${inviteGameId} skipped`);
        gamesSkipped++;
        continue;
      }
      const updatedBy = get('updated_by_username');
      validGameIds.add(inviteGameId);
      gameRows.push({
        invite_game_id: inviteGameId,
        title: get('title'),
        description: get('description'),
        closing_date: toISODateOrNull(get('closing_date')),
        game_date: toISODateOrNull(get('game_date')),
        created_by_username: createdBy,
        created_at: get('created_at') || new Date().toISOString(),
        updated_at: get('updated_at') || null,
        updated_by_username: updatedBy && usernames.has(updatedBy.toLowerCase()) ? updatedBy : null,
      });
    }
  }
  if (gameRows.length > 0) {
    const { error } = await supabase.from('invite_games').insert(gameRows);
    if (error) throw new Error(`invite_games insert failed: ${error.message}`);
  }
  console.log(`   -> ${gameRows.length} invite_games rows inserted${gamesSkipped > 0 ? ` (${gamesSkipped} skipped — unmatched created_by_username)` : ''}`);

  console.log('4. Inserting invite_game_attachments...');
  let attachmentsSkipped = 0;
  const attachmentRows: any[] = [];
  if (attachmentsTab) {
    const { rows, colMap } = attachmentsTab;
    for (const row of rows) {
      const get = getter(row, colMap);
      const attachmentId = get('attachment_id');
      const inviteGameId = get('invite_game_id');
      if (!attachmentId || !validGameIds.has(inviteGameId)) continue;
      const addedBy = get('added_by_username');
      if (!usernames.has(addedBy.toLowerCase())) {
        console.warn(`   !! invite_game_attachments: added_by_username "${addedBy}" doesn't match any current username — ${attachmentId} skipped`);
        attachmentsSkipped++;
        continue;
      }
      attachmentRows.push({
        attachment_id: attachmentId,
        invite_game_id: inviteGameId,
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
    const { error } = await supabase.from('invite_game_attachments').insert(attachmentRows);
    if (error) throw new Error(`invite_game_attachments insert failed: ${error.message}`);
  }
  console.log(`   -> ${attachmentRows.length} invite_game_attachments rows inserted${attachmentsSkipped > 0 ? ` (${attachmentsSkipped} skipped — unmatched username)` : ''}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
