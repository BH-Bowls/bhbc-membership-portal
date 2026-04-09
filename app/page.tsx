'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getBadgeClasses } from '@/config/theme-helpers';
import { useSessionRefresh } from '@/hooks/useSessionRefresh';

export default function HomePage() {
  const { data: session, status } = useSession();

  // Refresh session data from database (picks up role changes, etc.)
  useSessionRefresh();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session || !session.user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session.user?.name ?? undefined} userRole={session.user?.role ?? undefined} />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Welcome Card */}
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Welcome, {session.user.name}!
              </h2>

              <div className="space-y-3">
                <div>
                  <span className="text-sm font-medium text-gray-500">Username:</span>
                  <p className="mt-1 text-sm text-gray-900">{session.user.userName}</p>
                </div>

                {session.user.email && (
                  <div>
                    <span className="text-sm font-medium text-gray-500">Email:</span>
                    <p className="mt-1 text-sm text-gray-900">{session.user.email}</p>
                  </div>
                )}

                <div>
                  <span className="text-sm font-medium text-gray-500">Role:</span>
                  <p className="mt-1">
                    <span className={getBadgeClasses('primary', 'sm')}>
                      {session.user.role}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Info Section - Quick Start Guide */}
          <div className="mt-6 bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Quick Start
              </h3>

              {session.user.role === 'Club' ? (
                /* Club login quick start */
                <div className="text-sm text-gray-600 space-y-2">
                  <p>
                    Use the menu to access the <strong>Rowland Cup</strong> — your draw, match schedule, and results — and <strong>Clubs</strong> to find contact details for others in your section.
                  </p>
                  <p>
                    Once you have played a match, submit your result directly from the Rowland Cup page. You can also update your own club&apos;s contact details from the <strong>Clubs</strong> section.
                  </p>
                </div>
              ) : (
                <>
                  {/* Message for narrow screens (mobile) */}
                  <div className="md:hidden text-sm text-gray-600 space-y-2">
                    <p>
                      Tap the menu (<span className="inline-flex items-center font-medium text-gray-900">
                        <svg className="h-4 w-4 mx-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                      </span>) in the top right to get around. Check <strong>Friendlies</strong> for upcoming matches, <strong>Competitions</strong> for your draw, and <strong>Leagues</strong> to enter or follow club leagues.
                    </p>
                    <p>
                      Not sure where something is? Tap <strong>Help</strong> in the menu.
                    </p>
                  </div>

                  {/* Message for wide screens (desktop) */}
                  <div className="hidden md:block text-sm text-gray-600 space-y-2">
                    <p>
                      Use the navigation bar above to get around. Check <strong>Friendlies</strong> for upcoming matches, <strong>Competitions</strong> for your draw, and <strong>Leagues</strong> to enter or follow club leagues. Click your profile icon in the top right to manage your profile and settings.
                    </p>
                    <p>
                      Not sure where something is? Open <strong>Help</strong> from the menu.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
