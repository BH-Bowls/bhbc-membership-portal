// app/help/diary/page.tsx
// Help page covering the home page Diary panel and Announcements feature.

'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Body, BackLink } from '../_components';

export default function HelpDiaryPage() {
  // Get session to populate the navbar
  const { data: session } = useSession();
  const role = session && session.user ? session.user.role : '';

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session && session.user && session.user.name ? session.user.name : undefined}
        userRole={role}
      />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Home Page Diary &amp; Announcements</h1>
          <p className="text-gray-700 text-sm mt-1">
            Your personal upcoming schedule and club notices, all in one place
          </p>
        </div>

        <div className="space-y-4">

          <HelpSection title="What is the Diary?">
            <Body>
              The Diary panel on the home page shows your upcoming duties and games in
              chronological order. It pulls together information from several parts of the
              portal so you can see everything that is coming up without navigating to each
              section individually.
            </Body>
            <Body>
              The diary only shows future items — anything in the past is automatically hidden.
            </Body>
          </HelpSection>

          <HelpSection title="What appears in the Diary?">
            <Body>
              The diary can show the following types of items:
            </Body>
            <Body>
              🧹 <strong>Cleaning duties</strong> — dates where you are listed on the Cleaning
              Rota (as lead or assistant).
            </Body>
            <Body>
              🌿 <strong>Sweeping duties</strong> — dates where you are assigned to sweep the
              green on the Sweeping Rota.
            </Body>
            <Body>
              🫖 <strong>Tea duty</strong> — friendly games where you are listed as Tea Lead
              or Tea Helper.
            </Body>
            <Body>
              🟢 <strong>Friendlies</strong> — games you have entered (entered, selected, or
              reserve status).
            </Body>
            <Body>
              🏆 <strong>Competitions</strong> — your pending competition matches that have
              a planned date set.
            </Body>
            <Body>
              📋 <strong>Marking duty</strong> — competition matches where you have been
              assigned as the marker and a date has been agreed.
            </Body>
            <Body>
              ❓ <strong>Availability events</strong> — open availability polls you have been
              invited to but have not yet responded to. These are highlighted in blue to
              remind you that a response is needed.
            </Body>
            <Body>
              ✅ <strong>Confirmed availability</strong> — concluded availability events where
              you said Yes, and the winning date is in the future.
            </Body>
          </HelpSection>

          <HelpSection title="When does the Diary update?">
            <Body>
              The diary updates automatically in these situations:
            </Body>
            <Body>
              • When you enter or withdraw from a friendly, the diary refreshes immediately.
            </Body>
            <Body>
              • When you set a planned date for a competition match, the diary refreshes
              immediately.
            </Body>
            <Body>
              • When you respond to an availability event, the diary refreshes immediately.
            </Body>
            <Body>
              For rota changes (cleaning and sweeping), the diary may take up to 48 hours to
              reflect updates made by the Captain. This is because rota data is cached to keep
              the page fast — rota changes do not trigger a cache refresh automatically.
            </Body>
          </HelpSection>

          <HelpSection title="Announcements">
            <Body>
              The Announcements panel appears above the diary when the club committee has
              posted a notice. Announcements are used for important club-wide information
              such as event reminders, maintenance notices, or rule changes.
            </Body>
            <Body>
              Each announcement has an expiry date set by the person who created it. Once the
              expiry date passes, the announcement is automatically hidden from the home page.
              You do not need to dismiss announcements manually.
            </Body>
            <Body>
              Announcements can be created, edited, and deleted by Admin, Captain, and GMC
              users from the Announcements section of the Admin menu.
            </Body>
          </HelpSection>

          <HelpSection title="Something missing from your diary?">
            <Body>
              If you expect to see an item but it is not showing, check the following:
            </Body>
            <Body>
              • For competition matches — a planned date must be set on the match before it
              appears. Either you or your opponent can set this from the Competitions page.
            </Body>
            <Body>
              • For friendlies — only entries with Entered, Selected, or Reserve status appear.
              Withdrawn or absent entries are not shown.
            </Body>
            <Body>
              • For rota items — allow up to 48 hours after a rota change for the diary
              to update.
            </Body>
            <Body>
              • For availability events — only events with an Open status appear as nudges.
              If you have already responded, the nudge will not show.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
