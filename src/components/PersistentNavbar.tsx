// src/components/PersistentNavbar.tsx
// Renders the single, layout-level Navbar instance. Lives in app/providers.tsx so it
// mounts once per session rather than remounting on every page navigation (the old
// per-page <Navbar /> pattern re-ran all of Navbar's effects — including a fetch to
// /api/admin/impersonate/users — on every single route change).
//
// A handful of pages intentionally show no navbar at all (login/apply/reset flows,
// the maintenance splash, the token-only Rowland entry page, the guest PIN unlock
// page) — keep this list in sync with those pages' own layout.
//
// Also resets scroll to top on every route change. Next.js normally does this itself
// on <Link> navigation, but that behaviour is keyed off the page segment's own DOM
// boundary — now that Navbar is hoisted out of the page and mounted once at the
// layout level, Next sometimes decides the new page is "already in view" and skips
// the scroll reset, leaving the window at whatever scroll position the previous page
// was left at. Since the navbar is sticky, that can leave page content start hidden
// underneath it until the user manually scrolls up.

'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Navbar } from './Navbar';

const NO_NAVBAR_PATHS = [
  '/apply',
  '/forgot-password',
  '/kiosk',
  '/login',
  '/maintenance',
  '/reset-password',
  '/rowland/enter',
  '/unlock',
];

export function PersistentNavbar() {
  const pathname = usePathname();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (pathname && NO_NAVBAR_PATHS.includes(pathname)) {
    return null;
  }
  return <Navbar />;
}
