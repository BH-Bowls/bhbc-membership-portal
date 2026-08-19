// src/lib/data-export.ts
// Core report engine for the Data Export / Report Builder feature.
//
// Rebuilt from scratch — the old version read every source (Members, Renewals,
// RenewalPayments, CleaningRota, SweepingRota, Games, Clubs, Contacts) directly from
// raw Google Sheets, and wrote results to a ReportOutput sheet tab. That had gone
// silently stale: every one of those sources except Players (still Sheets-only,
// Step 4b, dropped from this tool entirely per an explicit decision) had already been
// cut over to Postgres elsewhere in the app, so the Sheets tabs were no longer being
// written to at all — Data Export was quietly reporting against frozen snapshots.
//
// Now every source reads the real Postgres tables (reusing each feature's own typed
// data-layer function where one already exists), ReportDefinitions moved to a
// `report_definitions` table, and results are handed back as a real .xlsx file
// (via exceljs) instead of being written into a sheet tab — no Sheets dependency
// anywhere in this file any more.

import ExcelJS from 'exceljs';
import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import { getFixtures } from './fixtures-supabase';
import { getClubs } from './clubs-supabase';
import { getCleaningRotaList } from './cleaning-rota-supabase';
import { getSweepingRotaList } from './sweeping-rota-supabase';
import {
  SchemaColumn,
  SheetSchema,
  ReportDefinition,
  ReportFilter,
  DefinitionSummary,
  RunReportResponse,
} from './types/data-export';

// A single output row, keyed by the source's column `name` (not the qualified
// "Sheet.column" form used in ReportDefinition — that qualification is added when
// joining). Values are always stringified; numeric-looking strings are converted
// back to real numbers only at the point an .xlsx file is written.
type ReportRow = Record<string, string>;

// ============================================================================
// SOURCE REGISTRY
// ============================================================================

interface SourceSpec {
  key: string;
  label: string;
  joinKey: 'user_name' | 'club_name';
  columns: SchemaColumn[]; // name = internal column key, originalHeader = display label
  fetchRows: () => Promise<ReportRow[]>;
}

function col(name: string, originalHeader: string): SchemaColumn {
  return { name, originalHeader };
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

async function fetchMembersRows(): Promise<ReportRow[]> {
  const users = await getAllUsers();
  // Deliberately excludes auth-internal fields (passwordHash, resetToken,
  // resetTokenExpires, isTempPassword, lastLoginFailedDate, lastPasswordResetDate) —
  // no reporting value, and a real security risk if ever exported to a shareable file.
  return users.map((u) => ({
    user_name: (u.userName || '').toLowerCase(),
    username_display: u.userName,
    title: str(u.title),
    first_name: str(u.firstName),
    last_name: str(u.lastName),
    known_as: str(u.knownAs),
    full_known_as: str(u.fullKnownAs),
    full_name: str(u.fullName),
    gmail_label: str(u.gmailLabel),
    email_address: str(u.emailAddress),
    mobile: str(u.mobile),
    landline: str(u.landline),
    address_1: str(u.address1),
    address_2: str(u.address2),
    address_3: str(u.address3),
    post_code: str(u.postCode),
    locker_no: str(u.lockerNo),
    birthdate: str(u.birthdate),
    age_demographic: str(u.ageDemographic),
    member_type: str(u.memberType),
    honorary: str(u.honorary),
    year_started: str(u.yearStarted),
    renew_status: str(u.renewStatus),
    friendlies_last_year: str(u.friendliesLastYear),
    competitions_eligible_override: str(u.competitionsEligibleOverride),
    comments: str(u.comments),
    social_emails: str(u.socialEmails),
    handbook_entry: str(u.handbookEntry),
    driving_away_matches: str(u.drivingAwayMatches),
    driving_additional_info: str(u.drivingAdditionalInfo),
    green_maintenance: str(u.greenMaintenance),
    green_additional_info: str(u.greenAdditionalInfo),
    bar_duty: str(u.barDuty),
    bar_additional_info: str(u.barAdditionalInfo),
    other_skills: str(u.otherSkills),
    gmc: str(u.gmc),
    handicap: str(u.handicap),
    is_marker: str(u.isMarker),
    is_worker: str(u.isWorker),
    worker_additional_info: str(u.workerAdditionalInfo),
    max_games_per_day: str(u.maxGamesPerDay),
    include: str(u.include),
    buddy_user_name: str(u.buddyUserName),
    role: str(u.role),
    last_login_date: str(u.lastLoginDate),
    created_at: str(u.createdAt),
    updated_at: str(u.updatedAt),
  }));
}

const MEMBERS_COLUMNS: SchemaColumn[] = [
  col('username_display', 'Username'),
  col('title', 'Title'), col('first_name', 'First Name'), col('last_name', 'Last Name'),
  col('known_as', 'Known As'), col('full_known_as', 'Full Known As'), col('full_name', 'Full Name'),
  col('gmail_label', 'Gmail Label'),
  col('email_address', 'Email Address'), col('mobile', 'Mobile'), col('landline', 'Landline'),
  col('address_1', 'Address 1'), col('address_2', 'Address 2'), col('address_3', 'Address 3'), col('post_code', 'Post Code'),
  col('locker_no', 'Locker No'), col('birthdate', 'Birthdate'), col('age_demographic', 'Age Demographic'),
  col('member_type', 'Member Type'), col('honorary', 'Honorary'), col('year_started', 'Year Started'),
  col('renew_status', 'Renew Status'), col('friendlies_last_year', 'Friendlies Last Year'),
  col('competitions_eligible_override', 'Competitions Eligible Override'),
  col('comments', 'Comments'), col('social_emails', 'Social Emails'), col('handbook_entry', 'Handbook Entry'),
  col('driving_away_matches', 'Driving Away Matches'), col('driving_additional_info', 'Driving Additional Info'),
  col('green_maintenance', 'Green Maintenance'), col('green_additional_info', 'Green Additional Info'),
  col('bar_duty', 'Bar Duty'), col('bar_additional_info', 'Bar Additional Info'), col('other_skills', 'Other Skills'),
  col('gmc', 'GMC'), col('handicap', 'Handicap'), col('is_marker', 'Is Marker'), col('is_worker', 'Is Worker'),
  col('worker_additional_info', 'Worker Additional Info'), col('max_games_per_day', 'Max Games Per Day'),
  col('include', 'Include In Emails'), col('buddy_user_name', 'Buddy Username'), col('role', 'Role'),
  col('last_login_date', 'Last Login Date'), col('created_at', 'Created At'), col('updated_at', 'Updated At'),
];

async function fetchRenewalsRows(): Promise<ReportRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('renewals').select('*');
  if (error) throw new Error(`Failed to fetch renewals: ${error.message}`);
  return (data ?? []).map((r) => ({
    user_name: (r.username || '').toLowerCase(),
    username_display: r.username,
    season_year: str(r.season_year),
    renewing_membership: str(r.renewing_membership),
    renewals_closed: str(r.renewals_closed),
    playing_fee: str(r.playing_fee),
    social_fee: str(r.social_fee),
    competitions_fee: str(r.competitions_fee),
    club_200_fee: str(r.club_200_fee),
    total_fee_due: str(r.total_fee_due),
    comp_mens_championship: str(r.comp_mens_championship),
    comp_ladies_maynard: str(r.comp_ladies_maynard),
    comp_mens_two_wood: str(r.comp_mens_two_wood),
    comp_ladies_two_wood: str(r.comp_ladies_two_wood),
    comp_married_pairs: str(r.comp_married_pairs),
    comp_drawn_pairs: str(r.comp_drawn_pairs),
    comp_australian_pairs: str(r.comp_australian_pairs),
    comp_drawn_triples: str(r.comp_drawn_triples),
    comp_handicap: str(r.comp_handicap),
    comp_oldlands: str(r.comp_oldlands),
    comp_veterans: str(r.comp_veterans),
    sub_drawn_pairs: str(r.sub_drawn_pairs),
    sub_australian_pairs: str(r.sub_australian_pairs),
    sub_drawn_triples: str(r.sub_drawn_triples),
    club_200_entries: str(r.club_200_entries),
    club_200_preferred_numbers: str(r.club_200_preferred_numbers),
    cleaning_dates_to_avoid: str(r.cleaning_dates_to_avoid),
    tea_dates_to_avoid: str(r.tea_dates_to_avoid),
    outstanding: str(r.outstanding),
    banking: str(r.banking),
    donations: str(r.donations),
    difference: str(r.difference),
    bank_transfer: str(r.bank_transfer),
    card_machine: str(r.card_machine),
    cheque: str(r.cheque),
    cash: str(r.cash),
    payment_ids: str(r.payment_ids),
    payment_notes: str(r.payment_notes),
    date_paid: str(r.date_paid),
    confirmation_email_date: str(r.confirmation_email_date),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  }));
}

const RENEWALS_COLUMNS: SchemaColumn[] = [
  col('username_display', 'Username'), col('season_year', 'Season Year'),
  col('renewing_membership', 'Renewing Membership'), col('renewals_closed', 'Renewals Closed'),
  col('playing_fee', 'Playing Fee'), col('social_fee', 'Social Fee'), col('competitions_fee', 'Competitions Fee'),
  col('club_200_fee', '200 Club Fee'), col('total_fee_due', 'Total Fee Due'),
  col('comp_mens_championship', "Mens Championship"), col('comp_ladies_maynard', "Ladies Maynard"),
  col('comp_mens_two_wood', "Mens Two Wood"), col('comp_ladies_two_wood', "Ladies Two Wood"),
  col('comp_married_pairs', "Married Pairs"), col('comp_drawn_pairs', "Drawn Pairs"),
  col('comp_australian_pairs', "Australian Pairs"), col('comp_drawn_triples', "Drawn Triples"),
  col('comp_handicap', "Handicap Comp"), col('comp_oldlands', "Oldlands"), col('comp_veterans', "Veterans"),
  col('sub_drawn_pairs', "Drawn Pairs Sub"), col('sub_australian_pairs', "Australian Pairs Sub"), col('sub_drawn_triples', "Drawn Triples Sub"),
  col('club_200_entries', '200 Club Entries'), col('club_200_preferred_numbers', '200 Club Preferred Numbers'),
  col('cleaning_dates_to_avoid', 'Cleaning Dates To Avoid'), col('tea_dates_to_avoid', 'Tea Dates To Avoid'),
  col('outstanding', 'Outstanding'), col('banking', 'Banking'), col('donations', 'Donations'), col('difference', 'Difference'),
  col('bank_transfer', 'Bank Transfer'), col('card_machine', 'Card Machine'), col('cheque', 'Cheque'), col('cash', 'Cash'),
  col('payment_ids', 'Payment IDs'), col('payment_notes', 'Payment Notes'), col('date_paid', 'Date Paid'),
  col('confirmation_email_date', 'Confirmation Email Date'), col('created_at', 'Created At'), col('updated_at', 'Updated At'),
];

async function fetchRenewalPaymentsRows(): Promise<ReportRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('renewal_payments').select('*');
  if (error) throw new Error(`Failed to fetch renewal payments: ${error.message}`);
  // No user_name column on this table (matched_users is a comma-separated free-text
  // field) — it can still be a join primary/target for filtering, just never matches
  // via the join key (matching the old sheet, which had no join column here either).
  return (data ?? []).map((p) => ({
    user_name: '',
    payment_id: str(p.payment_id),
    date: str(p.date),
    type: str(p.type),
    reference: str(p.reference),
    amount: str(p.amount),
    status: str(p.status),
    matched_users: str(p.matched_users),
    created_at: str(p.created_at),
  }));
}

const RENEWAL_PAYMENTS_COLUMNS: SchemaColumn[] = [
  col('payment_id', 'Payment ID'), col('date', 'Date'), col('type', 'Type'), col('reference', 'Reference'),
  col('amount', 'Amount'), col('status', 'Status'), col('matched_users', 'Matched Users'), col('created_at', 'Created At'),
];

async function fetchCleaningRotaRows(): Promise<ReportRow[]> {
  const rows = await getCleaningRotaList();
  // One rota row can name up to 4 members — no single "the" user_name to join on, so
  // this source isn't joinable to Members (matches the old sheet: CleaningRota was
  // never actually offered as a join target, only ever queried standalone).
  return rows.map((r) => ({
    user_name: '',
    date: r.date,
    lead: r.lead,
    second: r.second,
    third: r.third,
    fourth: r.fourth,
  }));
}

const CLEANING_ROTA_COLUMNS: SchemaColumn[] = [
  col('date', 'Date'), col('lead', 'Lead'), col('second', 'Second'), col('third', 'Third'), col('fourth', 'Fourth'),
];

async function fetchSweepingRotaRows(): Promise<ReportRow[]> {
  const rows = await getSweepingRotaList();
  return rows.map((r) => ({
    user_name: (r.userName || '').toLowerCase(),
    username_display: r.userName,
    date: r.date,
    is_blocked: str(r.isBlocked),
  }));
}

const SWEEPING_ROTA_COLUMNS: SchemaColumn[] = [
  col('username_display', 'Username'), col('date', 'Date'), col('is_blocked', 'Is Blocked'),
];

async function fetchGamesRows(): Promise<ReportRow[]> {
  // Active season only — matches the old Games sheet, which only ever held the
  // current season's fixtures.
  const fixtures = await getFixtures();
  return fixtures.map((f) => ({
    club_name: (f.clubName || '').toLowerCase(),
    club_name_display: f.clubName,
    date: f.date,
    time: f.time,
    home_away: f.homeAway,
    format: f.format,
    ladies_men: f.ladiesMen,
    dress: f.dress,
    tab_name: f.tabName,
    status: f.status,
    max_players: str(f.maxPlayers),
    entered: str(f.entered),
    selected: str(f.selected),
    reserves: str(f.reserves),
    bhbc_score: str(f.bhbcScore),
    opponent_score: str(f.opponentScore),
    reason: f.reason,
    who: f.who,
    last_modified_by: f.lastModifiedBy,
    last_modified_date: f.lastModifiedDate,
    paired: f.paired,
    game_type: f.gameType,
    club_suffix: f.clubSuffix,
    special_instructions: f.specialInstructions,
    pickup_info: f.pickupInfo,
    captain: f.captain,
    needs_players: str(f.needsPlayers),
    description: str(f.description),
  }));
}

const GAMES_COLUMNS: SchemaColumn[] = [
  col('club_name_display', 'Club Name'), col('date', 'Date'), col('time', 'Time'), col('home_away', 'Home/Away'),
  col('format', 'Format'), col('ladies_men', 'Ladies/Men'), col('dress', 'Dress'), col('tab_name', 'Tab Name'),
  col('status', 'Status'), col('max_players', 'Max Players'), col('entered', 'Entered'), col('selected', 'Selected'),
  col('reserves', 'Reserves'), col('bhbc_score', 'BHBC Score'), col('opponent_score', 'Opponent Score'),
  col('reason', 'Reason'), col('who', 'Who'), col('last_modified_by', 'Last Modified By'), col('last_modified_date', 'Last Modified Date'),
  col('paired', 'Paired'), col('game_type', 'Game Type'), col('club_suffix', 'Club Suffix'),
  col('special_instructions', 'Special Instructions'), col('pickup_info', 'Pickup Info'), col('captain', 'Captain'),
  col('needs_players', 'Needs Players'), col('description', 'Description'),
];

async function fetchClubsRows(): Promise<ReportRow[]> {
  const clubs = await getClubs();
  return clubs.map((c) => ({
    club_name: (c.clubName || '').toLowerCase(),
    club_name_display: c.clubName,
    club_number: c.clubNumber,
    club_mobile: c.clubMobile,
    club_email_address: c.clubEmailAddress,
    club_email_note: c.clubEmailNote,
    general_information: c.generalInformation,
    driving_band: c.drivingBand,
    petrol_cost: str(c.petrolCost),
    address_1: c.address1,
    address_2: c.address2,
    address_3: c.address3,
    address_4: c.address4,
    post_code: c.postCode,
    website: c.website,
    latitude: str(c.latitude),
    longitude: str(c.longitude),
    miles: c.miles,
    travel_time: c.travelTime,
    last_updated: c.lastUpdated,
  }));
}

const CLUBS_COLUMNS: SchemaColumn[] = [
  col('club_name_display', 'Club Name'), col('club_number', 'Club Number'), col('club_mobile', 'Club Mobile'),
  col('club_email_address', 'Club Email Address'), col('club_email_note', 'Club Email Note'),
  col('general_information', 'General Information'), col('driving_band', 'Driving Band'), col('petrol_cost', 'Petrol Cost'),
  col('address_1', 'Address 1'), col('address_2', 'Address 2'), col('address_3', 'Address 3'), col('address_4', 'Address 4'),
  col('post_code', 'Post Code'), col('website', 'Website'), col('latitude', 'Latitude'), col('longitude', 'Longitude'),
  col('miles', 'Miles'), col('travel_time', 'Travel Time'), col('last_updated', 'Last Updated'),
];

async function fetchContactsRows(): Promise<ReportRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('club_contact_profiles').select('*');
  if (error) throw new Error(`Failed to fetch club contacts: ${error.message}`);
  return (data ?? []).map((r) => {
    const firstName = r.first_name || '';
    const lastName = r.last_name || '';
    return {
      club_name: (r.club_name || '').toLowerCase(),
      club_name_display: r.club_name,
      role: str(r.role),
      first_name: str(firstName),
      last_name: str(lastName),
      name: str(`${firstName} ${lastName}`.trim()),
      phone_number: str(r.phone_number),
      mobile_number: str(r.mobile_number),
      notes: str(r.notes),
      email: str(r.email),
    };
  });
}

const CONTACTS_COLUMNS: SchemaColumn[] = [
  col('club_name_display', 'Club Name'), col('role', 'Role'), col('first_name', 'First Name'), col('last_name', 'Last Name'),
  col('name', 'Name'), col('phone_number', 'Phone Number'), col('mobile_number', 'Mobile Number'),
  col('notes', 'Notes'), col('email', 'Email'),
];

export const SOURCE_REGISTRY: SourceSpec[] = [
  { key: 'Members', label: 'Members', joinKey: 'user_name', columns: MEMBERS_COLUMNS, fetchRows: fetchMembersRows },
  { key: 'Renewals', label: 'Renewals', joinKey: 'user_name', columns: RENEWALS_COLUMNS, fetchRows: fetchRenewalsRows },
  { key: 'RenewalPayments', label: 'Renewal Payments', joinKey: 'user_name', columns: RENEWAL_PAYMENTS_COLUMNS, fetchRows: fetchRenewalPaymentsRows },
  { key: 'CleaningRota', label: 'Cleaning Rota', joinKey: 'user_name', columns: CLEANING_ROTA_COLUMNS, fetchRows: fetchCleaningRotaRows },
  { key: 'SweepingRota', label: 'Sweeping Rota', joinKey: 'user_name', columns: SWEEPING_ROTA_COLUMNS, fetchRows: fetchSweepingRotaRows },
  { key: 'Games', label: 'Games', joinKey: 'club_name', columns: GAMES_COLUMNS, fetchRows: fetchGamesRows },
  { key: 'Clubs', label: 'Clubs', joinKey: 'club_name', columns: CLUBS_COLUMNS, fetchRows: fetchClubsRows },
  { key: 'Contacts', label: 'Contacts', joinKey: 'club_name', columns: CONTACTS_COLUMNS, fetchRows: fetchContactsRows },
];

function getSource(key: string): SourceSpec {
  const source = SOURCE_REGISTRY.find((s) => s.key === key);
  if (!source) throw new Error(`Unknown source: ${key}`);
  return source;
}

// ============================================================================
// SCHEMA
// ============================================================================

export async function getAllSheetSchemas(): Promise<SheetSchema[]> {
  return SOURCE_REGISTRY.map((s) => ({
    key: s.key,
    label: s.label,
    joinKey: s.joinKey,
    columns: s.columns,
  }));
}

// ============================================================================
// REPORT EXECUTION
// ============================================================================

/**
 * Execute a report definition: fetch rows for the primary source and every joined
 * source, LEFT JOIN on the shared join key, filter, select columns in the requested
 * order (including fixed/static columns), and return every matching row.
 */
export async function executeReport(definition: ReportDefinition): Promise<{ headers: string[]; rows: string[][] }> {
  const primarySource = getSource(definition.primarySheet);
  const primaryRows = await primarySource.fetchRows();

  const joinedRowsBySource: Record<string, ReportRow[]> = {};
  for (const joinKey of definition.joins) {
    const joinSource = getSource(joinKey);
    if (joinSource.joinKey !== primarySource.joinKey) {
      throw new Error(
        `Cannot join ${joinKey} (${joinSource.joinKey}) with ${definition.primarySheet} (${primarySource.joinKey}): different join keys`
      );
    }
    joinedRowsBySource[joinKey] = await joinSource.fetchRows();
  }

  // Build join indexes: Map<joinKeyValue, row[]> for each joined source
  const joinIndexes: Record<string, Map<string, ReportRow[]>> = {};
  for (const [sourceKey, rows] of Object.entries(joinedRowsBySource)) {
    const source = getSource(sourceKey);
    const index = new Map<string, ReportRow[]>();
    for (const row of rows) {
      const keyValue = (row[source.joinKey] || '').trim();
      if (!keyValue) continue;
      if (!index.has(keyValue)) index.set(keyValue, []);
      index.get(keyValue)!.push(row);
    }
    joinIndexes[sourceKey] = index;
  }

  // LEFT JOIN: iterate primary rows, expand with joined data (cartesian product across joins)
  type ExpandedRow = Record<string, ReportRow | null>;
  let joinedExpandedRows: ExpandedRow[] = [];

  for (const primaryRow of primaryRows) {
    const primaryKeyValue = (primaryRow[primarySource.joinKey] || '').trim();

    let expansions: ExpandedRow[] = [{ [definition.primarySheet]: primaryRow }];

    for (const joinSourceKey of definition.joins) {
      const matchedRows = primaryKeyValue ? joinIndexes[joinSourceKey]?.get(primaryKeyValue) || [] : [];
      const newExpansions: ExpandedRow[] = [];

      if (matchedRows.length === 0) {
        for (const existing of expansions) newExpansions.push({ ...existing, [joinSourceKey]: null });
      } else {
        for (const existing of expansions) {
          for (const matchedRow of matchedRows) newExpansions.push({ ...existing, [joinSourceKey]: matchedRow });
        }
      }
      expansions = newExpansions;
    }

    joinedExpandedRows.push(...expansions);
  }

  // Evaluate a single filter against an expanded row
  function applyFilter(filter: ReportFilter, expandedRow: ExpandedRow): boolean {
    const dotIndex = filter.column.indexOf('.');
    const filterSourceKey = filter.column.substring(0, dotIndex);
    const filterColName = filter.column.substring(dotIndex + 1);
    const sourceRow = expandedRow[filterSourceKey];

    function getCellValue(): string | null {
      if (!sourceRow) return null;
      const v = sourceRow[filterColName];
      return v === undefined ? null : v.trim();
    }

    if (filter.operator === 'is_blank') {
      if (!sourceRow) return true;
      const v = getCellValue();
      return v === null || v === '';
    }
    if (filter.operator === 'is_not_blank') {
      if (!sourceRow) return false;
      const v = getCellValue();
      return v !== null && v !== '';
    }
    if (!sourceRow) return false;
    const cellValue = getCellValue() ?? '';
    if (filter.operator === 'in') return filter.values.some((v) => v.trim().toLowerCase() === cellValue.toLowerCase());
    if (filter.operator === 'not_in') return !filter.values.some((v) => v.trim().toLowerCase() === cellValue.toLowerCase());
    if (filter.operator === 'gt' || filter.operator === 'lt') {
      const parseNumeric = (s: string) => parseFloat(s.replace(/[£$,\s]/g, ''));
      const cellNum = parseNumeric(getCellValue() ?? '');
      const threshold = parseNumeric(filter.values[0] ?? '');
      if (isNaN(cellNum) || isNaN(threshold)) return false;
      return filter.operator === 'gt' ? cellNum > threshold : cellNum < threshold;
    }
    if (filter.operator === 'contains') return filter.values.some((v) => cellValue.toLowerCase().includes(v.trim().toLowerCase()));
    if (filter.operator === 'not_contains') return filter.values.every((v) => !cellValue.toLowerCase().includes(v.trim().toLowerCase()));
    return false;
  }

  const filterMode = definition.filterMode || 'AND';
  const filteredRows = joinedExpandedRows.filter((expandedRow) => {
    if (definition.filters.length === 0) return true;
    if (filterMode === 'OR') return definition.filters.some((f) => applyFilter(f, expandedRow));
    return definition.filters.every((f) => applyFilter(f, expandedRow));
  });

  // Build unified output column specs from columnOrder (or fall back to selectedColumns)
  const unifiedOrder = definition.columnOrder && definition.columnOrder.length > 0 ? definition.columnOrder : definition.selectedColumns;
  const fixedColMap = new Map((definition.fixedColumns || []).map((fc) => [fc.id, fc]));

  interface OutputColSpec {
    header: string;
    type: 'field' | 'fixed';
    sourceKey?: string;
    columnName?: string;
    fixedValue?: string;
  }

  const outputColSpecs: OutputColSpec[] = [];
  for (const colKey of unifiedOrder) {
    if (colKey.startsWith('fixed:')) {
      const fixedId = colKey.substring(6);
      const fc = fixedColMap.get(fixedId);
      if (!fc) continue;
      const alias = definition.columnAliases?.[colKey];
      outputColSpecs.push({ header: alias || fc.name || '', type: 'fixed', fixedValue: fc.value });
    } else {
      const dot = colKey.indexOf('.');
      const sourceKey = colKey.substring(0, dot);
      const columnName = colKey.substring(dot + 1);
      const source = SOURCE_REGISTRY.find((s) => s.key === sourceKey);
      const schemaCol = source?.columns.find((c) => c.name === columnName);
      const alias = definition.columnAliases?.[colKey];
      outputColSpecs.push({ header: alias || schemaCol?.originalHeader || columnName, type: 'field', sourceKey, columnName });
    }
  }

  const outputHeaders = outputColSpecs.map((c) => c.header);
  const outputRows: string[][] = filteredRows.map((expandedRow) =>
    outputColSpecs.map((spec) => {
      if (spec.type === 'fixed') return spec.fixedValue || '';
      const sourceRow = expandedRow[spec.sourceKey!];
      if (!sourceRow) return '';
      return sourceRow[spec.columnName!] ?? '';
    })
  );

  return { headers: outputHeaders, rows: outputRows };
}

/** Preview-sized wrapper for the live "Run Report" UI — first 10 rows only. */
export async function runReportPreview(definition: ReportDefinition): Promise<RunReportResponse> {
  const { headers, rows } = await executeReport(definition);
  return {
    rowCount: rows.length,
    columnCount: headers.length,
    headers,
    preview: rows.slice(0, 10),
  };
}

// ============================================================================
// EXCEL EXPORT
// ============================================================================

// Values are stored internally as strings (see ReportRow) even though most started
// out as real numbers/dates in Postgres — this heuristic writes anything that still
// looks purely numeric back out as a real Excel number (sortable/summable), rather
// than a text cell, without the join/filter engine ever needing to know column types.
function toCellValue(v: string): string | number {
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

/** Build an .xlsx workbook from report results, as a plain Uint8Array (avoids Node
 *  Buffer vs DOM BlobPart type friction at the API route boundary). */
export async function buildWorkbook(headers: string[], rows: string[][], sheetName = 'Report'): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || 'Report'); // Excel sheet-name length limit

  sheet.columns = headers.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(10, h.length + 4)) }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(row.map(toCellValue));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

// ============================================================================
// REPORT DEFINITIONS CRUD (report_definitions table, 0045)
// ============================================================================

export async function listDefinitions(): Promise<DefinitionSummary[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('report_definitions')
    .select('id, name, created_at, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Failed to list report definitions: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getDefinition(id: string): Promise<ReportDefinition | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('report_definitions').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to fetch report definition ${id}: ${error.message}`);
  if (!data) return null;
  const definition = data.definition as ReportDefinition;
  definition.id = data.id;
  definition.name = data.name;
  definition.createdAt = data.created_at;
  definition.updatedAt = data.updated_at;
  return definition;
}

export async function saveDefinition(
  name: string,
  definition: ReportDefinition,
  existingId?: string
): Promise<DefinitionSummary> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  if (existingId) {
    const { data, error } = await supabase
      .from('report_definitions')
      .update({ name, definition, updated_at: now }, { count: 'exact' })
      .eq('id', existingId)
      .select('id, name, created_at, updated_at')
      .maybeSingle();
    if (error) throw new Error(`Failed to update report definition: ${error.message}`);
    if (!data) throw new Error(`Definition ${existingId} not found`);
    return { id: data.id, name: data.name, createdAt: data.created_at, updatedAt: data.updated_at };
  }

  const { data, error } = await supabase
    .from('report_definitions')
    .insert({ name, definition })
    .select('id, name, created_at, updated_at')
    .single();
  if (error) throw new Error(`Failed to create report definition: ${error.message}`);
  return { id: data.id, name: data.name, createdAt: data.created_at, updatedAt: data.updated_at };
}

export async function deleteDefinition(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { error, count } = await supabase.from('report_definitions').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(`Failed to delete report definition ${id}: ${error.message}`);
  return !!count;
}
