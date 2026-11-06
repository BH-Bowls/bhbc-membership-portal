'use client';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpLockersPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Locker Register</h1>
          <p className="text-gray-500 text-sm mt-1">Who has which locker, and its keys</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="What it is">
            <Body>
              <strong>Admin → Members → Locker Register</strong> (Admin only) is the club&apos;s one
              record of every locker in the Mens and Ladies changing rooms: its number, key number,
              how many keys there are, who has it, and any notes.
            </Body>
            <Body>
              It is the only place a locker can be allocated or changed. Members see their own locker
              on their profile, but can&apos;t change it there.
            </Body>
          </HelpSection>

          <HelpSection title="Finding a locker">
            <Body>
              The counts at the top show, for each room, how many lockers are Member, Club Locker,
              Occupied and Empty. Below, filter by room or status, or search by member name, key number
              or notes.
            </Body>
          </HelpSection>

          <HelpSection title="Locker statuses">
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li><strong>Member</strong> — allocated to a member. A member must be chosen.</li>
              <li>
                <strong>Club Locker</strong> — used by the club, e.g. the Captain, the Secretary or bowls
                for sale. Put what it is used for in the notes.
              </li>
              <li>
                <strong>Occupied</strong> — in use, but not by a known member. Put who has it in the notes
                if you know.
              </li>
              <li><strong>Empty</strong> — free to allocate.</li>
            </ul>
            <Note>
              A member who has left keeps their locker in the register, marked <strong>Leaver</strong>,
              until you change it — so you can chase the key.
            </Note>
          </HelpSection>

          <HelpSection title="Allocating or changing a locker">
            <Step n={1}>Find the locker and tap <strong>Edit</strong>.</Step>
            <Step n={2}>Set the status, and choose the member (search by name), or tap <strong>Clear</strong> to remove them.</Step>
            <Step n={3}>Check the key number and number of keys, add any notes, and save.</Step>
          </HelpSection>

          <HelpSection title="Adding or removing a locker">
            <Body>
              <strong>Add locker</strong> adds a new one: choose the room, and enter the locker number,
              key number (e.g. &quot;ZA 0412&quot;) and number of keys. To remove a locker that no longer
              exists, edit it and tap <strong>Delete</strong> — this can&apos;t be undone.
            </Body>
          </HelpSection>

          <HelpSection title="Locker labels">
            <Body>
              <strong>Print locker labels</strong> opens Print Labels with the lockers from the register,
              ready to print on a label sheet.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
