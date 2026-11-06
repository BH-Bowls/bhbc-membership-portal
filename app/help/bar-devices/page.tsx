'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpBarDevicesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Bar Till Devices</h1>
          <p className="text-gray-500 text-sm mt-1">Approving the till tablet, and pairing the Square Terminal</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Why devices need approving">
            <Body>
              The bar till logs in with its own PIN. So that someone who learns the PIN can&apos;t run the
              till from their own phone, it only works on tablets an Admin has approved, on{' '}
              <strong>Admin → System → Bar Till Devices</strong>.
            </Body>
            <Body>
              For how the till itself is used, see the{' '}
              <Link href="/help/bar" className="text-blue-600 hover:text-blue-800">Bar till</Link> help.
            </Body>
          </HelpSection>

          <HelpSection title="Approving a new tablet">
            <Step n={1}>
              On the new tablet, open the till (<strong>/bar</strong>). Underneath the PIN box it shows a{' '}
              <strong>pairing code</strong>, and the tablet appears under <strong>Pending</strong> on Bar Till
              Devices.
            </Step>
            <Step n={2}>On Bar Till Devices, tap <strong>Approve…</strong> next to it.</Step>
            <Step n={3}>
              Type the pairing code shown on the tablet&apos;s screen — so you can only approve the tablet in
              front of you — and give it a name, e.g. &quot;Clubhouse iPad&quot;. Tap <strong>Confirm</strong>.
            </Step>
            <Step n={4}>The tablet can now log in with the till PIN.</Step>
            <Note>
              A tablet is recognised by something saved in its browser. If the browser&apos;s data is cleared,
              a different browser is used, or a kiosk app is reinstalled, it shows a new pairing code and
              needs approving again. Revoke the old entry when that happens.
            </Note>
          </HelpSection>

          <HelpSection title="Revoking a tablet">
            <Body>
              Tap <strong>Revoke</strong> on a tablet that is lost, replaced or no longer used. It is refused
              the next time it tries to log in. A till that is already logged in carries on until it is
              logged out — after 4 hours with nothing happening, or 24 hours at most — so log it out too if
              you need it stopped straight away.
            </Body>
          </HelpSection>

          <HelpSection title="The Square Terminal">
            <Body>
              The same page sets up the Square Terminal that takes card payments for the till.
            </Body>
            <Step n={1}>Tap <strong>Pair a Terminal</strong> and give it a name.</Step>
            <Step n={2}>
              On the Terminal, choose <strong>Sign in with device code</strong> and enter the code shown. The
              code expires after a while — if it does, get a new one.
            </Step>
            <Step n={3}>When it says <strong>Paired</strong>, the till sends card payments to the Terminal.</Step>
            <Body>
              <strong>Stop using this Terminal…</strong> unpairs it. The till then goes back to asking staff
              to tick that they took the card payment on a separate card machine.
            </Body>
          </HelpSection>

          <HelpSection title="Card payments needing attention">
            <Body>
              Occasionally a card payment goes through on the Terminal but the till can&apos;t record it
              cleanly — for example if the connection drops at the wrong moment. These are listed here in
              red. Sort each one out by hand — record it, or refund it in Square — then tap{' '}
              <strong>Mark dealt with</strong>.
            </Body>
            <Note>
              The <Link href="/banking/data-checks" className="text-blue-900 underline">Data Checks</Link> page
              also flags card payments that were never recorded.
            </Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
