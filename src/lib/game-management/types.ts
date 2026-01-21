// lib/game-management/types.ts
// Shared type definitions for all game/event management systems
// Used by: Friendlies, Internal Games, Social Events

// ============================================================================
// SYSTEM CONFIGURATION
// ============================================================================

/**
 * Configuration for a game management system
 * Defines how each system (Friendlies, Internal Games, Social Events) operates
 */
export interface GameSystemConfig {
  // Spreadsheet identification
  spreadsheetIdEnvVar: string;      // Environment variable name for spreadsheet ID
  gamesSheetName: string;           // Sheet name containing list of games/events
  membersSheetName: string;         // Sheet name containing members list

  // Feature flags - what this system supports
  hasOpponentClub: boolean;         // External opponent (friendlies only)
  hasHomeAway: boolean;             // Home/away designation (friendlies only)
  hasStats: boolean;                // Player statistics tracking (friendlies only)
  hasCaptain: boolean;              // Captain selection (friendlies only)
  hasTeams: boolean;                // Team selection and positions (friendlies + internal)
  hasAttendance: boolean;           // Simple attendance tracking (social events only)
  hasDriving: boolean;              // Driving/car assignments (friendlies away games only)

  // Display configuration
  systemName: string;               // Display name (e.g., "Friendlies", "Internal Games")
  itemName: string;                 // Singular item name (e.g., "Game", "Event")
  itemNamePlural: string;           // Plural item name (e.g., "Games", "Events")
}

// ============================================================================
// BASE TYPES (Shared across all systems)
// ============================================================================

/**
 * Game/Event status
 * '' = Not opened yet (initial state)
 * O = Open for entry
 * X = Closed (no more entries)
 * S = Selected (teams chosen by captain)
 * P = Postponed
 * C = Cancelled
 * A = Completed/Archived
 */
export type GameStatus = '' | 'O' | 'X' | 'S' | 'P' | 'C' | 'A';

/**
 * Selection status for competitive games (friendlies + internal)
 * '' = Not selected
 * Y = Selected (playing)
 * R = Reserve
 * T = Reserve Team (second reserve)
 */
export type SelectionStatus = '' | 'Y' | 'R' | 'T';

/**
 * Position in a team (skip, lead, second, third)
 * S = Skip (team leader)
 * 1 = Lead (first position)
 * 2 = Second
 * 3 = Third
 * '' = No position assigned yet
 */
export type Position = '' | 'S' | '1' | '2' | '3';

/**
 * Player confirmation status
 * '' = No response
 * Y = Confirmed (will play)
 * W = Withdrawn (won't play)
 */
export type ConfirmationStatus = '' | 'Y' | 'W';

/**
 * Attendance status for social events
 * '' = No response
 * Y = Yes (attending)
 * N = No (not attending)
 * M = Maybe (tentative)
 * W = Waitlist (want to attend but event is full)
 */
export type AttendanceStatus = '' | 'Y' | 'N' | 'M' | 'W';

/**
 * Home or Away designation
 */
export type HomeAway = 'H' | 'A';

// ============================================================================
// BASE GAME STRUCTURE
// ============================================================================

/**
 * Base game/event structure - common fields across all systems
 */
export interface BaseGame {
  // Identification
  tabDate: string;          // Unique identifier (e.g., "13 Jan 25")
  tabName: string;          // Sheet tab name for this game

  // Basic information
  date: string;             // Game date (DD/MM/YYYY)
  time: string;             // Game time (HH:MM)
  status: GameStatus;       // Current status (O/X/S/P/C/A)

  // Capacity and participation
  maxPlayers: number;       // Maximum number of players allowed
  entered: number;          // Number of players who have entered
  selected: number;         // Number of players selected to play
  reserves: number;         // Number of reserve players

  // Game format (for competitive games)
  format?: string;          // e.g., "Triples", "Pairs", "Rinks", "Singles"
  ladiesMen?: string;       // e.g., "Men", "Ladies", "Mixed"
  dress?: string;           // Dress code (e.g., "Whites", "Greys")

  // Internal row tracking
  _rowNumber?: number;      // Row number in Google Sheets (for updates)
}

/**
 * Friendly game - extends BaseGame with external opponent info
 */
export interface FriendlyGame extends BaseGame {
  clubName: string;         // Opponent club name
  homeAway: HomeAway;       // Home or Away
  format: string;           // Required for friendlies
  ladiesMen: string;        // Required for friendlies
  dress: string;            // Required for friendlies
}

/**
 * Internal game - extends BaseGame (internal competitive games)
 */
export interface InternalGame extends BaseGame {
  gameName: string;         // Name of internal game (e.g., "Club Championship Round 1")
  location?: string;        // Optional location details (e.g., "Rinks 1-4")
  format: string;           // Required for internal games
  ladiesMen: string;        // Required for internal games
  dress: string;            // Required for internal games
  description?: string;     // Short description (shown on hover)
  detailsUrl?: string;      // Google Doc URL for full details
}

/**
 * Social event - extends BaseGame (non-competitive events)
 */
export interface SocialEvent extends BaseGame {
  eventName: string;        // Event name (e.g., "Quiz Night", "BBQ", "Coach Trip")
  location?: string;        // Event location
  description?: string;     // Short description (shown on hover)
  detailsUrl?: string;      // Google Doc URL for full details
}

// ============================================================================
// BASE PLAYER STRUCTURE
// ============================================================================

/**
 * Base player structure - common fields across all systems
 */
export interface BasePlayer {
  rowNumber: number;        // Row number in game sheet (for updates)
  name: string;             // Player's username or full name
  status: ConfirmationStatus; // Confirmation status (Y/W)
}

/**
 * Competitive game player - adds team selection fields
 * Used by: Friendlies, Internal Games
 */
export interface CompetitivePlayer extends BasePlayer {
  selected: SelectionStatus;  // Y/R/T or blank
  team: number | null;        // Team number (1-4) or null
  position: Position;         // S/1/2/3 or blank
  driverBar: string;          // Driver/Bar status ('D', 'B', 'DB', '')
}

/**
 * Friendly game player - adds stats and driving
 */
export interface FriendlyPlayer extends CompetitivePlayer {
  // Statistics (friendlies only)
  nameDown: number;         // How many games entered
  picked: number;           // How many times selected
  percentPlayed: number;    // Percentage of games played

  // Captain and driving (friendlies only)
  captain: string;          // 'Y' if captain of the day, else ''
  driving: string;          // 'D' for driver, 'B' for bar, '' for neither
  carNumber: string;        // Car number if driving

  // Game history
  last8Games?: string[];    // Last 8 games history (for compatibility)
}

/**
 * Internal game player - no stats, no captain, no driving
 */
export interface InternalGamePlayer extends CompetitivePlayer {
  // Just the CompetitivePlayer fields, nothing extra
}

/**
 * Social event attendee - simple attendance tracking
 */
export interface SocialEventAttendee extends BasePlayer {
  attendance: AttendanceStatus; // Y/N/M/W
  // No teams, positions, or selection - just attendance
}

// ============================================================================
// CAPACITY MANAGEMENT
// ============================================================================

/**
 * Capacity information for a game/event
 */
export interface CapacityInfo {
  current: number;          // Current number of entries/attendees
  max: number;              // Maximum allowed
  available: number;        // Spots remaining
  isFull: boolean;          // Whether at capacity
  waitlistCount?: number;   // Number on waitlist (social events only)
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Generic API response
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Player entry request
 */
export interface PlayerEntryRequest {
  tabName: string;
  userName: string;
}

/**
 * Player update request (for team selection)
 */
export interface PlayerUpdateRequest {
  tabName: string;
  rowNumber: number;
  updates: Partial<CompetitivePlayer>;
}

/**
 * Attendance update request (for social events)
 */
export interface AttendanceUpdateRequest {
  tabName: string;
  userName: string;
  attendance: AttendanceStatus;
}
