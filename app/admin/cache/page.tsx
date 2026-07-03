// app/admin/cache/page.tsx
// Admin-only diagnostics for the in-memory Members read caches. Shows, for each
// cache, how many reads the current copy has served, lifetime totals, and a log of
// recent invalidations (each with the reads it served before being dropped).
//
// IMPORTANT: these counters are per serverless instance. In production every API
// route is a separate lambda with its own memory, so this endpoint's numbers only
// reflect the lambda that answered THIS request — not the whole app. For an
// app-wide view, watch the "[users-cache]" / "[friendlies members-cache]" console
// lines in your dev terminal or in Vercel → Logs.

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { getButtonClasses, getBadgeClasses, getAlertClasses } from '@/config/theme-helpers';

interface InvalidationRecord {
  invalidatedAt: number;
  hitsServed: number;
  windowMs: number;
}

interface CacheStats {
  cached: boolean;
  memberCount: number;
  loadedAt: number | null;
  ageMs: number | null;
  ttlMs: number;
  currentWindowHits: number;
  totalHits: number;
  totalLoads: number;
  totalInvalidations: number;
  startedAt: number;
  recentInvalidations: InvalidationRecord[];
}

function fmtTime(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function CacheSection({ title, subtitle, stats }: { title: string; subtitle: string; stats: CacheStats }) {
  let hitRate = '—';
  if ((stats.totalHits + stats.totalLoads) > 0) {
    hitRate = `${Math.round((stats.totalHits / (stats.totalHits + stats.totalLoads)) * 100)}%`;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <span className={getBadgeClasses(stats.cached ? 'success' : 'secondary', 'sm')}>
          {stats.cached ? 'Warm' : 'Empty'}
        </span>
      </div>
      <p className="text-xs text-gray-700 mb-3">{subtitle}</p>

      <dl className="grid grid-cols-2 gap-y-1.5 text-sm mb-3">
        <dt className="text-gray-700">Members held</dt>
        <dd className="text-gray-900 font-medium">{stats.cached ? stats.memberCount : '—'}</dd>
        <dt className="text-gray-700">Loaded at</dt>
        <dd className="text-gray-900 font-medium">{fmtTime(stats.loadedAt)}</dd>
        <dt className="text-gray-700">Age</dt>
        <dd className="text-gray-900 font-medium">{fmtDuration(stats.ageMs)}</dd>
        <dt className="text-gray-700">Reads served (this copy)</dt>
        <dd className="text-gray-900 font-medium">{stats.currentWindowHits}</dd>
      </dl>

      <dl className="grid grid-cols-2 gap-y-1.5 text-sm border-t border-gray-100 pt-3">
        <dt className="text-gray-700">Tracking since</dt>
        <dd className="text-gray-900 font-medium">{fmtTime(stats.startedAt)}</dd>
        <dt className="text-gray-700">Reads served from cache</dt>
        <dd className="text-gray-900 font-medium">{stats.totalHits}</dd>
        <dt className="text-gray-700">Sheet reads (misses)</dt>
        <dd className="text-gray-900 font-medium">{stats.totalLoads}</dd>
        <dt className="text-gray-700">Cache hit rate</dt>
        <dd className="text-gray-900 font-medium">{hitRate}</dd>
        <dt className="text-gray-700">Invalidations (writes)</dt>
        <dd className="text-gray-900 font-medium">{stats.totalInvalidations}</dd>
      </dl>

      {stats.recentInvalidations.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-700 mb-2">Recent invalidations</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-3 py-1.5 font-medium text-gray-700">Invalidated at</th>
                  <th className="px-3 py-1.5 font-medium text-gray-700 text-right">Reads served</th>
                  <th className="px-3 py-1.5 font-medium text-gray-700 text-right">Copy lived</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.recentInvalidations.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-gray-900">{fmtTime(r.invalidatedAt)}</td>
                    <td className="px-3 py-1.5 text-gray-900 text-right font-medium">{r.hitsServed}</td>
                    <td className="px-3 py-1.5 text-gray-700 text-right">{fmtDuration(r.windowMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MembersCachePage() {
  const { data: session } = useSession();

  const [usersCache, setUsersCache] = useState<CacheStats | null>(null);
  const [friendliesCache, setFriendliesCache] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/cache');
      if (res.status === 403) { setError('You do not have access to this page.'); return; }
      if (!res.ok) throw new Error('Failed to load cache stats');
      const data = await res.json();
      setUsersCache(data.usersCache);
      setFriendliesCache(data.friendliesMembersCache);
    } catch (err) {
      console.error('[MembersCachePage] load error:', err);
      setError('Failed to load cache stats. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const displayName = session && session.user && session.user.name ? session.user.name : undefined;
  const role = session && session.user ? session.user.role : '';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-4">
          <RouterBackLink fallbackHref="/" label="Home" />
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Members Cache</h1>
            <button onClick={load} disabled={loading} className={getButtonClasses('secondary', 'sm')}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <p className="text-sm text-gray-700 mt-1">
            The Members sheet is cached in memory (up to 24h) to cut Google Sheets read-quota usage.
            Any write to the Members sheet drops the cache immediately.
          </p>
        </div>

        <div className={getAlertClasses('warning') + ' mb-4'}>
          <p className="text-sm">
            <span className="font-medium">These numbers are for one server instance</span> — the lambda
            that answered this request. Production runs several, each with its own cache, so this won’t
            show app-wide totals and may read zero if this lambda hasn’t done member reads. For the full
            picture, watch the <code className="bg-gray-100 px-1 rounded">[users-cache]</code> and{' '}
            <code className="bg-gray-100 px-1 rounded">[friendlies members-cache]</code> lines in your dev
            terminal or in Vercel → Logs.
          </p>
        </div>

        {error && <div className={getAlertClasses('danger') + ' mb-4'}>{error}</div>}

        {loading && !usersCache && (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-700">Loading…</p>
          </div>
        )}

        {usersCache && (
          <CacheSection
            title="Main members cache"
            subtitle="Used by getAllUsers — auth, profile, competitions, leagues, admin, and most member lookups."
            stats={usersCache}
          />
        )}

        {friendliesCache && (
          <CacheSection
            title="Friendlies members cache"
            subtitle="Used by the friendlies pages (game / games / entered-players), which read Members via their own client."
            stats={friendliesCache}
          />
        )}

        <div className={getAlertClasses('info')}>
          <p className="text-sm">
            Each <span className="font-medium">read served from cache</span> is one Google Sheets read
            request avoided. A hit rate near 100% means the cache is doing its job. Browsing friendlies
            moves the friendlies cache; profile/competitions/leagues/admin move the main cache.
          </p>
        </div>
      </div>
    </div>
  );
}
