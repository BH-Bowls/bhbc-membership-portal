'use client';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpClubAdminPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Club Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Managing other clubs and their contacts</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="The club directory">
            <Body>
              <strong>Lookups → Clubs</strong> lists the clubs we play — in friendlies, the Rowland Cup and
              other competitions. Each club&apos;s page shows its contact details, address and location
              (with distance and travel time), driving band, general information, friendly planning notes,
              its contacts, and the fixtures we have played against it.
            </Body>
            <Body>
              Committee members and other role holders (such as Rowland organisers) can add and edit
              clubs and contacts. Ordinary members and the clubhouse kiosk can only look.
            </Body>
          </HelpSection>

          <HelpSection title="Adding a club">
            <Step n={1}>Go to Lookups → Clubs.</Step>
            <Step n={2}>Tap <strong>Add Club</strong>.</Step>
            <Step n={3}>Enter the club&apos;s name and details, and save.</Step>
          </HelpSection>

          <HelpSection title="Editing a club">
            <Step n={1}>Open the club&apos;s page and tap <strong>Edit</strong>.</Step>
            <Step n={2}>Change its phone, mobile, email, website, address, driving band, information or planning notes.</Step>
            <Step n={3}>Tap <strong>Save</strong> at the top. <strong>Delete Club</strong> removes a club and all its contacts.</Step>
          </HelpSection>

          <HelpSection title="Contacts">
            <Step n={1}>On the club&apos;s page, under <strong>Contacts</strong>, tap <strong>New Contact</strong>.</Step>
            <Step n={2}>
              Enter their first and last name, phone, mobile, email and any notes, and tick their roles —
              for example which Rowland Cup team they organise.
            </Step>
            <Step n={3}>Tap <strong>Add Contact</strong>.</Step>
            <Body>Tap a contact to change their details, or use <strong>Delete Contact</strong>.</Body>
            <Note>
              The Clubs pages can be seen without a login by anyone with the club&apos;s access PIN, so
              other clubs&apos; contact details are visible to them too. Only record what the contact is
              happy to share.
            </Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
