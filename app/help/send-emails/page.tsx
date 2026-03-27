'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Body, BackLink } from '../_components';

export default function HelpSendEmailsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Send Member Emails</h1>
          <p className="text-gray-500 text-sm mt-1">Sending bulk emails to members</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Overview">
            <Body>
              The Send Member Emails tool (Admin → Send Member Emails) lets you send emails to all
              members or to a filtered group. You can use saved templates or write a custom message.
            </Body>
          </HelpSection>

          <HelpSection title="Choosing recipients">
            <Step n={1}>Go to Admin → Send Member Emails.</Step>
            <Step n={2}>
              Use the recipient filters to select who should receive the email — for example, all
              playing members, or members of a specific type.
            </Step>
            <Step n={3}>The recipient count will update as you apply filters.</Step>
          </HelpSection>

          <HelpSection title="Using a template">
            <Step n={1}>Select a saved template from the dropdown.</Step>
            <Step n={2}>The subject and body will be pre-filled.</Step>
            <Step n={3}>Edit the content as needed before sending.</Step>
          </HelpSection>

          <HelpSection title="Writing a custom email">
            <Step n={1}>Leave the template selector blank.</Step>
            <Step n={2}>Enter a subject line.</Step>
            <Step n={3}>Write the email body. Plain text is supported.</Step>
          </HelpSection>

          <HelpSection title="Sending">
            <Step n={1}>Review the recipient count and email content carefully.</Step>
            <Step n={2}>Tap Send.</Step>
            <Step n={3}>
              You will see a confirmation once the emails have been queued for delivery.
            </Step>
          </HelpSection>

          <HelpSection title="Templates">
            <Body>
              Saved templates can be created and managed from the Templates tab. Templates are
              useful for recurring emails such as the start-of-season welcome or renewal reminders.
            </Body>
          </HelpSection>

          <HelpSection title="Important">
            <Note>
              Emails are sent to members who have not opted out of club communications. Always check
              the recipient count before sending to avoid unintended bulk sends.
            </Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
