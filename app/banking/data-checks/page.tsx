// app/banking/data-checks/page.tsx
// Data checks — runs the read-only sanity checks of the bar, renewals and Xero data
// (src/lib/data-checks.ts, migration 0096) and shows every check: a tick if it passed,
// or the problems it found. Errors are figures that should always agree but don't;
// warnings are things to look at; info is for the Treasurer's information.

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { hasRole } from '@/lib/role-utils';
import type { DataCheckResults, DataCheckProblem, DataCheckSeverity } from '@/lib/data-checks';

const SEVERITY_STYLE: Record<DataCheckSeverity, { badge: string; label: string }> = {
  error: { badge: 'bg-red-100 text-red-800', label: 'Error' },
  warning: { badge: 'bg-amber-100 text-amber-800', label: 'Warning' },
  info: { badge: 'bg-blue-100 text-blue-800', label: 'Info' },
};

const SEVERITY_ORDER: DataCheckSeverity[] = ['error', 'warning', 'info'];

/** The most serious severity among a check's problems, or null if it passed. */
function worstSeverity(problems: DataCheckProblem[]): DataCheckSeverity | null {
  for (const s of SEVERITY_ORDER) {
    if (problems.some((p) => p.severity === s)) return s;
  }
  return null;
}

export default function DataChecksPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const canAccess = hasRole(session?.user?.role, 'Admin', 'Treasurer', 'T');

  const [results, setResults] = useState<DataCheckResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showPassed, setShowPassed] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!canAccess) { router.push('/'); return; }
    runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canAccess]);

  async function runChecks() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/banking/data-checks');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to run the data checks');
      setResults(data);
      // Open every check with an error or warning
      const open = new Set<string>();
      for (const p of data.problems as DataCheckProblem[]) {
        if (p.severity !== 'info') open.add(`${p.area}|${p.check}`);
      }
      setExpanded(open);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run the data checks');
    } finally {
      setLoading(false);
    }
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!canAccess) return null;

  const problems = results?.problems || [];
  const counts: Record<DataCheckSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const p of problems) counts[p.severity]++;

  // Every known check, plus any the database returned that the page doesn't know about
  const checks = [...(results?.checks || [])];
  for (const p of problems) {
    if (!checks.some((c) => c.area === p.area && c.check === p.check)) {
      checks.push({ area: p.area, check: p.check, description: '' });
    }
  }
  const areas: string[] = [];
  for (const c of checks) {
    if (!areas.includes(c.area)) areas.push(c.area);
  }
  const passedCount = checks.filter((c) => !problems.some((p) => p.area === c.area && p.check === c.check)).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Data Checks</h1>
          <p className="text-sm text-gray-500">
            Cross-checks the bar, renewals and Xero figures that should always agree. It only reads — running it changes nothing.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
            <button onClick={() => setError('')} className="float-right font-bold">×</button>
          </div>
        )}

        <section className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center gap-3">
          <button onClick={runChecks} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm">
            {loading ? 'Checking…' : 'Run checks'}
          </button>
          {results && !loading && (
            <span className="text-sm text-gray-500">Last run {new Date(results.ranAt).toLocaleString('en-GB')}</span>
          )}
          <label className="text-sm text-gray-700 ml-auto flex items-center gap-2">
            <input type="checkbox" checked={showPassed} onChange={(e) => setShowPassed(e.target.checked)} />
            Show checks that passed
          </label>
        </section>

        {results && !loading && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={`rounded-lg shadow p-4 ${counts.error > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
              <div className="text-xs text-gray-500">Errors</div>
              <div className={`text-xl font-semibold ${counts.error > 0 ? 'text-red-700' : 'text-green-700'}`}>{counts.error}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500">Warnings</div>
              <div className="text-xl font-semibold text-amber-700">{counts.warning}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500">Info</div>
              <div className="text-xl font-semibold text-blue-700">{counts.info}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500">Checks passed</div>
              <div className="text-xl font-semibold text-gray-900">{passedCount} of {checks.length}</div>
            </div>
          </section>
        )}

        {results?.truncated && !loading && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded text-sm">
            There were too many problems to show them all — fix the ones below and run the checks again.
          </div>
        )}

        {results && !loading && counts.error === 0 && counts.warning === 0 && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded text-sm">
            ✓ Everything that can be cross-checked agrees.
          </div>
        )}

        {results && !loading && areas.map((area) => {
          const areaChecks = checks.filter((c) => c.area === area);
          const shown = areaChecks.filter((c) => showPassed || problems.some((p) => p.area === c.area && p.check === c.check));
          if (shown.length === 0) return null;
          return (
            <section key={area} className="bg-white rounded-lg shadow">
              <h2 className="px-4 py-3 border-b border-gray-200 font-semibold text-gray-900">{area}</h2>
              <ul className="divide-y divide-gray-100">
                {shown.map((c) => {
                  const key = `${c.area}|${c.check}`;
                  const found = problems.filter((p) => p.area === c.area && p.check === c.check);
                  const worst = worstSeverity(found);
                  const isOpen = expanded.has(key);
                  return (
                    <li key={key} className="px-4 py-3">
                      <button
                        onClick={() => found.length > 0 && toggle(key)}
                        className={`w-full flex items-start gap-3 text-left ${found.length > 0 ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        <span className={`mt-0.5 w-5 text-center font-bold ${worst === null ? 'text-green-600' : worst === 'error' ? 'text-red-600' : worst === 'warning' ? 'text-amber-600' : 'text-blue-600'}`}>
                          {worst === null ? '✓' : worst === 'info' ? 'i' : '!'}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-900">{c.check}</span>
                          {c.description && <span className="block text-xs text-gray-500">{c.description}</span>}
                        </span>
                        {worst && (
                          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${SEVERITY_STYLE[worst].badge}`}>
                            {found.length} {SEVERITY_STYLE[worst].label.toLowerCase()}{found.length === 1 ? '' : 's'} {isOpen ? '▾' : '▸'}
                          </span>
                        )}
                      </button>
                      {isOpen && found.length > 0 && (
                        <ul className="mt-2 ml-8 space-y-1">
                          {found.map((p, i) => (
                            <li key={i} className="text-sm text-gray-700 flex flex-wrap items-baseline gap-x-2">
                              <span className={`text-xs px-1.5 rounded ${SEVERITY_STYLE[p.severity].badge}`}>{SEVERITY_STYLE[p.severity].label}</span>
                              {p.memberName && <span className="font-medium text-gray-900">{p.memberName}:</span>}
                              <span className="break-words">{p.detail}</span>
                              {p.link && <Link href={p.link} className="text-blue-700 underline text-xs">Open</Link>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
