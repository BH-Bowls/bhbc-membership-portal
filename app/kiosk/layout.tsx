import type { Metadata } from 'next';

export const metadata: Metadata = {
  manifest: '/manifest-kiosk.json',
};

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
