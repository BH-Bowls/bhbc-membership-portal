'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Body, Note, BackLink } from '../_components';

export default function HelpHomePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Home Page</h1>
          <p className="text-gray-500 text-sm mt-1">Announcements, polls, your diary and your account at a glance</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="What's on the home page">
            <Body>From the top, the home page shows:</Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li><strong>Announcements</strong> from the committee, when there are any.</li>
              <li><strong>Open polls</strong> you have been invited to.</li>
              <li><strong>Your diary</strong> — your upcoming games and duties.</li>
              <li>A <strong>My Account</strong> button.</li>
              <li>A welcome panel with your username, and a few quick tips.</li>
            </ul>
          </HelpSection>

          <HelpSection title="Announcements">
            <Body>
              If the committee has posted an announcement, it appears as a highlighted panel at the
              very top of the home page. Announcements are used for short-term club notices such as
              green fee changes, clubhouse closures, or upcoming events.
            </Body>
            <Body>
              Announcements disappear automatically once their expiry date passes — you do not need
              to dismiss them. If there are none, the panel isn&apos;t shown.
            </Body>
          </HelpSection>

          <HelpSection title="Open polls">
            <Body>
              When someone has asked you to say which dates or times suit you — through the
              Availability Planner — the poll appears here until it closes. Tap it to answer Yes, Maybe
              or No for each option. See the{' '}
              <Link href="/help/availability" className="text-blue-600 hover:text-blue-800">Availability Planner</Link> help.
            </Body>
          </HelpSection>

          <HelpSection title="Your diary">
            <Body>
              The diary lists what is coming up for you, in date order: friendlies you have entered,
              competition matches with an agreed date, matches you are marking, and your tea,
              cleaning and sweeping duties. Past items drop off automatically.
            </Body>
            <Body>
              See the <Link href="/help/diary" className="text-blue-600 hover:text-blue-800">Diary</Link> help
              for everything it can show.
            </Body>
          </HelpSection>

          <HelpSection title="My Account">
            <Body>
              The <strong>My Account</strong> button opens your membership card. Tap the card to show
              the QR code you scan at the bar. Underneath are your Bar Account (balance and
              transactions), your Bar PIN, what to do if you lose your card, and your membership fees.
              See the <Link href="/help/account" className="text-blue-600 hover:text-blue-800">My Account</Link> help.
            </Body>
            <Note>My Account is also in the account menu, at the top right (or at the bottom of the ☰ menu on a phone).</Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
