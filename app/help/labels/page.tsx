'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Step, Body, Note, Tip, BackLink } from '../_components';

export default function HelpLabelsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Print Labels</h1>
          <p className="text-gray-500 text-sm mt-1">Address, booklet, locker and membership card labels</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Where to find it">
            <Body>
              <strong>Admin → Members → Print Labels</strong> (Admin only). It prints onto sheets of sticky
              labels, such as Avery L7163.
            </Body>
          </HelpSection>

          <HelpSection title="Label types">
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li><strong>Address</strong> — name and address, for posting.</li>
              <li><strong>Booklet</strong> — for the front of a member&apos;s booklet: the club banner, their name, membership type and locker, and the booklet message set in Config.</li>
              <li><strong>Locker</strong> — one per locker, from the Locker Register.</li>
              <li>
                <strong>Membership Card</strong> — a card-sized label with the member&apos;s name and the QR
                code they scan at the bar.
              </li>
            </ul>
          </HelpSection>

          <HelpSection title="Printing">
            <Step n={1}>Choose the <strong>label type</strong>. Its usual sheet layout is picked for you; choose another layout if you are using different labels.</Step>
            <Step n={2}>
              Choose who to print for: <strong>All members</strong>, <strong>Include in Mailings only</strong>{' '}
              (members ticked for club mailings), or <strong>Manual selection</strong> — search and tick the
              members you want.
            </Step>
            <Step n={3}>Choose the sort order — the original order, or by last name A–Z.</Step>
            <Step n={4}>
              Set <strong>Copies per member</strong> if you need more than one of each, and{' '}
              <strong>Skip labels</strong> to start part-way down a sheet that has already been used.
            </Step>
            <Step n={5}>
              Tap <strong>Print</strong> — the button shows how many labels and sheets it will use — and print
              at actual size (100%, not &quot;fit to page&quot;).
            </Step>
            <Tip>Print one sheet on plain paper first and hold it against a label sheet to check it lines up.</Tip>
          </HelpSection>

          <HelpSection title="Locker labels">
            <Body>
              For locker labels, choose the room (or both), and whether to print lockers in use or all of
              them (empty ones print with just the number). Locker labels come from the{' '}
              <Link href="/help/lockers" className="text-blue-600 hover:text-blue-800">Locker Register</Link>,
              which also has a <strong>Print locker labels</strong> button.
            </Body>
          </HelpSection>

          <HelpSection title="Setting up layouts">
            <Note>
              The sheet layouts (label sizes and spacing), each label type&apos;s default layout, and the
              booklet message are set up in <strong>Admin → Config</strong>, on the Labels tab — use{' '}
              <strong>Edit label config</strong> at the bottom of Print Labels.
            </Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
