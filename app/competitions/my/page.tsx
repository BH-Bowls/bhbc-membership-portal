// app/competitions/my/page.tsx
// Personal competition progress summary — shows the current user's status,
// partners, and opponents across all competitions they have entered.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { COMP_ROUND_LABELS } from '@/types/competitions';
import type { MyCompEntry, CompPosition } from '../../api/competitions/my/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: string | null | undefined) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return d; }
}

function roundLabel(round: string) {
  return COMP_ROUND_LABELS[round as keyof typeof COMP_ROUND_LABELS] ?? round;
}

function posShort(pos: CompPosition): string {
  if (pos === 'Skip') return 'S';
  if (pos === 'Lead') return 'L';
  if (pos === 'No. 2') return '2';
  return '';
}

function nameWithPos(p: { fullName: string; position: CompPosition }): string {
  const short = posShort(p.position);
  return short ? `${p.fullName} (${short})` : p.fullName;
}

function nameList(people: { fullName: string; position: CompPosition }[]) {
  return people.map(nameWithPos).join(' & ');
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  active:      { label: 'Active',          className: 'bg-blue-100 text-blue-700' },
  awaiting:    { label: 'Awaiting draw',   className: 'bg-yellow-100 text-yellow-700' },
  winner:      { label: 'Winner',          className: 'bg-green-100 text-green-700' },
  'knocked-out': { label: 'Knocked out',   className: 'bg-gray-100 text-gray-500' },
} as const;

// ── Card ──────────────────────────────────────────────────────────────────────

function EntryCard({ entry, onClick }: { entry: MyCompEntry; onClick: () => void }) {
  const { label, className } = STATUS_CONFIG[entry.entryStatus];
  const m = entry.match;
  const isActive = entry.entryStatus === 'active';
  const isKnockedOut = entry.entryStatus === 'knocked-out';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-lg border p-4 transition-all hover:shadow-md ${
        isActive ? 'border-blue-200 hover:border-blue-300' : 'border-gray-200 hover:border-gray-300'
      } ${isKnockedOut ? 'opacity-60' : ''}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="font-semibold text-gray-900">
            {entry.displayName}{entry.myPosition ? ` — ${entry.myPosition}` : ''}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {entry.compDescription ?? entry.compType}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${className}`}>
            {label}
          </span>
          <span className="text-xs text-gray-400">{roundLabel(entry.round)}</span>
        </div>
      </div>

      {/* Challenger / Opponent notice */}
      {isActive && (
        <div className="mb-2 text-xs text-blue-700 bg-blue-50 rounded px-2 py-1.5">
          {entry.isChallenger ? 'You are the Challenger' : 'You are the Opponent'}
          {entry.isChallenger && entry.offerByDate && (
            <span className="font-medium"> — offer your opponent 3 dates by {formatDate(entry.offerByDate)}</span>
          )}
        </div>
      )}

      {m && (
        <div className="space-y-1.5">
          {/* Partners (pairs / triples) */}
          {m.partners.length > 0 && (
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className="text-gray-400 text-xs w-16 shrink-0">With</span>
              <span className="text-gray-800 font-medium">{nameList(m.partners)}</span>
            </div>
          )}

          {/* Opponent */}
          {m.opponents && m.opponents.length > 0 ? (
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className="text-gray-400 text-xs w-16 shrink-0">
                {isActive ? 'Playing' : 'Played'}
              </span>
              <span className={`font-medium ${isActive ? 'text-gray-800' : 'text-gray-600'}`}>
                {nameList(m.opponents)}
              </span>
            </div>
          ) : m.status === 'Bye' ? (
            <div className="text-sm text-amber-600 font-medium">Bye — advancing to next round</div>
          ) : null}

          {/* Score (if played) */}
          {m.myScore != null && m.oppScore != null && (
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className="text-gray-400 text-xs w-16 shrink-0">Score</span>
              <span className={`font-mono font-semibold ${m.won ? 'text-green-700' : 'text-red-600'}`}>
                {m.myScore} – {m.oppScore}
              </span>
              <span className="text-xs text-gray-400">
                {m.won ? '(won)' : '(lost)'}
              </span>
            </div>
          )}

          {/* Play-by date */}
          {isActive && m.playByDate && (
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className="text-gray-400 text-xs w-16 shrink-0">Play by</span>
              <span className="text-gray-700">{formatDate(m.playByDate)}</span>
            </div>
          )}

          {/* Played date */}
          {m.playedDate && !isActive && (
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className="text-gray-400 text-xs w-16 shrink-0">Played</span>
              <span className="text-gray-500">{formatDate(m.playedDate)}</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyCompetitionsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [entries, setEntries] = useState<MyCompEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = session?.user?.role ?? '';

  useEffect(() => {
    fetch('/api/competitions/my')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEntries(data.entries ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const active    = entries.filter((e) => e.entryStatus === 'active');
  const awaiting  = entries.filter((e) => e.entryStatus === 'awaiting');
  const winner    = entries.filter((e) => e.entryStatus === 'winner');
  const knockedOut = entries.filter((e) => e.entryStatus === 'knocked-out');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <button
            onClick={() => router.push('/competitions')}
            className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
          >
            ← All Competitions
          </button>
          <h1 className="text-2xl font-bold text-gray-900">My Progress</h1>
          {session?.user?.name && (
            <p className="text-gray-500 text-sm mt-0.5">{session.user.name}</p>
          )}
        </div>

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
                <div className="h-4 w-40 bg-gray-200 rounded mb-3" />
                <div className="h-3 w-28 bg-gray-100 rounded mb-2" />
                <div className="h-3 w-36 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-400">
            You are not entered in any active competitions.
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="space-y-8">
            {active.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Active — matches to play
                </h2>
                <div className="space-y-3">
                  {active.map((e) => (
                    <EntryCard
                      key={e.compId}
                      entry={e}
                      onClick={() => router.push(`/competitions/${e.compId}`)}
                    />
                  ))}
                </div>
              </section>
            )}

            {awaiting.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Awaiting next round
                </h2>
                <div className="space-y-3">
                  {awaiting.map((e) => (
                    <EntryCard
                      key={e.compId}
                      entry={e}
                      onClick={() => router.push(`/competitions/${e.compId}`)}
                    />
                  ))}
                </div>
              </section>
            )}

            {winner.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Winner
                </h2>
                <div className="space-y-3">
                  {winner.map((e) => (
                    <EntryCard
                      key={e.compId}
                      entry={e}
                      onClick={() => router.push(`/competitions/${e.compId}`)}
                    />
                  ))}
                </div>
              </section>
            )}

            {knockedOut.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Knocked out
                </h2>
                <div className="space-y-3">
                  {knockedOut.map((e) => (
                    <EntryCard
                      key={e.compId}
                      entry={e}
                      onClick={() => router.push(`/competitions/${e.compId}`)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
