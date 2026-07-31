// app/competitions/page.tsx
// Competitions list page — loads live data from API

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { RichText } from '@/components/RichText';
import type { Competition, CompStatus, CompType } from '@/types/competitions';

interface RulesText {
  generalRules: string;
  scoringProcedure: string;
  markerResponsibilities: string;
}

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
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';
  const router = useRouter();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== '' && role !== 'Kiosk';

  // General Rules box — shows the General Rules (Settings 'description'); committee can
  // edit all three shared blocks (General Rules / Standard Scoring Procedure / Marker
  // Responsibilities) here, and there is a link to the full rules page.
  const emptyRules: RulesText = { generalRules: '', scoringProcedure: '', markerResponsibilities: '' };
  const [rulesText, setRulesText] = useState<RulesText>(emptyRules);
  const [editingRules, setEditingRules] = useState(false);
  const [editDraft, setEditDraft] = useState<RulesText>(emptyRules);
  const [savingRules, setSavingRules] = useState(false);

  useEffect(() => {
    fetch('/api/competitions')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCompetitions(data.competitions || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    fetch('/api/competitions/rules-text')
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setRulesText({
            generalRules: data.generalRules || '',
            scoringProcedure: data.scoringProcedure || '',
            markerResponsibilities: data.markerResponsibilities || '',
          });
        }
      })
      .catch(() => {});
  }, []);

  function startEditRules() {
    setEditDraft(rulesText);
    setEditingRules(true);
  }

  async function saveRules() {
    setSavingRules(true);
    try {
      const res = await fetch('/api/competitions/rules-text', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editDraft),
      });
      if (!res.ok) throw new Error('Failed to save');
      setRulesText(editDraft);
      setEditingRules(false);
    } catch {
      alert('Failed to save rules. Please try again.');
    } finally {
      setSavingRules(false);
    }
  }

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
        showLogoOnly={isGuest}
      />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Competitions</h1>
            {competitions.find((c) => c.finalsDate) && (
              <p className="text-gray-500 mt-1 text-sm">
                Finals weekend:{' '}
                {formatDate(competitions.find((c) => c.finalsDate)?.finalsDate ?? null)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <a
              href="https://burgesshillbowlsclub.com/marking"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm"
            >
              Marker Tips
            </a>
            {!!role && role !== 'Kiosk' && (
              <button
                onClick={() => router.push('/competitions/my')}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm cursor-pointer"
              >
                My Progress
              </button>
            )}
            {isCommittee && (
              <button
                onClick={() => router.push('/competitions/admin')}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm"
              >
                Manage
              </button>
            )}
          </div>
        </div>

        {/* General Rules box */}
        {(rulesText.generalRules || isCommittee) && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            {editingRules ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-700">
                  Plain text. Type your own numbering (1, 2, 3 / a, b, c); line breaks are kept. You may use
                  &lt;b&gt;bold&lt;/b&gt;, &lt;i&gt;italic&lt;/i&gt; and &lt;u&gt;underline&lt;/u&gt;.
                </p>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">General Rules</label>
                  <textarea
                    value={editDraft.generalRules}
                    onChange={(e) => setEditDraft({ ...editDraft, generalRules: e.target.value })}
                    rows={5}
                    className="w-full border border-blue-300 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Standard Scoring Procedure</label>
                  <textarea
                    value={editDraft.scoringProcedure}
                    onChange={(e) => setEditDraft({ ...editDraft, scoringProcedure: e.target.value })}
                    rows={6}
                    className="w-full border border-blue-300 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Marker Responsibilities</label>
                  <textarea
                    value={editDraft.markerResponsibilities}
                    onChange={(e) => setEditDraft({ ...editDraft, markerResponsibilities: e.target.value })}
                    rows={4}
                    className="w-full border border-blue-300 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setEditingRules(false)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveRules}
                    disabled={savingRules}
                    className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingRules ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-sm font-semibold text-blue-900 uppercase tracking-wide">General Rules</h2>
                  {isCommittee && (
                    <button
                      onClick={startEditRules}
                      className="shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {rulesText.generalRules ? (
                  <RichText text={rulesText.generalRules} className="text-sm text-blue-900 mt-2" />
                ) : (
                  <p className="text-sm text-blue-400 italic mt-2">No general rules set. Click Edit to add them.</p>
                )}
                <div className="mt-3">
                  <button
                    onClick={() => router.push('/competitions/rules')}
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    View full rules →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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
                      title={`View ${comp.displayName} draw`}
                      className="bg-white rounded-lg border border-gray-200 p-4 text-left hover:shadow-md hover:border-gray-300 transition-all cursor-pointer"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{comp.displayName}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{TYPE_LABELS[comp.compType]}</p>
                          <RichText text={comp.compDescription} className="text-xs text-gray-700 mt-1" />
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
