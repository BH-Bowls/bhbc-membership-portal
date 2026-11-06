'use client';
import { useSession } from 'next-auth/react';
import { LastUpdated, HelpSection, Step, Note, Body, BackLink } from '../_components';

export default function HelpLoginPage() {
  const { data: session, status } = useSession();
  const isLoggedIn = status === 'authenticated';
  const role = session?.user?.role ?? '';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          {isLoggedIn ? (
            <BackLink href="/help" label="Help" />
          ) : (
            <BackLink href="/login" label="Back to login" />
          )}
          <h1 className="text-2xl font-bold text-gray-900">Logging In & Out</h1>
          <p className="text-gray-500 text-sm mt-1">Signing in, passwords, and session management</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">
          <HelpSection title="Logging in">
            <Step n={1}>
              Go to the login page. Enter your username or email address and your password.
            </Step>
            <Step n={2}>
              Tap <strong>Sign in</strong>. If your details are correct you will be taken to the
              home page.
            </Step>
            <Step n={3}>
              If you see an error, check your username and password carefully — passwords are
              case-sensitive (capital letters matter), usernames are not.
            </Step>
          </HelpSection>

          <HelpSection title="Shared email address">
            <Body>
              If your email address is shared with another member — for example a partner, child,
              or grandchild — you must use your <strong>username</strong> to log in rather than
              your email address.
            </Body>
            <Body>
              Usernames look like <strong>john.smith</strong> — your first name, a dot, then your
              surname. If you are not sure what your username is, contact the club.
            </Body>
          </HelpSection>

          <HelpSection title="Staying logged in">
            <Body>
              You stay logged in on each device without needing to log in again. You will be asked
              to log in again if you haven&apos;t used the portal on that device for 45 days, and in any
              case 90 days after you last logged in.
            </Body>
          </HelpSection>

          <HelpSection title="Forgot your password">
            <Step n={1}>
              On the login page, tap <strong>Forgot your password?</strong>.
            </Step>
            <Step n={2}>
              Enter your email address and tap <strong>Send Reset Link</strong>.
            </Step>
            <Step n={3}>
              Check your email for a reset link — it expires after a short time.
            </Step>
            <Step n={4}>
              Follow the link and choose a new password.
            </Step>
          </HelpSection>

          <HelpSection title="Changing your password">
            <Note>You need to be logged in to change your password. If you have forgotten your password, use the <strong>Forgot your password</strong> section above instead.</Note>
            <Step n={1}>
              Tap your initials in the top-right corner (or open the ☰ menu on a phone) and choose <strong>Change Password</strong>.
            </Step>
            <Step n={2}>
              Enter your current password, then your new password twice.
            </Step>
            <Step n={3}>
              Save — you will be signed out and asked to log in with the new password.
            </Step>
          </HelpSection>

          <HelpSection title="Signing out">
            <Body>
              Tap your initials in the top-right corner and choose <strong>Logout</strong>. On
              mobile, open the ☰ menu and scroll to the bottom. You will be returned to the
              login page.
            </Body>
          </HelpSection>
        </div>
      </div>
    </div>
  );
}
