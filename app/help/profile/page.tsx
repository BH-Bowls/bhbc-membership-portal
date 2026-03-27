'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Tip, Body, BackLink } from '../_components';

export default function HelpProfilePage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Your Profile</h1>
          <p className="text-gray-500 text-sm mt-1">Keeping your details up to date</p>
        </div>
        <div className="space-y-4">
          <HelpSection title="Editing your profile">
            <Step n={1}>Go to <strong>Profile</strong> in the navigation menu.</Step>
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
              include you correctly in the handbook.
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
              Used for club reporting. If you select <strong>Under 18</strong>, a date of birth
              field will appear — this is required for junior members.
            </Body>
          </HelpSection>

          <HelpSection title="Unsaved changes">
            <Note>
              If you navigate away without saving, your draft is automatically saved for you.
              When you return to the profile page you will be offered the option to restore it.
            </Note>
          </HelpSection>
        </div>
      </div>
    </div>
  );
}
