// middleware.ts
// NextAuth middleware for route protection and role-based access control
// Runs on every request to protected pages before they are rendered
// Redirects unauthenticated users to login page
// Enforces role-based permissions (e.g., Captain-only routes)

import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

/**
 * Middleware function that runs on every protected route
 * Handles authentication checks and role-based authorization
 * Integrated with NextAuth for automatic session validation
 */
export default withAuth(
  /**
   * Custom middleware logic for role-based access control
   * Called after NextAuth verifies user is authenticated
   * @param req Request object with NextAuth token attached
   * @returns NextResponse to continue or redirect
   */
  function middleware(req) {
    // Get authentication token from NextAuth
    const token = req.nextauth.token;

    // Get current URL pathname
    const pathname = req.nextUrl.pathname;

    // Protect /friendlies/manage routes - Captain or Admin only
    // These routes allow team selection and game management
    if (pathname.startsWith('/friendlies/manage')) {
      // Check if user is authenticated
      if (!token) {
        // Not authenticated - redirect to friendlies home
        return NextResponse.redirect(new URL('/friendlies', req.url));
      }

      // Check if user has Captain or Admin role
      const userRole = token.role as string;
      let hasRequiredRole = false;

      // Check if user is Captain
      if (userRole === 'Captain') {
        hasRequiredRole = true;
      }

      // Check if user is Admin
      if (userRole === 'Admin') {
        hasRequiredRole = true;
      }

      // If user doesn't have required role, redirect to friendlies home
      if (!hasRequiredRole) {
        return NextResponse.redirect(new URL('/friendlies', req.url));
      }
    }

    // Protect /admin/emails routes - Admin only
    // These routes allow sending bulk emails to members
    if (pathname.startsWith('/admin/emails')) {
      // Check if user is authenticated
      if (!token) {
        // Not authenticated - redirect to home page
        return NextResponse.redirect(new URL('/', req.url));
      }

      // Check if user has Admin role
      const userRole = token.role as string;

      // Only allow Admin role to access admin email routes
      if (userRole !== 'Admin') {
        // Not an admin - redirect to home page
        return NextResponse.redirect(new URL('/', req.url));
      }
    }

    // No special handling needed - allow request to continue
    return NextResponse.next();
  },
  {
    // NextAuth middleware configuration
    callbacks: {
      /**
       * Authorized callback - determines if user can access protected routes
       * Called before custom middleware function above
       * @param token User's JWT token (null if not authenticated)
       * @returns true to allow access, false to redirect to login
       */
      authorized: ({ token }) => {
        // Check if token exists (user is authenticated)
        if (token) {
          return true;
        } else {
          return false;
        }
      },
    },

    // Custom page URLs for authentication
    pages: {
      signIn: '/login',  // Redirect unauthenticated users to /login
    },
  }
);

/**
 * Matcher configuration - defines which routes this middleware runs on
 * Uses negative lookahead regex to exclude public routes
 * Excluded routes:
 * - /api/auth/* - NextAuth API endpoints
 * - /login - Login page itself
 * - /forgot-password - Password reset request page
 * - /reset-password - Password reset form page
 * - /_next/static/* - Next.js static assets
 * - /_next/image/* - Next.js image optimization
 * - /favicon.ico - Site favicon
 */
export const config = {
  matcher: [
    '/((?!api/auth|api/apply|login|forgot-password|reset-password|kiosk|apply|_next/static|_next/image|favicon.ico).*)',
  ],
};
