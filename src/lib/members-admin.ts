// src/lib/members-admin.ts
// Admin member-management data layer: creating new members.
// The member-creation logic (unique username, temporary password, member_type
// translation, and the null-filled append that keeps Members ARRAYFORMULA columns
// intact) lives here so that both the application Convert flow and the manual
// "Create Member" admin flow use one tested path.

import {
  getGoogleSheetsClient,
  getSpreadsheetId,
  getColumnMap,
  getColumnLetter,
  getAllUsers,
} from './sheets';
import { hashPassword } from './auth-sheets';
import { getAllLeavers } from './leavers-sheets';

// Character set for generated temporary passwords (no ambiguous characters).
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 8;

// Input needed to create a new member. Mirrors the personal details collected on
// the application form; used by both Convert and manual Create.
export interface CreateMemberInput {
  firstName: string;
  lastName: string;
  knownAs: string;
  gender: string; // 'M' or 'F'
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

// Result of a member creation — the assigned username and the plain-text temp
// password (the only time it exists in plain text, for the welcome email / UI).
export interface CreateMemberResult {
  success: boolean;
  userName?: string;
  tempPassword?: string;
  error?: string;
}

/**
 * Generate a random 8-character alphanumeric temporary password for a new member.
 * (The forgot-password flow uses a separate 4-digit code; new members get a longer
 * alphanumeric password.)
 *
 * @returns An 8-character alphanumeric password
 */
function generateMemberTempPassword(): string {
  let password = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    const index = Math.floor(Math.random() * TEMP_PASSWORD_CHARS.length);
    password += TEMP_PASSWORD_CHARS.charAt(index);
  }
  return password;
}

/**
 * Strip a name part down to lowercase alphanumeric characters only.
 * Removes spaces, apostrophes, dots and any other punctuation.
 * Example: "O'Brien" -> "obrien", "A.J." -> "aj".
 *
 * @param part A first or last name
 * @returns The cleaned, lowercased part
 */
function cleanNamePart(part: string): string {
  return part.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Derive the full member type name (e.g. "Playing Man") from the gender and the
 * Playing/Social membership type.
 *
 * @param gender 'M' or 'F'
 * @param memberType 'Playing' or 'Social'
 * @returns The full member type name, or '' if it cannot be determined
 */
function deriveMemberTypeFullName(gender: string, memberType: string): string {
  if (memberType === 'Playing') {
    return gender === 'M' ? 'Playing Man' : 'Playing Lady';
  }
  if (memberType === 'Social') {
    return gender === 'M' ? 'Social Man' : 'Social Lady';
  }
  return '';
}

/**
 * Derive a unique username, checking against both the Members and Leavers sheets.
 * Base is "<knownAs-or-firstName>.<lastName>" cleaned to lowercase alphanumerics;
 * collisions get a numeric suffix (2, 3, …). Both sheets are checked because a
 * leaver keeps their original username and could collide on reinstatement.
 *
 * @param knownAs The member's known-as name (may be empty)
 * @param firstName The member's first name
 * @param lastName The member's last name
 * @returns A username not currently in use in either sheet
 */
export async function deriveUniqueUsername(
  knownAs: string,
  firstName: string,
  lastName: string
): Promise<string> {
  // Prefer the "known as" name when present, otherwise the first name
  let baseFirst = knownAs;
  if (!baseFirst) {
    baseFirst = firstName;
  }

  // Build the base username from cleaned name parts
  const base = `${cleanNamePart(baseFirst)}.${cleanNamePart(lastName)}`;

  // Collect every existing username (Members + Leavers), lowercased
  const taken = new Set<string>();

  const members = await getAllUsers();
  for (let i = 0; i < members.length; i++) {
    if (members[i].userName) {
      taken.add(members[i].userName.toLowerCase());
    }
  }

  const leavers = await getAllLeavers();
  for (let i = 0; i < leavers.length; i++) {
    if (leavers[i].userName) {
      taken.add(leavers[i].userName.toLowerCase());
    }
  }

  // Use the base if it is free
  if (!taken.has(base)) {
    return base;
  }

  // Otherwise append an increasing numeric suffix until a free name is found
  let suffix = 2;
  while (taken.has(`${base}${suffix}`)) {
    suffix++;
  }
  return `${base}${suffix}`;
}

/**
 * Create a new member: derive a unique username, generate and hash a temporary
 * password, translate the member type, and append the row to the Members sheet.
 *
 * Unpopulated cells are written as null (not '') so any Members ARRAYFORMULA
 * columns (full_name, full_known_as, age, Gmail Labels) are left for their formula
 * to fill rather than being broken.
 *
 * @param input The new member's details
 * @returns The assigned username and plain-text temporary password, or an error
 */
export async function createMember(input: CreateMemberInput): Promise<CreateMemberResult> {
  try {
    // Derive a unique username (checked against Members + Leavers)
    const userName = await deriveUniqueUsername(input.knownAs, input.firstName, input.lastName);

    // Generate and hash a temporary password
    const tempPassword = generateMemberTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    // Translate the member type to its full-name form (e.g. "Playing Man")
    const memberTypeFullName = deriveMemberTypeFullName(input.gender, input.memberType);

    const membersColMap = await getColumnMap('Members');
    const sheets = getGoogleSheetsClient();
    const nowIso = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    // Map normalized Members column name -> value. Columns not listed are left blank.
    const memberFields: { [key: string]: any } = {
      first_name: input.firstName,
      last_name: input.lastName,
      known_as: input.knownAs,
      email_address: input.emailAddress,
      landline: input.landline,
      mobile: input.mobile,
      address_1: input.address1,
      address_2: input.address2,
      address_3: input.address3,
      post_code: input.postCode,
      age_demographic: input.ageDemographic,
      birthdate: input.dob,
      member_type: memberTypeFullName,
      year_started: currentYear,
      user_name: userName,
      password_hash: passwordHash,
      is_temp_password: 'Y',
      role: 'Member',
      include: 'Y',
      social_emails: 'Y',
      handbook_entry: 'Y',
      created_at: nowIso,
      updated_at: nowIso,
    };

    // Determine how wide the row needs to be (highest mapped column index)
    let maxIndex = 0;
    for (const index of Object.values(membersColMap)) {
      if (index > maxIndex) {
        maxIndex = index;
      }
    }

    // Start with a fully blank row using null (not '') for every column we do not
    // populate, so computed/ARRAYFORMULA columns are left empty for their formula
    // to fill rather than being overwritten with empty-string content (#REF!).
    const memberRow: any[] = [];
    for (let i = 0; i <= maxIndex; i++) {
      memberRow[i] = null;
    }
    for (const [columnName, value] of Object.entries(memberFields)) {
      const colIndex = membersColMap[columnName];
      if (colIndex !== undefined) {
        memberRow[colIndex] = value;
      }
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'Members!A:ZZ',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [memberRow],
      },
    });

    return { success: true, userName, tempPassword };
  } catch (error) {
    console.error('[createMember] Failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create member',
    };
  }
}

/**
 * Bulk-update the `include` flag (Y/N) for many members in a single batch write.
 * Only the `include` column is touched, so computed/ARRAYFORMULA columns are
 * unaffected. Unknown usernames are skipped.
 *
 * @param updates Array of { userName, include } where include is 'Y' or 'N'
 * @returns Success flag and the number of cells written
 */
export async function bulkUpdateInclude(
  updates: { userName: string; include: string }[]
): Promise<{ success: boolean; updated: number; error?: string }> {
  try {
    if (updates.length === 0) {
      return { success: true, updated: 0 };
    }

    const colMap = await getColumnMap('Members');
    const includeCol = colMap['include'];
    if (includeCol === undefined) {
      return { success: false, updated: 0, error: 'Members sheet has no "include" column' };
    }
    const includeLetter = getColumnLetter(includeCol);

    // Map username -> sheet row number from the current Members data
    const users = await getAllUsers();
    const rowByUser = new Map<string, number>();
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      if (u.userName && u._rowNumber) {
        rowByUser.set(u.userName.toLowerCase(), u._rowNumber);
      }
    }

    // Build one cell update per known member
    const data: { range: string; values: any[][] }[] = [];
    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      const row = rowByUser.get(update.userName.toLowerCase());
      if (row === undefined) {
        continue; // unknown username — skip
      }
      // Normalize to Y or N
      const value = update.include === 'Y' ? 'Y' : 'N';
      data.push({
        range: `Members!${includeLetter}${row}`,
        values: [[value]],
      });
    }

    if (data.length === 0) {
      return { success: true, updated: 0 };
    }

    const sheets = getGoogleSheetsClient();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        data,
        valueInputOption: 'USER_ENTERED',
      },
    });

    return { success: true, updated: data.length };
  } catch (error) {
    console.error('[bulkUpdateInclude] Failed:', error);
    return {
      success: false,
      updated: 0,
      error: error instanceof Error ? error.message : 'Failed to update include flags',
    };
  }
}
