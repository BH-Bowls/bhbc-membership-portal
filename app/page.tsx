'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getBadgeClasses } from '@/config/theme-helpers';

export default function HomePage() {
  const { data: session, status } = useSession();

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

          {/* Info Section - Placeholder for future content */}
          <div className="mt-6 bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Quick Start
              </h3>
              <p className="text-sm text-gray-600">
                Use the navigation menu above to access different sections of the portal. You can manage your profile, submit membership renewals, and sign up for friendly matches.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
