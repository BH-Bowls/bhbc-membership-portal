// middleware.ts
// NextAuth middleware for route protection and role-based access control
// Runs on every request to protected pages before they are rendered
// Redirects unauthenticated users to login page
// Enforces role-based permissions (e.g., Captain-only routes)

import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { hasRole } from './src/lib/role-utils';

/**
 * Middleware function that runs on every protected route
 * Handles authentication checks and role-based authorization
 * Integrated with NextAuth for automatic session validation
 */
/**
 * Routes accessible without authentication (guest/public access).
 * Page routes listed here are exact-match only unless otherwise noted.
 */
function isPublicRoute(pathname: string): boolean {
  // Exact public pages
  const exactPages = [
    '/fixtures', '/members', '/friendlies', '/competitions',
    '/tea-rota', '/cleaning-rota', '/sweeping-rota', '/rowland', '/leagues',
  ];
  if (exactPages.includes(pathname)) return true;

  // /clubs and all sub-paths (list + detail pages)
  if (pathname === '/clubs' || pathname.startsWith('/clubs/')) return true;

  // /friendlies/game/[tabDate] — public read-only view of a game
  if (pathname.startsWith('/friendlies/game/')) return true;

  // /api/friendlies/game/[tabDate] — public API for game details
  if (pathname.startsWith('/api/friendlies/game/')) return true;

  // /rowland/[compId] — but NOT setup pages
  if (pathname.startsWith('/rowland/')) {
    const segment = pathname.split('/')[2];
    if (segment && !['setup'].includes(segment)) return true;
  }

  // /competitions/[compId] and sub-pages — but NOT admin/my/handicaps
  if (pathname.startsWith('/competitions/')) {
    const segment = pathname.split('/')[2];
    if (!['admin', 'my', 'handicaps'].includes(segment)) return true;
  }

  // /leagues/[leagueId] — public
  if (pathname.startsWith('/leagues/')) return true;

  // Exact public API routes (GET — write endpoints remain protected at handler level)
  const exactApis = [
    '/api/fixtures/games', '/api/tea-rota', '/api/cleaning-rota',
    '/api/sweeping-rota', '/api/members/lookup', '/api/friendlies/games',
    '/api/competitions', '/api/rowland', '/api/rowland/message',
    '/api/leagues', '/api/leagues/message',
  ];
  if (exactApis.includes(pathname)) return true;

  // /api/leagues/[leagueId] and sub-paths — public
  if (pathname.startsWith('/api/leagues/')) return true;

  // /api/rowland/[compId] and matches — but NOT setup
  if (pathname.startsWith('/api/rowland/')) {
    const segment = pathname.split('/')[3];
    if (segment && !['setup'].includes(segment)) return true;
  }

  // /api/clubs and all sub-paths
  if (pathname === '/api/clubs' || pathname.startsWith('/api/clubs/')) return true;

  // /api/competitions/[compId] and sub-paths — but NOT admin/my/handicaps
  if (pathname.startsWith('/api/competitions/')) {
    const segment = pathname.split('/')[3];
    if (!['admin', 'my', 'handicaps'].includes(segment)) return true;
  }

  return false;
}

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

    // Force password change if token is flagged (not when admin is impersonating)
    if (token?.mustChangePassword && !token?.isImpersonating) {
      if (!pathname.startsWith('/change-password') && !pathname.startsWith('/api/')) {
        return NextResponse.redirect(new URL('/change-password', req.url));
      }
    }

    // Restrict Club role to /clubs and /rowland (not when admin is impersonating)
    if (token?.role === 'Club' && !token?.isImpersonating) {
      const allowed = ['/clubs', '/rowland', '/api/', '/change-password', '/help'];
      if (!allowed.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL('/clubs', req.url));
      }
    }

    // Protect /friendlies/manage routes - Captain or Admin only
    if (pathname.startsWith('/friendlies/manage')) {
      if (!token || !hasRole(token.role as string, 'Captain', 'Admin')) {
        return NextResponse.redirect(new URL('/friendlies', req.url));
      }
    }

    // Protect /admin/emails routes - Admin only
    // These routes allow sending bulk emails to members
    if (pathname.startsWith('/admin/emails')) {
      if (!token || !hasRole(token.role as string, 'Admin')) {
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
      authorized: ({ token, req }) => {
        // Allow public routes without a token
        if (isPublicRoute(req.nextUrl.pathname)) return true;
        // Otherwise require authentication
        return !!token;
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
    '/((?!api/auth|api/apply|login|clublogin|forgot-password|reset-password|kiosk|apply|help/login|_next/static|_next/image|favicon.ico|bhbc-logo.jpg|manifest.json|icons/).*)',
  ],
};
