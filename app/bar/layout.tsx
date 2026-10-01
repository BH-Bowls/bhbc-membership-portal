// app/bar/layout.tsx
// Overrides the root layout's manifest/apple-web-app metadata (app/layout.tsx) just
// for /bar, so "Add to Home Screen" installs the till as its own distinctly-named
// app (manifest-bar.json) rather than the main portal. Same single service worker
// (scope "/", next-pwa) still covers it — no second sw.js needed.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BHBC Bar Till',
  manifest: '/manifest-bar.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Bar Till',
  },
};

export default function BarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
