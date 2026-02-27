// app/competitions/page.tsx
// Competitions list page — loads live data from API

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type { Competition, CompStatus, CompType } from '@/types/competitions';

const STATUS_STYLES: Record<CompStatus, { badge: string; label: string }> = {
  'Not Started': { badge: 'bg-gray-100 text-gray-600',     label: 'Not Started' },
  'Draw Done':   { badge: 'bg-yellow-100 text-yellow-700', label: 'Draw Done' },
  'In Progress': { badge: 'bg-blue-100 text-blue-700',     label: 'In Progress' },
  'Complete':    { badge: 'bg-green-100 text-green-700',   label: 'Complete' },
};

const TYPE_LABELS: Record<CompType, string> = {
  singles: 'Singles',
  pairs:   'Pairs',
  triples: 'Triples',
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return dateStr; }
}

export default function CompetitionsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== '';

  useEffect(() => {
    fetch('/api/competitions')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCompetitions(data.competitions || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const groups: { heading: string; statuses: CompStatus[] }[] = [
    { heading: 'In Progress', statuses: ['In Progress'] },
    { heading: 'Draw Done',   statuses: ['Draw Done'] },
    { heading: 'Not Started', statuses: ['Not Started'] },
    { heading: 'Complete',    statuses: ['Complete'] },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
      />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold">Competitions</h1>
            {competitions.find((c) => c.finalsDate) && (
              <p className="text-gray-500 mt-1 text-sm">
                Finals weekend:{' '}
                {formatDate(competitions.find((c) => c.finalsDate)?.finalsDate ?? null)}
              </p>
            )}
          </div>
          {isCommittee && (
            <button
              onClick={() => router.push('/competitions/admin')}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm"
            >
              Manage
            </button>
          )}
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-400">Loading competitions…</div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && competitions.length === 0 && (
          <div className="text-center py-12 text-gray-400">No competitions found.</div>
        )}

        {!loading && !error && groups.map(({ heading, statuses }) => {
          const comps = competitions.filter((c) => statuses.includes(c.status));
          if (comps.length === 0) return null;
          return (
            <div key={heading} className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {heading}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {comps.map((comp) => {
                  const { badge, label } = STATUS_STYLES[comp.status];
                  return (
                    <button
                      key={comp.compId}
                      onClick={() => router.push(`/competitions/${comp.compId}`)}
                      className="bg-white rounded-lg border border-gray-200 p-4 text-left hover:shadow-md hover:border-gray-300 transition-all"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{comp.displayName}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{TYPE_LABELS[comp.compType]}</p>
                        </div>
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${badge}`}>
                          {label}
                        </span>
                      </div>

                      {comp.finalsDate && comp.status !== 'Not Started' && (
                        <p className="text-xs text-gray-400 mt-2">
                          Final: {formatDate(comp.finalsDate)}
                        </p>
                      )}

                      {comp.triplesFixedDay && comp.triplesFixedDate && (
                        <p className="text-xs text-blue-600 mt-1">
                          First games day: {formatDate(comp.triplesFixedDate)}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
