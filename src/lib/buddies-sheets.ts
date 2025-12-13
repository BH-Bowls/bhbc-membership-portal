// src/lib/buddies-sheets.ts
// Core authorization logic for system-wide buddy/access control

import { getUserByUsername, getAllUsers, type User } from './sheets';

/**
 * Check if current user can manage target user (Profile & Renewals)
 * Uses buddy system: self + buddies + admin
 */
export async function canManageUser(
  currentUserName: string,
  currentUserRole: string,
  targetUserName: string
): Promise<boolean> {
  // 1. Can always manage self
  if (currentUserName === targetUserName) {
    return true;
  }

  // 2. Admins can manage anyone
  if (currentUserRole === 'Admin') {
    return true;
  }

  // 3. Can manage if you're listed as their buddy
  const targetUser = await getUserByUsername(targetUserName);
  if (targetUser?.buddyUserName === currentUserName) {
    return true;
  }

  return false;
}

/**
 * Check if current user can manage friendlies
 * Open access: any logged-in member can sign up any member
 */
export function canManageFriendlies(
  currentUserName: string | null
): boolean {
  // Simply check if logged in
  // Any authenticated user can sign up any member
  return !!currentUserName;
}

/**
 * Check if a specific profile field is restricted
 * Returns true if field can be edited, false if restricted
 * Note: Assumes canManageUser() has already been checked
 */
export function canEditProfileField(
  currentUserName: string,
  currentUserRole: string,
  targetUserName: string,
  fieldName: string
): boolean {
  // Password fields: self or admin only
  if (fieldName === 'password' || fieldName === 'passwordHash') {
    return currentUserName === targetUserName || currentUserRole === 'Admin';
  }

  // Email: self or admin only (authentication identifier)
  if (fieldName === 'emailAddress') {
    return currentUserName === targetUserName || currentUserRole === 'Admin';
  }

  // Username: admin only (primary key)
  if (fieldName === 'userName') {
    return currentUserRole === 'Admin';
  }

  // Role: admin only
  if (fieldName === 'role') {
    return currentUserRole === 'Admin';
  }

  // All other fields: allowed (buddy access already verified)
  return true;
}

/**
 * Check if current user can edit payment fields in renewals
 * Admin-only: banking, dateReceived, etc.
 */
export function canEditPaymentFields(
  currentUserRole: string
): boolean {
  // Only admins can edit banking/payment fields
  return currentUserRole === 'Admin';
}

/**
 * Get list of users that current user can manage
 * For dropdowns in Profile and Renewals
 */
export async function getManageableUsers(
  currentUserName: string,
  currentUserRole: string
): Promise<User[]> {
  const allUsers = await getAllUsers();

  console.log('👥 getManageableUsers - User:', currentUserName, 'Role:', currentUserRole, 'Total users:', allUsers.length);

  // If admin, return all users
  if (currentUserRole === 'Admin') {
    console.log('✅ User is admin, returning all users');
    return allUsers.sort((a, b) =>
      (a.fullKnownAs || a.firstName).localeCompare(b.fullKnownAs || b.firstName)
    );
  }

  console.log('ℹ️  User is not admin (role is not "Admin"), filtering to self + buddies');

  // For non-admins, return self + buddies
  const manageableUsers: User[] = [];

  // Add self
  const selfUser = allUsers.find((u) => u.userName === currentUserName);
  if (selfUser) {
    manageableUsers.push(selfUser);
  }

  // Add users where current user is their buddy
  const buddies = allUsers.filter(
    (u) => u.buddyUserName === currentUserName
  );
  manageableUsers.push(...buddies);

  return manageableUsers.sort((a, b) =>
    (a.fullKnownAs || a.firstName).localeCompare(b.fullKnownAs || b.firstName)
  );
}

/**
 * Get all members that can be signed up for friendlies
 * Open access: any active member can be signed up
 */
export async function getAllSignupableMembers(): Promise<User[]> {
  const allUsers = await getAllUsers();

  // Filter to active members only (not cancelled)
  return allUsers
    .filter((u) => u.memberType !== 'Cancelled')
    .sort((a, b) =>
      (a.fullKnownAs || a.firstName).localeCompare(b.fullKnownAs || b.firstName)
    );
}
