// src/lib/members-supabase.ts
// Postgres-backed replacement for the User-related functions in sheets.ts that
// auth-supabase.ts needs. Same User type (imported from sheets.ts, not redefined) and
// same function signatures, so nothing consuming these needs to change shape.
//
// getUserByUsername/getUsersByEmail/getAllUsers deliberately include shared accounts
// (Captain/Kiosk, account_type='shared') even though they have no member_profiles row —
// login needs to find them by username. A LEFT JOIN against member_profiles (not inner)
// is what makes this work: shared accounts come back with every profile field null,
// matching how today's Sheets-based dummy Kiosk/Captain rows already carry mostly-blank
// profile data. getAllUsers() also filters is_active=true — Leavers now live in the same
// `users` table (is_active=false) rather than a separate sheet, and the existing
// behaviour (getAllUsers never returns Leavers) has to carry forward unchanged.
//
// See specs/Phase_0_1_Migration_Plan.md, "Key architectural decision" and Step 1/2.

import { getSupabaseClient } from './supabase';
import type { User } from './sheets';

const USERS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours, matches sheets.ts

let _usersCache: { users: User[]; at: number } | null = null;

// Exported so other files that write to users/member_profiles directly
// (members-admin-supabase.ts, profile-supabase.ts) can invalidate this shared cache —
// found necessary after createMember() left the cache stale for up to 24h following a
// real Create Member test, since it writes via its own Supabase client rather than
// through this file's functions.
export function invalidateCache() {
  _usersCache = null;
}

function mapRow(row: any): User {
  const profile = row.member_profiles ?? null;
  const roles: string[] = (row.user_roles ?? []).map((r: any) => r.role);

  const firstName = profile?.first_name || '';
  const lastName = profile?.last_name || '';
  const knownAs = profile?.known_as || null;
  const fullKnownAs = knownAs || firstName;
  const fullName = `${fullKnownAs} ${lastName}`.trim();

  return {
    title: profile?.title ?? null,
    firstName,
    lastName,
    knownAs,
    fullKnownAs,
    fullName,
    emailAddress: profile?.email_address ?? null,
    landline: profile?.landline ?? null,
    mobile: profile?.mobile ?? null,
    address1: profile?.address_1 ?? null,
    address2: profile?.address_2 ?? null,
    address3: profile?.address_3 ?? null,
    postCode: profile?.post_code ?? null,
    lockerNo: profile?.locker_no ?? null,
    birthdate: profile?.birthdate ?? null,
    ageDemographic: profile?.age_demographic ?? '',   // restored in 0020, directly editable — see profile-supabase.ts
    memberType: profile?.member_type ?? '',
    honorary: profile?.honorary ?? null,
    yearStarted: profile?.year_started ?? null,
    renewStatus: profile?.renew_status ?? null,
    friendlies2023: 0,     // dropped entirely per the plan
    friendlies2024: 0,     // dropped entirely per the plan
    friendliesLastYear: 0, // dropped entirely per the plan
    comments: profile?.comments ?? null,
    socialEmails: profile?.social_emails ?? false,
    handbookEntry: profile?.handbook_entry ?? false,
    drivingAwayMatches: profile?.driving_away_matches ?? null,
    drivingAdditionalInfo: profile?.driving_additional_info ?? null,
    greenMaintenance: profile?.green_maintenance ?? null,
    greenAdditionalInfo: profile?.green_additional_info ?? null,
    barDuty: profile?.bar_duty ?? null,
    barAdditionalInfo: profile?.bar_additional_info ?? null,
    otherSkills: profile?.other_skills ?? null,
    gmc: profile?.gmc ?? null,
    profileUpdatedDate: profile?.profile_updated_at ?? null,
    handicap: profile?.handicap ?? null,
    include: profile?.include ?? null,
    renewalEmailSentStatus: profile?.renewal_email_sent_status ?? null,
    buddyUserName: profile?.buddy_user_name ?? null,
    userName: row.username,
    passwordHash: row.password_hash,
    isTempPassword: row.is_temp_password,
    role: roles.join(','),
    lastLoginDate: row.last_login_at,
    lastLoginFailedDate: row.last_login_failed_at,
    lastPasswordResetDate: row.last_password_reset_at,
    resetToken: row.reset_token,
    resetTokenExpires: row.reset_token_expires,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAllUsers(forceFresh = false): Promise<User[]> {
  // Same forceFresh contract as sheets.ts: auth-critical reads (login, reset-token,
  // change-password verify) must bypass the cache, since a stale copy could let a
  // just-changed password keep working, or a brand-new member fail to be found.
  if (!forceFresh && _usersCache && Date.now() - _usersCache.at < USERS_CACHE_TTL_MS) {
    return _usersCache.users.slice();
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    // member_profiles has two FKs to users (user_id, buddy_user_name) — PostgREST can't
    // infer which to embed without disambiguation. !user_id picks the profile-ownership
    // one, not the buddy-pairing one.
    .select('*, member_profiles!user_id(*), user_roles(role)')
    .eq('is_active', true);
  if (error) throw new Error(`Failed to fetch users from Postgres: ${error.message}`);

  const users = (data ?? []).map(mapRow);
  _usersCache = { users, at: Date.now() };
  console.log(`[members-supabase] loaded ${users.length} active users from Postgres`);
  return users.slice();
}

export async function getUserByUsername(userName: string, forceFresh = false): Promise<User | null> {
  const users = await getAllUsers(forceFresh);
  const normalized = userName.toLowerCase();
  const normalizedWithDot = normalized.replace(/_/g, '.');

  return (
    users.find(
      (u) => u.userName.toLowerCase() === normalized || u.userName.toLowerCase() === normalizedWithDot
    ) || null
  );
}

export async function getUsersByEmail(email: string, forceFresh = false): Promise<User[]> {
  const users = await getAllUsers(forceFresh);
  const normalized = email.toLowerCase();
  return users.filter((u) => u.emailAddress && u.emailAddress.toLowerCase() === normalized);
}

export async function updatePasswordHash(
  userName: string,
  newPasswordHash: string,
  isTempPassword: boolean = false
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('users')
    .update({
      password_hash: newPasswordHash,
      is_temp_password: isTempPassword,
      last_password_reset_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('username', userName);
  if (error) throw new Error(`Failed to update password: ${error.message}`);
  invalidateCache();
}

export async function updateLastLogin(userName: string, success: boolean): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const column = success ? 'last_login_at' : 'last_login_failed_at';
    const { error } = await supabase
      .from('users')
      .update({ [column]: new Date().toISOString() })
      .eq('username', userName);
    if (error) console.error('Error updating last login:', error.message);
    else invalidateCache();
  } catch (error) {
    console.error('Error updating last login:', error);
  }
}

export async function logLoginAttempt(attempt: {
  identifier: string;
  userName?: string | null;
  success: boolean;
  failureReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceType?: string | null;
}): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('login_attempts').insert({
      identifier: attempt.identifier,
      user_name: attempt.userName || null,
      success: attempt.success,
      failure_reason: attempt.failureReason || null,
      ip_address: attempt.ipAddress || null,
      user_agent: attempt.userAgent || null,
      device_type: attempt.deviceType || null,
    });
    if (error) console.error('Error logging login attempt:', error.message);
  } catch (error) {
    console.error('Error logging login attempt:', error);
  }
}

/**
 * Correctly windowed (last 15 minutes), unlike the live Sheets version — that one reads
 * range LoginAttempts!A2:H (columns A-H only) but indexes row[7] expecting attempted_at,
 * which is actually column I (device_type is at row[7]). Rate limiting is currently
 * disabled at the authenticateUser() call site, so this bug is dormant, not live-broken —
 * but there's no reason to carry a known bug forward into new code, so this queries
 * attempted_at directly and correctly.
 */
export async function getRecentFailedAttempts(
  identifier: string,
  ipAddress?: string
): Promise<{ byIdentifier: number; byIp: number }> {
  try {
    const supabase = getSupabaseClient();
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('login_attempts')
      .select('identifier, ip_address')
      .eq('success', false)
      .gte('attempted_at', fifteenMinutesAgo);
    if (error) throw new Error(error.message);

    const normalizedIdentifier = identifier.toLowerCase();
    let byIdentifier = 0;
    let byIp = 0;
    for (const row of data ?? []) {
      if (row.identifier?.toLowerCase() === normalizedIdentifier) byIdentifier++;
      if (ipAddress && row.ip_address === ipAddress) byIp++;
    }
    return { byIdentifier, byIp };
  } catch (error) {
    console.error('Error getting recent attempts:', error);
    return { byIdentifier: 0, byIp: 0 };
  }
}

// ============================================================================
// PASSWORD RESET (forgot-password / reset-password flow)
// ============================================================================

export async function logPasswordResetRequest(identifier: string, userName?: string | null): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('password_reset_requests')
      .insert({ identifier, user_name: userName || null });
    if (error) console.error('Error logging password reset request:', error.message);
  } catch (error) {
    console.error('Error logging password reset request:', error);
  }
}

export async function countRecentResetRequests(identifier: string): Promise<number> {
  try {
    const supabase = getSupabaseClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('password_reset_requests')
      .select('identifier')
      .gte('requested_at', oneHourAgo);
    if (error) throw new Error(error.message);

    const normalized = identifier.toLowerCase();
    return (data ?? []).filter((r) => r.identifier?.toLowerCase() === normalized).length;
  } catch (error) {
    console.error('Error counting reset requests:', error);
    return 0;
  }
}

export async function generatePasswordResetToken(identifier: string): Promise<string | null> {
  try {
    const users = await getAllUsers();
    const normalized = identifier.toLowerCase();
    const normalizedWithDot = normalized.replace(/_/g, '.');

    const user = users.find(
      (u) =>
        u.userName.toLowerCase() === normalized ||
        u.userName.toLowerCase() === normalizedWithDot ||
        (u.emailAddress && u.emailAddress.toLowerCase() === normalized)
    );

    if (!user) {
      // Log the request even if the user wasn't found, for rate limiting.
      await logPasswordResetRequest(identifier, null);
      return null;
    }

    await logPasswordResetRequest(identifier, user.userName);

    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    // 24-hour expiry — matches sheets.ts, extended for Gmail delivery delays.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('users')
      .update({ reset_token: token, reset_token_expires: expiresAt })
      .eq('username', user.userName);
    if (error) throw new Error(error.message);
    invalidateCache();

    return token;
  } catch (error) {
    console.error('Error generating password reset token:', error);
    return null;
  }
}

export async function validateResetToken(token: string): Promise<User | null> {
  try {
    // Read fresh — the token was just written and may not be in another instance's cache.
    const users = await getAllUsers(true);
    const user = users.find((u) => u.resetToken === token);
    if (!user) return null;

    if (!user.resetTokenExpires) return null;
    const expiresAt = new Date(user.resetTokenExpires).getTime();
    if (Date.now() > expiresAt) return null;

    return user;
  } catch (error) {
    console.error('Error validating reset token:', error);
    return null;
  }
}

export async function clearResetToken(userName: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('users')
      .update({ reset_token: null, reset_token_expires: null })
      .eq('username', userName);
    if (error) console.error('Error clearing reset token:', error.message);
    else invalidateCache();
  } catch (error) {
    console.error('Error clearing reset token:', error);
  }
}

// ============================================================================
// IMPERSONATION LOG
// ============================================================================

export async function logImpersonationEvent(event: {
  sessionId: string;
  action: 'START' | 'STOP';
  adminUserName: string;
  adminName: string;
  adminRole: string;
  targetUserName?: string | null;
  targetName?: string | null;
  targetRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('impersonation_log').insert({
      session_id: event.sessionId,
      action: event.action,
      admin_user_name: event.adminUserName,
      admin_name: event.adminName,
      admin_role: event.adminRole,
      target_user_name: event.targetUserName || null,
      target_name: event.targetName || null,
      target_role: event.targetRole || null,
      ip_address: event.ipAddress || null,
      user_agent: event.userAgent || null,
    });
    if (error) console.error('Error logging impersonation event:', error.message);
  } catch (error) {
    console.error('Error logging impersonation event:', error);
    // Don't throw - logging failure shouldn't break impersonation
  }
}
