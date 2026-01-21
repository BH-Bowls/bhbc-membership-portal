// lib/game-management/capacity.ts
// Capacity management for games and events
// NEW FEATURE: Tracks player limits across all systems

import type { BaseGame, CapacityInfo } from './types';

/**
 * Calculate capacity information for a game/event
 * @param game Game or event object
 * @param waitlistCount Optional waitlist count (for social events)
 * @returns Capacity information
 */
export function calculateCapacity(
  game: BaseGame,
  waitlistCount: number = 0
): CapacityInfo {
  const current = game.entered || 0;
  const max = game.maxPlayers || 0;
  const available = Math.max(0, max - current);
  // Only consider full if max capacity is set (> 0)
  const isFull = max > 0 && current >= max;

  return {
    current,
    max,
    available,
    isFull,
    ...(waitlistCount > 0 && { waitlistCount }),
  };
}

/**
 * Check if a player can enter a game/event
 * @param game Game or event object
 * @param allowWaitlist Whether to allow waitlist entries (social events only)
 * @returns Object with canEnter flag and optional reason
 */
export function canEnterGame(
  game: BaseGame,
  allowWaitlist: boolean = false
): { canEnter: boolean; reason?: string; onWaitlist?: boolean } {
  // Check if game is open for entry
  if (game.status !== 'O') {
    return {
      canEnter: false,
      reason: getStatusReason(game.status),
    };
  }

  // Check capacity
  const capacity = calculateCapacity(game);

  if (capacity.isFull) {
    if (allowWaitlist) {
      // Social events allow waitlist
      return {
        canEnter: true,
        onWaitlist: true,
      };
    } else {
      // Competitive games don't allow entry when full
      return {
        canEnter: false,
        reason: `Game is full (${capacity.current}/${capacity.max} players)`,
      };
    }
  }

  // All checks passed
  return { canEnter: true };
}

/**
 * Get human-readable reason for game status
 */
function getStatusReason(status: string): string {
  switch (status) {
    case 'X':
      return 'Game is closed for entry';
    case 'S':
      return 'Teams have been selected';
    case 'P':
      return 'Game has been postponed';
    case 'C':
      return 'Game has been cancelled';
    case 'A':
      return 'Game is archived';
    default:
      return 'Game is not available for entry';
  }
}

/**
 * Format capacity for display
 * @param capacity Capacity information
 * @returns Formatted string (e.g., "12/16", "Full", "20 (5 waiting)")
 */
export function formatCapacity(capacity: CapacityInfo): string {
  if (capacity.waitlistCount && capacity.waitlistCount > 0) {
    return `${capacity.current} (${capacity.waitlistCount} waiting)`;
  }

  if (capacity.isFull) {
    return `${capacity.current}/${capacity.max} FULL`;
  }

  return `${capacity.current}/${capacity.max}`;
}

/**
 * Get capacity status badge color
 * @param capacity Capacity information
 * @returns Tailwind color class
 */
export function getCapacityBadgeColor(capacity: CapacityInfo): string {
  if (capacity.isFull) {
    return 'bg-red-500'; // Full - red
  }

  const percentFull = (capacity.current / capacity.max) * 100;

  if (percentFull >= 75) {
    return 'bg-yellow-500'; // Almost full - yellow
  }

  return 'bg-green-500'; // Available spots - green
}

/**
 * Validate max players for a game format
 * @param format Game format (Triples, Pairs, etc.)
 * @param maxPlayers Proposed max players
 * @returns Validation result
 */
export function validateMaxPlayers(
  format: string,
  maxPlayers: number
): { valid: boolean; suggestion?: number; reason?: string } {
  // Standard formats and their typical player counts
  const formatSizes: Record<string, number> = {
    'Singles': 2,
    'Pairs': 4,
    'Triples': 6,
    'Fours': 8,
    'Rinks': 8,
  };

  const standardSize = formatSizes[format];

  if (!standardSize) {
    // Unknown format - allow any reasonable number
    if (maxPlayers < 2) {
      return {
        valid: false,
        reason: 'Minimum 2 players required',
      };
    }
    return { valid: true };
  }

  // Check if maxPlayers is a multiple of the format size
  if (maxPlayers % standardSize !== 0) {
    const suggested = Math.ceil(maxPlayers / standardSize) * standardSize;
    return {
      valid: false,
      suggestion: suggested,
      reason: `${format} games typically have ${standardSize} players per team. ` +
              `Consider ${suggested} players (${suggested / standardSize} teams).`,
    };
  }

  return { valid: true };
}
