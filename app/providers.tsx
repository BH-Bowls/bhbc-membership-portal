// src/app/providers.tsx
// Client-side providers wrapper

'use client';

import { SessionProvider } from 'next-auth/react';
import { NavbarConfigProvider } from '@/lib/navbar-config';
import { PersistentNavbar } from '@/components/PersistentNavbar';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <NavbarConfigProvider>
        <PersistentNavbar />
        {children}
      </NavbarConfigProvider>
    </SessionProvider>
  );
}
