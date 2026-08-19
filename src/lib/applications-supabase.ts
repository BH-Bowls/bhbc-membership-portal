// src/lib/applications-supabase.ts
// Postgres-backed replacement for applications-sheets.ts. Same Application field names
// (camelCase) as the Sheets version so callers (routes, the frontend page, the email
// templates) don't need to change shape — only `rowNumber: number` became `id: string`
// (a UUID), since Postgres doesn't have sheet row numbers.
//
// A few column names differ from their camelCase field names on the live sheet:
// emailAddress -> email, memberType -> requested_member_type, createdAt -> submitted_at.
// convertedUsername has no direct column at all — applications.converted_user_id is a
// UUID FK to users(id), resolved via a join and flattened back to a username string here.
//
// Date fields (createdAt, listedDate, paymentDate, approvedAt, convertedAt) are stored as
// real timestamptz columns but formatted back to DD/MM/YYYY strings on read, matching the
// live sheet's format — this keeps date-utils.ts's parseUKDate() (used for the objection-
// deadline calculation on listedDate) working unchanged, and keeps display text consistent
// with how it looked before. Callers writing a date must pass something Postgres can parse
// (ISO datetime or YYYY-MM-DD) — not a DD/MM/YYYY string, which Postgres cannot parse.

import { getSupabaseClient } from './supabase';
import { parseUKDate } from './date-utils';
import { createMember } from './members-admin-supabase';

/**
 * Application — one row from the applications table, in the same shape the live
 * Sheets-backed version used. The personal-detail fields come from the public /apply
 * form; the remaining fields are added and managed by the admin workflow.
 */
export interface Application {
  id: string; // UUID — stable id used in API routes (was rowNumber on the Sheets version)
  firstName: string;
  lastName: string;
  knownAs: string;
  gender: string; // 'M' or 'F'
  emailAddress: string;
  landline: string;
  mobile: string;
  address1: string;
  address2: string;
  address3: string;
  postCode: string;
  ageDemographic: string;
  dob: string;
  ftEducation: string;
  memberType: string; // 'Playing' or 'Social' (as submitted on the form)
  previousExperience: string;
  disabilities: string;
  proposerName: string;
  seconderName: string;
  comments: string;
  createdAt: string;
  // Workflow columns (added by this feature):
  status: string;
  listedDate: string;
  feeDue: number | null;
  feePaid: number | null;
  paymentMethod: string;
  paymentDate: string;
  decisionNotes: string;
  approvedAt: string;
  convertedAt: string;
  convertedUsername: string;
}

/** Format a Postgres timestamptz value as DD/MM/YYYY, or '' when null. */
function formatDateOnly(value: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return '';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

function mapRow(row: any): Application {
  const convertedUser = row.converted_user;
  return {
    id: row.id,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    knownAs: row.known_as || '',
    gender: row.gender || '',
    emailAddress: row.email || '',
    landline: row.landline || '',
    mobile: row.mobile || '',
    address1: row.address_1 || '',
    address2: row.address_2 || '',
    address3: row.address_3 || '',
    postCode: row.post_code || '',
    ageDemographic: row.age_demographic || '',
    dob: row.dob || '',
    ftEducation: row.ft_education || '',
    memberType: row.requested_member_type || '',
    previousExperience: row.previous_experience || '',
    disabilities: row.disabilities || '',
    proposerName: row.proposer_name || '',
    seconderName: row.seconder_name || '',
    comments: row.comments || '',
    createdAt: formatDateOnly(row.submitted_at),
    status: row.status || '',
    listedDate: formatDateOnly(row.listed_date),
    feeDue: row.fee_due === null || row.fee_due === undefined ? null : Number(row.fee_due),
    feePaid: row.fee_paid === null || row.fee_paid === undefined ? null : Number(row.fee_paid),
    paymentMethod: row.payment_method || '',
    paymentDate: formatDateOnly(row.payment_date),
    decisionNotes: row.decision_notes || '',
    approvedAt: formatDateOnly(row.approved_at),
    convertedAt: formatDateOnly(row.converted_at),
    convertedUsername: (convertedUser && convertedUser.username) || '',
  };
}

// applications has two FKs to users (reviewed_by, converted_user_id) — PostgREST can't
// infer which to embed without disambiguation. users!converted_user_id picks the
// conversion-link one, not the (currently unused) reviewed_by one.
const APPLICATION_SELECT = '*, converted_user:users!converted_user_id(username)';

/**
 * Read every application, oldest submission first (matches the original sheet's
 * top-to-bottom insertion order).
 */
export async function getAllApplications(): Promise<Application[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('applications')
    .select(APPLICATION_SELECT)
    .order('submitted_at', { ascending: true });
  if (error) throw new Error(`Failed to fetch applications: ${error.message}`);
  return (data || []).map(mapRow);
}

/** Read a single application by id, or null when not found. */
export async function getApplicationById(id: string): Promise<Application | null> {
  if (!id) return null;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('applications')
    .select(APPLICATION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch application: ${error.message}`);
  if (!data) return null;
  return mapRow(data);
}

/** Input for a new application, from the public /apply form. */
export interface CreateApplicationInput {
  firstName: string;
  lastName: string;
  knownAs: string;
  gender: string;
  emailAddress: string;
  landline: string;
  mobile: string;
  address1: string;
  address2: string;
  address3: string;
  postCode: string;
  ageDemographic: string;
  dob: string;
  ftEducation: string;
  memberType: string;
  previousExperience: string;
  disabilities: string;
  proposerName: string;
  seconderName: string;
  comments: string;
  feeDue: number | null;
}

/**
 * Create a new application (status 'Submitted'). submitted_at defaults to now() at the
 * database level, matching the live form's "record the submission time" behaviour.
 */
export async function createApplication(
  input: CreateApplicationInput
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('applications')
      .insert({
        status: 'Submitted',
        first_name: input.firstName,
        last_name: input.lastName,
        known_as: input.knownAs || null,
        gender: input.gender || null,
        email: input.emailAddress || null,
        landline: input.landline || null,
        mobile: input.mobile || null,
        address_1: input.address1 || null,
        address_2: input.address2 || null,
        address_3: input.address3 || null,
        post_code: input.postCode || null,
        age_demographic: input.ageDemographic || null,
        dob: input.dob || null,
        ft_education: input.ftEducation || null,
        requested_member_type: input.memberType || null,
        previous_experience: input.previousExperience || null,
        disabilities: input.disabilities || null,
        proposer_name: input.proposerName || null,
        seconder_name: input.seconderName || null,
        comments: input.comments || null,
        fee_due: input.feeDue,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { success: true, id: data.id };
  } catch (error) {
    console.error('[createApplication] Failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to submit application' };
  }
}

// camelCase workflow field -> applications column name. Only these are writable through
// updateApplicationFields — the personal-detail fields are set once at creation, and
// convertedUsername is derived from a join, handled specially by convertApplicationToMember.
const FIELD_TO_COLUMN: { [key: string]: string } = {
  status: 'status',
  listedDate: 'listed_date',
  feeDue: 'fee_due',
  feePaid: 'fee_paid',
  paymentMethod: 'payment_method',
  paymentDate: 'payment_date',
  decisionNotes: 'decision_notes',
  approvedAt: 'approved_at',
  convertedAt: 'converted_at',
};

/**
 * Update specific workflow fields on an application. Date-valued fields must already be
 * in a Postgres-parseable format (ISO datetime or YYYY-MM-DD) — callers are responsible
 * for that, same contract the Sheets version had with normalizeToUKDate (just the
 * opposite direction: Postgres needs ISO-ish input, Sheets needed UK-formatted input).
 */
export async function updateApplicationFields(
  id: string,
  fields: Partial<Application>
): Promise<void> {
  const supabase = getSupabaseClient();
  const updates: Record<string, any> = {};

  for (const [field, value] of Object.entries(fields)) {
    const columnName = FIELD_TO_COLUMN[field];
    if (!columnName) continue;
    updates[columnName] = value === undefined ? null : value;
  }

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase.from('applications').update(updates).eq('id', id);
  if (error) throw new Error(`Failed to update application: ${error.message}`);
}

/**
 * Determine whether an application currently needs admin action.
 * An application needs action when it is either:
 *  - 'Submitted' (a listed date still needs to be set), or
 *  - 'Listed' and the 14-day objection period has now passed.
 */
const OBJECTION_PERIOD_DAYS = 14;

export function applicationNeedsAction(application: Application): boolean {
  if (application.status === 'Submitted') {
    return true;
  }

  if (application.status === 'Listed' && application.listedDate) {
    const listed = parseUKDate(application.listedDate);

    const deadline = new Date(listed.getTime());
    deadline.setDate(deadline.getDate() + OBJECTION_PERIOD_DAYS);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (deadline.getTime() <= today.getTime()) {
      return true;
    }
  }

  return false;
}

/** Count the applications that currently need admin action. */
export async function getPendingApplicationsCount(): Promise<number> {
  const applications = await getAllApplications();

  let count = 0;
  for (let i = 0; i < applications.length; i++) {
    if (applicationNeedsAction(applications[i])) {
      count++;
    }
  }

  return count;
}

// ============================================================================
// CONVERSION TO MEMBER
// ============================================================================

// Result of a successful conversion — the new username and the plain-text temp
// password (the only time the password exists in plain text, for the welcome email).
export interface ConversionResult {
  success: boolean;
  userName?: string;
  tempPassword?: string;
  error?: string;
}

/**
 * Convert a paid application into an active member. Creates the member via the shared
 * createMember helper (same path used by manual Create), then marks the application
 * Converted, linking converted_user_id to the new member.
 *
 * The welcome email is sent by the caller using the returned plain-text password.
 */
export async function convertApplicationToMember(
  application: Application
): Promise<ConversionResult> {
  try {
    const result = await createMember({
      firstName: application.firstName,
      lastName: application.lastName,
      knownAs: application.knownAs,
      gender: application.gender,
      memberType: application.memberType,
      emailAddress: application.emailAddress,
      landline: application.landline,
      mobile: application.mobile,
      address1: application.address1,
      address2: application.address2,
      address3: application.address3,
      postCode: application.postCode,
      ageDemographic: application.ageDemographic,
      dob: application.dob,
    });

    // Pass through a creation failure unchanged
    if (!result.success || !result.userName || !result.userId) {
      return result;
    }

    // Mark the application as converted, linking directly to the new user's id
    const supabase = getSupabaseClient();
    const { error: updateError } = await supabase
      .from('applications')
      .update({
        status: 'Converted',
        converted_at: new Date().toISOString(),
        converted_user_id: result.userId,
      })
      .eq('id', application.id);

    if (updateError) {
      // The member was created successfully — don't fail the whole conversion over a
      // status-update error, but log loudly so it can be fixed manually.
      console.error(`[convertApplicationToMember] Member ${result.userName} created, but failed to mark application ${application.id} converted:`, updateError.message);
    }

    return { success: true, userName: result.userName, tempPassword: result.tempPassword };
  } catch (error) {
    console.error(`[convertApplicationToMember] Failed for application ${application.id}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to convert application',
    };
  }
}
