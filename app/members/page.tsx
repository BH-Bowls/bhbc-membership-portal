// app/members/page.tsx
// Member lookup page - search and filter members
// All logged-in members can access this

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';

interface MemberLookupResult {
  fullName: string;
  userName: string;
  memberType: string;
  mobile: string | null;
  landline: string | null;
  emailAddress: string | null;
  greenMaintenance: string | null;
  drivingAwayMatches: string | null;
  barDuty: string | null;
  gmc: string | null;
}

type FilterType = 'none' | 'greenMaintenance' | 'drivingAway' | 'barDuty' | 'gmc';

export default function MembersPage() {
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';

  const [members, setMembers] = useState<MemberLookupResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<FilterType>('none');

  useEffect(() => {
    fetchMembers();
  }, [filter]);

  async function fetchMembers() {
    setLoading(true);
    try {
      const response = await fetch(`/api/members/lookup?filter=${filter}`);
      const data = await response.json();
      if (data.members) {
        setMembers(data.members);
      }
    } catch (error) {
      console.error('Failed to fetch members:', error);
    } finally {
      setLoading(false);
    }
  }

  // Filter members by search term (name search)
  const filteredMembers = members.filter(member =>
    member.fullName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Get member type display name
  const getMemberTypeDisplay = (type: string): string => {
    const types: { [key: string]: string } = {
      'PL': 'Playing Lady',
      'SL': 'Social Lady',
      'PM': 'Playing Man',
      'SM': 'Social Man',
    };
    return types[type] || type;
  };

  // Get contact number (prefer mobile, fall back to landline)
  const getContactNumber = (member: MemberLookupResult): string => {
    return member.mobile || member.landline || '-';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} showLogoOnly={isGuest} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Member Lookup</h1>
          <p className="text-gray-600 mt-1">Search for members and view contact information</p>
        </div>

        {/* Search and filter controls */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search box */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Search by Name</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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

            {/* Filter dropdown */}
            <div className="md:w-64">
              <label className="block text-sm font-medium text-gray-700 mb-1">Filter</label>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterType)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="none">All Members</option>
                <option value="greenMaintenance">Green Maintenance</option>
                <option value="drivingAway">Driving Away Matches</option>
                <option value="barDuty">Bar Duty</option>
                <option value="gmc">GMC (Committee)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading members...</p>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            {searchTerm ? (
              <>
                <p className="text-gray-600">No members found matching "{searchTerm}"</p>
                <button
                  onClick={() => setSearchTerm('')}
                  className="mt-2 text-blue-500 hover:text-blue-600"
                >
                  Clear search
                </button>
              </>
            ) : (
              <p className="text-gray-600">No members found.</p>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Showing {filteredMembers.length} member{filteredMembers.length !== 1 ? 's' : ''}
            </p>

            {/* Desktop table view */}
            <div className="hidden md:block bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Username
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Member Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contact Number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredMembers.map((member) => (
                    <tr key={member.userName} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{member.fullName}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {member.userName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {getMemberTypeDisplay(member.memberType)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.mobile || member.landline ? (
                          <a
                            href={`tel:${member.mobile || member.landline}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {getContactNumber(member)}
                          </a>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.emailAddress ? (
                          <a
                            href={`mailto:${member.emailAddress}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {member.emailAddress}
                          </a>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card view */}
            <div className="md:hidden space-y-4">
              {filteredMembers.map((member) => (
                <div key={member.userName} className="bg-white rounded-lg shadow p-4">
                  <div className="font-bold text-lg text-gray-900 mb-2">{member.fullName}</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Username:</span>
                      <span className="text-gray-900">{member.userName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Type:</span>
                      <span className="text-gray-900">{getMemberTypeDisplay(member.memberType)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Phone:</span>
                      {member.mobile || member.landline ? (
                        <a
                          href={`tel:${member.mobile || member.landline}`}
                          className="text-blue-600 hover:underline"
                        >
                          {getContactNumber(member)}
                        </a>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Email:</span>
                      {member.emailAddress ? (
                        <a
                          href={`mailto:${member.emailAddress}`}
                          className="text-blue-600 hover:underline truncate ml-2"
                        >
                          {member.emailAddress}
                        </a>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
