'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Note, Body, BackLink } from '../_components';

export default function HelpGettingAroundPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Getting Around</h1>
          <p className="text-gray-500 text-sm mt-1">Navigating the BHBC Members Portal</p>
        </div>
        <div className="space-y-4">
          <HelpSection title="Works on any device">
            <Body>
              The portal works on phones, tablets, and laptops — the layout adjusts automatically
              to give the best experience on your screen.
            </Body>
            <Body>
              On <strong>mobiles and tablets</strong> you will see only the ☰ menu icon in the
              top-right corner. Tap it to slide open the full menu.
            </Body>
            <Body>
              On <strong>laptops and desktops</strong> the navigation bar shows all menu items
              across the top with their labels, so you can jump straight to any section in one
              click. Your account menu also gives you access to My Profile, Renewals, Change
              Password, and Logout.
            </Body>
          </HelpSection>

          <HelpSection title="What's in the menu">
            <Body>
              The main items you'll see are: Home (your dashboard), Friendlies, Internal
              Games, Lookups (Members, Clubs, Fixtures, and rotas), and Help.
            </Body>
            <Note>
              If you hold a committee role, you will also see an Admin menu with additional tools.
            </Note>
          </HelpSection>

          <HelpSection title="Your account (top right)">
            <Body>
              On desktop, your initials appear in a button in the top-right corner — for example,
              John Smith would see{' '}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '2rem',
                  height: '2rem',
                  borderRadius: '9999px',
                  background: '#2563eb',
                  color: '#fff',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  verticalAlign: 'middle',
                }}
              >
                JS
              </span>
              . Tap or click it to open the account menu.
            </Body>
            <Body>
              The account menu contains: <strong>My Profile</strong> (your personal details),{' '}
              <strong>Renewals</strong> (annual membership renewal), <strong>Change Password</strong>,
              and <strong>Logout</strong>. On mobile, these are accessible from the ☰ menu at the
              bottom of the list.
            </Body>
          </HelpSection>
        </div>
      </div>
    </div>
  );
}
