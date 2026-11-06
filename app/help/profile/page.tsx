'use client';
import { useSession } from 'next-auth/react';
import { LastUpdated, HelpSection, Step, Note, Tip, Body, BackLink } from '../_components';

export default function HelpProfilePage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Your Profile</h1>
          <p className="text-gray-500 text-sm mt-1">Keeping your details up to date</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">
          <HelpSection title="Editing your profile">
            <Step n={1}>Open the account menu (your initials at the top right, or the bottom of the ☰ menu on a phone) and choose <strong>My Profile</strong>.</Step>
            <Step n={2}>Tap <strong>Edit Profile</strong>.</Step>
            <Step n={3}>Update any fields you need to change.</Step>
            <Step n={4}>
              Tap <strong>Save</strong> in the top bar (or <strong>Cancel</strong> to discard
              changes).
            </Step>
          </HelpSection>

          <HelpSection title="Personal information">
            <Body>
              Your name, known-as name (what is shown when you appear in team lists), email,
              phone numbers, and address. Keep these up to date so the club can contact you and
              include you correctly in the handbook. Your buddy is set here too — see the Buddy help.
            </Body>
          </HelpSection>

          <HelpSection title="Membership information">
            <Body>
              Your member type, role, the year you started, your age group and your locker. Your locker
              is allocated by the club and can&apos;t be changed here — ask the committee.
            </Body>
          </HelpSection>

          <HelpSection title="Volunteering preferences">
            <Body>
              You can indicate whether you are willing to drive other members to away matches,
              help with green maintenance, or do bar duty. There is also a free-text field for
              any other skills you can offer the club.
            </Body>
          </HelpSection>

          <HelpSection title="Permissions">
            <Body>
              <strong>Social event emails</strong> — tick this if you are happy to receive
              emails about social events and club news. <strong>Handbook entry</strong> — tick
              this to have your contact details included in the printed membership handbook.
            </Body>
          </HelpSection>

          <HelpSection title="Age demographic">
            <Body>
              Your age group sets your membership fee, so keep it right before you renew. If you select{' '}
              <strong>Under 18</strong>, a date of birth field appears — this is required for junior members.
            </Body>
          </HelpSection>

          <HelpSection title="Unsaved changes">
            <Note>
              If you navigate away without saving, your changes are kept on that device. When you come
              back to your profile they are put back automatically (&quot;Draft restored from previous
              session&quot;) — tap Save to keep them, or Cancel to drop them.
            </Note>
          </HelpSection>
        </div>
      </div>
    </div>
  );
}
