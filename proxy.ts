// proxy.ts (formerly middleware.ts — Next.js 16 renamed the convention and deprecated
// the old filename; not forced here since this branch's maintenance check reads
// Supabase, which is Edge-compatible, but worth renaming ahead of the deprecation).
// NextAuth request handling for route protection and role-based access control.
// Runs on every request to protected pages before they are rendered.
// Redirects unauthenticated users to login page.
// Enforces role-based permissions (e.g., Captain-only routes).

import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { hasRole, isCommitteeMember } from './src/lib/role-utils';
import { isMaintenanceModeOn } from './src/lib/maintenance';

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
    '/api/competitions', '/api/competitions/rules-text', '/api/rowland', '/api/rowland/message',
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

  // /api/guides/[slug] — duty-instruction PDFs, viewable alongside the public rota pages
  if (pathname.startsWith('/api/guides/')) return true;

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
  // Competition rules — a public page linked from the club website, plus the single
  // endpoint that feeds it. Case-insensitive so a mis-cased link (/competitions/RULES)
  // is exempt too; the detail page redirects it to the canonical lowercase URL.
  if (pathname.toLowerCase() === '/competitions/rules') return true;
  if (pathname === '/api/competitions/rules-text') return true;
  if (pathname.startsWith('/availability/guest/')) return true;
  if (pathname.startsWith('/api/availability/guest/')) return true;
  // Duty-instruction PDFs (Tea Duty, Cleaning Duty, Captain guidelines) — non-sensitive,
  // and linked from token-authenticated email pages (e.g. /friendlies/game/[tabDate])
  // where the visitor has no PIN cookie.
  if (pathname.startsWith('/api/guides/')) return true;
  return false;
}

export default withAuth(
  /**
   * Custom proxy logic for role-based access control
   * Called after NextAuth verifies user is authenticated
   * @param req Request object with NextAuth token attached
   * @returns NextResponse to continue or redirect
   */
  async function proxy(req) {
    // Get authentication token from NextAuth
    const token = req.nextauth.token;

    // Get current URL pathname
    const pathname = req.nextUrl.pathname;

    // Maintenance mode: an already-logged-in non-Admin session doesn't just keep working
    // once the flag is flipped on — it gets redirected on its very next request. (New
    // non-Admin logins are blocked separately, in authenticateUser().) Only checked when
    // there's a non-Admin token on the request at all, so anonymous visitors to public
    // pages and Admins never pay the extra lookup.
    if (token && !hasRole(token.role as string, 'Admin') && pathname !== '/maintenance') {
      if (await isMaintenanceModeOn()) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json(
            { error: 'The portal is temporarily down for maintenance. Please check back later.' },
            { status: 503 }
          );
        }
        return NextResponse.redirect(new URL('/maintenance', req.url));
      }
    }

    // Public-access PIN gate. When PUBLIC_ACCESS_PIN is configured, the public
    // (no-login) pages require either a logged-in session or a valid PIN cookie.
    // Logged-in members bypass it; the /rowland section and visitor token links
    // are exempt. If the env var is unset, the gate is off (pages stay public).
    // A request carrying a per-recipient token (email links) authenticates itself and
    // must skip the PIN gate — otherwise a tokened visitor is wrongly asked for the
    // members-area PIN. IMPORTANT: only on the paths that actually validate tokens.
    // A blanket ?token= bypass would let ANY public route (e.g. /api/members/lookup)
    // be fetched PIN-free by appending a junk token.
    const tokenBypassPaths = [
      '/friendlies/game/',
      '/api/friendlies/game/',
      '/availability/guest/',
      '/api/availability/guest/',
    ];
    const pin = process.env.PUBLIC_ACCESS_PIN;
    const hasToken =
      req.nextUrl.searchParams.has('token') &&
      tokenBypassPaths.some((p) => pathname.startsWith(p));
    if (pin && !token && !hasToken && isPublicRoute(pathname) && !isPinExempt(pathname)) {
      const hasPin = req.cookies.get('public_access')?.value === pin;
      if (!hasPin) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'PIN required' }, { status: 401 });
        }
        const url = new URL('/unlock', req.url);
        url.searchParams.set('from', pathname + req.nextUrl.search);
        return NextResponse.redirect(url);
      }
      // Valid PIN cookie but no readable UI marker (e.g. the cookie predates the
      // marker, or it was cleared) — set it so the "Members Area Active" indicator
      // shows without the visitor having to re-enter the PIN.
      if (!req.cookies.get('members_area')) {
        const res = NextResponse.next();
        res.cookies.set('members_area', '1', {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24 * 30, // 30 days
        });
        return res;
      }
    }

    // Force password change if token is flagged (not when admin is impersonating)
    if (token?.mustChangePassword && !token?.isImpersonating) {
      if (!pathname.startsWith('/change-password') && !pathname.startsWith('/api/')) {
        return NextResponse.redirect(new URL('/change-password', req.url));
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

    // Protect /admin/cache route - Admin only (Members cache diagnostics)
    if (pathname.startsWith('/admin/cache')) {
      if (!token || !hasRole(token.role as string, 'Admin')) {
        return NextResponse.redirect(new URL('/', req.url));
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

    // /availability is open to any logged-in member (create polls + respond).
    // Per-poll access is enforced at the route level: a poll's own GET checks
    // public/group membership, and manage/conclude require its creator or Admin.
    // (Guest token sub-paths stay public via isPublicRoute above.)

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
    '/((?!api/auth|api/apply|api/unlock|unlock|login|forgot-password|reset-password|kiosk|apply|help/login|_next/static|_next/image|favicon.ico|bhbc-logo.jpg|manifest.json|icons/).*)',
  ],
};
