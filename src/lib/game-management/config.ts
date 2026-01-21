// lib/game-management/config.ts
// System configurations for all game/event management systems

import type { GameSystemConfig } from './types';

// ============================================================================
// FRIENDLIES SYSTEM CONFIGURATION
// ============================================================================

/**
 * Configuration for Friendlies system
 * External competitive games against other clubs
 */
export const FriendliesConfig: GameSystemConfig = {
  // Spreadsheet
  spreadsheetIdEnvVar: 'FRIENDLIES_SPREADSHEET_ID',
  gamesSheetName: 'Games',
  membersSheetName: 'Players',

  // Features
  hasOpponentClub: true,     // Games against other clubs
  hasHomeAway: true,         // Home and away games
  hasStats: true,            // Track player statistics
  hasCaptain: true,          // Captain of the day selection
  hasTeams: true,            // Team selection with positions
  hasAttendance: false,      // Not simple attendance - uses team selection
  hasDriving: true,          // Driving assignments for away games

  // Display
  systemName: 'Friendlies',
  itemName: 'Game',
  itemNamePlural: 'Games',
};

// ============================================================================
// INTERNAL GAMES SYSTEM CONFIGURATION
// ============================================================================

/**
 * Configuration for Internal Games system
 * Internal competitive games (club championships, etc.)
 */
export const InternalGamesConfig: GameSystemConfig = {
  // Spreadsheet
  spreadsheetIdEnvVar: 'INTERNAL_GAMES_SPREADSHEET_ID',
  gamesSheetName: 'Games',
  membersSheetName: 'Players',

  // Features
  hasOpponentClub: false,    // Internal - no opponent
  hasHomeAway: false,        // All "home"
  hasStats: false,           // No stats tracking
  hasCaptain: false,         // No captain needed
  hasTeams: true,            // Team selection with positions
  hasAttendance: false,      // Uses team selection, not attendance
  hasDriving: false,         // All local - no driving

  // Display
  systemName: 'Internal Games',
  itemName: 'Game',
  itemNamePlural: 'Games',
};

// ============================================================================
// SOCIAL EVENTS SYSTEM CONFIGURATION
// ============================================================================

/**
 * Configuration for Social Events system
 * Non-competitive social events (BBQ, quiz nights, trips, etc.)
 */
export const SocialEventsConfig: GameSystemConfig = {
  // Spreadsheet
  spreadsheetIdEnvVar: 'SOCIAL_EVENTS_SPREADSHEET_ID',
  gamesSheetName: 'Events',
  membersSheetName: 'Members',

  // Features
  hasOpponentClub: false,    // Social - no competition
  hasHomeAway: false,        // Just location
  hasStats: false,           // No stats
  hasCaptain: false,         // No captain
  hasTeams: false,           // No teams or positions
  hasAttendance: true,       // Simple Yes/No/Maybe/Waitlist
  hasDriving: false,         // Could add for trips, but not initially

  // Display
  systemName: 'Social Events',
  itemName: 'Event',
  itemNamePlural: 'Events',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get configuration by system name
 */
export function getConfigBySystem(systemName: 'friendlies' | 'internal-games' | 'social-events'): GameSystemConfig {
  switch (systemName) {
    case 'friendlies':
      return FriendliesConfig;
    case 'internal-games':
      return InternalGamesConfig;
    case 'social-events':
      return SocialEventsConfig;
    default:
      throw new Error(`Unknown system: ${systemName}`);
  }
}

/**
 * Get spreadsheet ID from environment for a given config
 */
export function getSpreadsheetId(config: GameSystemConfig): string {
  const id = process.env[config.spreadsheetIdEnvVar];
  if (!id) {
    throw new Error(
      `${config.spreadsheetIdEnvVar} environment variable is not set. ` +
      `Check your .env.local file.`
    );
  }
  return id;
}
