'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpKioskPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Clubhouse Kiosk &amp; Access PIN</h1>
          <p className="text-gray-500 text-sm mt-1">Using the portal without your own login</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Two ways in without a login">
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li>
                <strong>The clubhouse kiosk</strong> — a shared tablet in the clubhouse, logged in to one
                shared account, so anyone can look things up.
              </li>
              <li>
                <strong>The access PIN</strong> — lets visitors and members who aren&apos;t logged in see the
                club&apos;s public pages, such as fixtures and team sheets.
              </li>
            </ul>
            <Body>
              Neither shows anyone&apos;s phone number or email address. They are separate from the bar
              till, which has its own PIN and approved tablets — see{' '}
              <Link href="/help/bar-devices" className="text-blue-600 hover:text-blue-800">Bar Till Devices</Link>.
            </Body>
          </HelpSection>

          <HelpSection title="Setting up the clubhouse kiosk">
            <Step n={1}>On the clubhouse tablet, go to <strong>/kiosk</strong> on the portal.</Step>
            <Step n={2}>Enter the kiosk PIN. It opens on Friendlies.</Step>
            <Step n={3}>Add it to the tablet&apos;s home screen so it is easy to get back to.</Step>
            <Body>
              The kiosk PIN is the password of the shared &quot;clubhouse&quot; account. Ask an Admin if it
              needs changing — every kiosk then needs the new PIN.
            </Body>
          </HelpSection>

          <HelpSection title="What the kiosk can do">
            <Body>
              The account menu just says <strong>Kiosk Mode</strong>, with Logout. The menu has
              Competitions, Leagues, Friendlies, Invite Games, Rowland Cup and Lookups (Clubs, Fixtures,
              Documents, the Tea, Cleaning and Sweeping Rotas, the 200 Club and Halve It).
            </Body>
            <Body>
              It can&apos;t see the member list or anyone&apos;s contact details, and has no My Account,
              Renewals, Switch User or Admin. Members who want to enter a game, swap a duty or see their
              account should log in on their own phone.
            </Body>
            <Note>Log the kiosk out if the tablet is taken out of the clubhouse or lost.</Note>
          </HelpSection>

          <HelpSection title="The access PIN">
            <Body>
              Some pages can be seen without logging in — fixtures, friendly team sheets, competitions,
              leagues, the rotas and clubs. While the club has an access PIN set, a visitor who opens one
              of these is asked for it first (&quot;Enter the access PIN to view the club pages&quot;), with a{' '}
              <strong>Log in</strong> link for members. The PIN is remembered on that device for 30 days.
            </Body>
            <Body>
              While it is active the menu shows <strong>Members Area Active</strong>, with{' '}
              <strong>Leave members area</strong> to lock the pages again — useful on a shared computer.
            </Body>
            <Body>Nobody is asked for the access PIN:</Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li>when logged in;</li>
              <li>on the Rowland Cup pages;</li>
              <li>when following a link in an email, such as a visitor&apos;s link to a friendly&apos;s team sheet;</li>
              <li>on the bar till, which has its own PIN.</li>
            </ul>
            <Note>
              The member list (Lookups → Members) and everyone&apos;s contact details need a proper login —
              the access PIN doesn&apos;t open them.
            </Note>
          </HelpSection>

          <HelpSection title="Changing the access PIN">
            <Body>
              The access PIN is a setting on the server (<strong>PUBLIC_ACCESS_PIN</strong> in Vercel), not in
              Config. Changing it needs the app redeploying, and everyone who entered the old PIN is asked
              for the new one. Removing it makes those pages fully public.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
