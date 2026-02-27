// app/competitions/admin/page.tsx
// Committee overview: all competitions with quick-access manage links

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type { Competition, CompStatus, CompType } from '@/types/competitions';

const STATUS_STYLES: Record<CompStatus, string> = {
  'Not Started': 'bg-gray-100 text-gray-600',
  'Draw Done':   'bg-yellow-100 text-yellow-700',
  'In Progress': 'bg-blue-100 text-blue-700',
  'Complete':    'bg-green-100 text-green-700',
};

const TYPE_LABELS: Record<CompType, string> = {
  singles: 'Singles',
  pairs:   'Pairs',
  triples: 'Triples',
};

export default function CompetitionsAdminPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== '';

  useEffect(() => {
    if (!isCommittee && !loading) {
      router.replace('/competitions');
    }
  });

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

  const grouped: Record<CompType, Competition[]> = {
    singles: competitions.filter((c) => c.compType === 'singles'),
    pairs:   competitions.filter((c) => c.compType === 'pairs'),
    triples: competitions.filter((c) => c.compType === 'triples'),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={role}
      />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              onClick={() => router.push('/competitions')}
              className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
            >
              ← All Competitions
            </button>
            <h1 className="text-2xl font-bold">Competitions Admin</h1>
          </div>
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-6">
            {(['singles', 'pairs', 'triples'] as CompType[]).map((type) => {
              const comps = grouped[type];
              if (comps.length === 0) return null;
              return (
                <div key={type}>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    {TYPE_LABELS[type]}
                  </h2>
                  <div className="space-y-2">
                    {comps.map((comp) => (
                      <div
                        key={comp.compId}
                        className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-gray-900">{comp.displayName}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[comp.status]}`}>
                            {comp.status}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => router.push(`/competitions/${comp.compId}`)}
                            className="px-3 py-1.5 text-xs border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50"
                          >
                            View
                          </button>
                          <button
                            onClick={() => router.push(`/competitions/${comp.compId}/setup`)}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                          >
                            Manage
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
