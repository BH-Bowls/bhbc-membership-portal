// src/lib/members-admin-supabase.ts
// Postgres-backed replacement for members-admin.ts: creating new members and bulk
// include-flag updates. Mirrors the same logic (unique username derivation, temp
// password generation, member_type translation) — see specs/Phase_0_1_Migration_Plan.md.

import { getSupabaseClient } from './supabase';
import { getAllUsers, invalidateCache } from './members-supabase';
import { hashPassword } from './auth-sheets'; // pure, data-source-agnostic — see auth-supabase.ts

const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 8;

export interface CreateMemberInput {
  firstName: string;
  lastName: string;
  knownAs: string;
  gender: string; // 'M' or 'F' — used only to derive memberType's full name, not stored
  memberType: string; // 'Playing' or 'Social' (translated to the full name on write)
  emailAddress: string;
  landline: string;
  mobile: string;
  address1: string;
  address2: string;
  address3: string;
  postCode: string;
  ageDemographic: string;
  dob: string;
}

export interface CreateMemberResult {
  success: boolean;
  userName?: string;
  tempPassword?: string;
  userId?: string; // the new users.id — needed by callers that must link to it afterward (e.g. Applications conversion)
  error?: string;
}

function generateMemberTempPassword(): string {
  let password = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    const index = Math.floor(Math.random() * TEMP_PASSWORD_CHARS.length);
    password += TEMP_PASSWORD_CHARS.charAt(index);
  }
  return password;
}

function cleanNamePart(part: string): string {
  return part.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function deriveMemberTypeFullName(gender: string, memberType: string): string {
  if (memberType === 'Playing') return gender === 'M' ? 'Playing Man' : 'Playing Lady';
  if (memberType === 'Social') return gender === 'M' ? 'Social Man' : 'Social Lady';
  return '';
}

/**
 * Derive a unique username. Checks against every username in `users`, active or not —
 * unlike Sheets (separate Members/Leavers sheets needing two reads), Postgres holds both
 * in the same table, so a leaver's original username is already covered by one query.
 */
export async function deriveUniqueUsername(
  knownAs: string,
  firstName: string,
  lastName: string
): Promise<string> {
  const baseFirst = knownAs || firstName;
  const base = `${cleanNamePart(baseFirst)}.${cleanNamePart(lastName)}`;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('users').select('username');
  if (error) throw new Error(`Failed to check existing usernames: ${error.message}`);

  const taken = new Set((data ?? []).map((u) => u.username.toLowerCase()));

  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}${suffix}`)) suffix++;
  return `${base}${suffix}`;
}

export async function createMember(input: CreateMemberInput): Promise<CreateMemberResult> {
  try {
    const userName = await deriveUniqueUsername(input.knownAs, input.firstName, input.lastName);
    const tempPassword = generateMemberTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const memberTypeFullName = deriveMemberTypeFullName(input.gender, input.memberType);
    const currentYear = new Date().getFullYear();

    const supabase = getSupabaseClient();
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        username: userName,
        password_hash: passwordHash,
        is_temp_password: true,
        account_type: 'member',
      })
      .select('id')
      .single();
    if (userError) throw new Error(userError.message);

    const { error: profileError } = await supabase.from('member_profiles').insert({
      user_id: user.id,
      first_name: input.firstName,
      last_name: input.lastName,
      known_as: input.knownAs || null,
      email_address: input.emailAddress || null,
      landline: input.landline || null,
      mobile: input.mobile || null,
      address_1: input.address1 || null,
      address_2: input.address2 || null,
      address_3: input.address3 || null,
      post_code: input.postCode || null,
      birthdate: input.dob || null,
      age_demographic: input.ageDemographic || null,
      member_type: memberTypeFullName,
      year_started: currentYear,
      include: 'Y',
      social_emails: true,
      handbook_entry: true,
    });
    if (profileError) throw new Error(profileError.message);

    const { error: roleError } = await supabase.from('user_roles').insert({ user_id: user.id, role: 'Member' });
    if (roleError) throw new Error(roleError.message);

    invalidateCache();
    return { success: true, userName, tempPassword, userId: user.id };
  } catch (error) {
    console.error('[createMember] Failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create member' };
  }
}

export async function bulkUpdateInclude(
  updates: { userName: string; include: string }[]
): Promise<{ success: boolean; updated: number; error?: string }> {
  try {
    if (updates.length === 0) return { success: true, updated: 0 };

    const users = await getAllUsers();
    const validUsernames = new Set(users.map((u) => u.userName.toLowerCase()));

    const supabase = getSupabaseClient();
    let updated = 0;
    for (const update of updates) {
      if (!validUsernames.has(update.userName.toLowerCase())) continue; // unknown username — skip
      const value = update.include === 'Y' ? 'Y' : 'N';
      // Update via a join on users.username, since member_profiles has no username column.
      const { data: userRow } = await supabase
        .from('users')
        .select('id')
        .ilike('username', update.userName)
        .single();
      if (!userRow) continue;
      const { error } = await supabase
        .from('member_profiles')
        .update({ include: value })
        .eq('user_id', userRow.id);
      if (!error) updated++;
    }

    if (updated > 0) invalidateCache();
    return { success: true, updated };
  } catch (error) {
    console.error('[bulkUpdateInclude] Failed:', error);
    return { success: false, updated: 0, error: error instanceof Error ? error.message : 'Failed to update include flags' };
  }
}
