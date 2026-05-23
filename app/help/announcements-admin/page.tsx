'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Tip, Body, BackLink } from '../_components';

export default function HelpAnnouncementsAdminPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Announcements</h1>
          <p className="text-gray-500 text-sm mt-1">Posting notices to the home page for all members</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="What announcements are">
            <Body>
              Announcements appear at the top of the home page for every logged-in member. Use them
              for short-lived club notices — green fee changes, clubhouse closures, special events,
              or anything the committee wants all members to see immediately when they open the
              portal.
            </Body>
            <Body>
              Each announcement disappears automatically once its expiry date and time passes —
              there is nothing to tidy up manually.
            </Body>
            <Note>
              Announcements are visible to all members. Keep the message brief and relevant — it
              is the first thing members see when they log in.
            </Note>
          </HelpSection>

          <HelpSection title="Creating an announcement">
            <Step n={1}>
              Go to <strong>Admin → Announcements</strong> in the top navigation bar.
            </Step>
            <Step n={2}>
              Tap <strong>New Announcement</strong> (top right).
            </Step>
            <Step n={3}>
              Type your message in the <strong>Message</strong> box. There is no formatting — plain
              text only.
            </Step>
            <Step n={4}>
              Set an <strong>Expires on</strong> date — this is required. The announcement will
              stop showing to members after midnight on that date unless you also set a time.
            </Step>
            <Step n={5}>
              Optionally set an <strong>Expires at</strong> time if you need it to disappear at a
              specific point during the day (for example, 6:00pm on the day of an event).
              If left blank, it defaults to 11:59pm on the expiry date.
            </Step>
            <Step n={6}>
              Tap <strong>Create Announcement</strong>. It goes live immediately.
            </Step>
            <Tip>
              For time-sensitive notices (e.g. &quot;Green fees are suspended today due to
              maintenance&quot;), set the expiry to the same day. For longer-running notices, a
              week or two is usually appropriate.
            </Tip>
          </HelpSection>

          <HelpSection title="Editing an announcement">
            <Body>
              On the Announcements page, each announcement card has an <strong>Edit</strong> button.
              Tap it to open the form pre-filled with the current message and expiry, make your
              changes, and tap <strong>Save Changes</strong>.
            </Body>
            <Body>
              Editing takes effect immediately — the updated text and new expiry are live as soon as
              you save.
            </Body>
          </HelpSection>

          <HelpSection title="Deleting an announcement">
            <Body>
              Tap <strong>Delete</strong> on an announcement card. A confirmation prompt appears
              inline — tap <strong>Yes, Delete</strong> to confirm. Deletion is permanent and cannot
              be undone.
            </Body>
            <Tip>
              If an announcement has already expired you do not need to delete it — expired
              announcements are hidden from members automatically and only visible on this admin
              page.
            </Tip>
          </HelpSection>

          <HelpSection title="Who can manage announcements">
            <Body>
              Captains, GMC members, and Admins can create, edit, and delete announcements.
              The page shows who created or last edited each announcement and when.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
