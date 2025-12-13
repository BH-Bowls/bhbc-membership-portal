// src/lib/profile-sheets.ts
// Profile management operations for Google Sheets

import {
  getUserByUsername as getSheetsUser,
  type User,
  getColumnMap,
  getColumnLetter,
  clearColumnMapCache,
} from './sheets';
import { google } from 'googleapis';

// Re-export for convenience
export { type User };

function getSpreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('SPREADSHEET_ID not set');
  return id;
}

function getServiceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL not set');
  return email;
}

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) throw new Error('GOOGLE_PRIVATE_KEY not set');
  return key.replace(/\\n/g, '\n');
}

function getGoogleSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: getServiceAccountEmail(),
      private_key: getPrivateKey(),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Get user profile by username
 */
export async function getUserByUsername(userName: string): Promise<User | null> {
  return getSheetsUser(userName);
}

/**
 * Update user profile
 * Only allows updating specific fields (not auth fields)
 */
export async function updateUserProfile(
  userName: string,
  updates: Partial<User>
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUserByUsername(userName);
    
    if (!user || !user._rowNumber) {
      return { success: false, error: 'User not found' };
    }

    const colMap = await getColumnMap('Users');
    const sheets = getGoogleSheetsClient();

    // Define which fields can be updated
    const allowedFields = [
      'title',
      'firstName',
      'lastName',
      'knownAs',
      'emailAddress',
      'landline',
      'mobile',
      'address1',
      'address2',
      'address3',
      'postCode',
      'lockerNo',
      'birthdate',
      'ageDemographic',
      'memberType',        // ← ADD THIS
      'yearStarted',       // ← ADD THIS
      'socialEmails',
      'handbookEntry',
      'drivingAwayMatches',
      'drivingAdditionalInfo',
      'greenMaintenance',
      'greenAdditionalInfo',
      'barDuty',
      'barAdditionalInfo',
      'otherSkills',
    ];

    // Build batch update data
    const updateData: any[] = [];

    // Manual mapping for fields that don't follow camelCase pattern
    const fieldToColumnMap: { [key: string]: string } = {
	  'address1': 'address_1',
	  'address2': 'address_2', 
	  'address3': 'address_3',
	  'lockerNo': 'locker_no',
    };

    for (const field of allowedFields) {
      if (field in updates) {
        const value = updates[field as keyof User];
        const colName = fieldToColumnMap[field] || 
			field.replace(/([A-Z])/g, '_$1').toLowerCase();
        const colIndex = colMap[colName];

        if (colIndex !== undefined) {
          const colLetter = getColumnLetter(colIndex);
          
          // Convert boolean to Y/N for sheets
          let cellValue = value;
          if (typeof value === 'boolean') {
            cellValue = value ? 'Y' : 'N';
          }

          updateData.push({
            range: `Users!${colLetter}${user._rowNumber}`,
            values: [[cellValue ?? '']],
          });
        }
      }
    }

    // Update profile_updated_date
    const profileDateCol = colMap['profile_updated_date'];
    if (profileDateCol !== undefined) {
      updateData.push({
        range: `Users!${getColumnLetter(profileDateCol)}${user._rowNumber}`,
        values: [[new Date().toISOString()]],
      });
    }

    // Execute batch update
    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        requestBody: {
          data: updateData,
          valueInputOption: 'USER_ENTERED',
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating user profile:', error);
    return { success: false, error: 'Failed to update profile' };
  }
}

/**
 * Update specific volunteering preference
 */
export async function updateVolunteeringPreference(
  userName: string,
  field: 'drivingAwayMatches' | 'greenMaintenance' | 'barDuty',
  value: string,
  additionalInfo?: string
): Promise<{ success: boolean; error?: string }> {
  const updates: Partial<User> = {
    [field]: value,
  };

  // Add additional info if provided
  if (additionalInfo !== undefined) {
    const infoField = `${field}AdditionalInfo` as keyof User;
    updates[infoField] = additionalInfo as any;
  }

  return updateUserProfile(userName, updates);
}
