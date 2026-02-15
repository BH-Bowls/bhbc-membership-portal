// src/lib/types/sweeping.ts
// Types for Sweeping Rota feature

export interface SweepingRotaEntry {
  date: string;           // DD/MM/YYYY format
  userName: string;       // Username of assigned member (empty if available/blocked)
  isBlocked: boolean;     // TRUE for greenkeeper days
}

// Pattern types for recurring entries
export type PatternType =
  | 'every'           // Every [day] (e.g., every Saturday)
  | 'first'           // First [day] of month
  | 'second'          // Second [day] of month
  | 'third'           // Third [day] of month
  | 'fourth'          // Fourth [day] of month
  | 'last'            // Last [day] of month
  | 'first_and_third' // First and third [day]
  | 'second_and_fourth'; // Second and fourth [day]

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, 6 = Saturday

export interface PatternConfig {
  patternType: PatternType;
  dayOfWeek: DayOfWeek;
  startDate: string;      // DD/MM/YYYY - start generating from this date
  endDate: string;        // DD/MM/YYYY - stop generating at this date
}

// API response types
export interface SweepingRotaResponse {
  entries: SweepingRotaEntry[];
  currentUser: string;
  isAdmin: boolean;
}

export interface AddEntriesRequest {
  dates?: string[];        // Array of DD/MM/YYYY dates for ad-hoc
  pattern?: PatternConfig; // Pattern for recurring
  userName?: string;       // Optional: for non-members to assign to specific user
}

// Action types for pattern entry (non-members only)
export type PatternAction = 'assign' | 'block' | 'clear';

export interface ClearDaysRequest {
  dates?: string[];        // Array of DD/MM/YYYY dates for ad-hoc
  pattern?: PatternConfig; // Pattern for recurring
}

export interface ClearDaysResponse {
  success: boolean;
  clearedCount: number;
  skippedCount: number;
  results: {
    date: string;
    status: 'cleared' | 'skipped';
    reason?: string;
  }[];
}

export interface AddEntriesResponse {
  success: boolean;
  addedCount: number;
  skippedCount: number;
  results: {
    date: string;
    status: 'added' | 'skipped';
    reason?: string;
  }[];
}

export interface BlockDaysRequest {
  dates?: string[];        // Array of DD/MM/YYYY dates for ad-hoc
  pattern?: PatternConfig; // Pattern for recurring
}

export interface BlockDaysResponse {
  success: boolean;
  blockedCount: number;
  skippedCount: number;
  results: {
    date: string;
    status: 'blocked' | 'skipped';
    reason?: string;
  }[];
}

// Calendar display types
export type DayStatus =
  | 'available'     // Empty day, can be selected
  | 'assigned'      // Assigned to another member
  | 'own'           // Assigned to current user
  | 'blocked'       // Blocked (greenkeeper)
  | 'past';         // Past date, no action allowed

export interface CalendarDay {
  date: Date;
  dateString: string;     // DD/MM/YYYY format
  status: DayStatus;
  userName?: string;      // Username if assigned
  displayName?: string;   // Display name for assigned member
  isSelected?: boolean;   // For multi-select
}
