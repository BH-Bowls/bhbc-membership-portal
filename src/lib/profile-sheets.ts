// src/lib/profile-sheets.ts
// Profile management operations for Google Sheets
// Handles user profile updates with field-level validation and batch Google Sheets API updates

import {
  getUserByUsername as getSheetsUser,
  type User,
  getColumnMap,
  getColumnLetter,
  clearColumnMapCache,
} from './sheets';
import { wrapError, camelToSnakeCase } from './banking-sheets';
import { google } from 'googleapis';

// Re-export for convenience
export { type User };

// ============================================================================
// Environment Getters
// ============================================================================

/**
 * Get the Google Sheets spreadsheet ID from environment variables
 * This is the Members spreadsheet that contains user profile data
 */
function getSpreadsheetId(): string {
  const id = process.env.MEMBERS_SPREADSHEET_ID;
  if (!id) throw new Error('MEMBERS_SPREADSHEET_ID not set');
  return id;
}

/**
 * Get the Google service account email from environment variables
 * This is used for authentication with Google Sheets API
 */
function getServiceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL not set');
  return email;
}

/**
 * Get the Google service account private key from environment variables
 * The key contains escaped newlines (\n) that need to be converted to actual newlines
 */
function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) throw new Error('GOOGLE_PRIVATE_KEY not set');

  // Convert escaped newlines to actual newlines for the private key
  return key.replace(/\\n/g, '\n');
}

/**
 * Create an authenticated Google Sheets API client
 * Uses service account credentials for server-side access
 */
function getGoogleSheetsClient() {
  // Set up authentication with service account credentials
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: getServiceAccountEmail(),
      private_key: getPrivateKey(),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  // Return authenticated sheets client
  return google.sheets({ version: 'v4', auth });
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate profile field values before saving to Google Sheets
 * Returns error message if invalid, undefined if valid
 *
 * Validates:
 * - Email format (basic regex check)
 * - Year started (must be between 1900 and current year + 1)
 * - Age demographic (must be valid option)
 * - Member type (Playing or Social)
 * - Boolean fields (must be actual boolean)
 * - Volunteering preferences (Yes or No)
 */
function validateProfileField(field: string, value: any): string | undefined {
  // Validate email address format
  if (field === 'emailAddress' && value) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Check if email matches basic pattern (user@domain.com)
    if (!emailRegex.test(value)) {
      return 'Invalid email address format';
    }
  }

  // Validate year started
  if (field === 'yearStarted' && value !== undefined && value !== null && value !== '') {
    // Convert value to number if it's a string
    const year = typeof value === 'number' ? value : parseInt(value);
    const currentYear = new Date().getFullYear();

    // Year must be between 1900 and next year (to allow pre-registration)
    if (isNaN(year) || year < 1900 || year > currentYear + 1) {
      return `Invalid year: must be between 1900 and ${currentYear + 1}`;
    }
  }

  // Validate age demographic selection
  if (field === 'ageDemographic' && value) {
    const validDemographics = ['U18', '18-24', '25-59', '60+', '80+'];

    // Check if value is in the allowed list
    if (!validDemographics.includes(value)) {
      return `Invalid age demographic: must be one of ${validDemographics.join(', ')}`;
    }
  }

  // Validate member type
  if (field === 'memberType' && value) {
    const validTypes = ['Playing Lady', 'Social Lady', 'Playing Man', 'Social Man'];

    // Check if value is one of the four valid member types
    if (!validTypes.includes(value)) {
      return `Invalid member type: must be one of ${validTypes.join(', ')}`;
    }
  }

  // Validate boolean fields (socialEmails, handbookEntry)
  const booleanFields = ['socialEmails', 'handbookEntry'];
  if (booleanFields.includes(field) && value !== undefined && value !== null) {
    // Must be actual boolean type, not string "true" or "false"
    if (typeof value !== 'boolean') {
      return `${field} must be a boolean value`;
    }
  }

  // Validate volunteering preferences
  const volunteeringFields = ['drivingAwayMatches', 'greenMaintenance', 'barDuty'];
  if (volunteeringFields.includes(field) && value) {
    const validValues = ['Y', 'N'];

    // Check if value is either Y or N
    if (!validValues.includes(value)) {
      return `${field} must be one of ${validValues.join(', ')}`;
    }
  }

  // No validation errors found
  return undefined;
}

// ============================================================================
// Profile Operations
// ============================================================================

/**
 * Get user profile by username
 * This is a wrapper around the main getUserByUsername from sheets.ts
 * Kept here for backwards compatibility and clearer API
 */
export async function getUserByUsername(userName: string): Promise<User | null> {
  return getSheetsUser(userName);
}

/**
 * Update user profile in Google Sheets
 * Only allows updating specific whitelisted fields (not auth fields like password)
 *
 * Process:
 * 1. Validate user exists
 * 2. Validate all field values
 * 3. Build batch update request
 * 4. Execute single batch update to Google Sheets
 * 5. Update profile_updated_date timestamp
 *
 * @param userName The username to update
 * @param updates Partial user object with fields to update
 * @returns Success status and error message if failed
 */
export async function updateUserProfile(
  userName: string,
  updates: Partial<User>
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get the user's current profile from Google Sheets
    const user = await getUserByUsername(userName);

    // Check if user exists in the Members sheet
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Check if user has a row number (needed for updates)
    if (!user._rowNumber) {
      return { success: false, error: 'User not found' };
    }

    // Get the column mapping for the Members sheet
    const colMap = await getColumnMap('Members');

    // Get authenticated Google Sheets client
    const sheets = getGoogleSheetsClient();

    // Define which fields users are allowed to update
    // Security: Password and other auth fields are NOT in this list
    // Role is in this list but protected by canEditProfileField (admin-only)
    const allowedFields = [
      'firstName',
      'lastName',
      'knownAs',
      'role',
      'buddyUserName',
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
      'memberType',
      'yearStarted',
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

    // Validate all updates before applying any changes
    // This ensures we fail fast if any field is invalid
    for (const field of allowedFields) {
      // Check if this field is being updated
      if (field in updates) {
        const value = updates[field as keyof User];

        // Run validation on the field value
        const validationError = validateProfileField(field, value);

        // If validation failed, return error immediately
        if (validationError) {
          return { success: false, error: `${field}: ${validationError}` };
        }
      }
    }

    // Build array of cell updates for batch update
    // Each update specifies: sheet range, cell value
    const updateData: any[] = [];

    // Define custom field name mappings for fields that don't follow camelCase
    // e.g., address1 → address_1, lockerNo → locker_no
    const customFieldMappings: Record<string, string> = {
      address1: 'address_1',
      address2: 'address_2',
      address3: 'address_3',
      lockerNo: 'locker_no',
      buddyUserName: 'buddy_user_name',
    };

    // Loop through all allowed fields and build update requests
    for (const field of allowedFields) {
      // Check if this field is being updated
      if (field in updates) {
        // Get the new value for this field
        const value = updates[field as keyof User];

        // Convert field name from camelCase to snake_case column name
        // e.g., firstName → first_name
        const colName = camelToSnakeCase(field, customFieldMappings);

        // Get the column index from the column map
        const colIndex = colMap[colName];

        // Only update if column exists in the sheet
        if (colIndex !== undefined) {
          // Convert column index to Excel column letter (e.g., 0 → A, 25 → Z)
          const colLetter = getColumnLetter(colIndex);

          // Convert boolean values to Y/N for Google Sheets
          // Google Sheets stores boolean preferences as text
          let cellValue = value;
          if (typeof value === 'boolean') {
            cellValue = value ? 'Y' : 'N';
          }

          // Handle null/undefined values - store as empty string
          if (cellValue === null || cellValue === undefined) {
            cellValue = '';
          }

          // Prefix phone numbers with apostrophe to force text format
          // This prevents Google Sheets from stripping leading zeros
          if ((field === 'mobile' || field === 'landline') && cellValue && cellValue !== '') {
            cellValue = `'${cellValue}`;
          }

          // Add this cell update to the batch
          // Format: Members!A5 (sheet name, column letter, row number)
          updateData.push({
            range: `Members!${colLetter}${user._rowNumber}`,
            values: [[cellValue]],
          });
        }
      }
    }

    // Update the profile_updated_date timestamp
    // This tracks when the user last edited their profile
    const profileDateCol = colMap['profile_updated_date'];
    if (profileDateCol !== undefined) {
      // Add timestamp update to the batch
      updateData.push({
        range: `Members!${getColumnLetter(profileDateCol)}${user._rowNumber}`,
        values: [[new Date().toISOString()]],
      });
    }

    // Execute batch update to Google Sheets (only if there are updates)
    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        requestBody: {
          data: updateData,
          valueInputOption: 'USER_ENTERED', // Interprets values (dates, formulas, etc.)
        },
      });
    }

    // Profile updated successfully
    return { success: true };
  } catch (error) {
    // Log error with context for debugging
    console.error(`[updateUserProfile] Failed to update profile for ${userName}:`, error);

    // Return error message to caller
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update profile',
    };
  }
}

/**
 * Update a specific volunteering preference and its additional info
 * This is a convenience wrapper around updateUserProfile
 *
 * @param userName The username to update
 * @param field Which volunteering preference to update (driving, green, bar)
 * @param value The preference value (Yes or No)
 * @param additionalInfo Optional additional information about the preference
 * @returns Success status and error message if failed
 */
export async function updateVolunteeringPreference(
  userName: string,
  field: 'drivingAwayMatches' | 'greenMaintenance' | 'barDuty',
  value: string,
  additionalInfo?: string
): Promise<{ success: boolean; error?: string }> {
  // Build updates object with the main preference field
  const updates: Partial<User> = {
    [field]: value,
  };

  // Add additional info field if provided
  // e.g., drivingAwayMatches → drivingAdditionalInfo
  if (additionalInfo !== undefined) {
    const infoField = `${field}AdditionalInfo` as keyof User;
    updates[infoField] = additionalInfo as any;
  }

  // Use main update function to apply changes
  return updateUserProfile(userName, updates);
}
