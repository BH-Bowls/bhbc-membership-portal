'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Body, BackLink } from '../_components';

export default function HelpFriendliesPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Friendlies</h1>
          <p className="text-gray-500 text-sm mt-1">Viewing friendly matches and results</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Viewing upcoming matches">
            <Body>
              Go to Friendlies in the navigation menu to see all upcoming and past friendly games.
              Each entry shows the date, opponent, venue (home or away), and the game format. Tap a
              game to see full details.
            </Body>
          </HelpSection>

          <HelpSection title="Team sheet">
            <Body>
              Once the Captain has selected the team and published the game, you will be able to see
              who has been selected to play. Your name will be highlighted if you are in the team.
            </Body>
          </HelpSection>

          <HelpSection title="Tea rota">
            <Body>
              The tea rota for each home game is shown on the game detail page. It lists the members
              assigned to do teas. The rota is also emailed to those members when the game is
              published.
            </Body>
          </HelpSection>

          <HelpSection title="Results">
            <Body>
              After a game, the result is recorded by the Captain. You can view the final score on
              the game&apos;s detail page.
            </Body>
          </HelpSection>

          <HelpSection title="Past games">
            <Body>
              Completed games remain in the list and can be viewed at any time. Use the tabs at the
              top of the Friendlies page to switch between upcoming and past games.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
