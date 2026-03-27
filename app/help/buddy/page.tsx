'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Tip, Body, BackLink } from '../_components';

export default function HelpBuddyPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Buddy System</h1>
          <p className="text-gray-500 text-sm mt-1">Letting another member help manage your account</p>
        </div>
        <div className="space-y-4">
          <HelpSection title="What is a buddy?">
            <Body>
              A buddy is a member you trust to help manage your account. Once you have set a
              buddy, they can switch to your profile and update your details or complete your
              renewals on your behalf — useful if you are not comfortable using the portal
              yourself.
            </Body>
          </HelpSection>

          <HelpSection title="Setting your buddy">
            <Step n={1}>Go to <strong>Profile</strong> in the navigation menu.</Step>
            <Step n={2}>Tap <strong>Edit Profile</strong>.</Step>
            <Step n={3}>
              In the <strong>Buddy Name</strong> field, search for and select the member you
              want as your buddy.
            </Step>
            <Step n={4}>Tap <strong>Save</strong>.</Step>
          </HelpSection>

          <HelpSection title="Removing a buddy">
            <Step n={1}>Go to Profile and tap <strong>Edit Profile</strong>.</Step>
            <Step n={2}>
              Next to the <strong>Buddy Name</strong> field, tap <strong>Clear</strong>.
            </Step>
            <Step n={3}>Tap <strong>Save</strong>.</Step>
          </HelpSection>

          <HelpSection title="For buddies — switching to another member">
            <Body>
              If another member has set you as their buddy, a <strong>Switch User</strong>{' '}
              option will appear in your account menu (top-right corner). Tap it, find the
              member in the list, and select them to manage their account. Tap{' '}
              <strong>Exit</strong> when you are done to return to your own account.
            </Body>
          </HelpSection>

          <HelpSection title="Privacy">
            <Note>
              Buddies can see and edit your profile and renewals, but cannot change your
              password or access your login credentials.
            </Note>
          </HelpSection>
        </div>
      </div>
    </div>
  );
}
