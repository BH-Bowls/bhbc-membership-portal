// app/clubs/page.tsx
// Clubs list page - displays all clubs with search functionality
// All users can view, non-members can add new clubs

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses } from '@/config/theme-helpers';
import { Club } from '@/lib/types/clubs';
import { restoreDraft } from '@/lib/form-draft-utils';

export default function ClubsPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Check if user can create/edit clubs
  const userRole = session?.user?.role || 'Member';
  const canEdit = userRole !== 'Member' && userRole !== 'Kiosk' && userRole !== 'Rowland';

  // Check for draft and redirect to club being edited
  useEffect(() => {
    if (session?.user?.userName) {
      const draft = restoreDraft<{ clubName: string }>('Club', session.user.userName);
      if (draft?.clubName) {
        router.push(`/clubs/${encodeURIComponent(draft.clubName)}`);
        return;
      }
    }
  }, [session?.user?.userName, router]);

  useEffect(() => {
    fetchClubs();
  }, []);

  async function fetchClubs() {
    setLoading(true);
    try {
      const response = await fetch('/api/clubs');
      const data = await response.json();
      if (data.clubs) {
        setClubs(data.clubs);
      }
    } catch (error) {
      console.error('Failed to fetch clubs:', error);
    } finally {
      setLoading(false);
    }
  }

  // Filter clubs by search term
  const filteredClubs = clubs.filter(club =>
    club.clubName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    club.address3?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    club.postCode?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Get location summary for a club
  const getLocationSummary = (club: Club): string => {
    const parts = [club.address3, club.address4].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(', ');
    }
    if (club.postCode) {
      return club.postCode;
    }
    return 'Location not specified';
  };

  // Get driving band badge color
  const getDrivingBandColor = (band: string): string => {
    switch (band?.toUpperCase()) {
      case 'A':
        return 'bg-green-500';
      case 'B':
        return 'bg-yellow-500';
      case 'C':
        return 'bg-orange-500';
      case 'D':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Page header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Clubs</h1>
          {canEdit && (
            <Link
              href="/clubs/new"
              className={getButtonClasses('primary', 'md')}
            >
              Add Club
            </Link>
          )}
        </div>

        {/* Search box */}
        <div className="mb-6">
          <div className="relative">
            <input
              type="text"
              placeholder="Search clubs by name, town, or postcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-3 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Clubs list */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading clubs...</p>
          </div>
        ) : filteredClubs.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            {searchTerm ? (
              <>
                <p className="text-gray-600">No clubs found matching "{searchTerm}"</p>
                <button
                  onClick={() => setSearchTerm('')}
                  className="mt-2 text-blue-500 hover:text-blue-600"
                >
                  Clear search
                </button>
              </>
            ) : (
              <p className="text-gray-600">No clubs found.</p>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Showing {filteredClubs.length} of {clubs.length} clubs
            </p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredClubs.map((club) => (
                <Link
                  key={club.clubName}
                  href={`/clubs/${encodeURIComponent(club.clubName)}`}
                  className="bg-white rounded-lg shadow border border-gray-200 p-4 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer"
                >
                  {/* Club card header */}
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-lg text-blue-600 flex-1 pr-2">{club.clubName}</h3>
                    {club.drivingBand && (
                      <span
                        className={`inline-block px-2 py-1 text-xs font-semibold text-white rounded ${getDrivingBandColor(club.drivingBand)}`}
                        title={`Driving Band ${club.drivingBand}`}
                      >
                        Band {club.drivingBand}
                      </span>
                    )}
                  </div>

                  {/* Location */}
                  <p className="text-sm text-gray-600 flex items-center">
                    <svg className="h-4 w-4 mr-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {getLocationSummary(club)}
                  </p>

                  {/* Additional info */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {club.website && (
                      <span className="inline-flex items-center text-xs text-blue-600">
                        <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                        Website
                      </span>
                    )}
                    {(club.clubNumber || club.clubMobile) && (
                      <span className="inline-flex items-center text-xs text-gray-500">
                        <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        Phone
                      </span>
                    )}
                    {club.clubEmailAddress && (
                      <span className="inline-flex items-center text-xs text-gray-500">
                        <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Email
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
