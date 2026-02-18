// src/lib/types/friendlies.ts
// TypeScript type definitions for the Friendlies system
// Defines all data structures for games, players, teams, and API contracts
// Used throughout the application for type safety and documentation

// ============================================================================
// STATUS CODE TYPES
// ============================================================================

/**
 * Game status codes - track game lifecycle from creation to completion
 * '' = Blank/Not opened - Initial state, game created but not open for entries
 * 'O' = Open - Entries are open, players can enter the game
 * 'L' = Allocating - Paired games only: entries closed, captain is allocating players between games
 * 'X' = Selecting/Closed - Entries closed, captain is selecting the team
 * 'S' = Selected - Team has been picked and published to players
 * 'P' = Played - Game completed with final scores recorded
 * 'C' = Cancelled - Game cancelled before being played
 * 'A' = Abandoned - Game started but not completed (weather, injury, etc.)
 */
export type GameStatus = '' | 'O' | 'L' | 'X' | 'S' | 'P' | 'C' | 'A';

/**
 * Player entry status codes - stored in Players sheet columns
 * Tracks player's participation status for each game
 * Base codes:
 *   'E' = Entered - Player entered the game (self-entered)
 *   'M' = Manually added - Player added by captain
 *   'D' = Down - Player confirmed for game (stats updated, not selected to play)
 *   'P' = Picked - Player selected to play in regular team
 *   'R' = Reserve - Player selected as reserve
 *   'T' = Reserve Team - Player in reserve team
 *   'A' = Abandoned - Game was abandoned
 *   'C' = Cancelled - Game was cancelled
 * Withdrawal suffix 'W':
 *   'EW' = Entered + Withdrawn
 *   'DW' = Down + Withdrawn
 *   'PW' = Picked + Withdrawn
 *   'RW' = Reserve + Withdrawn
 *   'TW' = Reserve Team + Withdrawn
 *   'AW' = Abandoned + Withdrawn (rare)
 */
export type PlayerEntryStatus = 'E' | 'M' | 'D' | 'P' | 'R' | 'T' | 'A' | 'EW' | 'MW' | 'DW' | 'PW' | 'RW' | 'TW' | 'AW' | 'C';

/**
 * Selection status codes - stored in game sheet 'Selected' column
 * Used by captains during team selection
 * '' = Not selected - Player entered but not picked for any role
 * 'Y' = Yes/Playing - Player selected for regular team
 * 'R' = Reserve - Player selected as reserve
 * 'T' = Reserve Team - Player in reserve team
 */
export type SelectionStatus = '' | 'Y' | 'R' | 'T';

/**
 * Confirmation status codes - stored in game sheet 'Status' column
 * Tracks player confirmation and withdrawal
 * '' = No action - Player has not confirmed or withdrawn
 * 'Y' = Confirmed - Player confirmed they will attend (currently unused)
 * 'W' = Withdrawn - Player has withdrawn from the game
 */
export type ConfirmationStatus = '' | 'Y' | 'W';

/**
 * Position codes for bowls teams
 * '' = No position assigned
 * 'S' = Skip - Team leader, plays last
 * '1' = Lead - Plays first
 * '2' = Two/Second - Plays second
 * '3' = Three/Third - Plays third
 */
export type Position = '' | 'S' | '1' | '2' | '3';

/**
 * Home or Away game indicator
 * 'H' = Home - Game at Burgess Hill Bowls Club
 * 'A' = Away - Game at opponent's club (requires travel)
 */
export type HomeAway = 'H' | 'A';

// ============================================================================
// CORE DATA INTERFACES
// ============================================================================

/**
 * Game - Complete game record from Games sheet
 * Represents a single friendly match with all details, status, and results
 * Each row in the Games sheet becomes one Game object
 */
export interface Game {
  rowNumber: number;           // Row number in Games sheet (for updates)
  date: string;                 // Game date in "YYYY-MM-DD" format
  tabDate: string;              // Short date for tab names (e.g., "25-Sep")
  time: string;                 // Game time (e.g., "14:00")
  clubName: string;             // Opponent club name
  homeAway: HomeAway;           // 'H' or 'A'
  format: string;               // Game format (e.g., "Rinks", "Triples")
  ladiesMen: string;            // "Ladies", "Men", or "Mixed"
  dress: string;                // Dress code (e.g., "Whites", "Greys")
  league: string;               // League name if applicable
  tabName: string;              // Unique tab identifier (e.g., "West Hoathly 25-Sep")
  status: GameStatus;           // Current game status ('', O, X, S, P, C, or A)
  include?: string;             // Optional include flag for filtering
  maxPlayers: number;           // Maximum number of players allowed (capacity limit)
  entered: number;              // Count of players who entered
  selected: number;             // Count of players picked to play
  reserves: number;             // Count of reserve players
  bhbcScore: number | null;     // Burgess Hill score (null if not played)
  opponentScore: number | null; // Opponent score (null if not played)
  reason: string;               // Reason for cancellation/abandonment
  who: string;                  // Who cancelled the game
  lastModifiedBy: string;       // Username of last person to modify
  lastModifiedDate: string;     // Date of last modification
  paired?: string;              // 'Y' if this game is paired with another game on the same date
}

/**
 * GameWithUserStatus - Game extended with current user's entry status
 * Used on player-facing pages to show which games the logged-in user has entered
 * Adds user-specific fields to the base Game interface
 */
export interface GameWithUserStatus extends Game {
  userEntered: boolean;            // True if current user has entered this game
  userStatus: PlayerEntryStatus | null; // User's status (E, P, R, PW, etc.) or null if not entered
}

/**
 * PlayerEntry - Represents a single game entry from Players sheet
 * Each player has one entry per game they participated in
 * Used to display "My Games" list for players
 */
export interface PlayerEntry {
  tabName: string;              // Game identifier (e.g., "West Hoathly 25-Sep")
  status: PlayerEntryStatus;    // Player's status for this game (E, P, R, etc.)
}

/**
 * GameSheetPlayer - Complete player record from a game sheet
 * Represents one player in a specific game with all selection and stats
 * Used by captains during team selection and on match cards
 * Each player appears as one row in the game's individual sheet
 */
export interface GameSheetPlayer {
  rowNumber: number;            // Row number in game sheet (for updates)
  name: string;                 // Player's userName (for referential integrity)
  fullName: string;             // Player's full name (for UI display)
  nameDown: number;             // How many games player has entered
  picked: number;               // How many times player was selected to play
  percentPlayed: number;        // Percentage of games player actually played
  driverBar: string;            // Driver/Bar code: 'D', 'B', 'DB', or ''
  selected: SelectionStatus;    // Selection status: '', Y, R, or T
  team: number | null;          // Team number (1-4 typically) or null if not assigned
  position: Position;           // Position in team: S, 1, 2, 3, or ''
  driving: string;              // Driving assignment: 'D' or 'B' or ''
  carNumber: string;            // Car number if player is driving
  status: ConfirmationStatus;   // Confirmation status: '', Y, or W
  captain: string;              // Captain of the day: 'Y' or ''
  last8Games?: string[];        // Last 8 games history (for backward compatibility - use last6Games in PlayerStats)
}

/**
 * PlayerStats - Aggregated statistics for a player
 * Calculated from Players sheet columns
 * Shows player's participation history and reliability
 * Used to help captains make selection decisions
 */
export interface PlayerStats {
  nameDown: number;       // How many games player has entered
  picked: number;         // How many times player was selected to play
  percentPlayed: number;  // Percentage of games actually played (as decimal 0.0-1.0)
  withdrawn: number;      // How many times player withdrew
  cancelled: number;      // How many games were cancelled
  last6Games: string[];   // Last 6 games history (e.g., ["West Hoathly 25-Sep    P", "Lindfield 18-Sep    E"])
}

/**
 * DriverBarInfo - Driver and bar duty status for a player
 * Read from Members sheet to determine if player can drive to away games
 * or is willing to do bar duty at home games
 * Used to display D/B indicators on game sheets and match cards
 */
export interface DriverBarInfo {
  driver: boolean;  // True if player can drive to away matches
  bar: boolean;     // True if player does bar duty at home matches
  code: string;     // Display code: 'D', 'B', 'DB', or ''
}

/**
 * TeaRotaEntry - Entry for tea rota list page
 * Contains game info and tea duty assignments for home games
 * Used for viewing, editing, and swapping tea duties
 */
export interface TeaRotaEntry {
  rowNumber: number;      // Row number in Games sheet (for updates)
  tabName: string;        // Unique game identifier
  date: string;           // Game date in YYYY-MM-DD format
  displayDate: string;    // Formatted display date (e.g., "Sat 25 Apr")
  time: string;           // Game time (e.g., "14:00")
  clubName: string;       // Opponent club name
  format: string;         // Game format (e.g., "Rinks", "Triples")
  ladiesMen: string;      // "Ladies", "Men", or "Mixed"
  teaLead: string;        // Tea Lead username
  teaFirst: string;       // Tea First username
  teaSecond: string;      // Tea Second username
}

/**
 * ClubDetails - Comprehensive details about an opponent club
 * Read from Match Day Contacts spreadsheet
 * Used for away games to show venue information, directions, and costs
 * Displayed on match cards and game details pages
 */
export interface ClubDetails {
  clubName: string;        // Opponent club name
  clubNumber: string;      // Club's main phone number
  clubMobile: string;      // Club's mobile phone number
  clubEmail: string;       // Club's email address
  clubEmailNote: string;   // Notes about email communication
  generalInfo: string;     // General information and notes about the club
  drivingBand: string;     // Driving distance band: A, B, C, or D
  petrolCost: number;      // Petrol reimbursement amount (£2.00-£5.00)
  address1: string;        // First line of address
  address2: string;        // Second line of address
  address3: string;        // Third line of address
  address4: string;        // Fourth line of address
  postCode: string;        // Post code
  googleAddress: string;   // Full address for Google Maps URL
  bowlsEnglandUrl: string; // Link to club's Bowls England page
  website: string;         // Club's website URL
  bhWebsite: string;       // Alternative website URL
  latitude: string;        // GPS latitude coordinate
  longitude: string;       // GPS longitude coordinate
}

/**
 * ClubContact - Match day contact person for an opponent club
 * Read from Match Day Contacts spreadsheet
 * Multiple contacts per club are supported (Captain, Secretary, etc.)
 * Displayed on match cards so captains know who to contact on match day
 */
export interface ClubContact {
  clubName: string;     // Opponent club name
  role: string;         // Contact's role (e.g., "Captain", "Secretary")
  firstName: string;    // Contact's first name
  lastName: string;     // Contact's last name
  name: string;         // Full name (firstName + lastName)
  phoneNumber: string;  // Home/landline phone number
  mobileNumber: string; // Mobile phone number
  notes: string;        // Additional notes about this contact
  email: string;        // Email address
}

// ============================================================================
// DISPLAY DATA STRUCTURES
// ============================================================================

/**
 * Team - Represents one team for match card display
 * Groups 4 players together with their positions
 * Teams are numbered 1-4 (or more for larger formats)
 * Used to display organized team lineups on match cards
 */
export interface Team {
  team: number;         // Team number (1, 2, 3, 4, etc.)
  players: {
    name: string;               // Player's name
    position: Position;         // Position: S, 1, 2, or 3
    status: ConfirmationStatus; // Confirmation status: '', Y, or W
    driving?: string;           // Driving assignment: 'D' or 'B'
    carNumber?: string;         // Car number if driving
    isCaptain?: boolean;        // True if this player is captain of the day
  }[];
}

/**
 * ReservePlayer - Represents a reserve player
 * Players who entered but weren't selected for regular teams
 * May be assigned to a specific team as backup or unassigned
 * Displayed separately on match cards below the regular teams
 */
export interface ReservePlayer {
  name: string;               // Player's name
  team: number | null;        // Team number if assigned, null if general reserve
  position: Position;         // Position if assigned
  status: ConfirmationStatus; // Confirmation status: '', Y, or W
}

/**
 * MatchCardData - Complete data structure for displaying a match card
 * Aggregates game details, teams, reserves, contacts, and venue information
 * Used to generate printable/viewable match cards for players and captains
 * Includes all information needed for match day (teams, venue, contacts, tea rota)
 */
export interface MatchCardData {
  game: {
    tabDate: string;      // Short date for display (e.g., "25-Sep")
    date: string;         // Full date (e.g., "2025-09-25")
    time: string;         // Game time (e.g., "14:00")
    clubName: string;     // Opponent club name
    homeAway: HomeAway;   // 'H' or 'A'
    format: string;       // Game format (e.g., "Rinks", "Triples")
    ladiesMen: string;    // "Ladies", "Men", or "Mixed"
    dress?: string;       // Dress code (e.g., "Whites", "Greys")
  };
  teams: Team[];                  // Array of regular teams with players
  reserves: ReservePlayer[];      // Array of reserve players
  reserveTeams: Team[];           // Array of reserve teams (full teams held in reserve)
  captain: string;                // Captain of the day's name
  teaRota?: {                     // Tea duty assignments (null if not available)
    lead: string;                 // Lead tea person
    second: string;               // Second tea person
    third: string;                // Third tea person
  } | null;
  clubDetails?: {                 // Opponent club details (null for home games)
    address: string;              // Full address (multiline)
    postCode: string;             // Post code
    generalInfo: string;          // General information and notes
    petrolCost: number;           // Petrol reimbursement amount
    drivingBand: string;          // Driving distance band (A-D)
    directionsUrl: string;        // Google Maps directions URL
    clubNumber: string;           // Club phone number
    clubMobile: string;           // Club mobile number
    clubEmail: string;            // Club email address
    website: string;              // Club website URL
  } | null;
  clubContacts?: {                // Opponent club contacts (null for home games)
    name: string;                 // Contact's full name
    role: string;                 // Contact's role (Captain, Secretary, etc.)
    phone: string;                // Home/landline phone number
    mobile: string;               // Mobile phone number
    email: string;                // Email address
  }[] | null;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * EnterGamesRequest - Request to enter one or more games
 * POST /api/friendlies/enter
 * Players use this to enter games that are open for entries
 */
export interface EnterGamesRequest {
  user_name?: string;  // Optional - username (can be inferred from session)
  game_ids: string[];  // Array of game tabNames to enter (e.g., ["West Hoathly 25-Sep", "Lindfield 2-Oct"])
}

/**
 * EnterGamesResponse - Response after entering games
 * Returns success status and per-game results
 * Some games may succeed while others fail (e.g., already entered, game closed)
 */
export interface EnterGamesResponse {
  success: boolean;    // True if operation completed (doesn't mean all games entered)
  results: {
    game_id: string;   // Game tabName that was processed
    entered: boolean;  // True if successfully entered this game
    error?: string;    // Error message if entry failed
  }[];
}

/**
 * ConfirmParticipationRequest - Request to confirm participation (currently unused)
 * POST /api/friendlies/confirm
 * Reserved for future feature where players confirm they will attend
 */
export interface ConfirmParticipationRequest {
  user_name?: string;  // Optional - username (can be inferred from session)
  tab_name: string;    // Game tabName to confirm
  action: 'confirm';   // Action to perform (only 'confirm' supported)
}

/**
 * WithdrawRequest - Request to withdraw from a game
 * POST /api/friendlies/withdraw
 * Players use this to withdraw from games they entered
 * Behavior differs based on game status (Open vs Selected)
 */
export interface WithdrawRequest {
  user_name?: string;  // Optional - username (can be inferred from session)
  tab_name: string;    // Game tabName to withdraw from
}

/**
 * ChangeStatusRequest - Request to change game status
 * POST /api/friendlies/manage/status
 * Captains use this to move games through their lifecycle
 * Each action has specific validation and may trigger sheet operations
 */
export interface ChangeStatusRequest {
  tab_name: string;    // Game tabName to update (may be empty for unopened games)
  row_number?: number; // Row number in Games sheet (used to identify unopened games)
  action: 'open' | 'close' | 'allocate' | 'publish' | 'played' | 'cancel' | 'abandon'; // Status transition action
  bhbc_score?: number;      // Burgess Hill score (required for 'played' and 'abandon')
  opponent_score?: number;  // Opponent score (required for 'played' and 'abandon')
  reason?: string;          // Reason for cancellation/abandonment (required for 'cancel' and 'abandon')
  who?: string;             // Who initiated cancellation (required for 'cancel')
  send_email?: boolean;     // Whether to send email notification to players (for 'publish' action)
  send_tea_rota_email?: boolean; // Whether to send email notification to tea rota members (for 'publish' action, home games only)
}

/**
 * ChangeStatusResponse - Response after changing game status
 * Confirms new status and whether game sheet was created
 */
export interface ChangeStatusResponse {
  success: boolean;           // True if status change succeeded
  new_status: GameStatus;     // The new status code (O, X, S, P, C, or A)
  game_sheet_created?: boolean; // True if 'close' action created a game sheet
}

/**
 * AddPlayerRequest - Request to add a player to a closed game
 * POST /api/friendlies/manage/add-player
 * Captains use this to add players who missed the entry deadline
 */
export interface AddPlayerRequest {
  tab_name: string;   // Game tabName to add player to
  user_name: string;  // Username of player to add
}

/**
 * UpdateSelectionRequest - Request to update team selections
 * POST /api/friendlies/manage/update-selection
 * Captains use this to select teams, assign positions, and set driving duties
 * Can update multiple players in a single request
 */
export interface UpdateSelectionRequest {
  tab_name: string;    // Game tabName to update
  selections: {
    row_number: number;              // Row number in game sheet (required)
    selected?: SelectionStatus;      // Selection status: '', Y, R, or T
    team?: number | null;            // Team number or null
    position?: Position;             // Position: S, 1, 2, 3, or ''
    driving?: string;                // Driving assignment: 'D', 'B', or ''
    car_number?: string;             // Car number if driving
    captain?: string;                // Captain of the day: 'Y' or ''
    status?: ConfirmationStatus;     // Confirmation status: '', Y, or W
  }[];
}

/**
 * UpdateSelectionResponse - Response after updating team selections
 * Returns success status and complete player list sorted for display
 * Sorted order: Playing team first (by team, then position), then reserves
 */
export interface UpdateSelectionResponse {
  success: boolean;              // True if selections were updated successfully
  sorted_players: GameSheetPlayer[]; // All players sorted for display (Playing → Reserves → Unselected)
}

/**
 * UpdateStatsRequest - Request to sync player stats from game sheet to Players sheet
 * POST /api/friendlies/manage/update-stats
 * Captains use this after making selection changes to keep Players sheet in sync
 * Updates the Players sheet column for this game with selection status codes
 */
export interface UpdateStatsRequest {
  tab_name: string;   // Game tabName to sync stats for
}

/**
 * UpdateStatsResponse - Response after syncing player stats
 * Confirms how many player entries were updated in Players sheet
 */
export interface UpdateStatsResponse {
  success: boolean;       // True if stats sync completed
  stats_updated: number;  // Number of player entries updated in Players sheet
}

/**
 * GetStatsRequest - Request to fetch and update player stats in game sheet
 * POST /api/friendlies/manage/get-stats
 * Captains use this before making selections to see current player statistics
 * Populates nameDown, picked, percentPlayed, and driverBar columns in game sheet
 */
export interface GetStatsRequest {
  tab_name: string;   // Game tabName to fetch stats for
}
