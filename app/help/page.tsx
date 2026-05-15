// app/help/page.tsx
// Help index — card grid for all member features + role-filtered admin tools

'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';

interface HelpCard {
  title: string;
  description: string;
  href: string;
  external?: boolean; // link goes to the feature, not a help sub-page
}

function Card({ title, description, href, router }: HelpCard & { router: ReturnType<typeof useRouter> }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={() => router.push(href)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="text-left rounded-xl border p-5 w-full cursor-pointer transition-all duration-150"
      style={{
        background: hovered ? '#eff6ff' : '#ffffff',
        borderColor: hovered ? '#3b82f6' : '#e5e7eb',
        boxShadow: hovered ? '0 4px 12px rgba(59,130,246,0.15)' : 'none',
        transform: hovered ? 'translateY(-2px)' : 'none',
      }}
    >
      <h3 className="text-sm font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-semibold text-gray-700 mb-3 mt-6 first:mt-0">{children}</h2>
  );
}

export default function HelpIndexPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = session?.user?.role ?? '';
  const roles = role.split(',').map(r => r.trim()).filter(Boolean);
  const has = (...r: string[]) => r.some(x => roles.includes(x));

  const isAdmin     = has('Admin');
  const isCaptain   = has('Captain');
  const isLeagueOrganiser = has('LeagueOrganiser');
  const isTreasurer = has('Treasurer');
  const isGMC       = has('GMC');
  const isRowlandOrganiser = has('RowlandOrganiser');

  const generalCards: HelpCard[] = [
    {
      title: 'Getting around',
      description:
        'The navigation bar at the top gives access to all areas of the portal. On a phone or tablet, tap the menu icon (☰) to open it.',
      href: '/help/getting-around',
    },
    {
      title: 'Add to your home screen',
      description:
        'Open the portal like an app on your phone, tablet, or computer — iPhone, iPad, Android, Windows, and Chromebook.',
      href: '/help/install',
    },
    {
      title: 'Logging in & out',
      description:
        'Log in with your username and password. Your session stays active for 30 days. Forgot password, changing password, and signing out.',
      href: '/help/login',
    },
    {
      title: 'Friendlies',
      description:
        'View upcoming and past friendly matches, see who is playing and who is doing teas, and check match results.',
      href: '/help/friendlies',
    },
    {
      title: 'Competitions',
      description:
        'View the draw for club competitions (singles, pairs, triples), track your progress, and check results.',
      href: '/help/competitions',
    },
    {
      title: 'Leagues',
      description:
        'Enter club leagues, view fixtures grouped by date, check the league table, and enter scores.',
      href: '/help/leagues',
    },
    {
      title: 'Availability Planner',
      description:
        'Coordinate dates and times with other members and visitors. Create events with candidate slots, collect Yes/Maybe/No responses, and pick the best time.',
      href: '/help/availability',
    },
    {
      title: 'Lookups',
      description:
        'Find member contact details, club information, fixtures, and rota assignments — Members, Clubs, Fixtures, Tea Rota, Cleaning Rota, and Sweeping Rota.',
      href: '/help/lookups',
    },
    {
      title: 'Your profile',
      description:
        'Keep your contact details, address, and volunteering preferences up to date.',
      href: '/help/profile',
    },
    {
      title: 'Buddy system',
      description:
        "Nominate another member as your buddy — they can help manage your profile and renewals on your behalf.",
      href: '/help/buddy',
    },
    {
      title: 'Renewals',
      description:
        'How annual membership renewals work — when to expect your renewal, how to pay, and what happens once payment is confirmed.',
      href: '/help/renewals',
    },
  ];

  // Admin cards — only rendered if user has the required role
  type AdminCard = HelpCard & { show: boolean; badge: string };

  const adminCards: AdminCard[] = [
    {
      title: 'Member Suggestions',
      description: 'Review, manage, and respond to improvement suggestions submitted by members.',
      href: '/help/member-suggestions-admin',
      show: isGMC || isAdmin,
      badge: 'GMC',
    },
    {
      title: 'Banking',
      description: 'Import bank statements, match payments to renewals, and produce banking reports.',
      href: '/help/banking',
      show: isTreasurer || isAdmin,
      badge: 'Treasurer',
    },
    {
      title: 'Friendly Management',
      description: 'Create and publish friendly games, select teams, assign teas, and email the tea rota.',
      href: '/help/friendly-management',
      show: isCaptain || isAdmin,
      badge: 'Captain',
    },
    {
      title: 'Competitions Admin',
      description: 'Set up competition draws, manage play-by dates, and oversee competition progress.',
      href: '/help/competitions-admin',
      show: isCaptain || isAdmin,
      badge: 'Captain',
    },
    {
      title: 'Leagues Admin',
      description: 'Create leagues, manage teams and squad assignments, generate fixtures, and record results.',
      href: '/help/leagues-admin',
      show: isCaptain || isLeagueOrganiser || isAdmin,
      badge: 'Captain',
    },
    {
      title: 'Handicaps',
      description: 'View and update competition handicaps for playing members.',
      href: '/help/handicaps',
      show: isCaptain || isAdmin,
      badge: 'Captain',
    },
    {
      title: 'Rowland Admin',
      description: 'Manage Rowland Cup draws, club logins, and match results across all competitions.',
      href: '/help/rowland',
      show: isRowlandOrganiser || isAdmin,
      badge: 'Rowland',
    },
    {
      title: 'Fixtures & League Admin',
      description: 'Manage fixture lists and league tables for the playing season.',
      href: '/help/fixtures-admin',
      show: isCaptain || isAdmin,
      badge: 'Captain',
    },
    {
      title: 'Club Directory Admin',
      description: 'Add, edit, or remove clubs and update contact details for each competition.',
      href: '/help/club-admin',
      show: isGMC || isAdmin,
      badge: 'GMC',
    },
    {
      title: 'Invite Games',
      description: 'Manage invitation games and track responses from visiting clubs.',
      href: '/help/invite-games',
      show: isGMC || isAdmin,
      badge: 'GMC',
    },
    {
      title: 'Tea Rota Admin',
      description: 'Manage tea duty assignments for friendly match days.',
      href: '/help/tea-rota-admin',
      show: isCaptain || isAdmin,
      badge: 'Captain',
    },
    {
      title: 'Cleaning Rota Admin',
      description: 'Manage the clubhouse cleaning rota — add, edit, or remove assignments.',
      href: '/help/cleaning-rota-admin',
      show: isGMC || isAdmin,
      badge: 'GMC',
    },
    {
      title: 'Send Member Emails',
      description: 'Send bulk emails to all members or filtered groups using saved templates.',
      href: '/help/send-emails',
      show: isAdmin,
      badge: 'Admin',
    },
    {
      title: 'Data Export',
      description: 'Export member data in various formats for external use.',
      href: '/help/data-export',
      show: isAdmin,
      badge: 'Admin',
    },
  ];

  const visibleAdminCards = adminCards.filter(c => c.show);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Help</h1>
          <p className="text-gray-500 text-sm mt-1">What would you like help with?</p>
        </div>

        {/* General member features */}
        <SectionHeading>Using the portal</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {generalCards.map(card => (
            <Card key={card.title} {...card} router={router} />
          ))}
        </div>

        {/* Role-filtered admin tools */}
        {visibleAdminCards.length > 0 && (
          <>
            <SectionHeading>Committee &amp; admin tools</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {visibleAdminCards.map(card => (
                <div key={card.title} className="relative">
                  <Card {...card} router={router} />
                  <span className="absolute top-3 right-3 px-1.5 py-0.5 text-xs bg-blue-50 text-blue-600 rounded border border-blue-200">
                    {card.badge}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
