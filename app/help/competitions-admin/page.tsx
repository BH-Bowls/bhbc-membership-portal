'use client';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpCompetitionsAdminPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Competitions Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Managing club competition draws and results</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Overview">
            <Body>
              <strong>Admin → Competitions Admin</strong> (Captain and Admin) lists every club competition
              — singles, pairs and triples. Each has three buttons: <strong>View</strong> (the draw sheet),{' '}
              <strong>Export Sheet</strong> and <strong>Manage</strong> (dates and draw).
            </Body>
            <Note>
              Entrants come from this season&apos;s renewals — members choose their competitions when they
              renew. If the number of entrants changes after the draw is made, Manage warns you.
            </Note>
          </HelpSection>

          <HelpSection title="Setting up a competition (Manage)">
            <Step n={1}>
              <strong>Play-by dates &amp; finals</strong> — enter the date each round must be played by
              (and the preliminary round, if there is one) and the finals date. Tap{' '}
              <strong>Save dates &amp; continue →</strong>.
            </Step>
            <Step n={2}>
              <strong>The draw</strong> — choose who plays who in each match, from the entrants (or a
              substitute or other member if needed). When there are more entrants than fit the first
              round, a preliminary round is used and the remaining places are byes.
            </Step>
            <Step n={3}>Tap <strong>Save draw &amp; go to draw sheet</strong>. The draw is now live for members.</Step>
          </HelpSection>

          <HelpSection title="Entering results">
            <Step n={1}>On the draw sheet (View), tap the match.</Step>
            <Step n={2}>
              Enter both scores (there must be a winner), the date played and, for singles, the marker.
              Tap <strong>Save Score</strong>.
            </Step>
            <Step n={3}>The winner moves on to the next round automatically.</Step>
            <Body>
              If a player gives a walkover, tap the match and use <strong>Walkover</strong> to choose who
              goes through. A wrong result can be fixed with <strong>Correct Score</strong>. You can also
              save just an agreed date, without a score.
            </Body>
          </HelpSection>

          <HelpSection title="Exporting the draw">
            <Body>
              <strong>Export Sheet</strong> on the Competitions Admin list downloads the draw as an Excel
              workbook, for printing or the noticeboard. You can choose the line style before exporting.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
