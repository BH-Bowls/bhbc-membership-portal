// src/components/OpenPollsPanel.tsx
// Home-page panel showing open polls awaiting or received response from the member.
// Fetches from GET /api/availability/open-polls.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OpenPollSummary } from '@/types/availability';

const CACHE_KEY = 'HomeOpenPollsCache';

function formatExpiry(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function PollRow({ poll }: { poll: OpenPollSummary }) {
  const badge = poll.hasResponded
    ? 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800'
    : 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800';

  return (
    <Link
      href={`/availability/events/${poll.eventId}`}
      className="flex items-start justify-between gap-3 py-3 px-1 rounded-md hover:bg-gray-50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{poll.title}</p>
        <p className="text-xs text-gray-700 mt-0.5">
          {poll.optionCount} {poll.optionCount === 1 ? 'option' : 'options'} ·{' '}
          {poll.responseCount} {poll.responseCount === 1 ? 'response' : 'responses'} ·{' '}
          Expires {formatExpiry(poll.expiresAt)}
          {poll.groupName ? ` · ${poll.groupName}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={badge}>{poll.hasResponded ? '✓ Responded' : 'Respond'}</span>
        <span className="text-gray-400 text-sm">›</span>
      </div>
    </Link>
  );
}

export function OpenPollsPanel() {
  const [polls, setPolls] = useState<OpenPollSummary[] | null>(null);

  useEffect(() => {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        setPolls(JSON.parse(cached));
      } catch {
        // ignore
      }
    }
    fetchPolls({ silent: !!cached });
  }, []);

  async function fetchPolls({ silent }: { silent: boolean }) {
    if (!silent) setPolls(null);
    try {
      const res = await fetch('/api/availability/open-polls');
      if (!res.ok) {
        if (!silent) setPolls([]);
        return;
      }
      const json = await res.json();
      const data: OpenPollSummary[] = json.polls || [];
      setPolls(data);
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      if (!silent) setPolls([]);
    }
  }

  // Don't render the panel at all when there are no open polls
  if (polls !== null && polls.length === 0) return null;

  return (
    <div className="bg-white overflow-hidden shadow rounded-lg text-gray-900 mb-6">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Open Polls</h2>
          <Link href="/availability" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            All polls →
          </Link>
        </div>
        <p className="text-xs text-gray-700 mb-3">Polls awaiting a decision</p>

        {polls === null ? (
          // Loading skeleton
          <div className="space-y-1 animate-pulse">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-start gap-3 py-3">
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
                <div className="h-5 bg-gray-200 rounded w-20"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {polls.map((poll) => (
              <PollRow key={poll.eventId} poll={poll} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
