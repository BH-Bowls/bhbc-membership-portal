// src/lib/auth.ts
// NextAuth configuration for BHBC Members Portal
// Handles user authentication, JWT token generation, and session management
// Uses credentials provider to authenticate against Google Sheets database

import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { authenticateUser } from './auth-sheets';

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

        // Authenticate against Google Sheets database
        const result = await authenticateUser(
          credentials.identifier,
          credentials.password
        );

        // Check if authentication succeeded
        if (!result.success) {
          // Get error message from authentication result
          let errorMessage = result.error;
          if (!errorMessage) {
            errorMessage = 'Authentication failed';
          }

          // Throw error with the specific message from authenticateUser
          throw new Error(errorMessage);
        }

        // Return user object for successful authentication
        // If user is null, return null to indicate failure
        if (result.user) {
          return result.user;
        } else {
          return null;
        }
      },
    }),
  ],
  
  // NextAuth callbacks for customizing JWT and session behavior
  callbacks: {
    /**
     * JWT callback: runs when JWT token is created or updated
     * Adds custom user fields to the token for later retrieval
     * Called on every request to validate and refresh the token
     * @param token The existing JWT token
     * @param user The user object (only present on initial sign-in)
     * @returns Updated token with custom fields
     */
    async jwt({ token, user }) {
      // Check if this is initial sign-in (user object is only present then)
      if (user) {
        // Add custom user fields to JWT token
        // These will be available in the session callback
        token.userName = user.userName;
        token.role = user.role;
        token.name = user.name;
        token.email = user.email;

        // Store login time for absolute expiration check
        // Used to enforce 90-day maximum session duration
        token.loginTime = Date.now();
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
     * @throws Error if session has exceeded 90-day absolute limit
     */
    async session({ session, token }) {
      // Calculate absolute expiration time (90 days from login)
      const threeMonthsInMs = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds
      const loginTime = token.loginTime as number;

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
        session.user.role = token.role as string;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
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
