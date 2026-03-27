// app/help/rowland/page.tsx
// Guide for the Rowland role — managing the Rowland Cup

'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-3 last:mb-0">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="text-sm text-gray-700 leading-relaxed">{children}</div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 mb-4">
      {children}
    </div>
  );
}

export default function RowlandHelpPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = session?.user?.role ?? '';

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <button
            onClick={() => router.push('/rowland')}
            className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
          >
            ← Rowland Cup
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Rowland Cup — Admin Guide</h1>
          <p className="text-gray-500 text-sm mt-1">
            Managing competitions, draws, clubs, and results
          </p>
        </div>

        <div className="space-y-4">

          {/* Club logins */}
          <Section title="1. Club logins">
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              Each visiting club has its own username and password, set up by a BHBC Admin. The login is shared within the club — everyone at the club who manages their Rowland Cup matches uses the same login.
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">
              Once logged in, clubs can look up other clubs to find contact details to arrange matches, view the draw for their competition, and enter match results and player names.
            </p>
          </Section>

          {/* Setting up a competition */}
          <Section title="2. Managing a Competition Draw">
            <Step n={1}>
              Go to <strong>Rowland Cup</strong> and select the competition you want to set up.
            </Step>
            <Step n={2}>
              Click <strong>Manage</strong> to open the setup page.
            </Step>
            <Step n={3}>
              On the <strong>Dates</strong> tab, enter the play-by dates for each round and the finals date. Save dates before moving to the draw.
            </Step>
            <Step n={4}>
              On the <strong>Draw</strong> tab, assign clubs to each slot. The draw is generated automatically based on the number of teams.
            </Step>
            <Step n={5}>
              Once all slots are filled, click <strong>Save Draw</strong>. The draw is now live and clubs can see their matches.
            </Step>
            <Step n={6}>
              When setting up the draw, any team can be given a bye — leave the opposing slot empty and mark it as a bye. That team will advance automatically to the next round.
            </Step>
          </Section>

          {/* Managing results */}
          <Section title="3. Managing results">
            <Note>
              As a Rowland administrator you can enter or correct results for any match, regardless of which club submitted them.
            </Note>
            <Step n={1}>
              Open the competition draw and tap any <strong>Pending</strong> match to enter or update a result.
            </Step>
            <Step n={2}>
              Enter both teams' player names, the score, and the date played, then click <strong>Save</strong>.
            </Step>
            <Step n={3}>
              If a team cannot play, use <strong>Record walkover instead</strong> to advance the other team.
            </Step>
            <Step n={4}>
              Once a result is saved the winner automatically advances in the draw. If the next round slot has not yet appeared, the draw will update on the next page load.
            </Step>
          </Section>

          {/* Reviewing submissions */}
          <Section title="4. Reviewing club submissions">
            <p className="text-sm text-gray-700 leading-relaxed">
              Clubs enter their own results and player names. You can review all submissions in the draw. If a result looks incorrect, tap the match to open it and make corrections — your changes will overwrite what the club submitted.
            </p>
          </Section>

          {/* Print */}
          <Section title="5. Printing the draw">
            <Step n={1}>
              Open the competition draw.
            </Step>
            <Step n={2}>
              Use the <strong>Landscape / Portrait</strong> toggle to choose the page orientation for the print-out.
            </Step>
            <Step n={3}>
              Click <strong>Print</strong>. The draw is formatted to fit neatly on one page.
            </Step>
          </Section>

        </div>
      </div>
    </div>
  );
}
