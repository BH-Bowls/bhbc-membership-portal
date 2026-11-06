'use client';
import { LastUpdated, HelpSection, Note, Body, BackLink } from '../_components';

export default function HelpGettingAroundPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Getting Around</h1>
          <p className="text-gray-500 text-sm mt-1">Navigating the BHBC Members Portal</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">
          <HelpSection title="Works on any device">
            <Body>
              The portal works on phones, tablets, and laptops — the layout adjusts automatically
              to give the best experience on your screen.
            </Body>
            <Body>
              On <strong>mobiles and tablets</strong> you will see the ☰ menu icon in the top-right
              corner. Tap it to open the full menu.
            </Body>
            <Body>
              On <strong>laptops and desktops</strong> the menu runs across the top of the screen. If
              the window is too narrow for everything, the last few items move into a{' '}
              <strong>More</strong> menu.
            </Body>
          </HelpSection>

          <HelpSection title="What's in the menu">
            <Body>
              <strong>Home</strong> — your announcements, polls and diary. See the{' '}
              <strong>Home page</strong> help.
            </Body>
            <Body>
              <strong>Competitions</strong>, <strong>Leagues</strong>, <strong>Friendlies</strong> and{' '}
              <strong>Invite Games</strong> — entering and following the club&apos;s games.
            </Body>
            <Body>
              <strong>Lookups</strong> — Members, Clubs, Fixtures, Documents, Markers, the Tea,
              Cleaning and Sweeping Rotas, the 200 Club and Halve It (Darts).
            </Body>
            <Body>
              <strong>Rowland Cup</strong> — shown to Rowland Cup players and captains.
            </Body>
            <Body>
              <strong>Help</strong> — these pages.
            </Body>
            <Note>
              If you hold a committee role, you will also see an <strong>Admin</strong> menu with the
              tools for that role.
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
              . Tap or click it to open the account menu. On mobile, these are at the bottom of the
              ☰ menu.
            </Body>
            <Body>
              The account menu contains:
            </Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li><strong>My Profile</strong> — your personal details.</li>
              <li>
                <strong>My Account</strong> — your membership card and QR code, your bar PIN, your bar
                account and transactions, and your membership fees. See the My Account help.
              </li>
              <li><strong>Renewals</strong> — your annual membership renewal.</li>
              <li><strong>Switch User</strong> — only if you are someone&apos;s buddy (see the Buddy help).</li>
              <li><strong>Change Password</strong> and <strong>Logout</strong>.</li>
            </ul>
          </HelpSection>
        </div>
      </div>
    </div>
  );
}
