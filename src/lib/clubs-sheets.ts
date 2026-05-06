// src/lib/clubs-sheets.ts
// Google Sheets operations for Clubs feature - handles all data access and manipulation
// for clubs and their contacts from the Match Day Contacts spreadsheet

import { google } from 'googleapis';
import bcrypt from 'bcryptjs';
import {
  Club,
  ClubContact,
  ClubWithContacts,
  CreateClubRequest,
  UpdateClubRequest,
  CreateContactRequest,
  UpdateContactRequest,
} from './types/clubs';

// ============================================================================
// ENVIRONMENT VARIABLE GETTERS
// ============================================================================

/**
 * Get the Match Day Contacts spreadsheet ID from environment variables
 * This spreadsheet contains club details and contacts
 * @returns Spreadsheet ID string
 */
export function getMatchDayContactsSpreadsheetId(): string {
  const id = process.env.MATCH_DAY_CONTACTS_SPREADSHEET_ID;
  if (!id) {
    throw new Error('MATCH_DAY_CONTACTS_SPREADSHEET_ID environment variable is not set');
  }
  return id;
}

/**
 * Get the Google service account email from environment variables
 * @returns Service account email
 */
function getServiceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable is not set');
  }
  return email;
}

/**
 * Get the Google service account private key from environment variables
 * @returns Private key string with actual newline characters
 */
function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) {
    throw new Error('GOOGLE_PRIVATE_KEY environment variable is not set');
  }
  return key.replace(/\\n/g, '\n');
}

// ============================================================================
// GOOGLE SHEETS CLIENT
// ============================================================================

/**
 * Create and return an authenticated Google Sheets API client
 * @returns Google Sheets API v4 client
 */
function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: getServiceAccountEmail(),
      private_key: getPrivateKey(),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert a zero-based column index to a spreadsheet column letter
 * @param index Zero-based column index
 * @returns Column letter (e.g., "A", "B", "AA")
 */
function getColumnLetter(index: number): string {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

// ============================================================================
// COLUMN MAPPING
// ============================================================================

interface ColumnMapCache {
  [spreadsheetId: string]: {
    [sheetName: string]: { [key: string]: number };
  };
}

let columnMapCache: ColumnMapCache = {};

/**
 * Get column mapping from header row
 * Maps column names to their index positions (0-based)
 */
async function getColumnMap(
  spreadsheetId: string,
  sheetName: string
): Promise<{ [key: string]: number }> {
  // Check cache first
  if (columnMapCache[spreadsheetId]?.[sheetName]) {
    return columnMapCache[spreadsheetId][sheetName];
  }

  const sheets = getSheetsClient();

  // Fetch header row
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });

  const headers = response.data.values?.[0] || [];
  const map: { [key: string]: number } = {};

  // Build mapping from normalized column names to indices
  headers.forEach((header: string, index: number) => {
    const normalized = String(header).toLowerCase().trim().replace(/\s+/g, '_');
    map[normalized] = index;
  });

  // Cache the mapping
  if (!columnMapCache[spreadsheetId]) {
    columnMapCache[spreadsheetId] = {};
  }
  columnMapCache[spreadsheetId][sheetName] = map;

  return map;
}

/**
 * Clear column map cache
 */
export function clearColumnMapCache() {
  columnMapCache = {};
}

// ============================================================================
// PETROL BANDS
// ============================================================================

/** Hardcoded fallback in case the PetrolBands sheet is missing or empty */
const PETROL_BANDS_FALLBACK: Record<string, number> = {
  'A': 2.00,
  'B': 3.00,
  'C': 4.00,
  'D': 5.00,
};

/**
 * Read petrol reimbursement amounts from the PetrolBands sheet.
 * Falls back to hardcoded values if the sheet doesn't exist or is empty.
 * Sheet columns: Band | Amount
 * @returns Map of band letter to reimbursement amount (e.g. { A: 2, B: 3, C: 4, D: 5 })
 */
export async function getPetrolBands(): Promise<Record<string, number>> {
  try {
    const spreadsheetId = getMatchDayContactsSpreadsheetId();
    const colMap = await getColumnMap(spreadsheetId, 'PetrolBands');
    const sheets = getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'PetrolBands!A:B',
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return { ...PETROL_BANDS_FALLBACK };

    const get = (row: any[], field: string): string => {
      const index = colMap[field];
      return index !== undefined ? (row[index] || '') : '';
    };

    const map: Record<string, number> = {};
    for (let i = 1; i < rows.length; i++) {
      const band = get(rows[i], 'band').trim().toUpperCase();
      const amount = parseFloat(get(rows[i], 'amount'));
      if (band && !isNaN(amount)) {
        map[band] = amount;
      }
    }

    return Object.keys(map).length > 0 ? map : { ...PETROL_BANDS_FALLBACK };
  } catch {
    // Sheet doesn't exist yet — use hardcoded fallback
    return { ...PETROL_BANDS_FALLBACK };
  }
}

// ============================================================================
// CLUBS OPERATIONS
// ============================================================================

/**
 * Get all clubs from the Clubs sheet
 * @returns Array of all clubs
 */
export async function getClubs(): Promise<Club[]> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const [colMap, petrolBands] = await Promise.all([
    getColumnMap(spreadsheetId, 'clubs'),
    getPetrolBands(),
  ]);
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'clubs!A:ZZ',
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) return []; // No data rows (only header)

  const get = (row: any[], field: string): string => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || '') : '';
  };

  const getNumber = (row: any[], field: string): number | null => {
    const value = get(row, field);
    if (!value) return null;
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  };

  const clubs: Club[] = [];

  // Skip header row (index 0), process data rows
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const clubName = get(row, 'club_name');

    // Skip empty rows
    if (!clubName) continue;

    const drivingBand = get(row, 'driving_band');
    clubs.push({
      clubName,
      clubNumber: get(row, 'club_number'),
      clubMobile: get(row, 'club_mobile'),
      clubEmailAddress: get(row, 'club_email_address') || get(row, 'club_email'),
      clubEmailNote: get(row, 'club_email_note'),
      generalInformation: get(row, 'general_information') || get(row, 'general_info'),
      drivingBand,
      petrolCost: petrolBands[drivingBand] ?? 0,
      address1: get(row, 'address_1'),
      address2: get(row, 'address_2'),
      address3: get(row, 'address_3'),
      address4: get(row, 'address_4'),
      postCode: get(row, 'post_code'),
      website: get(row, 'website'),
      latitude: getNumber(row, 'latitude'),
      longitude: getNumber(row, 'longitude'),
      miles: get(row, 'miles'),
      travelTime: get(row, 'travel_time'),
      lastUpdated: get(row, 'last_updated'),
      _rowNumber: i + 1, // Sheet rows are 1-indexed
    });
  }

  // Sort clubs alphabetically by name
  clubs.sort((a, b) => a.clubName.localeCompare(b.clubName));

  return clubs;
}

/**
 * Get a single club by name
 * @param clubName Club name to search for
 * @returns Club object or null if not found
 */
export async function getClubByName(clubName: string): Promise<Club | null> {
  const clubs = await getClubs();
  return clubs.find(c => c.clubName.toLowerCase() === clubName.toLowerCase()) || null;
}

/**
 * Get all contacts for a specific club
 * @param clubName Club name to get contacts for
 * @returns Array of contacts for the club
 */
export async function getContactsForClub(clubName: string): Promise<ClubContact[]> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Contacts');
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Contacts!A:ZZ',
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) return [];

  const get = (row: any[], field: string): string => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || '') : '';
  };

  const contacts: ClubContact[] = [];

  // Skip header row (index 0), process data rows
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowClubName = get(row, 'club_name');

    // Skip contacts that don't belong to the requested club
    if (rowClubName.toLowerCase() !== clubName.toLowerCase()) {
      continue;
    }

    contacts.push({
      clubName: rowClubName,
      role: get(row, 'role'),
      firstName: get(row, 'first_name'),
      lastName: get(row, 'last_name'),
      name: get(row, 'name'),
      phoneNumber: get(row, 'phone_number'),
      mobileNumber: get(row, 'mobile_number'),
      notes: get(row, 'notes'),
      email: get(row, 'email'),
      _rowNumber: i + 1, // Sheet rows are 1-indexed
    });
  }

  // Sort contacts by role priority
  const roleOrder: { [key: string]: number } = {
    'Captain': 1,
    'Secretary': 2,
  };

  contacts.sort((a, b) => {
    const aOrder = roleOrder[a.role] ?? 99;
    const bOrder = roleOrder[b.role] ?? 99;
    return aOrder - bOrder;
  });

  return contacts;
}

/**
 * Get a club with all its contacts
 * @param clubName Club name to get
 * @returns Club with contacts or null if not found
 */
export async function getClubWithContacts(clubName: string): Promise<ClubWithContacts | null> {
  const club = await getClubByName(clubName);
  if (!club) return null;

  const contacts = await getContactsForClub(clubName);
  return { club, contacts };
}

/**
 * Create a new club
 * @param clubData Club data to create
 * @returns Created club object
 */
export async function createClub(clubData: CreateClubRequest): Promise<Club> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'clubs');
  const sheets = getSheetsClient();

  // Check if club already exists
  const existing = await getClubByName(clubData.clubName);
  if (existing) {
    throw new Error(`Club "${clubData.clubName}" already exists`);
  }

  // Build row data based on column mapping
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'clubs!1:1',
  });
  const headers = headerResponse.data.values?.[0] || [];
  const rowData: string[] = new Array(headers.length).fill('');

  // Map club data to row
  const setValue = (field: string, value: string | number | null | undefined) => {
    const index = colMap[field];
    if (index !== undefined && value !== undefined && value !== null) {
      rowData[index] = String(value);
    }
  };

  setValue('club_name', clubData.clubName);
  setValue('club_number', clubData.clubNumber);
  setValue('club_mobile', clubData.clubMobile);
  setValue('club_email_address', clubData.clubEmailAddress);
  setValue('club_email', clubData.clubEmailAddress); // Also set alternate column name
  setValue('club_email_note', clubData.clubEmailNote);
  setValue('general_information', clubData.generalInformation);
  setValue('general_info', clubData.generalInformation); // Also set alternate column name
  setValue('driving_band', clubData.drivingBand);
  setValue('address_1', clubData.address1);
  setValue('address_2', clubData.address2);
  setValue('address_3', clubData.address3);
  setValue('address_4', clubData.address4);
  setValue('post_code', clubData.postCode);
  setValue('website', clubData.website);
  setValue('latitude', clubData.latitude);
  setValue('longitude', clubData.longitude);
  setValue('miles', clubData.miles);
  setValue('travel_time', clubData.travelTime);
  setValue('last_updated', new Date().toISOString().split('T')[0]);

  // Append new row
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'clubs!A:ZZ',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [rowData],
    },
  });

  // Clear cache and return the created club
  clearColumnMapCache();
  const createdClub = await getClubByName(clubData.clubName);
  if (!createdClub) {
    throw new Error('Failed to create club');
  }
  return createdClub;
}

/**
 * Update an existing club
 * @param clubName Club name to update
 * @param updates Fields to update
 * @returns Updated club object
 */
export async function updateClub(clubName: string, updates: UpdateClubRequest): Promise<Club> {
  const club = await getClubByName(clubName);
  if (!club) {
    throw new Error(`Club "${clubName}" not found`);
  }

  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'clubs');
  const sheets = getSheetsClient();

  // Build update data
  const updateData: { range: string; values: any[][] }[] = [];

  const addUpdate = (field: string, value: string | number | null | undefined) => {
    const index = colMap[field];
    if (index !== undefined && value !== undefined) {
      const colLetter = getColumnLetter(index);
      updateData.push({
        range: `clubs!${colLetter}${club._rowNumber}`,
        values: [[value === null ? '' : value]],
      });
    }
  };

  // Add updates for each provided field
  if (updates.clubNumber !== undefined) addUpdate('club_number', updates.clubNumber);
  if (updates.clubMobile !== undefined) addUpdate('club_mobile', updates.clubMobile);
  if (updates.clubEmailAddress !== undefined) {
    addUpdate('club_email_address', updates.clubEmailAddress);
    addUpdate('club_email', updates.clubEmailAddress);
  }
  if (updates.clubEmailNote !== undefined) addUpdate('club_email_note', updates.clubEmailNote);
  if (updates.generalInformation !== undefined) {
    addUpdate('general_information', updates.generalInformation);
    addUpdate('general_info', updates.generalInformation);
  }
  if (updates.drivingBand !== undefined) addUpdate('driving_band', updates.drivingBand);
  if (updates.address1 !== undefined) addUpdate('address_1', updates.address1);
  if (updates.address2 !== undefined) addUpdate('address_2', updates.address2);
  if (updates.address3 !== undefined) addUpdate('address_3', updates.address3);
  if (updates.address4 !== undefined) addUpdate('address_4', updates.address4);
  if (updates.postCode !== undefined) addUpdate('post_code', updates.postCode);
  if (updates.website !== undefined) addUpdate('website', updates.website);
  if (updates.latitude !== undefined) addUpdate('latitude', updates.latitude);
  if (updates.longitude !== undefined) addUpdate('longitude', updates.longitude);
  if (updates.miles !== undefined) addUpdate('miles', updates.miles);
  if (updates.travelTime !== undefined) addUpdate('travel_time', updates.travelTime);

  // Always update last_updated
  addUpdate('last_updated', new Date().toISOString().split('T')[0]);

  if (updateData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updateData,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }

  // Clear cache and return updated club
  clearColumnMapCache();
  const updatedClub = await getClubByName(clubName);
  if (!updatedClub) {
    throw new Error('Failed to retrieve updated club');
  }
  return updatedClub;
}

/**
 * Delete a club and all its contacts
 * @param clubName Club name to delete
 */
export async function deleteClub(clubName: string): Promise<void> {
  const club = await getClubByName(clubName);
  if (!club) {
    throw new Error(`Club "${clubName}" not found`);
  }

  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const sheets = getSheetsClient();

  // First, delete all contacts for this club
  const contacts = await getContactsForClub(clubName);

  // Delete contacts in reverse order to maintain row numbers
  const sortedContacts = [...contacts].sort((a, b) => b._rowNumber - a._rowNumber);
  for (const contact of sortedContacts) {
    await deleteContactByRowNumber(contact._rowNumber);
  }

  // Get the sheet ID for the clubs sheet
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const clubsSheet = spreadsheet.data.sheets?.find(s =>
    s.properties?.title?.toLowerCase() === 'clubs'
  );

  if (!clubsSheet?.properties?.sheetId) {
    throw new Error('Clubs sheet not found');
  }

  // Delete the club row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: clubsSheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: club._rowNumber - 1, // 0-indexed
              endIndex: club._rowNumber,
            },
          },
        },
      ],
    },
  });

  // Clear cache
  clearColumnMapCache();
}

// ============================================================================
// CONTACTS OPERATIONS
// ============================================================================

/**
 * Add a contact to a club
 * @param contactData Contact data to create
 * @returns Created contact object
 */
export async function addContact(contactData: CreateContactRequest): Promise<ClubContact> {
  // Verify club exists
  const club = await getClubByName(contactData.clubName);
  if (!club) {
    throw new Error(`Club "${contactData.clubName}" not found`);
  }

  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Contacts');
  const sheets = getSheetsClient();

  // Get header row to build new row
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Contacts!1:1',
  });
  const headers = headerResponse.data.values?.[0] || [];
  const rowData: string[] = new Array(headers.length).fill('');

  // Map contact data to row
  const setValue = (field: string, value: string | undefined) => {
    const index = colMap[field];
    if (index !== undefined && value !== undefined) {
      rowData[index] = value;
    }
  };

  setValue('club_name', contactData.clubName);
  setValue('role', contactData.role);
  setValue('first_name', contactData.firstName);
  setValue('last_name', contactData.lastName);
  // Build full name from first and last name
  const fullName = [contactData.firstName, contactData.lastName].filter(Boolean).join(' ');
  setValue('name', fullName);
  setValue('phone_number', contactData.phoneNumber);
  setValue('mobile_number', contactData.mobileNumber);
  setValue('notes', contactData.notes);
  setValue('email', contactData.email);

  // Append new row
  const appendResponse = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Contacts!A:ZZ',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [rowData],
    },
  });

  // Get the row number of the appended row
  const updatedRange = appendResponse.data.updates?.updatedRange;
  let rowNumber = 0;
  if (updatedRange) {
    const match = updatedRange.match(/!A(\d+):/);
    if (match) {
      rowNumber = parseInt(match[1], 10);
    }
  }

  // Clear cache
  clearColumnMapCache();

  return {
    clubName: contactData.clubName,
    role: contactData.role || '',
    firstName: contactData.firstName || '',
    lastName: contactData.lastName || '',
    name: fullName,
    phoneNumber: contactData.phoneNumber || '',
    mobileNumber: contactData.mobileNumber || '',
    notes: contactData.notes || '',
    email: contactData.email || '',
    _rowNumber: rowNumber,
  };
}

/**
 * Update a contact by row number
 * @param rowNumber Row number in Contacts sheet
 * @param updates Fields to update
 * @returns Updated contact
 */
export async function updateContact(rowNumber: number, updates: UpdateContactRequest): Promise<ClubContact> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Contacts');
  const sheets = getSheetsClient();

  // Get current contact data
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Contacts!A${rowNumber}:ZZ${rowNumber}`,
  });

  const row = response.data.values?.[0];
  if (!row) {
    throw new Error(`Contact at row ${rowNumber} not found`);
  }

  const get = (field: string): string => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || '') : '';
  };

  // Build update data
  const updateData: { range: string; values: any[][] }[] = [];

  const addUpdate = (field: string, value: string | undefined) => {
    const index = colMap[field];
    if (index !== undefined && value !== undefined) {
      const colLetter = getColumnLetter(index);
      updateData.push({
        range: `Contacts!${colLetter}${rowNumber}`,
        values: [[value]],
      });
    }
  };

  // Add updates for each provided field
  if (updates.role !== undefined) addUpdate('role', updates.role);
  if (updates.firstName !== undefined) addUpdate('first_name', updates.firstName);
  if (updates.lastName !== undefined) addUpdate('last_name', updates.lastName);
  if (updates.phoneNumber !== undefined) addUpdate('phone_number', updates.phoneNumber);
  if (updates.mobileNumber !== undefined) addUpdate('mobile_number', updates.mobileNumber);
  if (updates.notes !== undefined) addUpdate('notes', updates.notes);
  if (updates.email !== undefined) addUpdate('email', updates.email);

  // Update name field if first or last name changed
  if (updates.firstName !== undefined || updates.lastName !== undefined) {
    const firstName = updates.firstName ?? get('first_name');
    const lastName = updates.lastName ?? get('last_name');
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    addUpdate('name', fullName);
  }

  if (updateData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updateData,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }

  // Clear cache and return updated contact
  clearColumnMapCache();

  // Re-fetch the row to get current data
  const updatedResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Contacts!A${rowNumber}:ZZ${rowNumber}`,
  });

  const updatedRow = updatedResponse.data.values?.[0];
  if (!updatedRow) {
    throw new Error('Failed to retrieve updated contact');
  }

  const getUpdated = (field: string): string => {
    const index = colMap[field];
    return index !== undefined ? (updatedRow[index] || '') : '';
  };

  return {
    clubName: getUpdated('club_name'),
    role: getUpdated('role'),
    firstName: getUpdated('first_name'),
    lastName: getUpdated('last_name'),
    name: getUpdated('name'),
    phoneNumber: getUpdated('phone_number'),
    mobileNumber: getUpdated('mobile_number'),
    notes: getUpdated('notes'),
    email: getUpdated('email'),
    _rowNumber: rowNumber,
  };
}

/**
 * Delete a contact by row number (internal helper)
 * @param rowNumber Row number to delete
 */
async function deleteContactByRowNumber(rowNumber: number): Promise<void> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const sheets = getSheetsClient();

  // Get the sheet ID for the Contacts sheet
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const contactsSheet = spreadsheet.data.sheets?.find(s =>
    s.properties?.title?.trim().toLowerCase() === 'contacts'
  );

  const sheetId = contactsSheet?.properties?.sheetId;
  if (sheetId === undefined) {
    throw new Error(`Contacts sheet not found. Available sheets: ${spreadsheet.data.sheets?.map(s => `"${s.properties?.title}" (id: ${s.properties?.sheetId})`).join(', ')}`);
  }

  // Delete the row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1, // 0-indexed
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });

  // Clear cache
  clearColumnMapCache();
}

/**
 * Delete a contact by row number
 * @param clubName Club name (for validation)
 * @param rowNumber Row number in Contacts sheet
 */
export async function deleteContact(clubName: string, rowNumber: number): Promise<void> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Contacts');
  const sheets = getSheetsClient();

  // Get current contact data to verify it belongs to the specified club
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Contacts!A${rowNumber}:ZZ${rowNumber}`,
  });

  const row = response.data.values?.[0];
  if (!row) {
    throw new Error(`Contact at row ${rowNumber} not found`);
  }

  const contactClubName = colMap['club_name'] !== undefined ? row[colMap['club_name']] : '';
  if (contactClubName.toLowerCase() !== clubName.toLowerCase()) {
    throw new Error(`Contact at row ${rowNumber} does not belong to club "${clubName}"`);
  }

  await deleteContactByRowNumber(rowNumber);
}

// ============================================================================
// CLUB AUTHENTICATION
// ============================================================================

export interface ClubLoginRecord {
  rowNumber: number;
  clubId: string;
  clubName: string;
  passwordHash: string;
  mustChangePassword: boolean;
}

export interface ClubAuthResult {
  success: boolean;
  club?: { clubId: string; clubName: string; mustChangePassword: boolean };
  error?: string;
}

/** Fetch a club's login record by club_id (case-insensitive). */
export async function getClubLoginRecord(clubId: string): Promise<ClubLoginRecord | null> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'clubs');
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'clubs!A:ZZ',
  });

  const rows = response.data.values ?? [];
  if (rows.length < 2) return null;

  const clubIdCol = colMap['club_id'];
  const clubNameCol = colMap['club_name'];
  const passwordCol = colMap['password'];
  const mustChangeCol = colMap['is_temp_password'];
  if (clubIdCol === undefined) return null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if ((row[clubIdCol] ?? '').toString().toLowerCase() === clubId.toLowerCase()) {
      const mustChangeRaw = mustChangeCol !== undefined ? (row[mustChangeCol] ?? '') : '';
      return {
        rowNumber: i + 1,
        clubId: row[clubIdCol] ?? '',
        clubName: clubNameCol !== undefined ? (row[clubNameCol] ?? '') : '',
        passwordHash: passwordCol !== undefined ? (row[passwordCol] ?? '') : '',
        mustChangePassword: mustChangeRaw.toString().toUpperCase() === 'Y',
      };
    }
  }
  return null;
}

/** Authenticate a club login. */
export async function authenticateClub(clubId: string, password: string): Promise<ClubAuthResult> {
  try {
    const record = await getClubLoginRecord(clubId);
    if (!record) return { success: false, error: 'Invalid username or password' };
    if (!record.passwordHash) return { success: false, error: 'Account not configured — contact BHBC admin' };
    // Plain text temp password or bcrypt
    const valid = record.mustChangePassword && !record.passwordHash.startsWith('$2b$')
      ? password === record.passwordHash
      : await bcrypt.compare(password, record.passwordHash);
    if (!valid) return { success: false, error: 'Invalid username or password' };
    return { success: true, club: { clubId: record.clubId, clubName: record.clubName, mustChangePassword: record.mustChangePassword } };
  } catch {
    return { success: false, error: 'Authentication error' };
  }
}

/** Change a club's password. Pass currentPassword for self-service; omit for admin override.
 *  isTempPassword: when true, sets must_change_password = Y so the club is forced to change on next login.
 */
export async function changeClubPassword(
  clubId: string,
  newPassword: string,
  currentPassword?: string,
  isTempPassword: boolean = false,
): Promise<{ success: boolean; error?: string }> {
  const record = await getClubLoginRecord(clubId);
  if (!record) return { success: false, error: 'Club not found' };

  if (currentPassword) {
    if (!record.passwordHash) return { success: false, error: 'No password set' };
    const valid = record.mustChangePassword && !record.passwordHash.startsWith('$2b$')
      ? currentPassword === record.passwordHash
      : await bcrypt.compare(currentPassword, record.passwordHash);
    if (!valid) return { success: false, error: 'Current password is incorrect' };
    if (currentPassword === newPassword) return { success: false, error: 'New password must be different from current' };
  }

  // Store plain text for temp passwords (admin-set), bcrypt for permanent
  const hash = isTempPassword ? newPassword : await bcrypt.hash(newPassword, 10);

  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'clubs');
  const passwordCol = colMap['password'];
  if (passwordCol === undefined) return { success: false, error: 'Password column not found in sheet' };

  const sheets = getSheetsClient();
  const updates: { range: string; values: string[][] }[] = [
    {
      range: `clubs!${getColumnLetter(passwordCol)}${record.rowNumber}`,
      values: [[hash]],
    },
  ];

  // Write is_temp_password flag if the column exists
  const mustChangeCol = colMap['is_temp_password'];
  if (mustChangeCol !== undefined) {
    // Self-service change always clears the flag; admin can set it
    const flagValue = currentPassword ? 'N' : (isTempPassword ? 'Y' : 'N');
    updates.push({
      range: `clubs!${getColumnLetter(mustChangeCol)}${record.rowNumber}`,
      values: [[flagValue]],
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { data: updates, valueInputOption: 'RAW' },
  });

  return { success: true };
}

/** Return all clubs that have a club_id set (for the impersonation modal). */
export async function getAllClubsForImpersonation(): Promise<{ clubId: string; clubName: string }[]> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'clubs');
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'clubs!A:ZZ',
  });

  const rows = response.data.values ?? [];
  if (rows.length < 2) return [];

  const clubIdCol = colMap['club_id'];
  const clubNameCol = colMap['club_name'];
  if (clubIdCol === undefined) return [];

  return rows.slice(1)
    .filter((r) => r[clubIdCol]?.toString().trim())
    .map((r) => ({
      clubId: r[clubIdCol] ?? '',
      clubName: clubNameCol !== undefined ? (r[clubNameCol] ?? '') : '',
    }));
}

/** Get all contacts with Include = Y, enriched with their club's credentials. */
export async function getClubContactsToEmail(): Promise<ContactWithCredentials[]> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const sheets = getSheetsClient();

  const [contactsColMap, clubsColMap] = await Promise.all([
    getColumnMap(spreadsheetId, 'Contacts'),
    getColumnMap(spreadsheetId, 'clubs'),
  ]);

  const [contactsResponse, clubsResponse] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Contacts!A:ZZ' }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'clubs!A:ZZ' }),
  ]);

  const getField = (colMap: { [key: string]: number }, row: any[], field: string): string => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || '') : '';
  };

  const credMap = new Map<string, { clubId: string; password: string }>();
  const clubRows = clubsResponse.data.values || [];
  for (let i = 1; i < clubRows.length; i++) {
    const row = clubRows[i];
    const clubName = getField(clubsColMap, row, 'club_name');
    if (clubName) {
      credMap.set(clubName.toLowerCase(), {
        clubId: getField(clubsColMap, row, 'club_id'),
        password: getField(clubsColMap, row, 'password'),
      });
    }
  }

  const contactRows = contactsResponse.data.values || [];
  const includeCol = contactsColMap['include'];
  const results: ContactWithCredentials[] = [];

  for (let i = 1; i < contactRows.length; i++) {
    const row = contactRows[i];
    if (includeCol !== undefined) {
      const include = (row[includeCol] || '').toString().toUpperCase().trim();
      if (include !== 'Y') continue;
    }

    const clubName = getField(contactsColMap, row, 'club_name');
    const creds = credMap.get(clubName.toLowerCase());
    const email = getField(contactsColMap, row, 'email');
    const clubId = creds?.clubId || '';
    const password = creds?.password || '';

    results.push({
      contact: {
        clubName,
        role: getField(contactsColMap, row, 'role'),
        firstName: getField(contactsColMap, row, 'first_name'),
        lastName: getField(contactsColMap, row, 'last_name'),
        name: getField(contactsColMap, row, 'name'),
        email,
        phoneNumber: getField(contactsColMap, row, 'phone_number'),
        mobileNumber: getField(contactsColMap, row, 'mobile_number'),
        notes: getField(contactsColMap, row, 'notes'),
        _rowNumber: i + 1,
      },
      clubId,
      password,
      canEmail: !!(email && clubId),
    });
  }

  return results;
}

/** Get all distinct roles from the Contacts sheet, sorted alphabetically. */
export async function getDistinctContactRoles(): Promise<string[]> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Contacts');
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Contacts!A:ZZ',
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) return [];

  const roleCol = colMap['role'];
  if (roleCol === undefined) return [];

  const roles = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const role = rows[i][roleCol]?.toString().trim();
    if (role) roles.add(role);
  }

  return Array.from(roles).sort();
}

export interface ContactWithCredentials {
  contact: {
    clubName: string;
    role: string;
    firstName: string;
    lastName: string;
    name: string;
    email: string;
    phoneNumber: string;
    mobileNumber: string;
    notes: string;
    _rowNumber: number;
  };
  clubId: string;
  password: string;
  canEmail: boolean;
}

/** Get contacts matching a given role, enriched with their club's credentials. */
export async function getContactsWithCredentialsByRole(role: string): Promise<ContactWithCredentials[]> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const sheets = getSheetsClient();

  const [contactsColMap, clubsColMap] = await Promise.all([
    getColumnMap(spreadsheetId, 'Contacts'),
    getColumnMap(spreadsheetId, 'clubs'),
  ]);

  const [contactsResponse, clubsResponse] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Contacts!A:ZZ' }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'clubs!A:ZZ' }),
  ]);

  const getField = (colMap: { [key: string]: number }, row: any[], field: string): string => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || '') : '';
  };

  // Build credentials map: clubName.toLowerCase() -> { clubId, password }
  const credMap = new Map<string, { clubId: string; password: string }>();
  const clubRows = clubsResponse.data.values || [];
  for (let i = 1; i < clubRows.length; i++) {
    const row = clubRows[i];
    const clubName = getField(clubsColMap, row, 'club_name');
    if (clubName) {
      credMap.set(clubName.toLowerCase(), {
        clubId: getField(clubsColMap, row, 'club_id'),
        password: getField(clubsColMap, row, 'password'),
      });
    }
  }

  const contactRows = contactsResponse.data.values || [];
  const results: ContactWithCredentials[] = [];

  for (let i = 1; i < contactRows.length; i++) {
    const row = contactRows[i];
    const rowRole = getField(contactsColMap, row, 'role');
    if (rowRole.trim() !== role.trim()) continue;

    const clubName = getField(contactsColMap, row, 'club_name');
    const creds = credMap.get(clubName.toLowerCase());
    const email = getField(contactsColMap, row, 'email');
    const clubId = creds?.clubId || '';
    const password = creds?.password || '';

    results.push({
      contact: {
        clubName,
        role: rowRole,
        firstName: getField(contactsColMap, row, 'first_name'),
        lastName: getField(contactsColMap, row, 'last_name'),
        name: getField(contactsColMap, row, 'name'),
        email,
        phoneNumber: getField(contactsColMap, row, 'phone_number'),
        mobileNumber: getField(contactsColMap, row, 'mobile_number'),
        notes: getField(contactsColMap, row, 'notes'),
        _rowNumber: i + 1,
      },
      clubId,
      password,
      canEmail: !!(email && clubId),
    });
  }

  return results;
}
