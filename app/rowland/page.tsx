// app/rowland/page.tsx
// Rowland Cup home — visible to clubs and committee

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const ROWLAND_GUEST_BUTTONS = (
  <>
    <a href="/clublogin" className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors">Club Login</a>
    <a href="/login"     className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600  hover:bg-blue-700  rounded-md transition-colors">Member Login</a>
  </>
);
import { Navbar } from '@/components/Navbar';
import type { RowlandComp, RowlandCompStatus } from '@/types/rowland';
import { ROWLAND_COMP_NAMES } from '@/types/rowland';

const STATUS_STYLES: Record<RowlandCompStatus, string> = {
  'Not Started': 'bg-gray-100 text-gray-600',
  'Draw Done':   'bg-yellow-100 text-yellow-700',
  'In Progress': 'bg-blue-100 text-blue-700',
  'Complete':    'bg-green-100 text-green-700',
};

export default function RowlandPage() {
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';
  const router = useRouter();
  const [comps, setComps] = useState<RowlandComp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = session?.user?.role ?? '';

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

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} showLogoOnly={isGuest} guestButtons={ROWLAND_GUEST_BUTTONS} />

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Rowland Cup</h1>

        {loading && <div className="text-center py-12 text-gray-400">Loading…</div>}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-2">
            {comps.map((comp) => (
              <div
                key={comp.compId}
                className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() => router.push(`/rowland/${comp.compId}`)}
                title={`View ${ROWLAND_COMP_NAMES[comp.compId] ?? comp.compName} bracket`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">
                    {ROWLAND_COMP_NAMES[comp.compId] ?? comp.compName}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[comp.status]}`}>
                    {comp.status}
                  </span>
                </div>
                <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            ))}
            {comps.length === 0 && (
              <p className="text-center py-12 text-gray-400">No competitions set up yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
