'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Note, Body, BackLink } from '../_components';

export default function HelpHomePage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Home Page</h1>
          <p className="text-gray-500 text-sm mt-1">Announcements and your upcoming events at a glance</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Announcements">
            <Body>
              If the committee has posted an announcement, it appears as a highlighted panel at the
              very top of the home page — above everything else. Announcements are used for
              short-term club notices such as green fee changes, clubhouse closures, or upcoming
              events.
            </Body>
            <Body>
              Announcements disappear automatically once their expiry date passes — you do not need
              to dismiss them.
            </Body>
            <Note>
              If there are no active announcements, the panel is not shown and the home page goes
              straight to your upcoming events.
            </Note>
          </HelpSection>

          <HelpSection title="Upcoming events">
            <Body>
              Below the announcements, the home page shows a personalised list of things coming up
              for you specifically. Two types of item can appear here:
            </Body>
            <div className="mt-2 space-y-3 text-sm text-gray-700 mb-2">
              <div>
                <p className="font-semibold text-gray-900">Friendly games</p>
                <p>
                  Once the Captain has selected and published the team, any game you are in — as a
                  playing member, reserve, or reserve team player — appears here with the date,
                  opponent, and your status. Tap the entry to go straight to the team sheet.
                </p>
              </div>
              <div>
                <p className="font-semibold text-gray-900">Competition matches</p>
                <p>
                  When you and your opponent have agreed a date to play your competition match and
                  one of you has recorded it on the portal, the match appears here as a reminder.
                  See the <strong>Competitions</strong> help page for how to record the agreed date.
                </p>
              </div>
            </div>
            <Note>
              Only events dated today or in the future are shown. Past events drop off the list
              automatically.
            </Note>
          </HelpSection>

          <HelpSection title="What is not shown here">
            <Body>
              The upcoming panel is intentionally focused — it only shows events you are personally
              involved in. To see all open friendly games, go to <strong>Friendlies</strong>. To
              see the full competition draws, go to <strong>Competitions</strong>.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
