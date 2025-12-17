// src/lib/auth.ts
// NextAuth configuration for BHBC Members Portal

import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { authenticateUser } from './auth-sheets';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        identifier: { label: 'Username or Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.identifier || !credentials?.password) {
          throw new Error('Please enter your username and password');
        }

        const result = await authenticateUser(
          credentials.identifier,
          credentials.password
        );

        if (!result.success) {
          // Throw error with the specific message from authenticateUser
          throw new Error(result.error || 'Authentication failed');
        }

        return result.user || null;
      },
    }),
  ],
  
  callbacks: {
    async jwt({ token, user }) {
      // Add custom fields to JWT token
      if (user) {
        token.userName = user.userName;
        token.role = user.role;
        token.name = user.name;
        token.email = user.email;
        // Store login time for absolute expiration check
        token.loginTime = Date.now();
      }
      return token;
    },

    async session({ session, token }) {
      // Check absolute expiration (3 months from login)
      const threeMonthsInMs = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds
      const loginTime = token.loginTime as number;

      if (loginTime && Date.now() - loginTime > threeMonthsInMs) {
        // Session has exceeded 3 months - force logout
        throw new Error('Session expired');
      }

      // Add custom fields to session
      if (session.user) {
        session.user.userName = token.userName as string;
        session.user.role = token.role as string;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
  
  pages: {
    signIn: '/login',
    error: '/login',
  },
  
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  
  secret: process.env.NEXTAUTH_SECRET,
};
