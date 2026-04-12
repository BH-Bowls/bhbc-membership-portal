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
          <h1 className="text-2xl font-bold text-gray-900">Rowland Cup — Guide</h1>
          <p className="text-gray-500 text-sm mt-1">
            Viewing draws, finding opponent contacts, and managing competitions and results
          </p>
        </div>

        <div className="space-y-4">

          {/* Club logins */}
          <Section title="1. Club logins">
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              Each visiting club has its own username and password, set up by a BHBC Admin. The login is shared within the club — everyone at the club who manages their Rowland Cup matches uses the same login.
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">
              Once logged in, clubs can view the draw for their competition, see their next match and opponent contact details, and enter match results and player names.
            </p>
          </Section>

          {/* Your next match */}
          <Section title="2. Your next match &amp; opponent contacts">
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              When you open a competition draw, a green card at the top shows your next match — the round, the play-by date, and the opponent's contact details (Organiser and Skip) so you can arrange the game directly.
            </p>
            <p className="text-sm text-gray-700 font-medium mb-2">If you are logged in as a club or BHBC player:</p>
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              The card appears automatically and your position in the draw is highlighted. No setup needed.
            </p>
            <p className="text-sm text-gray-700 font-medium mb-2">If you are not logged in:</p>
            <Step n={1}>
              Go to the <strong>Rowland Cup</strong> home page.
            </Step>
            <Step n={2}>
              Use the <strong>Select your club</strong> dropdown to identify your club. This is saved in your browser so you only need to do it once.
            </Step>
            <Step n={3}>
              Open any competition draw — your team will be highlighted and your next match card will appear at the top with your opponent's contact details.
            </Step>
            <Step n={4}>
              If you need to change the selected club, click <strong>Change</strong> on the home page, or <strong>Not your club?</strong> on the draw page.
            </Step>
            <Note>
              Contact details shown here come from the Contacts sheet. If a club's Organiser or Skip details are missing or out of date, a BHBC Admin can update them. See section 6 below.
            </Note>
          </Section>

          {/* Setting up a competition */}
          <Section title="3. Managing a Competition Draw">
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
          <Section title="4. Managing results">
            <Note>
              Rowland administrators can enter or correct results for any match. Clubs, RowlandPlayers, and Captains can enter results for their own matches only.
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

          {/* Score sheet upload */}
          <Section title="5. Score sheet photos">
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              When entering a result, a score sheet photo can be attached. The image is stored and a link is included in the result notification email.
            </p>
            <Step n={1}>
              Open the match and fill in the result as normal.
            </Step>
            <Step n={2}>
              Below the date, tap <strong>Add photo / take photo</strong>.
              On a <strong>phone</strong> this opens the camera directly — take a photo of the score card.
              On a <strong>PC</strong> this opens a file browser — select an image file.
            </Step>
            <Step n={3}>
              A thumbnail preview appears. Click <strong>Save</strong> — the image is uploaded and the link is included in the result email to the organisers.
            </Step>
            <Step n={4}>
              To view a score sheet after the result has been saved, look for the small <strong>camera icon</strong> in the corner of the match card on the draw. Click it to open the image.
            </Step>
            <Note>
              You can also go back into a completed match to add or replace the score sheet photo at any time — open the match, tap the photo button, and save again.
            </Note>
          </Section>

          {/* Club contact details */}
          <Section title="6. Updating club contact details">
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              Each club's Rowland Organiser and Skip contact details are shown on the <strong>Your next match</strong> card when another club is drawn against them. It is worth keeping these accurate so clubs can reach the right person to arrange games.
            </p>
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              Contact roles that appear on the next match card are: <strong>ERowland A/B Organiser</strong>, <strong>ERowland A/B Skip</strong>, <strong>GRowland A/B Organiser</strong>, and <strong>GRowland A/B Skip</strong> — depending on which competition is being viewed.
            </p>
            <Step n={1}>
              Log in with your club username and password.
            </Step>
            <Step n={2}>
              Go to <strong>Clubs</strong> and find your club — it will open automatically on the clubs page.
            </Step>
            <Step n={3}>
              Tap <strong>Edit</strong> to update the club's general details (address, phone, email).
            </Step>
            <Step n={4}>
              To add a skip or other contact, scroll to the <strong>Contacts</strong> section and tap <strong>Add Contact</strong>.
            </Step>
            <Step n={5}>
              Choose a role from the dropdown (e.g. <em>Skip</em>), fill in the person's name and phone number, and tap <strong>Save</strong>.
            </Step>
            <Note>
              You can add as many contacts as you need — one per skip if you have multiple teams. Other clubs will be able to see these details when they look up your club.
            </Note>
            <p className="text-sm text-gray-700 leading-relaxed">
              To remove a contact that is no longer current, tap the <strong>delete</strong> (bin) icon next to their entry.
            </p>
          </Section>

          {/* Reviewing submissions */}
          <Section title="7. Reviewing club submissions">
            <p className="text-sm text-gray-700 leading-relaxed">
              Clubs enter their own results and player names. You can review all submissions in the draw. If a result looks incorrect, tap the match to open it and make corrections — your changes will overwrite what the club submitted.
            </p>
          </Section>

          {/* Print */}
          <Section title="8. Printing the draw">
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
