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
          <p className="text-gray-500 text-sm mt-1">Viewing the draw and tracking your progress</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Competitions summary">
            <Body>
              The Competitions page lists all club competitions — singles, pairs, and triples — grouped
              by status (In Progress, Draw Done, Not Started, Complete). Tap any competition to open
              its draw and see all matches and results.
            </Body>
          </HelpSection>

          <HelpSection title="The draw">
            <Body>
              The draw shows all matches in the competition. Your match is highlighted in blue. Each
              match shows the two players or teams, and the result if it has been recorded.
            </Body>
            <Body>
              <strong>On a wide screen</strong> (tablet landscape or desktop), all rounds are shown
              side by side with connecting lines so you can follow the path to the final at a glance.
            </Body>
            <Body>
              <strong>On a phone</strong>, one round is shown at a time — the current round with
              matches still to play is shown first. Tap the round buttons at the top to switch
              between rounds, or tap the <strong>All Rounds</strong> button or the same round button
              again to show all rounds at once.
            </Body>
            <Body>
              Tap <strong>← All Competitions</strong> at the top of the screen to return to the
              competitions summary.
            </Body>
          </HelpSection>

          <HelpSection title="My Progress">
            <Body>
              On the Competitions page, tap <strong>My Progress</strong> (top right) to see a
              summary of every competition you are entered in — your current round, who you are
              playing, the score if recorded, and the play-by date for your next match.
            </Body>
            <Body>
              For active matches, the card also shows contact details for the relevant players so
              you can get in touch to arrange the game:
            </Body>
            <ul className="text-sm text-gray-700 list-disc list-inside space-y-1 mb-3 ml-1">
              <li><strong>Singles</strong> — contact details for your next opponent.</li>
              <li><strong>Pairs</strong> — your partner&apos;s details, plus the opposing skip&apos;s details if you are skip.</li>
              <li><strong>Married Pairs</strong> — contact details for both opponents.</li>
              <li><strong>Triples</strong> — contact details for your two team members, plus the opposing skip&apos;s details if you are skip.</li>
            </ul>
            <Body>
              Tap <strong>Show Draw →</strong> at the bottom of an entry card to open the full draw
              for that competition.
            </Body>
            <Body>
              Tap <strong>← All Competitions</strong> at the top of the screen to return to the
              competitions summary.
            </Body>
          </HelpSection>

          <HelpSection title="Play-by dates">
            <Note>
              Each round has a date by which the match must be played. Check the draw for your
              current round&apos;s deadline. If you are having difficulty arranging a match, contact the
              Captain.
            </Note>
            <Body>
              Results are entered by the Captain or committee — leave your score card in the box in
              the clubhouse once your match has been played so they can record the result.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
