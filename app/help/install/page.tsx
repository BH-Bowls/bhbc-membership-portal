'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Tip, Body, BackLink } from '../_components';

export default function HelpInstallPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Add to your home screen</h1>
          <p className="text-gray-500 text-sm mt-1">Open the portal like an app on your phone, tablet, or computer</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Why do this?">
            <Body>
              You can add the portal to your home screen or desktop so it opens like any other app —
              with its own icon, no browser address bar, and straight to the portal without any extra
              taps. Your login stays active, so you go straight in.
            </Body>
            <Tip>
              This is entirely optional. The portal works just as well in a normal browser tab.
            </Tip>
          </HelpSection>

          <HelpSection title="iPhone &amp; iPad">
            <Note>
              On Apple devices this only works in <strong>Safari</strong>. If you normally use
              Chrome or Firefox, switch to Safari just for this step.
            </Note>
            <Step n={1}>Open the portal in <strong>Safari</strong>.</Step>
            <Step n={2}>
              Tap the <strong>Share</strong> button — the box with an arrow pointing up. On iPhone
              it is at the bottom of the screen; on iPad it is at the top.
            </Step>
            <Step n={3}>
              Scroll down the list and tap <strong>Add to Home Screen</strong>.
            </Step>
            <Step n={4}>
              Change the name if you like, then tap <strong>Add</strong> in the top right.
            </Step>
            <Body>
              The BHBC logo will appear on your home screen. Tap it to open the portal in its own
              full-screen window.
            </Body>
          </HelpSection>

          <HelpSection title="Android phone &amp; tablet">
            <Note>
              This works in <strong>Chrome</strong> and <strong>Samsung Internet</strong>. It is
              not supported in Firefox.
            </Note>
            <Body><strong>Chrome</strong></Body>
            <Step n={1}>Open the portal in Chrome.</Step>
            <Step n={2}>Tap the <strong>three-dot menu</strong> (⋮) in the top right corner.</Step>
            <Step n={3}>
              Tap <strong>Add to Home screen</strong> — it may say <strong>Install app</strong>{' '}
              instead.
            </Step>
            <Step n={4}>Tap <strong>Add</strong> to confirm.</Step>
            <Body><strong>Samsung Internet</strong></Body>
            <Step n={1}>Open the portal in Samsung Internet.</Step>
            <Step n={2}>Tap the <strong>three-line menu</strong> (☰) at the bottom of the screen.</Step>
            <Step n={3}>Tap <strong>Add page to</strong> → <strong>Home screen</strong>.</Step>
            <Step n={4}>Tap <strong>Add</strong> to confirm.</Step>
          </HelpSection>

          <HelpSection title="Windows (PC or laptop)">
            <Note>
              This works in <strong>Chrome</strong> and <strong>Microsoft Edge</strong>. It is not
              supported in Firefox.
            </Note>
            <Body><strong>Chrome</strong></Body>
            <Step n={1}>Open the portal in Chrome.</Step>
            <Step n={2}>
              Look for the <strong>install icon</strong> in the address bar — it looks like a
              computer screen with a small download arrow. Click it.
            </Step>
            <Step n={3}>Click <strong>Install</strong>.</Step>
            <Body>
              The portal is added to your Start menu and can be pinned to the taskbar like any
              other program.
            </Body>
            <Body><strong>Microsoft Edge</strong></Body>
            <Step n={1}>Open the portal in Edge.</Step>
            <Step n={2}>
              Click the <strong>install icon</strong> in the address bar, or go to{' '}
              <strong>⋯ menu → Apps → Install this site as an app</strong>.
            </Step>
            <Step n={3}>Click <strong>Install</strong>.</Step>
          </HelpSection>

          <HelpSection title="Chromebook">
            <Body>
              The steps are the same as Chrome on Windows above. Once installed, the portal appears
              in your app launcher and shelf and opens in its own window, the same as any other
              Chromebook app.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
