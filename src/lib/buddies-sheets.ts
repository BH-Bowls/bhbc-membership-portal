// src/lib/buddies-sheets.ts
// The two pure (no data lookup) authorization checks from the original buddy/access
// control module — re-exported by buddies-supabase.ts. Every data-dependent check
// (canManageUser, canEditProfileField, canImpersonate, getImpersonatableUsers,
// getManageableUsers) has a Postgres-backed replacement in buddies-supabase.ts instead.

import { hasRole } from './role-utils';

/**
 * Check if current user can manage friendlies (sign up members for games)
 *
 * Friendlies have open access - any logged-in member can sign up any member
 * This is intentionally more permissive than Profile/Renewals
 *
 * @param currentUserName The username of the current user (null if not logged in)
 * @returns true if user can manage friendlies, false if not logged in
 */
export function canManageFriendlies(
  currentUserName: string | null
): boolean {
  // Check if user is logged in
  // Null or undefined username means not authenticated
  if (currentUserName === null || currentUserName === undefined) {
    return false;
  }

  // Any authenticated user can sign up any member for friendlies
  return true;
}

/**
 * Check if current user can edit payment fields in renewals
 * Payment fields include: banking, dateReceived, donations, etc.
 *
 * Admin-only to prevent fraud and maintain financial integrity
 *
 * @param currentUserRole The role of the current user
 * @returns true if user can edit payments (admin only)
 */
export function canEditPaymentFields(
  currentUserRole: string
): boolean {
  // Only admins can edit banking and payment fields
  // This prevents members from marking their own renewals as paid
  if (hasRole(currentUserRole, 'Admin')) {
    return true;
  }

  return false;
}
