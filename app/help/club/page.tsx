// app/help/club/page.tsx
// Getting started guide for visiting clubs (Rowland Cup)

'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-3 last:mb-0">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="text-sm text-gray-700 leading-relaxed">{children}</div>
    </div>
  );
}

export default function ClubHelpPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = session?.user?.role ?? '';

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <button
            onClick={() => router.push('/rowland')}
            className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
          >
            ← Rowland Cup
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Club Guide</h1>
          <p className="text-gray-500 text-sm mt-1">
            How to use the BHBC portal for the Rowland Cup
          </p>
        </div>

        <div className="space-y-4">

          {/* Shared login */}
          <Section title="1. Shared club login">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
              <strong>Important:</strong> There is one login for your entire club. Share the username and password with everyone at your club who will be managing Rowland Cup matches.
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">
              Anyone at your club who needs to enter match results or player names should use this same login.
            </p>
          </Section>

          {/* Viewing the draw */}
          <Section title="2. Viewing the Rowland Cup draw">
            <Step n={1}>
              Go to <strong>Rowland Cup</strong> from the navigation menu.
            </Step>
            <Step n={2}>
              Select the competition you are entered in (e.g. <em>Edward A</em>).
            </Step>
            <Step n={3}>
              The draw shows all matches. Your club's match is highlighted in blue.
            </Step>
          </Section>

          {/* Entering a result */}
          <Section title="3. Entering a match result">
            <p className="text-sm text-gray-700 mb-4 leading-relaxed">
              Either club can enter the result. Tap your highlighted match to open the result form.
            </p>
            <Step n={1}>
              Enter player names in the <strong>Players</strong> section (up to 4 per team). If you know both teams' players, you can fill in both columns — please use <strong>full names</strong> (e.g. Robert Smith, not Bob).
            </Step>
            <Step n={2}>
              Enter the score for both teams in the <strong>Result</strong> section.
            </Step>
            <Step n={3}>
              Check the <strong>Date played</strong> is correct (it defaults to today).
            </Step>
            <Step n={4}>
              Tap <strong>Save</strong>. If scores are filled in, the result is recorded. If you leave the scores blank, only the player names are saved.
            </Step>
            <p className="text-sm text-gray-500 mt-4">
              <strong>If one club has already entered the result</strong> and your club still needs to add player names, tap the match (it will still be tappable even after the result is recorded) and save your players.
            </p>
          </Section>

          {/* Club contact details */}
          <Section title="4. Finding your opponent's contact details">
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              Go to <strong>Clubs</strong> in the navigation menu to find information about any club in the competition.
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">
              Each club's page lists contact names for each competition — clearly highlighted with the competition name, e.g.{' '}
              <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">EdwardRowland A</span>
              {' '}— these are the people you should get in touch with to arrange your match. You will also find the club's address, phone number, email address, and website where available.
            </p>
          </Section>

          {/* Walkover */}
          <Section title="5. Recording a walkover">
            <p className="text-sm text-gray-700 leading-relaxed">
              If one team cannot play, tap your match and choose <strong>Record walkover instead</strong>. Select which team advances. Contact BHBC if you are unsure.
            </p>
          </Section>

          {/* Contact */}
          <Section title="6. Problems or questions?">
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              For any queries about the Rowland Cup — including match results, the draw, or anything else — email{' '}
              <a href="mailto:rowlandsbhbc@gmail.com" className="text-blue-600 underline hover:text-blue-800">
                rowlandsbhbc@gmail.com
              </a>.
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">
              If you forget your password, contact Burgess Hill Bowls Club and they will reset it for you.
            </p>
          </Section>

          {/* Password */}
          <Section title="7. Changing your password">
            <Step n={1}>
              Click your name in the top-right corner of the screen and select <strong>Change Password</strong>, or go to{' '}
              <button
                onClick={() => router.push('/change-password')}
                className="text-blue-600 underline hover:text-blue-800"
              >
                Change Password
              </button>.
            </Step>
            <Step n={2}>
              Enter your current password, then choose a new password your club will remember.
            </Step>
            <Step n={3}>
              Save the new password. You will be asked to log in again.
            </Step>
          </Section>

        </div>
      </div>
    </div>
  );
}
