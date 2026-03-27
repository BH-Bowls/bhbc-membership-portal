'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Body, BackLink } from '../_components';

export default function HelpCompetitionsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Competitions</h1>
          <p className="text-gray-500 text-sm mt-1">Entering club competition results</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Finding your competition">
            <Step n={1}>
              Go to <strong>Competitions → My Competitions</strong> to see the competitions you have
              entered.
            </Step>
            <Step n={2}>
              Tap a competition name to open the draw.
            </Step>
          </HelpSection>

          <HelpSection title="The draw">
            <Body>
              The draw shows all matches in the competition as a bracket. Your match is highlighted
              in blue. Each match shows the two players or teams, the play-by date, and the result if
              it has been recorded.
            </Body>
          </HelpSection>

          <HelpSection title="Entering your result">
            <Step n={1}>
              Tap your highlighted match to open the result form.
            </Step>
            <Step n={2}>
              Enter both players&apos; names — please use full names (e.g. Robert Smith, not Bob).
            </Step>
            <Step n={3}>
              Enter the score for both sides.
            </Step>
            <Step n={4}>
              Check the date played is correct (it defaults to today).
            </Step>
            <Step n={5}>
              Tap <strong>Save</strong>. The winner automatically advances in the draw.
            </Step>
          </HelpSection>

          <HelpSection title="If your opponent enters the result first">
            <Body>
              Either player can enter the result. If your opponent has already entered the score, you
              can still tap the match to add your player name if it is missing.
            </Body>
          </HelpSection>

          <HelpSection title="Walkovers">
            <Step n={1}>
              Tap your match.
            </Step>
            <Step n={2}>
              Tap <strong>Record walkover instead</strong>.
            </Step>
            <Step n={3}>
              Select which side advances. Contact the Captain if you are unsure.
            </Step>
          </HelpSection>

          <HelpSection title="Play-by dates">
            <Note>
              Each round has a date by which the match must be played. Check the draw for your
              current round&apos;s deadline. If you are having difficulty arranging a match, contact the
              Captain.
            </Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
