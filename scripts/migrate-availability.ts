/**
 * migrate-availability.ts
 *
 * Reads the live AvailabilityGroups / AvailabilityGroupMembers / AvailabilityEvents /
 * AvailabilitySlots / AvailabilityResponses sheets (AVAILABILITY_SPREADSHEET_ID) and
 * writes them into the new Postgres availability_groups/availability_group_members/
 * availability_events/availability_slots/availability_responses tables. Same
 * "refresh Dev, rerun for the real Prod cutover" pattern as migrate-rotas.ts.
 *
 * ID preservation:
 *   - availability_groups.id / availability_events.id are preserved EXACTLY as the
 *     sheet's AG-YYYY-NNN / AV-YYYY-NNN strings, because these are embedded in
 *     already-sent email links for real, currently-open polls (supabase/migrations/
 *     0030_availability_planning.sql made them TEXT PRIMARY KEY for this reason).
 *   - availability_group_members.token is preserved exactly (also embedded in
 *     already-sent email links). The AGM- id itself is dropped — nothing external
 *     references it — a fresh uuid is generated instead.
 *   - availability_slots.id (sheet's AVS-NNNNNN) is dropped and replaced with a fresh
 *     uuid, since slot ids are never exposed in a persisted URL. A slotIdMap tracks
 *     old->new so events.concluded_slot_id / offered_slot_ids / responses.slot_id can
 *     be rewritten to match.
 *   - availability_responses.id (sheet's AVR-NNNNNN) and the sheet's invitee_id column
 *     are both dropped — nothing references a response by id, and invitee_id was
 *     already confirmed dead (an alias for member_id, not a real second id scheme).
 *
 * Insert order respects FKs: groups -> group_members -> events (concluded_slot_id
 * left null) -> slots -> events updated with the real concluded_slot_id/
 * offered_slot_ids (now that slots exist) -> responses.
 *
 * No PII redaction here (matching migrate-rotas.ts/migrate-fixtures.ts, not
 * migrate-members.ts) — visitor names/emails and member usernames are written as-is.
 *
 * IMPORTANT: this script's tables are wired into migrate-members.ts's wipeSteps list
 * (they FK to users(username)). Re-running migrate-members.ts wipes them, so
 * migrate-availability.ts MUST be re-run after migrate-members.ts, same as
 * migrate-fixtures.ts/migrate-rotas.ts.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-availability.ts
 */

import { randomUUID } from 'crypto';
import { getGoogleSheetsClient, getColumnMap } from '../src/lib/sheets';
import { getAllUsers } from '../src/lib/members-supabase';
import { getSupabaseClient } from '../src/lib/supabase';

const GROUPS_SHEET = 'AvailabilityGroups';
const MEMBERS_SHEET = 'AvailabilityGroupMembers';
const EVENTS_SHEET = 'AvailabilityEvents';
const SLOTS_SHEET = 'AvailabilitySlots';
const RESPONSES_SHEET = 'AvailabilityResponses';

const GROUPS_RANGE = `${GROUPS_SHEET}!A2:I`;
const MEMBERS_RANGE = `${MEMBERS_SHEET}!A2:N`;
const EVENTS_RANGE = `${EVENTS_SHEET}!A2:V`;
const SLOTS_RANGE = `${SLOTS_SHEET}!A2:F`;
const RESPONSES_RANGE = `${RESPONSES_SHEET}!A2:K`;

function getAvailabilitySpreadsheetId(): string {
  const id = process.env.AVAILABILITY_SPREADSHEET_ID;
  if (!id) {
    throw new Error('AVAILABILITY_SPREADSHEET_ID environment variable is not set');
  }
  return id;
}

async function fetchSheetRows(
  sheetName: string,
  range: string
): Promise<{ rows: string[][]; colMap: Record<string, number> }> {
  const spreadsheetId = getAvailabilitySpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const colMap = await getColumnMap(sheetName, spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return { rows: response.data.values ?? [], colMap };
}

function cell(row: string[], colMap: Record<string, number>, key: string): string {
  const col = colMap[key];
  if (col === undefined) return '';
  return (row[col] || '').toString().trim();
}

function nullIfBlank(value: string): string | null {
  return value ? value : null;
}

async function main() {
  console.log('1. Reading live AvailabilityGroups/GroupMembers/Events/Slots/Responses sheets + current usernames...');
  const [groupsSheet, membersSheet, eventsSheet, slotsSheet, responsesSheet, allUsers] = await Promise.all([
    fetchSheetRows(GROUPS_SHEET, GROUPS_RANGE),
    fetchSheetRows(MEMBERS_SHEET, MEMBERS_RANGE),
    fetchSheetRows(EVENTS_SHEET, EVENTS_RANGE),
    fetchSheetRows(SLOTS_SHEET, SLOTS_RANGE),
    fetchSheetRows(RESPONSES_SHEET, RESPONSES_RANGE),
    getAllUsers(),
  ]);
  console.log(
    `   -> ${groupsSheet.rows.length} groups, ${membersSheet.rows.length} group members, ` +
    `${eventsSheet.rows.length} events, ${slotsSheet.rows.length} slots, ${responsesSheet.rows.length} responses`
  );

  // Nullable username FK columns: resolve against current Postgres users, null + warn if
  // the sheet's name doesn't match anyone current (departed member, typo) — same
  // convention as migrate-rotas.ts. NOT NULL username columns (created_by_username) are
  // only warned about, never nulled — an unresolvable value there is left as-is so
  // Postgres's own FK error surfaces the problem clearly rather than silently corrupting
  // who created the group/event.
  const usernames = new Set(allUsers.map((u) => u.userName.toLowerCase()));
  const resolveNullable = (name: string, context: string): string | null => {
    if (!name) return null;
    if (usernames.has(name.toLowerCase())) return name;
    console.warn(`   !! ${context}: "${name}" doesn't match any current username — nulled, needs review`);
    return null;
  };
  const warnIfUnresolvable = (name: string, context: string): string => {
    if (name && !usernames.has(name.toLowerCase())) {
      console.warn(`   !! ${context}: "${name}" doesn't match any current username — kept as-is, insert will fail if truly invalid`);
    }
    return name;
  };

  const supabase = getSupabaseClient();

  console.log('2. Wiping existing availability_responses/slots/events/group_members/groups...');
  // id is uuid on responses/slots/group_members but text (AG-.../AV-...) on groups/events —
  // the neq sentinel has to be a value Postgres will actually accept for that column's type.
  const wipeSteps: { table: string; sentinel: string }[] = [
    { table: 'availability_responses', sentinel: '00000000-0000-0000-0000-000000000000' },
    { table: 'availability_slots', sentinel: '00000000-0000-0000-0000-000000000000' },
    { table: 'availability_events', sentinel: '__never_matches__' },
    { table: 'availability_group_members', sentinel: '00000000-0000-0000-0000-000000000000' },
    { table: 'availability_groups', sentinel: '__never_matches__' },
  ];
  for (const step of wipeSteps) {
    const { error } = await supabase.from(step.table).delete().neq('id', step.sentinel);
    if (error) throw new Error(`Failed to wipe ${step.table}: ${error.message}`);
  }

  // ─── Groups ───────────────────────────────────────────────────────────────
  console.log('3. Inserting availability_groups rows...');
  const groupsToInsert = groupsSheet.rows
    .filter((row) => cell(row, groupsSheet.colMap, 'group_id'))
    .map((row) => ({
      id: cell(row, groupsSheet.colMap, 'group_id'),
      name: cell(row, groupsSheet.colMap, 'name'),
      description: nullIfBlank(cell(row, groupsSheet.colMap, 'description')),
      created_by_username: warnIfUnresolvable(cell(row, groupsSheet.colMap, 'created_by_username'), `availability_groups ${cell(row, groupsSheet.colMap, 'group_id')} created_by`),
      allow_member_management: cell(row, groupsSheet.colMap, 'allow_member_management') === 'Y',
      team_id: nullIfBlank(cell(row, groupsSheet.colMap, 'team_id')),
      status: cell(row, groupsSheet.colMap, 'status') || 'active',
      created_at: cell(row, groupsSheet.colMap, 'created_at') || new Date().toISOString(),
      updated_at: nullIfBlank(cell(row, groupsSheet.colMap, 'updated_at')),
    }));
  if (groupsToInsert.length > 0) {
    const { error } = await supabase.from('availability_groups').insert(groupsToInsert);
    if (error) throw new Error(`availability_groups insert failed: ${error.message}`);
  }
  console.log(`   -> ${groupsToInsert.length} availability_groups rows inserted`);

  // ─── Group members ────────────────────────────────────────────────────────
  console.log('4. Inserting availability_group_members rows...');
  const groupMembersToInsert = membersSheet.rows
    .filter((row) => cell(row, membersSheet.colMap, 'group_id'))
    .map((row) => {
      const memberType = cell(row, membersSheet.colMap, 'member_type') || 'member';
      const groupId = cell(row, membersSheet.colMap, 'group_id');
      return {
        id: randomUUID(),
        group_id: groupId,
        member_type: memberType,
        username: memberType === 'member'
          ? resolveNullable(cell(row, membersSheet.colMap, 'user_name'), `availability_group_members ${groupId} member`)
          : null,
        visitor_name: nullIfBlank(cell(row, membersSheet.colMap, 'visitor_name')),
        visitor_email: nullIfBlank(cell(row, membersSheet.colMap, 'visitor_email')),
        added_by_username: resolveNullable(cell(row, membersSheet.colMap, 'added_by_username'), `availability_group_members ${groupId} added_by`),
        token: nullIfBlank(cell(row, membersSheet.colMap, 'token')),
        created_at: cell(row, membersSheet.colMap, 'created_at') || new Date().toISOString(),
      };
    });
  if (groupMembersToInsert.length > 0) {
    const { error } = await supabase.from('availability_group_members').insert(groupMembersToInsert);
    if (error) throw new Error(`availability_group_members insert failed: ${error.message}`);
  }
  console.log(`   -> ${groupMembersToInsert.length} availability_group_members rows inserted`);

  // ─── Events (pass 1 — concluded_slot_id/offered_slot_ids left null; slots don't exist yet) ──
  console.log('5. Inserting availability_events rows (concluded_slot_id deferred until slots exist)...');
  const eventRows = eventsSheet.rows.filter((row) => cell(row, eventsSheet.colMap, 'event_id'));
  const eventsToInsert = eventRows.map((row) => ({
    id: cell(row, eventsSheet.colMap, 'event_id'),
    title: cell(row, eventsSheet.colMap, 'title'),
    description: nullIfBlank(cell(row, eventsSheet.colMap, 'description')),
    created_by_username: warnIfUnresolvable(cell(row, eventsSheet.colMap, 'created_by_username'), `availability_events ${cell(row, eventsSheet.colMap, 'event_id')} created_by`),
    group_id: nullIfBlank(cell(row, eventsSheet.colMap, 'group_id')),
    type: cell(row, eventsSheet.colMap, 'type') || 'general',
    slot_type: cell(row, eventsSheet.colMap, 'slot_type') || 'datetime',
    status: cell(row, eventsSheet.colMap, 'status') || 'open',
    show_responses_to_respondents: cell(row, eventsSheet.colMap, 'show_responses_to_respondents') === 'Y',
    notify_creator_on_response: cell(row, eventsSheet.colMap, 'notify_creator_on_response') === 'Y',
    expires_at: nullIfBlank(cell(row, eventsSheet.colMap, 'expires_at')),
    concluded_slot_id: null as string | null,
    conclusion_note: nullIfBlank(cell(row, eventsSheet.colMap, 'conclusion_note')),
    concluded_at: nullIfBlank(cell(row, eventsSheet.colMap, 'concluded_at')),
    concluded_by_username: resolveNullable(cell(row, eventsSheet.colMap, 'concluded_by_username'), `availability_events ${cell(row, eventsSheet.colMap, 'event_id')} concluded_by`),
    created_at: cell(row, eventsSheet.colMap, 'created_at') || new Date().toISOString(),
    updated_at: nullIfBlank(cell(row, eventsSheet.colMap, 'updated_at')),
    is_match_finder: cell(row, eventsSheet.colMap, 'is_match_finder') === 'Y',
    offered_slot_ids: [] as string[],
  }));
  if (eventsToInsert.length > 0) {
    const { error } = await supabase.from('availability_events').insert(eventsToInsert);
    if (error) throw new Error(`availability_events insert failed: ${error.message}`);
  }
  console.log(`   -> ${eventsToInsert.length} availability_events rows inserted`);

  // ─── Slots — old AVS-NNNNNN sheet id -> fresh uuid, tracked for the events backfill + responses ──
  console.log('6. Inserting availability_slots rows...');
  const slotIdMap = new Map<string, string>();
  const slotsToInsert = slotsSheet.rows
    .filter((row) => cell(row, slotsSheet.colMap, 'slot_id') && cell(row, slotsSheet.colMap, 'event_id'))
    .map((row) => {
      const oldSlotId = cell(row, slotsSheet.colMap, 'slot_id');
      const newSlotId = randomUUID();
      slotIdMap.set(oldSlotId, newSlotId);
      const displayOrderStr = cell(row, slotsSheet.colMap, 'display_order');
      return {
        id: newSlotId,
        event_id: cell(row, slotsSheet.colMap, 'event_id'),
        slot_datetime: nullIfBlank(cell(row, slotsSheet.colMap, 'slot_datetime')),
        slot_label: nullIfBlank(cell(row, slotsSheet.colMap, 'slot_label')),
        display_order: displayOrderStr ? parseInt(displayOrderStr, 10) : 0,
        created_at: cell(row, slotsSheet.colMap, 'created_at') || new Date().toISOString(),
      };
    });
  if (slotsToInsert.length > 0) {
    const { error } = await supabase.from('availability_slots').insert(slotsToInsert);
    if (error) throw new Error(`availability_slots insert failed: ${error.message}`);
  }
  console.log(`   -> ${slotsToInsert.length} availability_slots rows inserted`);

  // ─── Events (pass 2 — backfill concluded_slot_id/offered_slot_ids now slots exist) ──
  console.log('7. Backfilling availability_events.concluded_slot_id/offered_slot_ids...');
  let backfilledCount = 0;
  for (const row of eventRows) {
    const eventId = cell(row, eventsSheet.colMap, 'event_id');
    const oldConcludedSlotId = cell(row, eventsSheet.colMap, 'concluded_slot_id');
    const offeredRaw = cell(row, eventsSheet.colMap, 'offered_slot_ids');

    const newConcludedSlotId = oldConcludedSlotId ? (slotIdMap.get(oldConcludedSlotId) || null) : null;
    if (oldConcludedSlotId && !newConcludedSlotId) {
      console.warn(`   !! availability_events ${eventId}: concluded_slot_id "${oldConcludedSlotId}" has no matching slot — left null`);
    }

    const offeredOldIds = offeredRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const offeredNewIds: string[] = [];
    for (const oldId of offeredOldIds) {
      const newId = slotIdMap.get(oldId);
      if (newId) {
        offeredNewIds.push(newId);
      } else {
        console.warn(`   !! availability_events ${eventId}: offered_slot_ids entry "${oldId}" has no matching slot — dropped`);
      }
    }

    if (newConcludedSlotId || offeredNewIds.length > 0) {
      const { error } = await supabase
        .from('availability_events')
        .update({ concluded_slot_id: newConcludedSlotId, offered_slot_ids: offeredNewIds })
        .eq('id', eventId);
      if (error) throw new Error(`availability_events backfill failed for ${eventId}: ${error.message}`);
      backfilledCount++;
    }
  }
  console.log(`   -> ${backfilledCount} availability_events rows backfilled`);

  // ─── Responses ────────────────────────────────────────────────────────────
  console.log('8. Inserting availability_responses rows...');
  let responsesSkipped = 0;
  const responsesToInsert = responsesSheet.rows
    .filter((row) => cell(row, responsesSheet.colMap, 'event_id') && cell(row, responsesSheet.colMap, 'slot_id'))
    .map((row) => {
      const oldSlotId = cell(row, responsesSheet.colMap, 'slot_id');
      const newSlotId = slotIdMap.get(oldSlotId);
      if (!newSlotId) return null;
      const respondentType = cell(row, responsesSheet.colMap, 'respondent_type') || 'member';
      const eventId = cell(row, responsesSheet.colMap, 'event_id');
      return {
        id: randomUUID(),
        event_id: eventId,
        slot_id: newSlotId,
        respondent_type: respondentType,
        username: respondentType === 'member'
          ? resolveNullable(cell(row, responsesSheet.colMap, 'user_name'), `availability_responses ${eventId} member`)
          : null,
        visitor_name: nullIfBlank(cell(row, responsesSheet.colMap, 'visitor_name')),
        visitor_email: nullIfBlank(cell(row, responsesSheet.colMap, 'visitor_email')),
        response: cell(row, responsesSheet.colMap, 'response') || 'no',
        responded_at: cell(row, responsesSheet.colMap, 'responded_at') || new Date().toISOString(),
        updated_at: nullIfBlank(cell(row, responsesSheet.colMap, 'updated_at')),
      };
    })
    .filter((r): r is NonNullable<typeof r> => {
      if (r === null) responsesSkipped++;
      return r !== null;
    });
  if (responsesToInsert.length > 0) {
    const { error } = await supabase.from('availability_responses').insert(responsesToInsert);
    if (error) throw new Error(`availability_responses insert failed: ${error.message}`);
  }
  console.log(`   -> ${responsesToInsert.length} availability_responses rows inserted${responsesSkipped > 0 ? ` (${responsesSkipped} skipped — no matching slot)` : ''}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
