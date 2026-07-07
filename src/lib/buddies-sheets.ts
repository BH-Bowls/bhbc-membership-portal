// src/lib/buddies-sheets.ts
// Core authorization logic for system-wide buddy/access control
// Implements permission system allowing users to manage themselves, their buddies, and admins to manage everyone

import { getUserByUsername, getAllUsers, type User } from './sheets';
import { hasRole, isCommitteeMember } from './role-utils';

/**
 * True when a role string carries privileges beyond a plain member.
 * Used as the ceiling on buddy impersonation: a buddy relationship must never be a
 * route to committee/admin powers — only plain-member (or specialist-player) accounts
 * may be impersonated via the buddy rule.
 */
function hasElevatedRole(role: string | null | undefined): boolean {
  return isCommitteeMember(role) || hasRole(role, 'RowlandOrganiser', 'Super Admin', 'superadmin');
}

// ============================================================================
// Authorization Functions
// ============================================================================

/**
 * Check if current user can manage target user (used in Profile & Renewals)
 *
 * Permission Rules:
 * 1. Users can always manage themselves
 * 2. Admins can manage anyone
 * 3. Buddies can manage each other (if target lists current user as their buddy)
 *
 * @param currentUserName The username of the person trying to access
 * @param currentUserRole The role of the current user (Admin, T, M, etc.)
 * @param targetUserName The username being accessed/managed
 * @returns true if access is allowed, false if forbidden
 */
export async function canManageUser(
  currentUserName: string,
  currentUserRole: string,
  targetUserName: string
): Promise<boolean> {
  // Rule 1: Users can always manage their own profile/renewal
  if (currentUserName === targetUserName) {
    return true;
  }

  // Rule 2: Admins can manage anyone
  // Admin role has full system access (multi-role aware — an exact compare here
  // previously denied e.g. "Admin,Captain")
  if (hasRole(currentUserRole, 'Admin')) {
    return true;
  }

  // Rule 3: Check if current user is listed as the target's buddy
  // Get the target user's profile from Google Sheets
  const targetUser = await getUserByUsername(targetUserName);

  // Check if target user exists
  if (!targetUser) {
    return false;
  }

  // Check if target user has listed current user as their buddy
  if (targetUser.buddyUserName === currentUserName) {
    return true;
  }

  // No permission rules matched - access denied
  return false;
}

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
 * Check if a specific profile field can be edited by current user
 *
 * Field-level permissions (assumes canManageUser() has already passed):
 * - password/passwordHash: Self or Admin only (security-critical)
 * - emailAddress: Self, Buddy, or Admin (buddies need contact info)
 * - userName: Admin only (primary key, can't be changed)
 * - role: Admin only (privilege escalation prevention)
 * - All other fields: Allowed if canManageUser() passed
 *
 * @param currentUserName The username of the person trying to edit
 * @param currentUserRole The role of the current user
 * @param targetUserName The username being edited
 * @param fieldName The specific field being edited
 * @returns true if field can be edited, false if restricted
 */
export async function canEditProfileField(
  currentUserName: string,
  currentUserRole: string,
  targetUserName: string,
  fieldName: string
): Promise<boolean> {
  // Password fields are highly restricted - only self or admin
  // Prevents buddies from changing each other's passwords
  if (fieldName === 'password' || fieldName === 'passwordHash') {
    // Check if editing own password
    if (currentUserName === targetUserName) {
      return true;
    }

    // Check if admin
    if (hasRole(currentUserRole, 'Admin')) {
      return true;
    }

    // Not self and not admin - password change forbidden
    return false;
  }

  // Email address: self, buddy, or admin
  // Buddies can update contact info for their buddy
  if (fieldName === 'emailAddress') {
    // Check if editing own email
    if (currentUserName === targetUserName) {
      return true;
    }

    // Check if admin
    if (hasRole(currentUserRole, 'Admin')) {
      return true;
    }

    // Check if current user is the buddy of target user
    const targetUser = await getUserByUsername(targetUserName);

    // Check if target user exists and has current user as buddy
    if (targetUser) {
      if (targetUser.buddyUserName === currentUserName) {
        return true;
      }
    }

    // Not self, not admin, not buddy - email change forbidden
    return false;
  }

  // Username field: admin only
  // Username is the primary key and shouldn't be changed
  if (fieldName === 'userName') {
    if (hasRole(currentUserRole, 'Admin')) {
      return true;
    }
    return false;
  }

  // Role field: admin only
  // Prevents privilege escalation (users making themselves admin)
  if (fieldName === 'role') {
    if (hasRole(currentUserRole, 'Admin')) {
      return true;
    }
    return false;
  }

  // Administrative fields — admin only (membership status / committee / comps)
  // honorary (fee exemption), handicap (competitions), include (renewal emails),
  // gmc, renewStatus (renewal delivery method)
  if (fieldName === 'honorary' || fieldName === 'handicap' || fieldName === 'include' || fieldName === 'gmc' || fieldName === 'renewStatus') {
    if (hasRole(currentUserRole, 'Admin')) {
      return true;
    }
    return false;
  }

  // All other fields are allowed
  // This includes: name, address, phone, preferences, etc.
  // Access to edit these was already verified by canManageUser()
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

/**
 * Check if current user can impersonate target user
 *
 * Impersonation Rules (system-wide via JWT):
 * 1. Admins can impersonate anyone
 * 2. Members can impersonate users who list them as their buddy
 * 3. Cannot impersonate yourself (redundant - you're already yourself)
 *
 * @param currentUserName The username of the person attempting to impersonate
 * @param currentUserRole The role of the current user (Admin, Member, etc.)
 * @param targetUserName The username to impersonate
 * @returns true if impersonation is allowed, false if forbidden
 */
export async function canImpersonate(
  currentUserName: string,
  currentUserRole: string,
  targetUserName: string
): Promise<boolean> {
  // Cannot impersonate yourself (use normal login instead)
  if (currentUserName === targetUserName) {
    return false;
  }

  // Admins and Super Admins can impersonate anyone (multi-role aware)
  if (hasRole(currentUserRole, 'Admin', 'Super Admin', 'superadmin')) {
    return true;
  }

  // Check buddy relationship - target must list current user as their buddy
  const targetUser = await getUserByUsername(targetUserName);

  if (!targetUser) {
    return false;
  }

  // Buddy rule with a ROLE CEILING: impersonating grants the target's full powers,
  // so a buddy link to a committee/admin account must not be an escalation route.
  // Buddy impersonation is for plain-member family accounts only.
  if (targetUser.buddyUserName === currentUserName && !hasElevatedRole(targetUser.role)) {
    return true;
  }

  // No permission rules matched - impersonation denied
  return false;
}

/**
 * Get list of users that current user can impersonate
 * Used for "Switch User" dropdown in navbar
 *
 * Returns:
 * - Admins: All users except themselves
 * - Members: Only users who list them as buddy
 *
 * @param currentUserName The username of the current user
 * @param currentUserRole The role of the current user
 * @returns Array of users that can be impersonated, sorted by name
 */
export async function getImpersonatableUsers(
  currentUserName: string,
  currentUserRole: string
): Promise<User[]> {
  // Get all users from the Members Google Sheet
  const allUsers = await getAllUsers();

  // If user is admin or super admin, they can impersonate everyone (except themselves)
  if (hasRole(currentUserRole, 'Admin', 'Super Admin', 'superadmin')) {
    const impersonatableUsers = allUsers.filter(u => u.userName !== currentUserName);

    // Sort alphabetically by full name
    impersonatableUsers.sort((a, b) => {
      const nameA = a.fullKnownAs || a.firstName;
      const nameB = b.fullKnownAs || b.firstName;
      return nameA.localeCompare(nameB);
    });

    return impersonatableUsers;
  }

  // For non-admins, return only users who list them as buddy (exclude self).
  // Elevated-role targets are excluded to match the canImpersonate role ceiling.
  const buddies = allUsers.filter(u =>
    u.buddyUserName === currentUserName &&
    u.userName !== currentUserName &&
    !hasElevatedRole(u.role)
  );

  // Sort alphabetically by full name
  buddies.sort((a, b) => {
    const nameA = a.fullKnownAs || a.firstName;
    const nameB = b.fullKnownAs || b.firstName;
    return nameA.localeCompare(nameB);
  });

  return buddies;
}

// ============================================================================
// User List Functions
// ============================================================================

/**
 * Get list of users that current user can manage
 * Used for dropdowns in Profile and Renewals pages
 *
 * Returns:
 * - Admins: All users
 * - Regular users: Self + users who list them as buddy
 *
 * @param currentUserName The username of the current user
 * @param currentUserRole The role of the current user
 * @returns Array of users that can be managed, sorted by name
 */
export async function getManageableUsers(
  currentUserName: string,
  currentUserRole: string
): Promise<User[]> {
  // Get all users from the Members Google Sheet
  const allUsers = await getAllUsers();

  // If user is admin, they can manage everyone
  if (hasRole(currentUserRole, 'Admin')) {

    // Sort all users alphabetically by full name
    // Loop through and sort manually
    const sortedUsers = [...allUsers];
    sortedUsers.sort((a, b) => {
      // Get the name to sort by (prefer fullKnownAs, fall back to firstName)
      const nameA = a.fullKnownAs;
      const nameB = b.fullKnownAs;

      // Use fallback if fullKnownAs is empty
      const finalNameA = nameA || a.firstName;
      const finalNameB = nameB || b.firstName;

      // Compare names alphabetically
      return finalNameA.localeCompare(finalNameB);
    });

    return sortedUsers;
  }

  // For non-admins, build list of manageable users
  const manageableUsers: User[] = [];

  // Step 1: Add self to the list
  // Find current user in the all users list
  let selfUser = null;
  for (const user of allUsers) {
    if (user.userName === currentUserName) {
      selfUser = user;
      break;
    }
  }

  // Add self if found
  if (selfUser) {
    manageableUsers.push(selfUser);
  }

  // Step 2: Add users where current user is listed as their buddy
  // Loop through all users to find ones who list current user as buddy
  for (const user of allUsers) {
    // Check if this user has current user as their buddy
    if (user.buddyUserName === currentUserName) {
      manageableUsers.push(user);
    }
  }

  // Sort the manageable users alphabetically by name
  manageableUsers.sort((a, b) => {
    // Get the name to sort by (prefer fullKnownAs, fall back to firstName)
    const nameA = a.fullKnownAs;
    const nameB = b.fullKnownAs;

    // Use fallback if fullKnownAs is empty
    const finalNameA = nameA || a.firstName;
    const finalNameB = nameB || b.firstName;

    // Compare names alphabetically
    return finalNameA.localeCompare(finalNameB);
  });

  return manageableUsers;
}

/**
 * Get all members that can be signed up for friendlies
 * Friendlies have open access - any active member can be signed up by anyone
 *
 * @returns Array of active members (excludes cancelled memberships), sorted by name
 */
export async function getAllSignupableMembers(): Promise<User[]> {
  // Get all users from the Members Google Sheet
  const allUsers = await getAllUsers();

  // Filter to active members only (exclude cancelled memberships)
  const activeMembers: User[] = [];

  // Loop through all users
  for (const user of allUsers) {
    // Skip users with cancelled membership
    if (user.memberType === 'Cancelled') {
      continue;
    }

    // Add active member to the list
    activeMembers.push(user);
  }

  // Sort active members alphabetically by name
  activeMembers.sort((a, b) => {
    // Get the name to sort by (prefer fullKnownAs, fall back to firstName)
    const nameA = a.fullKnownAs;
    const nameB = b.fullKnownAs;

    // Use fallback if fullKnownAs is empty
    const finalNameA = nameA || a.firstName;
    const finalNameB = nameB || b.firstName;

    // Compare names alphabetically
    return finalNameA.localeCompare(finalNameB);
  });

  return activeMembers;
}
