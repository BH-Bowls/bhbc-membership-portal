// src/lib/auth-supabase.ts
// Authentication logic using Postgres (via members-supabase.ts) instead of Google Sheets.
// Mirrors auth-sheets.ts exactly for the functions that touch the data layer
// (findUserByIdentifier, authenticateUser, changePassword, setTemporaryPassword).
// Pure, database-agnostic functions (hashPassword, verifyPassword, generateTempPassword,
// isAdmin/isCaptain/isTreasurer/hasRole) are re-exported from auth-sheets.ts rather than
// duplicated — they don't depend on the data source at all, only on an already-fetched
// User object or nothing.
//
// NOT YET WIRED IN: auth.ts still imports authenticateUser from ./auth-sheets. This file
// exists and is verified standalone but deliberately not connected to the live login path
// yet — that's a separate, explicit step given the stakes (see
// specs/Phase_0_1_Migration_Plan.md's Cutover Procedure: real login testing before ever
// flipping this switch).

import { parseRoles } from './role-utils';
import { isMaintenanceModeOn } from './maintenance';
import {
  getUserByUsername,
  getUsersByEmail,
  updatePasswordHash,
  updateLastLogin,
  logLoginAttempt,
  getRecentFailedAttempts,
} from './members-supabase';
import type { User } from './sheets';

export {
  hashPassword,
  verifyPassword,
  generateTempPassword,
  isAdmin,
  isCaptain,
  isTreasurer,
  hasRole,
  checkRateLimit,
} from './auth-sheets';
import { hashPassword, verifyPassword } from './auth-sheets';

export class SharedEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedEmailError';
  }
}

function detectDeviceType(userAgent: string | undefined): string {
  if (!userAgent) return '';
  const ua = userAgent.toLowerCase();
  if (
    ua.includes('mobile') || ua.includes('android') || ua.includes('iphone') ||
    ua.includes('ipod') || ua.includes('blackberry') || ua.includes('windows phone')
  ) {
    return 'Mobile';
  }
  if (ua.includes('ipad') || ua.includes('tablet')) return 'Wide';
  return 'Wide';
}

export async function authenticateUser(
  identifier: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{
  success: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    userName: string;
    role: string;
    mustChangePassword: boolean;
  };
  error?: string;
}> {
  try {
    let user: User | null = null;
    try {
      user = await findUserByIdentifier(identifier);
    } catch (error) {
      if (error instanceof SharedEmailError) {
        await logLoginAttempt({
          identifier,
          userName: null,
          success: false,
          failureReason: error.message,
          ipAddress: ipAddress || '',
          userAgent: userAgent || '',
          deviceType: detectDeviceType(userAgent),
        });
        return { success: false, error: error.message };
      }
      throw error;
    }

    // Maintenance mode: same gate as auth-sheets.ts — non-Admin logins blocked outright
    // while the flag is set, even with fully correct credentials.
    if (await isMaintenanceModeOn()) {
      const isUserAdmin = user ? parseRoles(user.role).includes('Admin') : false;
      if (!isUserAdmin) {
        return {
          success: false,
          error: 'The portal is temporarily down for maintenance. Please check back later.',
        };
      }
    }

    if (!user) {
      await logLoginAttempt({
        identifier,
        userName: null,
        success: false,
        failureReason: 'User not found',
        ipAddress: ipAddress || '',
        userAgent: userAgent || '',
        deviceType: detectDeviceType(userAgent),
      });
      return { success: false, error: 'Invalid username or password' };
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      await logLoginAttempt({
        identifier,
        userName: user.userName,
        success: false,
        failureReason: 'Invalid password',
        ipAddress: ipAddress || '',
        userAgent: userAgent || '',
        deviceType: detectDeviceType(userAgent),
      });
      await updateLastLogin(user.userName, false);
      return { success: false, error: 'Invalid username or password' };
    }

    await logLoginAttempt({
      identifier,
      userName: user.userName,
      success: true,
      failureReason: null,
      ipAddress: ipAddress || '',
      userAgent: userAgent || '',
      deviceType: detectDeviceType(userAgent),
    });
    await updateLastLogin(user.userName, true);

    const displayName = user.fullName;
    const email = user.emailAddress || '';

    return {
      success: true,
      user: {
        id: user.userName,
        name: displayName,
        email,
        userName: user.userName,
        role: user.role,
        mustChangePassword: user.isTempPassword,
      },
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

export async function findUserByIdentifier(identifier: string): Promise<User | null> {
  try {
    // Read FRESH (login path) — see members-supabase.ts's forceFresh contract.
    let user = await getUserByUsername(identifier, true);
    if (user) return user;

    const usernameVariant = identifier.replace(/_/g, '.');
    if (usernameVariant !== identifier) {
      user = await getUserByUsername(usernameVariant);
      if (user) return user;
    }

    const usersByEmail = await getUsersByEmail(identifier);
    if (usersByEmail.length === 0) return null;
    if (usersByEmail.length === 1) return usersByEmail[0];

    throw new SharedEmailError(
      'This email is linked to more than one account. Please log in with your username instead.'
    );
  } catch (error) {
    if (error instanceof SharedEmailError) throw error;
    console.error('Error finding user:', error);
    return null;
  }
}

export async function setTemporaryPassword(
  identifier: string
): Promise<{ success: boolean; tempPassword?: string; email?: string; error?: string }> {
  try {
    const user = await findUserByIdentifier(identifier);
    if (!user) return { success: false, error: 'User not found' };
    if (!user.emailAddress) {
      return { success: false, error: 'No email address on file. Please contact an administrator.' };
    }

    const { generateTempPassword } = await import('./auth-sheets');
    const tempPassword = generateTempPassword();
    const tempHash = await hashPassword(tempPassword);
    await updatePasswordHash(user.userName, tempHash, true);

    return { success: true, tempPassword, email: user.emailAddress };
  } catch (error) {
    console.error('Error setting temporary password:', error);
    return { success: false, error: 'Failed to reset password. Please try again.' };
  }
}

export async function changePassword(
  userName: string,
  newPassword: string,
  oldPassword?: string,
  isTempPassword: boolean = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUserByUsername(userName, true);
    if (!user) return { success: false, error: 'User not found' };

    if (oldPassword) {
      const isValid = await verifyPassword(oldPassword, user.passwordHash);
      if (!isValid) return { success: false, error: 'Current password is incorrect' };
    }

    const newHash = await hashPassword(newPassword);
    await updatePasswordHash(userName, newHash, isTempPassword);
    return { success: true };
  } catch (error) {
    console.error('Error changing password:', error);
    return { success: false, error: 'Failed to change password. Please try again.' };
  }
}
