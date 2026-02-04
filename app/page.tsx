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

              {/* Message for narrow screens (mobile) */}
              <div className="md:hidden text-sm text-gray-600 space-y-2">
                <p>
                  Use the Hamburger Menu (<span className="inline-flex items-center font-medium text-gray-900">
                    <svg className="h-4 w-4 mx-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </span>) in the top right to access different sections of the portal.
                </p>
                <p>
                  You can manage your profile, submit membership renewals, and take a sneak preview at the new friendly match system.
                </p>
              </div>

              {/* Message for wide screens (desktop) */}
              <div className="hidden md:block text-sm text-gray-600 space-y-2">
                <p>
                  Use the navigation menu above to access different sections of the portal. Click the <span className="inline-flex items-center font-medium text-gray-900">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-medium mx-1">
                      {session.user.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                    profile icon
                  </span> in the top right for additional options.
                </p>
                <p>
                  You can manage your profile, submit membership renewals, and take a sneak preview at the new friendly match system.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
