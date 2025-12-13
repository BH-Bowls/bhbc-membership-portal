// src/lib/auth-sheets.ts
// Authentication logic using Google Sheets as database
// Supports both legacy XOR hashes and bcrypt for gradual migration

import bcrypt from 'bcryptjs';
import {
  getUserByUsername,
  getUsersByEmail,
  updatePasswordHash,
  updateLastLogin,
  logLoginAttempt,
  getRecentFailedAttempts,
  type User,
} from './sheets';

// Add this at the top of the file, after imports
export class SharedEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedEmailError';
  }
}

// ============================================================================
// PASSWORD HASHING
// ============================================================================

/**
 * Hash password with bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/**
 * Legacy XOR hash function (from Google Apps Script)
 * Used for backward compatibility during migration
 */
function legacyXORHash(password: string): string {
  let hash = '';
  for (let i = 0; i < password.length; i++) {
    const charCode = password.charCodeAt(i);
    const xorCode = charCode ^ 1940;
    hash += String.fromCharCode(xorCode);
  }
  return hash;
}

/**
 * Verify password against hash (supports both bcrypt and legacy XOR)
 * Automatically migrates legacy hashes to bcrypt on successful login
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  userName: string
): Promise<boolean> {
  // Check if it's a bcrypt hash (starts with $2b$)
  if (storedHash.startsWith('$2b$')) {
    return bcrypt.compare(password, storedHash);
  }
  
  // Legacy XOR hash
  const legacyHash = legacyXORHash(password);
  const isValid = legacyHash === storedHash;
  
  // If valid, migrate to bcrypt
  if (isValid) {
    try {
      const newHash = await hashPassword(password);
      await updatePasswordHash(userName, newHash, false);
      console.log(`✓ Migrated ${userName} from XOR to bcrypt`);
    } catch (error) {
      console.error(`Failed to migrate password for ${userName}:`, error);
      // Don't fail the login if migration fails
    }
  }
  
  return isValid;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

/**
 * Authenticate user with username/email and password
 * Supports flexible login: username, email, or username with . or _
 */
export async function authenticateUser(
  identifier: string,
  password: string
): Promise<{
  success: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    userName: string;
    role: string;
  };
  error?: string;
}> {
  try {
    // TEMPORARILY SKIP RATE LIMITING - we'll add it back later
    // const rateLimitResult = await checkRateLimit(identifier, '');
    // if (!rateLimitResult.allowed) {
    //   await logLoginAttempt(identifier, null, false, rateLimitResult.reason, '', '');
    //   return {
    //     success: false,
    //     error: 'Too many login attempts. Please try again later.',
    //   };
    // }

    // Find user - catch SharedEmailError
    let user: User | null = null;
    try {
      user = await findUserByIdentifier(identifier);
    } catch (error) {
      if (error instanceof SharedEmailError) {
        // Log the attempt
        await logLoginAttempt({
          identifier,
          userName: null,
          success: false,
          failureReason: error.message,
          ipAddress: '',
          userAgent: '',
        });
        return {
          success: false,
          error: error.message,
        };
      }
      throw error;
    }

    if (!user) {
      await logLoginAttempt({
        identifier,
        userName: null,
        success: false,
        failureReason: 'User not found',
        ipAddress: '',
        userAgent: '',
      });
      return {
        success: false,
        error: 'Invalid username or password',
      };
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash, user.userName);
    
    if (!isValid) {
      await logLoginAttempt({
        identifier,
        userName: user.userName,
        success: false,
        failureReason: 'Invalid password',
        ipAddress: '',
        userAgent: '',
      });
      return {
        success: false,
        error: 'Invalid username or password',
      };
    }

    // Success
    await logLoginAttempt({
      identifier,
      userName: user.userName,
      success: true,
      failureReason: null,
      ipAddress: '',
      userAgent: '',
    });

    return {
      success: true,
      user: {
        id: user.userName,
        name: user.fullKnownAs || `${user.firstName} ${user.lastName}`,
        email: user.emailAddress || '',
        userName: user.userName,
        role: user.role,
      },
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return {
      success: false,
      error: 'An unexpected error occurred',
    };
  }
}

/**
 * Find user by flexible identifier
 * Tries: exact username, email, username with . or _ substitution
 */
export async function findUserByIdentifier(
  identifier: string
): Promise<User | null> {
  try {
    // Try as username first (most specific)
    let user = await getUserByUsername(identifier);
    if (user) return user;

    // Try username with dots converted to underscores
    const usernameVariant = identifier.replace(/\./g, '_');
    if (usernameVariant !== identifier) {
      user = await getUserByUsername(usernameVariant);
      if (user) return user;
    }

    // Try as email - BUT check if email is shared
    const usersByEmail = await getUsersByEmail(identifier);
    
    if (usersByEmail.length === 0) {
      return null;
    }
    
    if (usersByEmail.length === 1) {
      // Email is unique - safe to login
      return usersByEmail[0];
    }
    
    // CRITICAL: Email is shared by multiple users
    throw new SharedEmailError(
      `This email is shared by ${usersByEmail.length} family members. Please login with your username instead.`
    );

  } catch (error) {
    // Re-throw SharedEmailError
    if (error instanceof SharedEmailError) {
      throw error;
    }
    console.error('Error finding user:', error);
    return null;
  }
}

// ============================================================================
// PASSWORD RESET
// ============================================================================

/**
 * Generate temporary password (4 random digits)
 */
export function generateTempPassword(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Set temporary password for user (for forgot password flow)
 */
export async function setTemporaryPassword(
  identifier: string
): Promise<{ success: boolean; tempPassword?: string; email?: string; error?: string }> {
  try {
    const user = await findUserByIdentifier(identifier);
    
    if (!user) {
      return {
        success: false,
        error: 'User not found',
      };
    }
    
    if (!user.emailAddress) {
      return {
        success: false,
        error: 'No email address on file. Please contact an administrator.',
      };
    }
    
    const tempPassword = generateTempPassword();
    
    // Store as plain text (will be hashed by updatePasswordHash but marked as temp)
    // When they log in, they'll be forced to change it
    await updatePasswordHash(user.userName, tempPassword, true);
    
    return {
      success: true,
      tempPassword,
      email: user.emailAddress,
    };
  } catch (error) {
    console.error('Error setting temporary password:', error);
    return {
      success: false,
      error: 'Failed to reset password. Please try again.',
    };
  }
}

/**
 * Change password (for logged-in users or password reset flow)
 */
export async function changePassword(
  userName: string,
  newPassword: string,
  oldPassword?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUserByUsername(userName);
    
    if (!user) {
      return {
        success: false,
        error: 'User not found',
      };
    }
    
    // If oldPassword provided, verify it
    if (oldPassword) {
      const isValid = await verifyPassword(oldPassword, user.passwordHash, userName);
      if (!isValid) {
        return {
          success: false,
          error: 'Current password is incorrect',
        };
      }
    }
    
    // Hash and update new password
    const newHash = await hashPassword(newPassword);
    await updatePasswordHash(userName, newHash, false);
    
    return { success: true };
  } catch (error) {
    console.error('Error changing password:', error);
    return {
      success: false,
      error: 'Failed to change password. Please try again.',
    };
  }
}

// ============================================================================
// ROLE CHECKS
// ============================================================================

export function isAdmin(user: User): boolean {
  return user.role === 'Admin';
}

export function isCaptain(user: User): boolean {
  return user.role === 'Captain' || isAdmin(user);
}

export function isTreasurer(user: User): boolean {
  return user.role === 'Treasurer' || isAdmin(user);
}

export function hasRole(user: User, allowedRoles: string[]): boolean {
  return allowedRoles.includes(user.role) || isAdmin(user);
}

// Add these functions to auth-sheets.ts

export async function checkRateLimit(
  identifier: string,
  ipAddress: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    // Get recent failed attempts (function handles time window internally)
    const recentAttempts = await getRecentFailedAttempts(identifier, ipAddress);

    // Check identifier-based rate limit (5 attempts per 15 minutes)
    if (recentAttempts.byIdentifier >= 5) {
      return {
        allowed: false,
        reason: 'Too many failed attempts for this account',
      };
    }

    // Check IP-based rate limit (10 attempts per 15 minutes)
    if (ipAddress && recentAttempts.byIp >= 10) {
      return {
        allowed: false,
        reason: 'Too many failed attempts from this IP',
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Rate limit check error:', error);
    // On error, allow the attempt
    return { allowed: true };
  }
}
