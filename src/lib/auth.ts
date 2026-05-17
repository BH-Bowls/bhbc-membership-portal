// src/lib/auth.ts
// NextAuth configuration for BHBC Members Portal
// Handles user authentication, JWT token generation, and session management
// Uses credentials provider to authenticate against Google Sheets database

import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { authenticateUser } from './auth-sheets';
import { clearColumnMapCache } from './sheets';
import { authenticateClub } from './clubs-sheets';
import { parseRoles } from './role-utils';

/**
 * NextAuth configuration object
 * Defines authentication providers, session strategy, and security settings
 * Session expires after 30 days of inactivity OR 90 days absolute (whichever comes first)
 */
export const authOptions: NextAuthOptions = {
  // Authentication providers configuration
  providers: [
    // Credentials provider: username/email + password authentication
    CredentialsProvider({
      name: 'Credentials',

      // Login form field definitions
      credentials: {
        identifier: { label: 'Username or Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },

      /**
       * Authorize function: validates credentials and returns user object
       * Called when user submits login form
       * @param credentials User-submitted login data
       * @returns User object if authentication successful, null otherwise
       * @throws Error with message to display to user if authentication fails
       */
      async authorize(credentials, req) {
        // Clear column map cache at start of login to ensure fresh column positions
        // This ensures any Google Sheets column changes are picked up immediately
        clearColumnMapCache();

        // Validate that both fields were provided
        if (!credentials) {
          throw new Error('Please enter your username and password');
        }

        if (!credentials.identifier) {
          throw new Error('Please enter your username and password');
        }

        if (!credentials.password) {
          throw new Error('Please enter your username and password');
        }

        // Extract IP address and user agent from request
        const ipAddress = req?.headers?.['x-forwarded-for'] as string ||
                         req?.headers?.['x-real-ip'] as string ||
                         req?.body?.headers?.['x-forwarded-for'] ||
                         '';
        const userAgent = req?.headers?.['user-agent'] as string ||
                         req?.body?.headers?.['user-agent'] ||
                         '';

        // Authenticate against Google Sheets database
        const result = await authenticateUser(
          credentials.identifier,
          credentials.password,
          ipAddress,
          userAgent
        );

        // Check if member authentication succeeded
        if (result.success && result.user) {
          return result.user;
        }

        // Member auth failed — try club login
        const clubResult = await authenticateClub(credentials.identifier, credentials.password);
        if (clubResult.success && clubResult.club) {
          return {
            id: clubResult.club.clubId,
            userName: clubResult.club.clubId,
            name: clubResult.club.clubName,
            email: '',
            role: 'Club',
            clubId: clubResult.club.clubId,
            mustChangePassword: clubResult.club.mustChangePassword,
          };
        }

        // Both failed — throw the member auth error (more informative)
        throw new Error(result.error || 'Invalid username or password');
      },
    }),
  ],
  
  // NextAuth callbacks for customizing JWT and session behavior
  callbacks: {
    /**
     * JWT callback: runs when JWT token is created or updated
     * Adds custom user fields to the token for later retrieval
     * Called on every request to validate and refresh the token
     * Also handles impersonation state changes via trigger='update'
     * @param token The existing JWT token
     * @param user The user object (only present on initial sign-in)
     * @param trigger Reason for callback (signin, update, etc.)
     * @param session Session data passed during update() calls
     * @returns Updated token with custom fields
     */
    async jwt({ token, user, trigger, session }) {
      // Check if this is initial sign-in (user object is only present then)
      if (user) {
        // Add custom user fields to JWT token
        // These will be available in the session callback
        token.userName = user.userName;
        token.role = user.role;
        token.roles = parseRoles(user.role);
        token.name = user.name;
        token.email = user.email;
        token.clubId = user.clubId; // set for Club role, undefined otherwise
        token.mustChangePassword = user.mustChangePassword ?? false;

        // Store login time for absolute expiration check
        // Used to enforce 90-day maximum session duration
        token.loginTime = Date.now();

        // Initialize impersonation fields (not impersonating at login)
        token.isImpersonating = false;
        token.originalAdmin = undefined;
        token.impersonationStartTime = undefined;
        token.impersonationSessionId = undefined;
      }

      // Handle session updates triggered by API endpoints
      if (trigger === 'update' && session) {
        // Refresh user data from database (for role changes, etc.)
        if (session.action === 'REFRESH_USER_DATA' && session.userData) {
          token.role = session.userData.role;
          token.roles = parseRoles(session.userData.role);
          token.name = session.userData.name;
          token.email = session.userData.email;
          if ('mustChangePassword' in session.userData) {
            token.mustChangePassword = session.userData.mustChangePassword;
          }
        }

        // Start impersonation
        if (session.action === 'START_IMPERSONATION') {
          // Store original admin info before switching
          token.originalAdmin = {
            userName: token.userName as string,
            email: token.email as string,
            name: token.name as string,
            role: token.role as string,
            roles: (token.roles as string[]) ?? parseRoles(token.role as string),
          };

          // Switch to impersonated user
          token.userName = session.targetUser.userName;
          token.email = session.targetUser.email;
          token.name = session.targetUser.name;
          token.role = session.targetUser.role;
          token.roles = parseRoles(session.targetUser.role);
          token.clubId = session.targetUser.clubId ?? undefined;
          token.mustChangePassword = session.targetUser.mustChangePassword ?? false;
          token.isImpersonating = true;
          token.impersonationStartTime = Date.now();
          token.impersonationSessionId = session.sessionId;
        }

        // Stop impersonation
        if (session.action === 'STOP_IMPERSONATION') {
          // Restore original admin info
          if (token.originalAdmin) {
            token.userName = token.originalAdmin.userName;
            token.email = token.originalAdmin.email;
            token.name = token.originalAdmin.name;
            token.role = token.originalAdmin.role;
            token.roles = parseRoles(token.originalAdmin.role);
          }

          // Clear impersonation fields
          token.isImpersonating = false;
          token.originalAdmin = undefined;
          token.impersonationStartTime = undefined;
          token.impersonationSessionId = undefined;
          token.clubId = undefined;
          token.mustChangePassword = false; // admins never have temp passwords
        }
      }

      return token;
    },

    /**
     * Session callback: runs on every request to check/update session
     * Enforces absolute 90-day session expiration (regardless of activity)
     * Adds custom user fields from JWT token to session object
     * @param session The session object sent to client
     * @param token The JWT token containing user data
     * @returns Updated session with custom fields
     * @throws Error if session is invalid or has exceeded 90-day absolute limit
     */
    async session({ session, token }) {
      // If token is missing required fields, it's invalid (e.g., decryption failed)
      // Throw error to invalidate the session. Role can legitimately be empty (= regular member).
      if (!token.userName) {
        throw new Error('Invalid session token');
      }

      // Calculate absolute expiration time (90 days from login)
      const threeMonthsInMs = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds
      const loginTime = token.loginTime as number;

      // Invalidate kiosk sessions created before 2026-05-18 (unauthorised access via removed guest link)
      if (token.userName === 'clubhouse' && loginTime && loginTime < 1779062400000) {
        throw new Error('Session expired');
      }

      // Check if session has exceeded absolute expiration
      if (loginTime) {
        const currentTime = Date.now();
        const timeSinceLogin = currentTime - loginTime;

        if (timeSinceLogin > threeMonthsInMs) {
          // Session has exceeded 3 months - force logout
          // This prevents indefinite sessions even with continued activity
          throw new Error('Session expired');
        }
      }

      // Add custom fields from JWT token to session object
      // Session object is what client-side code can access
      if (session.user) {
        session.user.userName = token.userName as string;
        session.user.role = (token.role as string) ?? '';
        session.user.roles = (token.roles as string[]) ?? parseRoles(token.role as string);
        session.user.name = token.name as string;
        session.user.email = token.email as string;
        session.user.clubId = token.clubId as string | undefined;
        session.user.mustChangePassword = (token.mustChangePassword as boolean | undefined) ?? false;

        // Add impersonation fields to session
        session.user.isImpersonating = token.isImpersonating || false;
        if (token.originalAdmin) {
          session.user.originalAdmin = token.originalAdmin;
        }
      }

      return session;
    },
  },
  
  // Custom page URLs for authentication flows
  pages: {
    signIn: '/login',  // Redirect to /login for sign-in
    error: '/login',   // Redirect errors to /login page (shows error message)
  },

  // Session configuration
  session: {
    strategy: 'jwt',  // Use JWT tokens (stored client-side) instead of database sessions
    maxAge: 30 * 24 * 60 * 60,  // Session expires after 30 days of inactivity (in seconds)
    // Note: Absolute 90-day expiration is enforced in session callback above
  },

  // Secret key for signing JWT tokens (MUST be set in environment variables)
  secret: process.env.NEXTAUTH_SECRET,
};
