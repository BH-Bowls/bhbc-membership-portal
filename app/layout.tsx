// src/app/layout.tsx
// Root layout with NextAuth session provider

import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import { OfflineBanner } from '@/components/OfflineBanner';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'BHBC Members Portal',
  description: 'Burgess Hill Bowls Club Membership System',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'BHBC Portal',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/bhbc-apple-180.png" />
        <meta name="theme-color" content="#1d4ed8" />
      </head>
      <body className={inter.className}>
        <OfflineBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
