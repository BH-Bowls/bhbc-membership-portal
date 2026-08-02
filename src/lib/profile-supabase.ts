// src/lib/profile-supabase.ts
// Postgres-backed replacement for profile-sheets.ts. Same validation rules and allowed-
// field whitelist. One genuinely different piece: `role` is no longer a column at all —
// it's the reconstructed user_roles table — so updating it means replacing that user's
// role rows, not writing a field. Boolean fields (socialEmails, handbookEntry) are real
// booleans in Postgres now, not Y/N strings, so they're written as-is, not converted.

import { getSupabaseClient } from './supabase';
import { getUserByUsername as getMemberByUsername } from './members-supabase';
import { parseRoles } from './role-utils';
import type { User } from './sheets';

export { type User };

// Thin re-export, matching profile-sheets.ts's own API — kept here for the same reason
// the original had it: a clear, profile-scoped name for consumers of this file.
export async function getUserByUsername(userName: string): Promise<User | null> {
  return getMemberByUsername(userName);
}

function validateProfileField(field: string, value: any): string | undefined {
  if (field === 'emailAddress' && value) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return 'Invalid email address format';
  }

  if (field === 'yearStarted' && value !== undefined && value !== null && value !== '') {
    const year = typeof value === 'number' ? value : parseInt(value);
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 1900 || year > currentYear + 1) {
      return `Invalid year: must be between 1900 and ${currentYear + 1}`;
    }
  }

  if (field === 'ageDemographic' && value) {
    const validDemographics = ['U18', '18-24', '25-59', '60+', '80+'];
    if (!validDemographics.includes(value)) {
      return `Invalid age demographic: must be one of ${validDemographics.join(', ')}`;
    }
  }

  if (field === 'memberType' && value) {
    const validTypes = ['Playing Lady', 'Social Lady', 'Playing Man', 'Social Man'];
    if (!validTypes.includes(value)) {
      return `Invalid member type: must be one of ${validTypes.join(', ')}`;
    }
  }

  if (field === 'handicap' && value !== undefined && value !== null && value !== '') {
    const num = typeof value === 'number' ? value : parseInt(value);
    if (isNaN(num) || num < 0 || num > 10 || !Number.isInteger(num)) {
      return 'Handicap must be a whole number between 0 and 10';
    }
  }

  const ynFields = ['honorary', 'include'];
  if (ynFields.includes(field) && value !== undefined && value !== null && value !== '') {
    if (value !== 'Y' && value !== 'N') return `${field} must be Y or N`;
  }

  if (field === 'renewStatus' && value) {
    const validStatuses = ['Renew-Email', 'Renew-Post'];
    if (!validStatuses.includes(value)) return 'renewStatus must be Renew-Email or Renew-Post';
  }

  const booleanFields = ['socialEmails', 'handbookEntry'];
  if (booleanFields.includes(field) && value !== undefined && value !== null) {
    if (typeof value !== 'boolean') return `${field} must be a boolean value`;
  }

  const volunteeringFields = ['drivingAwayMatches', 'greenMaintenance', 'barDuty'];
  if (volunteeringFields.includes(field) && value) {
    const validValues = ['Y', 'N'];
    if (!validValues.includes(value)) return `${field} must be one of ${validValues.join(', ')}`;
  }

  return undefined;
}

// camelCase field -> member_profiles column name (fields not listed use the direct
// snake_case conversion of the camelCase name, e.g. firstName -> first_name).
const FIELD_TO_COLUMN: Record<string, string> = {
  address1: 'address_1',
  address2: 'address_2',
  address3: 'address_3',
  postCode: 'post_code',
  lockerNo: 'locker_no',
  buddyUserName: 'buddy_user_name',
  emailAddress: 'email_address',
  ageDemographic: 'age_demographic',
  memberType: 'member_type',
  yearStarted: 'year_started',
  renewStatus: 'renew_status',
  socialEmails: 'social_emails',
  handbookEntry: 'handbook_entry',
  drivingAwayMatches: 'driving_away_matches',
  drivingAdditionalInfo: 'driving_additional_info',
  greenMaintenance: 'green_maintenance',
  greenAdditionalInfo: 'green_additional_info',
  barDuty: 'bar_duty',
  barAdditionalInfo: 'bar_additional_info',
  otherSkills: 'other_skills',
  firstName: 'first_name',
  lastName: 'last_name',
  knownAs: 'known_as',
};

export async function updateUserProfile(
  userName: string,
  updates: Partial<User>
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getMemberByUsername(userName, true);
    if (!user) return { success: false, error: 'User not found' };

    const allowedFields = [
      'firstName', 'lastName', 'knownAs', 'role', 'buddyUserName', 'emailAddress',
      'landline', 'mobile', 'address1', 'address2', 'address3', 'postCode', 'lockerNo',
      'birthdate', 'ageDemographic', 'memberType', 'yearStarted',
      'honorary', 'handicap', 'include', 'gmc', 'renewStatus', 'socialEmails',
      'handbookEntry', 'drivingAwayMatches', 'drivingAdditionalInfo', 'greenMaintenance',
      'greenAdditionalInfo', 'barDuty', 'barAdditionalInfo', 'otherSkills',
    ];

    for (const field of allowedFields) {
      if (field in updates) {
        const validationError = validateProfileField(field, updates[field as keyof User]);
        if (validationError) return { success: false, error: `${field}: ${validationError}` };
      }
    }

    const supabase = getSupabaseClient();

    // role is user_roles, not a member_profiles column — replace the full set.
    if ('role' in updates) {
      const { data: userRow } = await supabase.from('users').select('id').ilike('username', userName).single();
      if (userRow) {
        await supabase.from('user_roles').delete().eq('user_id', userRow.id);
        const roles = parseRoles(updates.role as string);
        if (roles.length > 0) {
          await supabase.from('user_roles').insert(roles.map((role) => ({ user_id: userRow.id, role })));
        }
      }
    }

    const profileUpdate: Record<string, any> = {};
    for (const field of allowedFields) {
      if (field === 'role' || !(field in updates)) continue;
      const value = updates[field as keyof User];
      const column = FIELD_TO_COLUMN[field] ?? field;
      profileUpdate[column] = value === undefined ? null : value;
    }

    if (Object.keys(profileUpdate).length > 0) {
      profileUpdate.profile_updated_at = new Date().toISOString();
      const { data: userRow } = await supabase.from('users').select('id').ilike('username', userName).single();
      if (!userRow) return { success: false, error: 'User not found' };
      const { error } = await supabase.from('member_profiles').update(profileUpdate).eq('user_id', userRow.id);
      if (error) return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error(`[updateUserProfile] Failed to update profile for ${userName}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update profile' };
  }
}

export async function updateVolunteeringPreference(
  userName: string,
  field: 'drivingAwayMatches' | 'greenMaintenance' | 'barDuty',
  value: string,
  additionalInfo?: string
): Promise<{ success: boolean; error?: string }> {
  const updates: Partial<User> = { [field]: value };
  if (additionalInfo !== undefined) {
    const infoField = `${field}AdditionalInfo` as keyof User;
    updates[infoField] = additionalInfo as any;
  }
  return updateUserProfile(userName, updates);
}
