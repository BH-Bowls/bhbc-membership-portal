'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Body, BackLink } from '../_components';

export default function HelpInternalGamesPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Internal Games</h1>
          <p className="text-gray-500 text-sm mt-1">Leagues and internal competitions</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="What are internal games?">
            <Body>
              Internal games are competitions played entirely within the club — such as the Triples
              League. They run throughout the season with members playing each other in scheduled
              fixtures.
            </Body>
          </HelpSection>

          <HelpSection title="Viewing fixtures">
            <Body>
              Go to <strong>Internal Games</strong> in the navigation menu to see the current
              fixtures. Each game shows the date, the two teams, and the result if it has been
              played.
            </Body>
          </HelpSection>

          <HelpSection title="Results and standings">
            <Body>
              Once a game result is recorded, the league table is updated automatically. Tap the
              <strong> Standings</strong> tab to see the current league table, including played, won,
              lost, and points for each team.
            </Body>
          </HelpSection>

          <HelpSection title="Sign-in sheet">
            <Body>
              On match days you can view the sign-in list from Internal Games. The sign-in sheet
              shows who is expected to play and records who attended.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
