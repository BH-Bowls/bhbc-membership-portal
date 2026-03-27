'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpCompetitionsAdminPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Competitions Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Managing club competition draws and results</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Overview">
            <Body>
              Competitions Admin (at Admin → Competitions Admin) lets you manage all club competitions
              — singles, pairs, and triples. Each competition has its own draw, play-by dates, and
              results.
            </Body>
          </HelpSection>

          <HelpSection title="Setting up the draw">
            <Step n={1}>Open a competition and go to the Draw tab.</Step>
            <Step n={2}>Assign entrants to each slot in the bracket.</Step>
            <Step n={3}>
              If a slot needs a bye, leave the opposing slot empty and mark it as a bye — that player
              advances automatically.
            </Step>
            <Step n={4}>Click Save Draw when all slots are filled. The draw is now live.</Step>
          </HelpSection>

          <HelpSection title="Setting play-by dates">
            <Step n={1}>Go to the Dates tab.</Step>
            <Step n={2}>Enter the play-by date for each round and the finals date.</Step>
            <Step n={3}>Save dates before working on the draw.</Step>
          </HelpSection>

          <HelpSection title="Entering results">
            <Step n={1}>From the competition draw, tap any Pending match.</Step>
            <Step n={2}>Enter both players&apos; names, the score, and the date played.</Step>
            <Step n={3}>Save — the winner advances automatically to the next round.</Step>
          </HelpSection>

          <HelpSection title="Walkovers">
            <Body>
              Tap the match and use Record walkover instead. Select which side advances.
            </Body>
          </HelpSection>

          <HelpSection title="Exporting results">
            <Body>
              Use the Export button on the competition page to download a spreadsheet of all matches,
              results, and player names for your records.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
