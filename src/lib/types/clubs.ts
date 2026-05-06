// src/lib/types/clubs.ts
// TypeScript type definitions for the Clubs feature
// Defines data structures for clubs and contacts from Match Day Contacts spreadsheet

// ============================================================================
// CLUB INTERFACES
// ============================================================================

/**
 * Club - Complete club record from Clubs sheet
 * Represents a single bowls club with contact info, address, and location data
 * Each row in the Clubs sheet becomes one Club object
 */
export interface Club {
  clubName: string;           // Club's official name
  clubNumber: string;         // Club's main phone number
  clubMobile: string;         // Club's mobile phone number
  clubEmailAddress: string;   // Club's email address
  clubEmailNote: string;      // Notes about email communication
  generalInformation: string; // General notes and information about the club
  drivingBand: string;        // Driving distance band (A, B, C, D)
  petrolCost: number;         // Petrol reimbursement amount for this band (£)
  address1: string;           // First line of address
  address2: string;           // Second line of address
  address3: string;           // Third line of address (town/city)
  address4: string;           // Fourth line of address (county)
  postCode: string;           // Post code
  website: string;            // Club's website URL
  latitude: number | null;    // GPS latitude coordinate
  longitude: number | null;   // GPS longitude coordinate
  miles: string;              // Distance in miles
  travelTime: string;         // Estimated travel time (e.g., "45 mins")
  lastUpdated: string;        // Date of last update
  _rowNumber: number;         // Row number in Clubs sheet (for updates)
}

/**
 * ClubContact - Contact person for a club
 * Represents a single contact from the Contacts sheet
 * Multiple contacts per club are supported (Captain, Secretary, etc.)
 */
export interface ClubContact {
  clubName: string;      // Club this contact belongs to
  role: string;          // Contact's role (e.g., "Captain", "Secretary")
  firstName: string;     // Contact's first name
  lastName: string;      // Contact's last name
  name: string;          // Full name (firstName + lastName)
  phoneNumber: string;   // Home/landline phone number
  mobileNumber: string;  // Mobile phone number
  notes: string;         // Additional notes about this contact
  email: string;         // Email address
  _rowNumber: number;    // Row number in Contacts sheet (for updates)
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * ClubWithContacts - Club with its associated contacts
 * Used for API responses that return a single club with all its contacts
 */
export interface ClubWithContacts {
  club: Club;
  contacts: ClubContact[];
}

/**
 * CreateClubRequest - Request body for creating a new club
 */
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

/**
 * UpdateClubRequest - Request body for updating an existing club
 * All fields are optional (partial update)
 */
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

/**
 * CreateContactRequest - Request body for creating a new contact
 */
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

/**
 * UpdateContactRequest - Request body for updating an existing contact
 * All fields are optional (partial update)
 */
export interface UpdateContactRequest {
  role?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  mobileNumber?: string;
  notes?: string;
  email?: string;
}
