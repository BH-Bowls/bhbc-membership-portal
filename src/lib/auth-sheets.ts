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
 * Uses cost factor of 12 for strong security (2^12 = 4096 iterations)
 * Higher cost = more secure but slower (12 is a good balance as of 2024)
 * @param password Plain text password to hash
 * @returns Promise resolving to bcrypt hash string (starts with $2b$)
 */
export async function hashPassword(password: string): Promise<string> {
  // Hash password with bcrypt using cost factor 12
  return bcrypt.hash(password, 12);
}

/**
 * Legacy XOR hash function (from Google Apps Script)
 * DEPRECATED: Only used for backward compatibility during migration to bcrypt
 * XOR hashing is NOT cryptographically secure (easily reversible)
 * Kept temporarily to support existing user passwords until they login and auto-migrate
 * Algorithm: XOR each character code with 1940, convert back to character
 * @param password Plain text password to hash with XOR
 * @returns XOR "hash" string (WARNING: Not secure, migration-only)
 */
function legacyXORHash(password: string): string {
  // Build hash string character by character
  let hash = '';

  // Loop through each character in password
  for (let i = 0; i < password.length; i++) {
    // Get ASCII/Unicode code for this character
    const charCode = password.charCodeAt(i);

    // XOR with magic number 1940 (legacy Google Apps Script implementation)
    const xorCode = charCode ^ 1940;

    // Convert XOR result back to character and append to hash
    hash += String.fromCharCode(xorCode);
  }

  return hash;
}

/**
 * Verify password against stored hash (supports both bcrypt and legacy XOR)
 * Automatically migrates legacy XOR hashes to bcrypt on successful login
 * This allows gradual migration from insecure XOR to secure bcrypt without forcing password resets
 * @param password Plain text password entered by user
 * @param storedHash The hash stored in Google Sheets (bcrypt or legacy XOR)
 * @param userName Username for auto-migration (if needed)
 * @returns Promise resolving to true if password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  userName: string
): Promise<boolean> {
  // Check if it's a bcrypt hash (bcrypt hashes start with $2b$)
  if (storedHash.startsWith('$2b$')) {
    // Modern bcrypt hash - verify using bcrypt
    return bcrypt.compare(password, storedHash);
  }

  // Legacy XOR hash - compute XOR hash and compare
  const legacyHash = legacyXORHash(password);
  const isValid = legacyHash === storedHash;

  // If password is valid with legacy XOR, migrate to bcrypt automatically
  if (isValid) {
    try {
      // Hash password with bcrypt
      const newHash = await hashPassword(password);

      // Update Google Sheets with new bcrypt hash
      // Pass false for isTemporary since this is their real password
      await updatePasswordHash(userName, newHash, false);

      // Log successful migration for monitoring
      console.log(`✓ Migrated ${userName} from XOR to bcrypt`);
    } catch (error) {
      // Log migration failure but don't fail the login
      // User can still login with XOR, we'll try migration again next time
      console.error(`Failed to migrate password for ${userName}:`, error);
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
 * Main authentication entry point called by NextAuth authorize callback
 * Supports flexible login identifiers: username, email, or username with . or _
 * Logs all authentication attempts for security auditing
 * @param identifier Username or email address entered by user
 * @param password Plain text password entered by user
 * @returns Promise with success status, user object if successful, error message if failed
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
    // Rate limiting would check for too many failed attempts from this identifier or IP
    // const rateLimitResult = await checkRateLimit(identifier, '');
    // if (!rateLimitResult.allowed) {
    //   await logLoginAttempt(identifier, null, false, rateLimitResult.reason, '', '');
    //   return {
    //     success: false,
    //     error: 'Too many login attempts. Please try again later.',
    //   };
    // }

    // Find user by flexible identifier (username, email, or username variants)
    // Catch SharedEmailError separately (family members sharing email)
    let user: User | null = null;
    try {
      user = await findUserByIdentifier(identifier);
    } catch (error) {
      // Check if this is a shared email error
      if (error instanceof SharedEmailError) {
        // Log the failed attempt with specific reason
        await logLoginAttempt({
          identifier,
          userName: null,
          success: false,
          failureReason: error.message,
          ipAddress: '',
          userAgent: '',
        });

        // Return error message asking user to login with username instead
        return {
          success: false,
          error: error.message,
        };
      }

      // Re-throw other errors
      throw error;
    }

    // Check if user was found
    if (!user) {
      // User not found - log failed attempt
      await logLoginAttempt({
        identifier,
        userName: null,
        success: false,
        failureReason: 'User not found',
        ipAddress: '',
        userAgent: '',
      });

      // Return generic error (don't reveal whether username exists)
      return {
        success: false,
        error: 'Invalid username or password',
      };
    }

    // Verify password against stored hash (bcrypt or legacy XOR)
    const isValid = await verifyPassword(password, user.passwordHash, user.userName);

    // Check if password was correct
    if (!isValid) {
      // Wrong password - log failed attempt
      await logLoginAttempt({
        identifier,
        userName: user.userName,
        success: false,
        failureReason: 'Invalid password',
        ipAddress: '',
        userAgent: '',
      });

      // Return generic error (don't reveal that username was correct)
      return {
        success: false,
        error: 'Invalid username or password',
      };
    }

    // Authentication successful - log successful attempt
    await logLoginAttempt({
      identifier,
      userName: user.userName,
      success: true,
      failureReason: null,
      ipAddress: '',
      userAgent: '',
    });

    // Use Full Name from sheet (e.g., "Celia Dasey" - uses preferred name + last name)
    let displayName = user.fullName;

    // Build email with fallback to empty string
    let email = user.emailAddress;
    if (!email) {
      email = '';
    }

    // Return success with user object for NextAuth session
    return {
      success: true,
      user: {
        id: user.userName,              // Unique identifier
        name: displayName,               // Display name for UI (from Full Name column)
        email: email,                    // Email address
        userName: user.userName,         // Username for authorization checks
        role: user.role,                 // Role for permission checks
      },
    };
  } catch (error) {
    // Unexpected error during authentication
    console.error('Authentication error:', error);

    // Return generic error message
    return {
      success: false,
      error: 'An unexpected error occurred',
    };
  }
}

/**
 * Find user by flexible identifier (username, email, or username variant)
 * Tries multiple strategies to accommodate different login preferences:
 * 1. Exact username match
 * 2. Username with dots converted to underscores (john.smith → john_smith)
 * 3. Email address lookup (with shared email detection for families)
 * @param identifier Username or email entered by user
 * @returns Promise resolving to User if found, null if not found
 * @throws SharedEmailError if email is shared by multiple family members
 */
export async function findUserByIdentifier(
  identifier: string
): Promise<User | null> {
  try {
    // Strategy 1: Try as exact username first (most specific, fastest)
    let user = await getUserByUsername(identifier);
    if (user) {
      return user;
    }

    // Strategy 2: Try username with dots converted to underscores
    // Some users might type "john.smith" when their username is "john_smith"
    const usernameVariant = identifier.replace(/\./g, '_');

    // Only try variant if it's different from original
    if (usernameVariant !== identifier) {
      user = await getUserByUsername(usernameVariant);
      if (user) {
        return user;
      }
    }

    // Strategy 3: Try as email address
    // Get all users with this email (may be multiple for families)
    const usersByEmail = await getUsersByEmail(identifier);

    // Check how many users have this email
    if (usersByEmail.length === 0) {
      // No users found with this email
      return null;
    }

    if (usersByEmail.length === 1) {
      // Email is unique - safe to login with email
      return usersByEmail[0];
    }

    // CRITICAL: Email is shared by multiple users (family memberships)
    // Throw special error to inform user they must use username instead
    throw new SharedEmailError(
      `This email is shared by ${usersByEmail.length} family members. Please login with your username instead.`
    );

  } catch (error) {
    // Re-throw SharedEmailError so caller can handle it specially
    if (error instanceof SharedEmailError) {
      throw error;
    }

    // Log other errors
    console.error('Error finding user:', error);
    return null;
  }
}

// ============================================================================
// PASSWORD RESET
// ============================================================================

/**
 * Generate temporary password for forgot password flow
 * Creates a 4-digit numeric password (1000-9999)
 * Simple format makes it easy to type on phone when reading from email
 * User will be forced to change this on first login
 * @returns String containing 4-digit temporary password
 */
export function generateTempPassword(): string {
  // Generate random number between 1000 and 9999 (inclusive)
  // Math.random() gives 0.0-1.0, multiply by 9000 gives 0-9000
  // Add 1000 to shift range to 1000-9999
  const randomNumber = Math.floor(1000 + Math.random() * 9000);

  // Convert number to string for password
  return randomNumber.toString();
}

/**
 * Set temporary password for user (forgot password flow)
 * Generates 4-digit temporary password and updates Google Sheets
 * Password is marked as temporary - user must change on next login
 * Returns temp password and email so caller can send password reset email
 * @param identifier Username or email entered by user on forgot password form
 * @returns Promise with success status, temp password, and email if successful
 */
export async function setTemporaryPassword(
  identifier: string
): Promise<{ success: boolean; tempPassword?: string; email?: string; error?: string }> {
  try {
    // Find user by flexible identifier
    const user = await findUserByIdentifier(identifier);

    // Check if user exists
    if (!user) {
      return {
        success: false,
        error: 'User not found',
      };
    }

    // Check if user has email address on file
    if (!user.emailAddress) {
      // Cannot send reset email without email address
      return {
        success: false,
        error: 'No email address on file. Please contact an administrator.',
      };
    }

    // Generate 4-digit temporary password
    const tempPassword = generateTempPassword();

    // Update password in Google Sheets
    // Pass true for isTemporary flag - user must change on next login
    // updatePasswordHash will handle bcrypt hashing
    await updatePasswordHash(user.userName, tempPassword, true);

    // Return success with temp password and email
    // Caller will send email with temp password to user
    return {
      success: true,
      tempPassword,              // Temp password to send in email
      email: user.emailAddress,  // Email address to send to
    };
  } catch (error) {
    // Log error for debugging
    console.error('Error setting temporary password:', error);

    // Return generic error message
    return {
      success: false,
      error: 'Failed to reset password. Please try again.',
    };
  }
}

/**
 * Change password for user
 * Used for both self-service password changes and password reset flows
 * If oldPassword provided, verifies it first (for security)
 * If oldPassword not provided, allows change without verification (admin/reset flow)
 * @param userName Username of user changing password
 * @param newPassword New password to set (will be bcrypt hashed)
 * @param oldPassword Optional current password (required for self-service changes)
 * @returns Promise with success status and error message if failed
 */
export async function changePassword(
  userName: string,
  newPassword: string,
  oldPassword?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get user profile from Google Sheets
    const user = await getUserByUsername(userName);

    // Check if user exists
    if (!user) {
      return {
        success: false,
        error: 'User not found',
      };
    }

    // If oldPassword provided, verify it first (security check)
    // This prevents unauthorized password changes if session is hijacked
    if (oldPassword) {
      const isValid = await verifyPassword(oldPassword, user.passwordHash, userName);

      // Check if current password is correct
      if (!isValid) {
        return {
          success: false,
          error: 'Current password is incorrect',
        };
      }
    }

    // Hash new password with bcrypt
    const newHash = await hashPassword(newPassword);

    // Update password in Google Sheets
    // Pass false for isTemporary - this is their permanent password now
    await updatePasswordHash(userName, newHash, false);

    // Password changed successfully
    return { success: true };
  } catch (error) {
    // Log error for debugging
    console.error('Error changing password:', error);

    // Return generic error message
    return {
      success: false,
      error: 'Failed to change password. Please try again.',
    };
  }
}

// ============================================================================
// ROLE CHECKS
// ============================================================================

/**
 * Check if user has Admin role
 * Admins have full system access and bypass all permission checks
 * @param user User object from session
 * @returns true if user is Admin, false otherwise
 */
export function isAdmin(user: User): boolean {
  return user.role === 'Admin';
}

/**
 * Check if user has Captain role or higher
 * Captains can manage friendlies team selection
 * Admins are also considered Captains (role hierarchy)
 * @param user User object from session
 * @returns true if user is Captain or Admin, false otherwise
 */
export function isCaptain(user: User): boolean {
  // Check if user is Captain
  if (user.role === 'Captain') {
    return true;
  }

  // Admins have all permissions including Captain
  if (isAdmin(user)) {
    return true;
  }

  return false;
}

/**
 * Check if user has Treasurer role or higher
 * Treasurers can manage banking and financial operations
 * Admins are also considered Treasurers (role hierarchy)
 * @param user User object from session
 * @returns true if user is Treasurer or Admin, false otherwise
 */
export function isTreasurer(user: User): boolean {
  // Check if user is Treasurer
  if (user.role === 'Treasurer') {
    return true;
  }

  // Admins have all permissions including Treasurer
  if (isAdmin(user)) {
    return true;
  }

  return false;
}

/**
 * Check if user has any of the specified roles or is Admin
 * Generic role checker for flexible permission checks
 * Admins always pass this check regardless of allowedRoles
 * @param user User object from session
 * @param allowedRoles Array of role names that should be granted access
 * @returns true if user has one of the allowed roles or is Admin, false otherwise
 */
export function hasRole(user: User, allowedRoles: string[]): boolean {
  // Check if user's role is in the allowed list
  let hasAllowedRole = false;
  for (const role of allowedRoles) {
    if (user.role === role) {
      hasAllowedRole = true;
      break;
    }
  }

  if (hasAllowedRole) {
    return true;
  }

  // Admins bypass all role checks
  if (isAdmin(user)) {
    return true;
  }

  return false;
}

// ============================================================================
// RATE LIMITING (Currently Disabled)
// ============================================================================

/**
 * Check if login attempt should be rate limited
 * CURRENTLY DISABLED in authenticateUser() - kept for future use
 * Prevents brute force attacks by limiting failed login attempts
 * Two-tier approach: per-account limit (5) and per-IP limit (10)
 * @param identifier Username or email being attempted
 * @param ipAddress IP address of login attempt
 * @returns Promise with allowed status and reason if blocked
 */
export async function checkRateLimit(
  identifier: string,
  ipAddress: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    // Get count of recent failed attempts (last 15 minutes)
    // Function handles time window filtering internally
    const recentAttempts = await getRecentFailedAttempts(identifier, ipAddress);

    // Check identifier-based rate limit (5 attempts per 15 minutes)
    // Prevents targeted attacks on specific accounts
    if (recentAttempts.byIdentifier >= 5) {
      return {
        allowed: false,
        reason: 'Too many failed attempts for this account',
      };
    }

    // Check IP-based rate limit (10 attempts per 15 minutes)
    // Prevents distributed attacks from single IP
    if (ipAddress) {
      if (recentAttempts.byIp >= 10) {
        return {
          allowed: false,
          reason: 'Too many failed attempts from this IP',
        };
      }
    }

    // No rate limit hit - allow attempt
    return { allowed: true };
  } catch (error) {
    // Log error for monitoring
    console.error('Rate limit check error:', error);

    // On error, allow the attempt (fail open for availability)
    // Better to allow one potential attack than lock out legitimate users
    return { allowed: true };
  }
}
