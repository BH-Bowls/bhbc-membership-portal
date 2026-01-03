// src/lib/member-type-utils.ts
// Utility functions for member type handling (PL, SL, PM, SM codes and full names)

/**
 * Member type codes
 * PL = Playing Lady
 * SL = Social Lady
 * PM = Playing Man
 * SM = Social Man
 */
export type MemberTypeCode = 'PL' | 'SL' | 'PM' | 'SM';

/**
 * Game gender types for Friendlies
 */
export type GameGender = 'Ladies' | 'Men' | 'Mixed' | '';

/**
 * Map of member type codes to full names
 */
const MEMBER_TYPE_NAMES: Record<MemberTypeCode, string> = {
  PL: 'Playing Lady',
  SL: 'Social Lady',
  PM: 'Playing Man',
  SM: 'Social Man',
};

/**
 * Map of full names to member type codes
 */
const MEMBER_TYPE_CODES: Record<string, MemberTypeCode> = {
  'Playing Lady': 'PL',
  'Social Lady': 'SL',
  'Playing Man': 'PM',
  'Social Man': 'SM',
};

/**
 * Convert member type code to full name
 * @param code Member type code (PL, SL, PM, SM)
 * @returns Full name (e.g., "Playing Lady") or the code itself if not recognized
 */
export function getMemberTypeFullName(code: string): string {
  // Return full name if code is recognized
  if (code in MEMBER_TYPE_NAMES) {
    return MEMBER_TYPE_NAMES[code as MemberTypeCode];
  }

  // Return code as-is if not recognized (for backwards compatibility)
  return code;
}

/**
 * Convert full name to member type code
 * @param fullName Full name (e.g., "Playing Lady")
 * @returns Member type code (PL, SL, PM, SM) or the input if not recognized
 */
export function getMemberTypeCode(fullName: string): string {
  // Return code if full name is recognized
  if (fullName in MEMBER_TYPE_CODES) {
    return MEMBER_TYPE_CODES[fullName];
  }

  // Return input as-is if not recognized (for backwards compatibility)
  return fullName;
}

/**
 * Check if member type is a playing member (Playing Lady or Playing Man)
 * Players can enter friendly matches
 * @param memberType Member type full name (Playing Lady, Social Lady, Playing Man, Social Man)
 * @returns true if member is a player (Playing Lady or Playing Man), false otherwise
 */
export function isPlayer(memberType: string): boolean {
  return memberType === 'Playing Lady' || memberType === 'Playing Man';
}

/**
 * Check if member type is a social member (Social Lady or Social Man)
 * Social members cannot enter friendly matches
 * @param memberType Member type full name (Playing Lady, Social Lady, Playing Man, Social Man)
 * @returns true if member is social (Social Lady or Social Man), false otherwise
 */
export function isSocial(memberType: string): boolean {
  return memberType === 'Social Lady' || memberType === 'Social Man';
}

/**
 * Check if member can enter a game based on their member type and game gender
 * Rules:
 * - Social members (Social Lady, Social Man) cannot enter any games
 * - Playing Ladies can only enter Ladies or Mixed games
 * - Playing Men can only enter Men or Mixed games
 * @param memberType Member type full name (Playing Lady, Social Lady, Playing Man, Social Man)
 * @param gameGender Game gender (Ladies, Men, Mixed, or empty)
 * @returns true if member can enter this game, false otherwise
 */
export function canEnterGame(memberType: string, gameGender: GameGender): boolean {
  // Social members cannot enter any games
  if (isSocial(memberType)) {
    return false;
  }

  // If not a recognized player type, deny entry
  if (!isPlayer(memberType)) {
    return false;
  }

  // Mixed games or unspecified gender - all players can enter
  if (gameGender === 'Mixed' || gameGender === '') {
    return true;
  }

  // Ladies games - only Playing Ladies can enter
  if (gameGender === 'Ladies') {
    return memberType === 'Playing Lady';
  }

  // Men games - only Playing Men can enter
  if (gameGender === 'Men') {
    return memberType === 'Playing Man';
  }

  // Default: deny entry
  return false;
}

/**
 * Get display name for member type with Honorary suffix if applicable
 * @param memberType Member type full name (Playing Lady, Social Lady, Playing Man, Social Man)
 * @param honorary Honorary flag ("Y", "N", null, or empty)
 * @returns Display name (e.g., "Playing Lady" or "Playing Lady, Honorary")
 */
export function getMemberTypeDisplay(memberType: string, honorary: string | null): string {
  // Get full name for member type (if codes are passed for backwards compatibility, convert them)
  const fullName = getMemberTypeFullName(memberType);

  // Add Honorary suffix if applicable
  if (honorary === 'Y') {
    return `${fullName}, Honorary`;
  }

  return fullName;
}

/**
 * Get all member type options for dropdown
 * Returns array of objects with value (full name) and label (full name)
 * @returns Array of member type options
 */
export function getMemberTypeOptions(): Array<{ value: string; label: string }> {
  return [
    { value: 'Playing Lady', label: 'Playing Lady' },
    { value: 'Social Lady', label: 'Social Lady' },
    { value: 'Playing Man', label: 'Playing Man' },
    { value: 'Social Man', label: 'Social Man' },
  ];
}
