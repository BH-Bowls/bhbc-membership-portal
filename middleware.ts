// middleware.ts
// NextAuth middleware for route protection and role-based access control
// Runs on every request to protected pages before they are rendered
// Redirects unauthenticated users to login page
// Enforces role-based permissions (e.g., Captain-only routes)

import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { hasRole, isCommitteeMember } from './src/lib/role-utils';

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

  // /availability/guest — visitor token pages (no auth required)
  if (pathname.startsWith('/availability/guest/')) return true;

  // /api/availability/guest — public API endpoints for visitor token responses
  if (pathname.startsWith('/api/availability/guest/')) return true;

  // /api/competitions/[compId] and sub-paths — but NOT admin/my/handicaps
  if (pathname.startsWith('/api/competitions/')) {
    const segment = pathname.split('/')[3];
    if (!['admin', 'my', 'handicaps'].includes(segment)) return true;
  }

  return false;
}

/**
 * Public routes that stay open even when the public-access PIN gate is on.
 * The /rowland section (per request) and visitor token links (which carry their
 * own token and would break behind a PIN). The /unlock flow is excluded via the
 * matcher, so it never reaches the gate.
 */
function isPinExempt(pathname: string): boolean {
  if (pathname === '/rowland' || pathname.startsWith('/rowland/')) return true;
  if (pathname.startsWith('/api/rowland')) return true;
  if (pathname.startsWith('/availability/guest/')) return true;
  if (pathname.startsWith('/api/availability/guest/')) return true;
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

    // Public-access PIN gate. When PUBLIC_ACCESS_PIN is configured, the public
    // (no-login) pages require either a logged-in session or a valid PIN cookie.
    // Logged-in members bypass it; the /rowland section and visitor token links
    // are exempt. If the env var is unset, the gate is off (pages stay public).
    const pin = process.env.PUBLIC_ACCESS_PIN;
    if (pin && !token && isPublicRoute(pathname) && !isPinExempt(pathname)) {
      const hasPin = req.cookies.get('public_access')?.value === pin;
      if (!hasPin) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'PIN required' }, { status: 401 });
        }
        const url = new URL('/unlock', req.url);
        url.searchParams.set('from', pathname + req.nextUrl.search);
        return NextResponse.redirect(url);
      }
    }

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

    // Protect /admin/members routes - Admin only
    // Membership lifecycle: applications workflow and member archiving/reinstatement
    if (pathname.startsWith('/admin/members')) {
      if (!token || !hasRole(token.role as string, 'Admin')) {
        return NextResponse.redirect(new URL('/', req.url));
      }
    }

    // Protect membership-management API routes - Admin only
    // (the route handlers also self-guard; this is defence in depth)
    if (
      pathname.startsWith('/api/admin/applications') ||
      pathname.startsWith('/api/admin/members') ||
      pathname.startsWith('/api/admin/leavers')
    ) {
      if (!token || !hasRole(token.role as string, 'Admin')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Protect /admin/stats routes - Admin, Captain, GMC (Treasurer excluded)
    if (pathname.startsWith('/admin/stats')) {
      if (!token || !hasRole(token.role as string, 'Admin', 'Captain', 'GMC')) {
        return NextResponse.redirect(new URL('/', req.url));
      }
    }

    // Protect /admin/announcements routes - Admin, Captain, or GMC only
    // These routes allow creating and managing home page announcements
    if (pathname.startsWith('/admin/announcements')) {
      if (!token || !hasRole(token.role as string, 'Admin', 'Captain', 'GMC')) {
        return NextResponse.redirect(new URL('/', req.url));
      }
    }

    // Restrict /availability to Admin or Testing roles during testing phase
    // Guest sub-paths (/availability/guest/) remain public (handled by isPublicRoute above)
    if (pathname.startsWith('/availability') && !pathname.startsWith('/availability/guest/')) {
      if (!token || !hasRole(token.role as string, 'Admin', 'Testing')) {
        return NextResponse.redirect(new URL('/', req.url));
      }
    }

    // Restrict /api/availability to Admin or Testing roles during testing phase
    // Guest sub-paths (/api/availability/guest/) remain public (handled by isPublicRoute above)
    if (pathname.startsWith('/api/availability') && !pathname.startsWith('/api/availability/guest/')) {
      if (!token || !hasRole(token.role as string, 'Admin', 'Testing')) {
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
    '/((?!api/auth|api/apply|api/unlock|unlock|login|clublogin|forgot-password|reset-password|kiosk|apply|help/login|_next/static|_next/image|favicon.ico|bhbc-logo.jpg|manifest.json|icons/).*)',
  ],
};
