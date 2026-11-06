'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Body, Note, BackLink } from '../_components';

export default function HelpAdminToolsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Admin Tools</h1>
          <p className="text-gray-500 text-sm mt-1">Config, Logs, Backups and Cache View</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Where to find them">
            <Body>
              These are in the <strong>System</strong> group of the Admin menu, for Admin only. The Bar Till
              and Bar Till Devices are in the same group — see the{' '}
              <Link href="/help/bar" className="text-blue-600 hover:text-blue-800">Bar till</Link> and{' '}
              <Link href="/help/bar-devices" className="text-blue-600 hover:text-blue-800">Bar Till Devices</Link> help.
            </Body>
          </HelpSection>

          <HelpSection title="Config">
            <Body>Settings for the whole portal, on four tabs. Changes take effect straight away.</Body>
            <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 mb-3">
              <li>
                <strong>General</strong>
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li>
                    <strong>Maintenance mode</strong> — stops everyone except Admins logging in, and sends
                    anyone already logged in to a maintenance page. A warning shows while it is on. Remember
                    to turn it off.
                  </li>
                  <li>
                    <strong>Min friendlies for competitions eligibility</strong> — how many friendlies a
                    playing member must have made themselves available for last season to enter club
                    competitions on their renewal. It can be overridden for a member on their record.
                  </li>
                  <li>
                    <strong>Online renewal payments (Stripe)</strong> — switches on &quot;Pay online&quot; for
                    renewals.
                  </li>
                  <li>
                    <strong>Bank details</strong> — shown to members on their renewal and in My Account for
                    paying by bank transfer.
                  </li>
                  <li>
                    The green&apos;s rinks, capacity warning and players per day, used by Season Planning, and
                    the age anchor (not used yet).
                  </li>
                </ul>
              </li>
              <li>
                <strong>Labels</strong> — the label sheet layouts, each label type&apos;s default layout, and
                the booklet message, used by{' '}
                <Link href="/help/labels" className="text-blue-600 hover:text-blue-800">Print Labels</Link>.
              </li>
              <li>
                <strong>Rowland</strong> — settings for the public Rowland Cup team entry form and its
                confirmation email.
              </li>
              <li>
                <strong>Bar</strong>
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li>
                    <strong>Pricing mode</strong> and <strong>member discount rate</strong> — single price,
                    separate member and visitor prices, a discount off a member&apos;s whole bill, or a
                    discount per product.
                  </li>
                  <li>
                    <strong>Card or PIN needed for Pay by Account and Top Up</strong> — No one, Members with
                    the Testing role (to trial it), or Everyone.
                  </li>
                  <li>
                    <strong>Person serving confirms with card or PIN</strong> for Day End, Void, Refund and
                    Cash Movement — the same choices. Switch it on once bar staff have set their PINs.
                  </li>
                  <li>
                    <strong>Till float</strong> and <strong>cash carried forward</strong> — Day End keeps
                    these up to date. Only change them to correct a mistake, and tell the Treasurer.
                  </li>
                </ul>
              </li>
            </ul>
          </HelpSection>

          <HelpSection title="Logs">
            <Body>The most recent entries from four logs:</Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li><strong>Login Attempts</strong> — every login, successful or not. Useful when a member says they can&apos;t log in.</li>
              <li><strong>Password Reset Requests</strong> — forgotten-password requests (limited to 3 an hour each).</li>
              <li><strong>Impersonation Log</strong> — every time someone starts or stops Switch User.</li>
              <li>
                <strong>Member Emails</strong> — every email the portal has sent: friendlies notices,
                renewals, bulk emails, password resets and more. Check here when someone says an email
                didn&apos;t arrive.
              </li>
            </ul>
            <Body>Each log has <strong>Clear log</strong>, for a reset at the end of the season.</Body>
          </HelpSection>

          <HelpSection title="Backups">
            <Body>
              Every night a copy of the whole database is made, checked, and saved to the{' '}
              <strong>BHBC Database Backups</strong> folder in the club&apos;s Google Drive. Copies older than
              90 days are deleted. If a backup fails, an alert is emailed.
            </Body>
            <Body>
              The Backups page checks they are arriving: how recent the newest one is, its size, whether
              any day was missed, and whether old ones are being cleared. It only looks — nothing on this
              page can change or restore a backup.
            </Body>
            <Note>
              Restoring a backup is done by a developer, not from the portal. After a restore of the live
              database, the app must be redeployed in Vercel, or it can keep showing old data for a while.
            </Note>
          </HelpSection>

          <HelpSection title="Cache View">
            <Body>
              To stay fast, the portal keeps copies of some data (such as the member list) in memory and
              refreshes them when something changes. Cache View shows how those copies are being used and
              when they were last refreshed. It is a diagnostic page — mostly useful if something looks out
              of date. Nothing on it needs changing day to day.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
