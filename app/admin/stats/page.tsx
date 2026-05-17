// app/admin/stats/page.tsx
// Membership statistics page — Admin and Committee read-only view of member counts

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';

// Shape of the stats object returned from /api/admin/stats
interface MemberStats {
  playingLadies: number;
  playingMen: number;
  socialLadies: number;
  socialMen: number;
  totalPlaying: number;
  totalSocial: number;
  totalMembers: number;
  ageU18: number;
  age18to24: number;
  age25to59: number;
  age60plus: number;
  age80plus: number;
  ageUnknown: number;
  noEmail: number;
  newThisYear: number;
  currentYear: number;
}

// ── Stat card component ────────────────────────────────────────────────────────
// Renders a single bordered card with a coloured header strip, a large count,
// and a label. bgClass / textClass / borderClass must be literal Tailwind strings.
function StatCard({
  label,
  count,
  bgClass,
  textClass,
  borderClass,
}: {
  label: string;
  count: number;
  bgClass: string;
  textClass: string;
  borderClass: string;
}) {
  return (
    <div className={`rounded-lg border-2 ${borderClass} bg-white shadow-sm overflow-hidden`}>
      {/* Coloured header strip */}
      <div className={`${bgClass} px-4 py-2`}>
        <p className={`text-sm font-semibold ${textClass}`}>{label}</p>
      </div>
      {/* Large count number */}
      <div className="px-4 py-4">
        <p className={`text-4xl font-bold ${textClass}`}>{count}</p>
      </div>
    </div>
  );
}

// ── Summary pill component ─────────────────────────────────────────────────────
// Compact inline stat used for the rollup row (Total Playing / Total Social / Grand Total)
function SummaryPill({
  label,
  count,
  bgClass,
  textClass,
}: {
  label: string;
  count: number;
  bgClass: string;
  textClass: string;
}) {
  return (
    <div className={`${bgClass} rounded-lg px-5 py-3 flex items-center gap-3`}>
      <span className={`text-2xl font-bold ${textClass}`}>{count}</span>
      <span className={`text-sm font-medium ${textClass}`}>{label}</span>
    </div>
  );
}

// ── Main page component ────────────────────────────────────────────────────────
export default function MembershipStatsPage() {
  const { data: session } = useSession();

  // Stats data returned from the API
  const [stats, setStats] = useState<MemberStats | null>(null);

  // Loading and error states — no alert(), inline only
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch stats once on mount
  useEffect(() => {
    async function fetchStats() {
      try {
        // Call the stats API endpoint
        const response = await fetch('/api/admin/stats');

        // Parse the JSON response
        const data = await response.json();

        if (!response.ok) {
          // Use the error message from the API if present, otherwise a generic one
          const message = data.error ? data.error : 'Failed to load membership stats';
          setError(message);
          return;
        }

        // Store the stats for rendering
        setStats(data);
      } catch (err) {
        // Network or parse failure
        setError('Failed to load membership stats');
      } finally {
        // Always clear the loading indicator
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  // Resolve session values to string | undefined — Navbar does not accept null
  // Use explicit if checks (no ?. or ?? per coding standards)
  let navUserName: string | undefined = undefined;
  let navUserRole: string | undefined = undefined;
  if (session && session.user) {
    if (session.user.name) {
      navUserName = session.user.name;
    }
    if (session.user.role) {
      navUserRole = session.user.role;
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={navUserName} userRole={navUserRole} />
        <div className="px-4 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-700">Loading membership stats...</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={navUserName} userRole={navUserRole} />
        <div className="px-4 py-8 max-w-3xl mx-auto">
          <RouterBackLink fallbackHref="/" label="Back to Home" />
          <div className="mt-4 rounded-md bg-red-50 border border-red-200 p-4">
            <p className="text-red-700 font-medium">Error loading stats</p>
            <p className="text-red-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Guard against null stats (should not happen if loading/error are handled above)
  if (!stats) {
    return null;
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={navUserName} userRole={navUserRole} />

      <div className="px-4 py-8 max-w-4xl mx-auto">
        <RouterBackLink fallbackHref="/" label="Back to Home" />

        <h1 className="text-3xl font-bold text-gray-900 mt-3 mb-8">Membership Statistics</h1>

        {/* ── Section 1: Membership by Type ───────────────────────────────── */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Membership by Type</h2>

          {/* Four member-type cards in a responsive grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <StatCard
              label="Playing Ladies"
              count={stats.playingLadies}
              bgClass="bg-purple-100"
              textClass="text-purple-800"
              borderClass="border-purple-300"
            />
            <StatCard
              label="Playing Men"
              count={stats.playingMen}
              bgClass="bg-blue-100"
              textClass="text-blue-800"
              borderClass="border-blue-300"
            />
            <StatCard
              label="Social Ladies"
              count={stats.socialLadies}
              bgClass="bg-pink-100"
              textClass="text-pink-800"
              borderClass="border-pink-300"
            />
            <StatCard
              label="Social Men"
              count={stats.socialMen}
              bgClass="bg-teal-100"
              textClass="text-teal-800"
              borderClass="border-teal-300"
            />
          </div>

          {/* Rollup summary row */}
          <div className="flex flex-wrap gap-3">
            <SummaryPill
              label="Total Playing"
              count={stats.totalPlaying}
              bgClass="bg-indigo-100"
              textClass="text-indigo-800"
            />
            <SummaryPill
              label="Total Social"
              count={stats.totalSocial}
              bgClass="bg-orange-100"
              textClass="text-orange-800"
            />
            <SummaryPill
              label="Grand Total"
              count={stats.totalMembers}
              bgClass="bg-gray-200"
              textClass="text-gray-800"
            />
          </div>
        </section>

        {/* ── Section 2: Age Demographics ─────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Age Demographics</h2>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden max-w-sm">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Age Group</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-900">Under 18</td>
                  <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{stats.ageU18}</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-900">18 – 24</td>
                  <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{stats.age18to24}</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-900">25 – 59</td>
                  <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{stats.age25to59}</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-900">60+</td>
                  <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{stats.age60plus}</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-900">80+</td>
                  <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{stats.age80plus}</td>
                </tr>
                {/* Only show the Unknown row when there are actually profiles needing attention */}
                {stats.ageUnknown > 0 && (
                  <tr className="bg-yellow-50">
                    <td className="px-4 py-3 text-sm text-gray-700 italic">Unknown / Not Set</td>
                    <td className="px-4 py-3 text-sm text-gray-700 text-right font-medium italic">{stats.ageUnknown}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Section 3: Operational Indicators ───────────────────────────── */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Indicators</h2>

          <div className="flex flex-wrap gap-4">
            {/* No email address on record */}
            <StatCard
              label="No email address on record"
              count={stats.noEmail}
              bgClass="bg-red-100"
              textClass="text-red-800"
              borderClass="border-red-300"
            />
            {/* New members joined this calendar year */}
            <StatCard
              label={`New Members ${stats.currentYear}`}
              count={stats.newThisYear}
              bgClass="bg-green-100"
              textClass="text-green-800"
              borderClass="border-green-300"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
