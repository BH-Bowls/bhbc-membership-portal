// app/leagues/manage/page.tsx
// League Management home — LeagueCaptain/Captain/Admin only

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type { League, LeagueStatus, LeagueType } from '@/types/leagues';

const STATUS_STYLES: Record<LeagueStatus, string> = {
  'Not Started':  'bg-gray-100 text-gray-600',
  'Entries Open': 'bg-yellow-100 text-yellow-700',
  'In Progress':  'bg-blue-100 text-blue-700',
  'Complete':     'bg-green-100 text-green-700',
};

export default function LeagueManagePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const role = session?.user?.role ?? '';
  const roles = role.split(',').map((r) => r.trim());
  const canAccess = ['LeagueCaptain', 'Captain', 'Admin'].some((r) => roles.includes(r));

  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New league form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<LeagueType>('triples');
  const [newSeason, setNewSeason] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated' || (status === 'authenticated' && !canAccess)) {
      router.replace('/leagues');
      return;
    }
    if (status === 'authenticated') {
      fetch('/api/leagues')
        .then((r) => r.json())
        .then((data) => { if (data.error) throw new Error(data.error); setLeagues(data.leagues || []); })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [status, canAccess]);

  async function createLeague() {
    if (!newName.trim() || !newSeason.trim()) {
      setCreateError('Name and season are required'); return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), type: newType, season: newSeason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      router.push(`/leagues/manage/${data.leagueId}`);
    } catch (err: any) {
      setCreateError(err.message);
      setCreating(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userRole="" />
        <div className="text-center py-20 text-gray-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              onClick={() => router.push('/leagues')}
              className="text-sm text-gray-500 hover:text-gray-700 mb-1 inline-block"
            >
              ← Leagues
            </button>
            <h1 className="text-2xl font-bold text-gray-900">League Management</h1>
          </div>
          <button
            onClick={() => setShowNewForm(true)}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
          >
            + New League
          </button>
        </div>

        {/* New league form */}
        {showNewForm && (
          <div className="mb-6 bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-4">New League</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div className="sm:col-span-1">
                <label className="block text-xs text-gray-600 mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Triples League"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Type</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as LeagueType)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="triples">Triples</option>
                  <option value="pairs">Pairs</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Season</label>
                <input
                  type="text"
                  value={newSeason}
                  onChange={(e) => setNewSeason(e.target.value)}
                  placeholder="e.g. 2026"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>
            {createError && <p className="text-sm text-red-600 mb-3">{createError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowNewForm(false); setCreateError(null); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={createLeague}
                disabled={creating}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create League'}
              </button>
            </div>
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-400">Loading…</div>}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        {!loading && !error && leagues.length === 0 && (
          <div className="text-center py-12 text-gray-400">No leagues yet. Create one above.</div>
        )}

        {!loading && !error && leagues.length > 0 && (
          <div className="space-y-3">
            {leagues.map((league) => (
              <div
                key={league.leagueId}
                className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div>
                  <p className="font-semibold text-gray-900">{league.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5 capitalize">{league.type} · {league.season}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_STYLES[league.status]}`}>
                    {league.status}
                  </span>
                  <button
                    onClick={() => router.push(`/leagues/manage/${league.leagueId}`)}
                    className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                  >
                    Manage
                  </button>
                  <button
                    onClick={() => router.push(`/leagues/${league.leagueId}`)}
                    className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-800 text-sm"
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
