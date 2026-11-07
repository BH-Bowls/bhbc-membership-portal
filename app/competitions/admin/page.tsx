// app/competitions/admin/page.tsx
// Committee overview: all competitions with quick-access manage links, plus the Admin
// "Set up next year" action — creates next year's competitions (Not Started, same names,
// types and rules). This year's draws stay as they are and become a past year on the
// /competitions year picker.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ExportSheetDialog } from '@/components/competitions/ExportSheetDialog';
import type { Competition, CompStatus, CompType } from '@/types/competitions';
import { hasRole } from '@/lib/role-utils';

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

  const sessionLoading = !session && loading;
  const role = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== '';
  const isAdmin = hasRole(role, 'Admin');

  const [exportComp, setExportComp] = useState<Competition | null>(null);

  // Start new season
  const [currentYear, setCurrentYear] = useState<number | null>(null);
  const [nextYear, setNextYear] = useState<number | null>(null);
  const [startSeasonOpen, setStartSeasonOpen] = useState(false);
  const [startingSeason, setStartingSeason] = useState(false);
  const [startSeasonError, setStartSeasonError] = useState<string | null>(null);
  const [startSeasonDone, setStartSeasonDone] = useState<string | null>(null);

  useEffect(() => {
    if (!isCommittee && !loading) {
      router.replace('/competitions');
    }
  });

  function loadCompetitions() {
    fetch('/api/competitions')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCompetitions(data.competitions || []);
        setCurrentYear(data.currentYear || null);
        setNextYear(data.nextYear || null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadCompetitions();
  }, []);

  async function startSeason() {
    if (nextYear === null) return;
    setStartingSeason(true);
    setStartSeasonError(null);
    try {
      const res = await fetch('/api/competitions/start-year', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: nextYear }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to set up the new year');
      setStartSeasonOpen(false);
      setStartSeasonDone(`${data.year} is set up: ${data.created} competition${data.created === 1 ? '' : 's'}. The ${data.year - 1} draws are still on Competitions: pick ${data.year - 1} from the year list.`);
      loadCompetitions();
    } catch (err) {
      setStartSeasonError(err instanceof Error ? err.message : 'Failed to set up the new year');
    } finally {
      setStartingSeason(false);
    }
  }

  const grouped: Record<CompType, Competition[]> = {
    singles: competitions.filter((c) => c.compType === 'singles'),
    pairs:   competitions.filter((c) => c.compType === 'pairs'),
    triples: competitions.filter((c) => c.compType === 'triples'),
  };

  return (
    <>
    <div className="min-h-screen bg-gray-50">

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              onClick={() => router.push('/competitions')}
              className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
            >
              ← All Competitions
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Competitions Admin</h1>
            {currentYear !== null && <p className="text-sm text-gray-700 mt-0.5">{currentYear} season</p>}
          </div>
          {isAdmin && nextYear !== null && (
            <button
              onClick={() => { setStartSeasonError(null); setStartSeasonOpen(true); }}
              className="px-3 py-2 text-sm border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50 font-medium"
            >
              Set up {nextYear}
            </button>
          )}
        </div>

        {startSeasonDone && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
            {startSeasonDone}
          </div>
        )}

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
                          {isAdmin && (
                            <button
                              onClick={() => setExportComp(comp)}
                              className="px-3 py-1.5 text-xs border border-green-300 text-green-700 rounded-md hover:bg-green-50 font-medium"
                            >
                              Export Sheet
                            </button>
                          )}
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

    {exportComp && (
      <ExportSheetDialog
        competition={exportComp}
        onClose={() => setExportComp(null)}
      />
    )}

    {startSeasonOpen && nextYear !== null && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 px-4">
        <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Set up the {nextYear} competitions?</h2>
          <div className="text-sm text-gray-700 space-y-2 mb-4">
            <p>This adds every competition for {nextYear}, Not Started with no draw or dates. Names, types and rules carry over.</p>
            <p>{nextYear} becomes the year shown on the Competitions page. The {nextYear - 1} draws and results stay as they are; pick {nextYear - 1} from the year list to see them. They can&apos;t be changed after this.</p>
            <p className="font-medium text-gray-900">Only do this once {nextYear - 1}&apos;s competitions are finished.</p>
          </div>
          {startSeasonError && <p className="text-sm text-red-700 mb-3">{startSeasonError}</p>}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setStartSeasonOpen(false)}
              disabled={startingSeason}
              className="px-4 py-2 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={startSeason}
              disabled={startingSeason}
              className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {startingSeason ? 'Setting up…' : `Set up ${nextYear}`}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
