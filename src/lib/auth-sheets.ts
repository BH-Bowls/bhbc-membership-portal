// src/lib/auth-sheets.ts
// Authentication logic using Google Sheets as database
// All passwords are bcrypt hashes — including temp passwords, which are hashed at
// write time (the legacy XOR and plaintext-temp verification paths were removed
// Jul 2026 once no such passwords remained in the sheet)

import bcrypt from 'bcryptjs';
import { parseRoles } from './role-utils';
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

/**
 * Detect device type from user agent string
 * Returns "Mobile" or "Wide" based on screen size indicators
 */
function detectDeviceType(userAgent: string | undefined): string {
  if (!userAgent) return '';

  const ua = userAgent.toLowerCase();

  // Check for mobile indicators
  if (ua.includes('mobile') ||
      ua.includes('android') ||
      ua.includes('iphone') ||
      ua.includes('ipod') ||
      ua.includes('blackberry') ||
      ua.includes('windows phone')) {
    return 'Mobile';
  }

  // Check for tablet indicators (treat as wide)
  if (ua.includes('ipad') || ua.includes('tablet')) {
    return 'Wide';
  }

  // Default to wide for desktop/laptop
  return 'Wide';
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
 * Verify password against the stored bcrypt hash.
 * bcrypt-only: the legacy XOR and plaintext-temp-password paths were removed once no
 * such passwords remained in the sheet (temp passwords are now bcrypt-hashed at write
 * time). A stored value that is not a bcrypt hash can never verify.
 * @param password Plain text password entered by user
 * @param storedHash The bcrypt hash stored in Google Sheets (starts with $2b$)
 * @returns Promise resolving to true if password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  // Only bcrypt hashes are valid ($2b$ prefix); anything else fails closed
  if (!storedHash || !storedHash.startsWith('$2b$')) {
    return false;
  }
  return bcrypt.compare(password, storedHash);
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
          ipAddress: ipAddress || '',
          userAgent: userAgent || '',
          deviceType: detectDeviceType(userAgent),
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
        ipAddress: ipAddress || '',
        userAgent: userAgent || '',
        deviceType: detectDeviceType(userAgent),
      });

      // Return generic error (don't reveal whether username exists)
      return {
        success: false,
        error: 'Invalid username or password',
      };
    }

    // Verify password against the stored bcrypt hash
    const isValid = await verifyPassword(password, user.passwordHash);

    // Check if password was correct
    if (!isValid) {
      // Wrong password - log failed attempt
      await logLoginAttempt({
        identifier,
        userName: user.userName,
        success: false,
        failureReason: 'Invalid password',
        ipAddress: ipAddress || '',
        userAgent: userAgent || '',
        deviceType: detectDeviceType(userAgent),
      });

      // Record the failed attempt on the member's row (Last Login Failed Date)
      await updateLastLogin(user.userName, false);

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
      ipAddress: ipAddress || '',
      userAgent: userAgent || '',
      deviceType: detectDeviceType(userAgent),
    });

    // Stamp the Last Login Date on the member's row. (This had silently stopped
    // happening — updateLastLogin was imported but never invoked.) It is
    // self-guarded, so a write failure never blocks login.
    await updateLastLogin(user.userName, true);

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
        mustChangePassword: user.isTempPassword, // Force password change if temp
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
    // Strategy 1: Try as exact username first (most specific, fastest).
    // Read FRESH (login path): a just-changed password or newly-added member must be
    // seen even if this serverless instance's cache is stale. This repopulates the
    // cache, so the variant/email lookups below reuse it without another round-trip.
    let user = await getUserByUsername(identifier, true);
    if (user) {
      return user;
    }

    // Strategy 2: Try username with underscores converted to dots
    // Some users might type "john_smith" when their username is "john.smith"
    const usernameVariant = identifier.replace(/_/g, '.');

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

    // bcrypt-hash the temp password before storing — updatePasswordHash writes the
    // value verbatim, so hashing here keeps plaintext out of the sheet. The temp flag
    // still forces a change on next login.
    const tempHash = await hashPassword(tempPassword);
    await updatePasswordHash(user.userName, tempHash, true);

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
  oldPassword?: string,
  isTempPassword: boolean = false
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get user profile from Google Sheets. Read FRESH — we verify the current
    // password against this hash, so it must not be a stale cross-instance copy.
    const user = await getUserByUsername(userName, true);

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
      const isValid = await verifyPassword(oldPassword, user.passwordHash);

      // Check if current password is correct
      if (!isValid) {
        return {
          success: false,
          error: 'Current password is incorrect',
        };
      }
    }

    // Always hash with bcrypt — temp passwords included (the temp flag only controls
    // the forced change on next login, not how the password is stored)
    const newHash = await hashPassword(newPassword);

    // Update password in Google Sheets
    await updatePasswordHash(userName, newHash, isTempPassword);

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
  return parseRoles(user.role).includes('Admin');
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
  if (parseRoles(user.role).includes('Captain')) {
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
  if (parseRoles(user.role).includes('Treasurer')) {
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
  const userRoles = parseRoles(user.role);
  if (allowedRoles.some(r => userRoles.includes(r))) {
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
