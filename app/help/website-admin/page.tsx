'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpWebsiteAdminPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Website Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Keeping the public club website up to date</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="What it is">
            <Body>
              <strong>Admin → Website → Website Admin</strong> (Admin, Captain and GMC) edits the content of
              the club&apos;s public website, burgesshillbowlsclub.com. Changes go to the website as soon as
              you save — there is nothing else to publish, though a page can take a few minutes to update.
            </Body>
            <Note>
              Website announcements are separate from the portal&apos;s own home-page announcements (Admin →
              Announcements), which only members see.
            </Note>
          </HelpSection>

          <HelpSection title="What you can change">
            <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 mb-3">
              <li><strong>Committee</strong> — the committee list on the About page.</li>
              <li><strong>Coaches</strong> — the coaches on the Coaching page.</li>
              <li>
                <strong>Announcements</strong> — the banners and cards on the website&apos;s home page (see
                below).
              </li>
              <li>
                <strong>Internal Honours</strong> — one record per season of the club&apos;s own competition
                winners, shown on the Honours page. The year can&apos;t be changed once created — delete it
                and create it again.
              </li>
              <li>
                <strong>Print Honours Boards</strong> — builds print-ready PDFs of the internal honours for
                the clubhouse boards, and photo plaques for the champions&apos; photos. You can adjust the rows
                and style for one print; only an Admin can save them as the club&apos;s settings, or change
                the boards themselves in Setup.
              </li>
              <li>
                <strong>External Honours</strong> — county, national and other external results on the
                Honours page. A year can have several.
              </li>
              <li>
                <strong>Rowland Cup Winners</strong> — the winning clubs each year on the Rowland page, with
                photos of the Edward and Gladys winners (drag and drop to upload).
              </li>
              <li><strong>Documents</strong> — the PDFs on the website&apos;s Documents page (see below).</li>
            </ul>
          </HelpSection>

          <HelpSection title="Website announcements">
            <Step n={1}>Open <strong>Announcements</strong> and tap <strong>New Announcement</strong>.</Step>
            <Step n={2}>
              Choose the type — Notice, Open Day, Visiting Side or Event — and enter a title and the text.
            </Step>
            <Step n={3}>
              Optionally add a button: its label (e.g. &quot;Learn more&quot;) and where it goes (a website
              page such as /join, or a full web address).
            </Step>
            <Step n={4}>
              Set the start and end dates, and tick active. It shows on the website only between those
              dates while it is active; otherwise it is listed here as &quot;Not showing&quot;.
            </Step>
          </HelpSection>

          <HelpSection title="Website documents">
            <Step n={1}>Open <strong>Documents</strong>.</Step>
            <Step n={2}>
              Choose a category, or type a new one to start a new section on the website&apos;s Documents
              page.
            </Step>
            <Step n={3}>Drop in a PDF (up to 50MB) and upload it.</Step>
            <Body>
              The documents are kept in the club&apos;s Google Drive. Members&apos; own documents in the portal
              are under Lookups → Documents — see the{' '}
              <Link href="/help/lookups" className="text-blue-600 hover:text-blue-800">Lookups</Link> help.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
