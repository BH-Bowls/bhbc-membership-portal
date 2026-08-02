// src/lib/buddies-supabase.ts
// Postgres-backed replacement for buddies-sheets.ts's data-dependent functions
// (canManageUser, canEditProfileField, canImpersonate, getImpersonatableUsers — all call
// getUserByUsername/getAllUsers). canEditProfileField was initially assumed pure but
// actually has one data-dependent branch (the emailAddress buddy check).
// canManageFriendlies/canEditPaymentFields are genuinely pure — re-exported from
// buddies-sheets.ts rather than duplicated, same pattern as auth-supabase.ts.

import { getUserByUsername, getAllUsers } from './members-supabase';
import { hasRole, isCommitteeMember } from './role-utils';
import type { User } from './sheets';

export { canManageFriendlies, canEditPaymentFields } from './buddies-sheets';

function hasElevatedRole(role: string | null | undefined): boolean {
  return isCommitteeMember(role) || hasRole(role, 'RowlandOrganiser', 'Super Admin', 'superadmin');
}

export async function canManageUser(
  currentUserName: string,
  currentUserRole: string,
  targetUserName: string
): Promise<boolean> {
  if (currentUserName === targetUserName) return true;
  if (hasRole(currentUserRole, 'Admin')) return true;

  const targetUser = await getUserByUsername(targetUserName);
  if (!targetUser) return false;
  if (targetUser.buddyUserName === currentUserName) return true;

  return false;
}

export async function canEditProfileField(
  currentUserName: string,
  currentUserRole: string,
  targetUserName: string,
  fieldName: string
): Promise<boolean> {
  if (fieldName === 'password' || fieldName === 'passwordHash') {
    if (currentUserName === targetUserName) return true;
    if (hasRole(currentUserRole, 'Admin')) return true;
    return false;
  }

  if (fieldName === 'emailAddress') {
    if (currentUserName === targetUserName) return true;
    if (hasRole(currentUserRole, 'Admin')) return true;
    const targetUser = await getUserByUsername(targetUserName);
    if (targetUser && targetUser.buddyUserName === currentUserName) return true;
    return false;
  }

  if (fieldName === 'userName') {
    return hasRole(currentUserRole, 'Admin');
  }

  if (fieldName === 'role') {
    return hasRole(currentUserRole, 'Admin');
  }

  if (fieldName === 'honorary' || fieldName === 'handicap' || fieldName === 'include' || fieldName === 'gmc' || fieldName === 'renewStatus') {
    return hasRole(currentUserRole, 'Admin');
  }

  return true;
}

export async function canImpersonate(
  currentUserName: string,
  currentUserRole: string,
  targetUserName: string
): Promise<boolean> {
  if (currentUserName === targetUserName) return false;
  if (hasRole(currentUserRole, 'Admin', 'Super Admin', 'superadmin')) return true;

  const targetUser = await getUserByUsername(targetUserName);
  if (!targetUser) return false;

  if (targetUser.buddyUserName === currentUserName && !hasElevatedRole(targetUser.role)) {
    return true;
  }

  return false;
}

export async function getImpersonatableUsers(
  currentUserName: string,
  currentUserRole: string
): Promise<User[]> {
  const allUsers = await getAllUsers();

  if (hasRole(currentUserRole, 'Admin', 'Super Admin', 'superadmin')) {
    const impersonatableUsers = allUsers.filter((u) => u.userName !== currentUserName);
    impersonatableUsers.sort((a, b) => {
      const nameA = a.fullKnownAs || a.firstName;
      const nameB = b.fullKnownAs || b.firstName;
      return nameA.localeCompare(nameB);
    });
    return impersonatableUsers;
  }

  return allUsers.filter((u) => u.buddyUserName === currentUserName);
}
