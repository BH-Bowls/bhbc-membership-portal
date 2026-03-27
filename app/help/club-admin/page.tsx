'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpClubAdminPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Club Directory Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Managing visiting clubs and their contacts</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="The club directory">
            <Body>
              The Clubs page lists all visiting clubs involved in the Rowland Cup and other
              competitions. As a GMC member you can add new clubs, edit existing ones, and manage
              the contact people for each competition.
            </Body>
          </HelpSection>

          <HelpSection title="Adding a club">
            <Step n={1}>Go to Clubs.</Step>
            <Step n={2}>Tap Add Club.</Step>
            <Step n={3}>Enter the club name, address, phone, email, and website.</Step>
            <Step n={4}>Save.</Step>
          </HelpSection>

          <HelpSection title="Editing a club">
            <Step n={1}>Find the club in the list and tap it.</Step>
            <Step n={2}>Tap Edit.</Step>
            <Step n={3}>Update any details.</Step>
            <Step n={4}>Save.</Step>
          </HelpSection>

          <HelpSection title="Adding contacts">
            <Step n={1}>Open the club's page.</Step>
            <Step n={2}>Under Contacts, tap Add Contact.</Step>
            <Step n={3}>Enter the contact's name, role, phone, and the competition they are associated with (e.g. EdwardRowland A).</Step>
            <Step n={4}>Save. The contact will appear highlighted with the competition badge on the club's page.</Step>
          </HelpSection>

          <HelpSection title="Editing or removing contacts">
            <Body>
              Tap any contact to edit their details. Use Delete to remove a contact who is no longer
              relevant. Contacts are visible to all logged-in users including visiting club logins.
            </Body>
          </HelpSection>

          <HelpSection title="Club logins">
            <Body>
              Visiting clubs have their own login credentials (separate from member accounts). These
              are set up by an Admin in the member profile system. The club shares one login across
              everyone who manages their Rowland Cup matches.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
