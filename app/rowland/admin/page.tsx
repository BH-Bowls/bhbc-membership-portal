// app/rowland/admin/page.tsx
// Committee overview of all Rowland Cup competitions

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type { RowlandComp, RowlandCompStatus } from '@/types/rowland';
import { ROWLAND_COMP_NAMES } from '@/types/rowland';

const STATUS_STYLES: Record<RowlandCompStatus, string> = {
  'Not Started': 'bg-gray-100 text-gray-600',
  'Draw Done':   'bg-yellow-100 text-yellow-700',
  'In Progress': 'bg-blue-100 text-blue-700',
  'Complete':    'bg-green-100 text-green-700',
};

export default function RowlandAdminPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [comps, setComps] = useState<RowlandComp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== 'Club' && role !== '';

  useEffect(() => {
    if (session && !isCommittee) router.replace('/rowland');
  }, [session, isCommittee]);

  useEffect(() => {
    fetch('/api/rowland')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setComps(data.comps || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Group by cup (Edward / Gladys)
  const edward = comps.filter((c) => c.compId.startsWith('edward'));
  const gladys  = comps.filter((c) => c.compId.startsWith('gladys'));

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-6">
          <button
            onClick={() => router.push('/rowland')}
            className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
          >
            ← Rowland Cup
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Rowland Cup Admin</h1>
        </div>

        {loading && <div className="text-center py-12 text-gray-400">Loading…</div>}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-6">
            {[
              { label: 'Edward Cup', items: edward },
              { label: 'Gladys Cup', items: gladys },
            ].map(({ label, items }) => {
              if (items.length === 0) return null;
              return (
                <div key={label}>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    {label}
                  </h2>
                  <div className="space-y-2">
                    {items.map((comp) => (
                      <div
                        key={comp.compId}
                        className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-gray-900">
                            {ROWLAND_COMP_NAMES[comp.compId] ?? comp.compName}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[comp.status]}`}>
                            {comp.status}
                          </span>
                          {comp.numTeams > 0 && (
                            <span className="text-xs text-gray-500">{comp.numTeams} teams</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => router.push(`/rowland/${comp.compId}`)}
                            className="px-3 py-1.5 text-xs border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50"
                          >
                            View
                          </button>
                          <button
                            onClick={() => router.push(`/rowland/${comp.compId}/setup`)}
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
