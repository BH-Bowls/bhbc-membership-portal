// src/lib/clubs-supabase.ts
// Postgres-backed replacement for clubs-sheets.ts's real Clubs & Contacts data (NOT
// club login — authenticateClub/getClubLoginRecord/changeClubPassword/
// getAllClubsForImpersonation stay on clubs-sheets.ts deliberately, since club login is
// being removed entirely per the migration plan, not migrated; getClubContactsToEmail
// also stays, since it pulls in raw club-login credentials for its bulk-email feature).
//
// club_name is the sole identifier (matches the plan's decision to drop club_id
// entirely — it only ever existed as a login identifier). Club lookups are
// case-insensitive (ilike) to match the live Sheets version's .toLowerCase() matching.
//
// ClubContact.id (a UUID) replaces the Sheets version's _rowNumber.

import { getSupabaseClient } from './supabase';

export interface Club {
  clubName: string;
  clubNumber: string;
  clubMobile: string;
  clubEmailAddress: string;
  clubEmailNote: string;
  generalInformation: string;
  drivingBand: string;
  petrolCost: number;
  address1: string;
  address2: string;
  address3: string;
  address4: string;
  postCode: string;
  website: string;
  latitude: number | null;
  longitude: number | null;
  miles: string;
  travelTime: string;
  lastUpdated: string;
}

export interface ClubContact {
  id: string;
  clubName: string;
  role: string;
  firstName: string;
  lastName: string;
  name: string;
  phoneNumber: string;
  mobileNumber: string;
  notes: string;
  email: string;
}

export interface ClubWithContacts {
  club: Club;
  contacts: ClubContact[];
}

export interface CreateClubRequest {
  clubName: string;
  clubNumber?: string;
  clubMobile?: string;
  clubEmailAddress?: string;
  clubEmailNote?: string;
  generalInformation?: string;
  drivingBand?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  address4?: string;
  postCode?: string;
  website?: string;
  latitude?: number | null;
  longitude?: number | null;
  miles?: string;
  travelTime?: string;
}

export interface UpdateClubRequest {
  clubNumber?: string;
  clubMobile?: string;
  clubEmailAddress?: string;
  clubEmailNote?: string;
  generalInformation?: string;
  drivingBand?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  address4?: string;
  postCode?: string;
  website?: string;
  latitude?: number | null;
  longitude?: number | null;
  miles?: string;
  travelTime?: string;
}

export interface CreateContactRequest {
  clubName: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  mobileNumber?: string;
  notes?: string;
  email?: string;
}

export interface UpdateContactRequest {
  role?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  mobileNumber?: string;
  notes?: string;
  email?: string;
}

/** Hardcoded fallback in case the petrol_bands table is empty. */
const PETROL_BANDS_FALLBACK: Record<string, number> = {
  A: 2.0,
  B: 3.0,
  C: 4.0,
  D: 5.0,
};

/** Read petrol reimbursement amounts. Falls back to hardcoded values if empty/erroring. */
export async function getPetrolBands(): Promise<Record<string, number>> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('petrol_bands').select('band, amount');
    if (error) throw new Error(error.message);

    const map: Record<string, number> = {};
    for (const row of data || []) {
      if (row.band) map[row.band] = Number(row.amount);
    }
    return Object.keys(map).length > 0 ? map : { ...PETROL_BANDS_FALLBACK };
  } catch {
    return { ...PETROL_BANDS_FALLBACK };
  }
}

function mapClubRow(row: any, petrolBands: Record<string, number>): Club {
  const drivingBand = row.driving_band || '';
  return {
    clubName: row.club_name,
    clubNumber: row.club_number || '',
    clubMobile: row.club_mobile || '',
    clubEmailAddress: row.club_email_address || '',
    clubEmailNote: row.club_email_note || '',
    generalInformation: row.general_information || '',
    drivingBand,
    petrolCost: petrolBands[drivingBand] ?? 0,
    address1: row.address_1 || '',
    address2: row.address_2 || '',
    address3: row.address_3 || '',
    address4: row.address_4 || '',
    postCode: row.post_code || '',
    website: row.website || '',
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    miles: row.miles || '',
    travelTime: row.travel_time || '',
    lastUpdated: row.updated_at ? String(row.updated_at).split('T')[0] : '',
  };
}

function computeName(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(' ');
}

function mapContactRow(row: any): ClubContact {
  const firstName = row.first_name || '';
  const lastName = row.last_name || '';
  return {
    id: row.id,
    clubName: row.club_name,
    role: row.role || '',
    firstName,
    lastName,
    name: computeName(firstName, lastName),
    phoneNumber: row.phone_number || '',
    mobileNumber: row.mobile_number || '',
    notes: row.notes || '',
    email: row.email || '',
  };
}

/** Highest-priority role in a (possibly comma-separated) role string, for sorting. */
const ROLE_ORDER: { [key: string]: number } = {
  Captain: 1, 'Ladies Captain': 1, 'Mens Captain': 1,
  'Vice Captain': 2, 'Ladies Vice Captain': 2, 'Mens Vice Captain': 2,
  'Club Secretary': 3, Secretary: 3, 'Match Secretary': 4,
};
function bestRolePriority(roleStr: string): number {
  return Math.min(...roleStr.split(',').map((r) => ROLE_ORDER[r.trim()] ?? 99));
}

export async function getClubs(): Promise<Club[]> {
  const supabase = getSupabaseClient();
  const [{ data, error }, petrolBands] = await Promise.all([
    supabase.from('club_profiles').select('*'),
    getPetrolBands(),
  ]);
  if (error) throw new Error(`Failed to fetch clubs: ${error.message}`);

  const clubs = (data || []).map((row) => mapClubRow(row, petrolBands));
  clubs.sort((a, b) => a.clubName.localeCompare(b.clubName));
  return clubs;
}

export async function getClubByName(clubName: string): Promise<Club | null> {
  if (!clubName) return null;
  const supabase = getSupabaseClient();
  const [{ data, error }, petrolBands] = await Promise.all([
    supabase.from('club_profiles').select('*').ilike('club_name', clubName).maybeSingle(),
    getPetrolBands(),
  ]);
  if (error) throw new Error(`Failed to fetch club: ${error.message}`);
  if (!data) return null;
  return mapClubRow(data, petrolBands);
}

export async function getContactsForClub(clubName: string): Promise<ClubContact[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('club_contact_profiles')
    .select('*')
    .ilike('club_name', clubName);
  if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);

  const contacts = (data || []).map(mapContactRow);
  contacts.sort((a, b) => bestRolePriority(a.role) - bestRolePriority(b.role));
  return contacts;
}

export async function getClubWithContacts(clubName: string): Promise<ClubWithContacts | null> {
  const club = await getClubByName(clubName);
  if (!club) return null;

  const contacts = await getContactsForClub(clubName);
  return { club, contacts };
}

export async function createClub(clubData: CreateClubRequest): Promise<Club> {
  const existing = await getClubByName(clubData.clubName);
  if (existing) {
    throw new Error(`Club "${clubData.clubName}" already exists`);
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('club_profiles').insert({
    club_name: clubData.clubName,
    club_number: clubData.clubNumber || null,
    club_mobile: clubData.clubMobile || null,
    club_email_address: clubData.clubEmailAddress || null,
    club_email_note: clubData.clubEmailNote || null,
    general_information: clubData.generalInformation || null,
    driving_band: clubData.drivingBand || null,
    address_1: clubData.address1 || null,
    address_2: clubData.address2 || null,
    address_3: clubData.address3 || null,
    address_4: clubData.address4 || null,
    post_code: clubData.postCode || null,
    website: clubData.website || null,
    latitude: clubData.latitude === undefined ? null : clubData.latitude,
    longitude: clubData.longitude === undefined ? null : clubData.longitude,
    miles: clubData.miles || null,
    travel_time: clubData.travelTime || null,
  });
  if (error) throw new Error(error.message);

  const createdClub = await getClubByName(clubData.clubName);
  if (!createdClub) {
    throw new Error('Failed to create club');
  }
  return createdClub;
}

export async function updateClub(clubName: string, updates: UpdateClubRequest): Promise<Club> {
  const club = await getClubByName(clubName);
  if (!club) {
    throw new Error(`Club "${clubName}" not found`);
  }

  const supabase = getSupabaseClient();
  const columnUpdates: Record<string, any> = { updated_at: new Date().toISOString() };

  if (updates.clubNumber !== undefined) columnUpdates.club_number = updates.clubNumber;
  if (updates.clubMobile !== undefined) columnUpdates.club_mobile = updates.clubMobile;
  if (updates.clubEmailAddress !== undefined) columnUpdates.club_email_address = updates.clubEmailAddress;
  if (updates.clubEmailNote !== undefined) columnUpdates.club_email_note = updates.clubEmailNote;
  if (updates.generalInformation !== undefined) columnUpdates.general_information = updates.generalInformation;
  if (updates.drivingBand !== undefined) columnUpdates.driving_band = updates.drivingBand;
  if (updates.address1 !== undefined) columnUpdates.address_1 = updates.address1;
  if (updates.address2 !== undefined) columnUpdates.address_2 = updates.address2;
  if (updates.address3 !== undefined) columnUpdates.address_3 = updates.address3;
  if (updates.address4 !== undefined) columnUpdates.address_4 = updates.address4;
  if (updates.postCode !== undefined) columnUpdates.post_code = updates.postCode;
  if (updates.website !== undefined) columnUpdates.website = updates.website;
  if (updates.latitude !== undefined) columnUpdates.latitude = updates.latitude;
  if (updates.longitude !== undefined) columnUpdates.longitude = updates.longitude;
  if (updates.miles !== undefined) columnUpdates.miles = updates.miles;
  if (updates.travelTime !== undefined) columnUpdates.travel_time = updates.travelTime;

  const { error } = await supabase.from('club_profiles').update(columnUpdates).ilike('club_name', clubName);
  if (error) throw new Error(error.message);

  const updatedClub = await getClubByName(clubName);
  if (!updatedClub) {
    throw new Error('Failed to retrieve updated club');
  }
  return updatedClub;
}

export async function deleteClub(clubName: string): Promise<void> {
  const club = await getClubByName(clubName);
  if (!club) {
    throw new Error(`Club "${clubName}" not found`);
  }

  const supabase = getSupabaseClient();

  // Delete contacts first — club_contact_profiles.club_name has no ON DELETE CASCADE,
  // matching the live Sheets version's own explicit "delete contacts, then the club".
  const { error: contactsError } = await supabase
    .from('club_contact_profiles')
    .delete()
    .ilike('club_name', clubName);
  if (contactsError) throw new Error(contactsError.message);

  const { error } = await supabase.from('club_profiles').delete().ilike('club_name', clubName);
  if (error) throw new Error(error.message);
}

export async function addContact(contactData: CreateContactRequest): Promise<ClubContact> {
  const club = await getClubByName(contactData.clubName);
  if (!club) {
    throw new Error(`Club "${contactData.clubName}" not found`);
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('club_contact_profiles')
    .insert({
      club_name: club.clubName,
      role: contactData.role || null,
      first_name: contactData.firstName || null,
      last_name: contactData.lastName || null,
      phone_number: contactData.phoneNumber || null,
      mobile_number: contactData.mobileNumber || null,
      notes: contactData.notes || null,
      email: contactData.email || null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  return mapContactRow(data);
}

export async function updateContact(id: string, updates: UpdateContactRequest): Promise<ClubContact> {
  const supabase = getSupabaseClient();
  const columnUpdates: Record<string, any> = {};

  if (updates.role !== undefined) columnUpdates.role = updates.role;
  if (updates.firstName !== undefined) columnUpdates.first_name = updates.firstName;
  if (updates.lastName !== undefined) columnUpdates.last_name = updates.lastName;
  if (updates.phoneNumber !== undefined) columnUpdates.phone_number = updates.phoneNumber;
  if (updates.mobileNumber !== undefined) columnUpdates.mobile_number = updates.mobileNumber;
  if (updates.notes !== undefined) columnUpdates.notes = updates.notes;
  if (updates.email !== undefined) columnUpdates.email = updates.email;

  const { data, error } = await supabase
    .from('club_contact_profiles')
    .update(columnUpdates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`Contact not found or failed to update: ${error.message}`);

  return mapContactRow(data);
}

export async function deleteContact(clubName: string, id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('club_contact_profiles')
    .delete()
    .eq('id', id)
    .ilike('club_name', clubName);
  if (error) throw new Error(error.message);
}

/** All distinct roles across every contact (roles can be comma-separated), sorted. */
export async function getDistinctContactRoles(): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('club_contact_profiles').select('role');
  if (error) throw new Error(`Failed to fetch contact roles: ${error.message}`);

  const roles = new Set<string>();
  for (const row of data || []) {
    const cell = (row.role || '').toString().trim();
    if (!cell) continue;
    for (const part of cell.split(',')) {
      const role = part.trim();
      if (role) roles.add(role);
    }
  }

  return Array.from(roles).sort();
}
