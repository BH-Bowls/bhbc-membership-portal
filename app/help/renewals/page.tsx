'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Note, Body, BackLink } from '../_components';

export default function HelpRenewalsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Renewals</h1>
          <p className="text-gray-500 text-sm mt-1">Annual membership renewal</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="When renewals happen">
            <Body>
              Membership renewals run annually. You will receive an email from the club when it is
              time to renew, with details of the subscription fee for the coming season.
            </Body>
          </HelpSection>

          <HelpSection title="How to pay">
            <Body>
              Payment is made by bank transfer directly to the club account. The renewal email
              will include the account details and the amount to pay. Please use your name as the
              payment reference so the Treasurer can match your payment.
            </Body>
            <Note>
              If you are unsure of the amount or account details, contact the Treasurer.
            </Note>
          </HelpSection>

          <HelpSection title="After you have paid">
            <Body>
              Once your payment has been received and matched, your membership will be marked as
              renewed for the new season. You do not need to do anything else — the Treasurer
              handles this.
            </Body>
          </HelpSection>

          <HelpSection title="Buddy — renewing on someone else's behalf">
            <Body>
              If you are acting as a buddy for another member, you can pay their renewal on their
              behalf. Use their name as the payment reference, or contact the Treasurer to let them
              know.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
