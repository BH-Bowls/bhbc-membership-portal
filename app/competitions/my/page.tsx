// app/competitions/my/page.tsx
// Personal competition progress — shows the user's full journey through every
// competition they have entered, including byes, wins/losses with scores,
// handicap starting scores, and their current pending match.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { COMP_ROUND_LABELS } from '@/types/competitions';
import type { MyCompEntry, CompPosition, JourneyStep } from '../../api/competitions/my/route';

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

function nameWithPos(p: { fullName: string; position: CompPosition; handicap?: number | null }): string {
  const short = posShort(p.position);
  const hcp   = p.handicap != null ? ` [${p.handicap}]` : '';
  return short ? `${p.fullName} (${short})${hcp}` : `${p.fullName}${hcp}`;
}

function nameList(people: { fullName: string; position: CompPosition; handicap?: number | null }[]) {
  return people.map(nameWithPos).join(' & ');
}

// ── Overall status badge ──────────────────────────────────────────────────────

const STATUS_CONFIG = {
  active:       { label: 'Active',        className: 'bg-blue-100 text-blue-700' },
  awaiting:     { label: 'Awaiting draw', className: 'bg-yellow-100 text-yellow-700' },
  winner:       { label: 'Winner',        className: 'bg-green-100 text-green-700' },
  'knocked-out':{ label: 'Knocked out',   className: 'bg-gray-100 text-gray-500' },
} as const;

// ── Journey step row ──────────────────────────────────────────────────────────

function JourneyRow({ step }: { step: JourneyStep }) {
  const { matchStatus, round, opponents, myScore, oppScore,
          playByDate, playedDate, myHandicap, myStartScore, oppStartScore } = step;

  const oppNames = opponents && opponents.length > 0 ? nameList(opponents) : null;

  // Row accent colour
  const isBye     = matchStatus === 'Bye';
  const isWon     = matchStatus === 'Won' || matchStatus === 'WalkoverWon';
  const isLost    = matchStatus === 'Lost' || matchStatus === 'WalkoverLost';
  const isPending = matchStatus === 'Pending';

  const roundPill = (
    <span className="inline-block text-xs font-medium bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 w-16 text-center shrink-0">
      {roundLabel(round)}
    </span>
  );

  // Handicap info line
  const showHcp = myHandicap != null && opponents && opponents[0]?.handicap != null;
  const oppHcp  = opponents?.[0]?.handicap ?? null;

  const hcpLine = showHcp ? (
    <span className="text-xs text-gray-400">
      Hcp: you {myHandicap} / opp {oppHcp}
      {myStartScore != null && oppStartScore != null && (
        <span className="ml-1 text-gray-500">
          · {isPending ? 'starts' : 'started'} {myStartScore}–{oppStartScore}
        </span>
      )}
    </span>
  ) : null;

  if (isBye) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        {roundPill}
        <span className="text-sm text-amber-600 font-medium">Bye — advanced</span>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="py-1.5 space-y-0.5">
        <div className="flex items-start gap-2">
          {roundPill}
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="text-sm font-medium text-blue-700">
                vs {oppNames ?? 'TBD'}
              </span>
            </div>
            {playByDate && (
              <p className="text-xs text-gray-500">Play by {formatDate(playByDate)}</p>
            )}
            {hcpLine && <p>{hcpLine}</p>}
          </div>
        </div>
      </div>
    );
  }

  // Completed / walkover
  const scoreStr = myScore != null && oppScore != null ? `${myScore}–${oppScore}` : null;
  const isWalkover = matchStatus === 'WalkoverWon' || matchStatus === 'WalkoverLost';

  return (
    <div className="py-1.5 space-y-0.5">
      <div className="flex items-start gap-2">
        {roundPill}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className={`text-sm font-medium ${isWon ? 'text-green-700' : 'text-red-600'}`}>
              {isWon ? 'Beat' : 'Lost to'} {oppNames ?? '—'}
            </span>
            {scoreStr && (
              <span className={`font-mono text-sm font-semibold ${isWon ? 'text-green-700' : 'text-red-600'}`}>
                {scoreStr}
              </span>
            )}
            {isWalkover && (
              <span className="text-xs text-orange-500">(walkover)</span>
            )}
          </div>
          {hcpLine && <p>{hcpLine}</p>}
          {playedDate && (
            <p className="text-xs text-gray-400">{formatDate(playedDate)}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Entry card ────────────────────────────────────────────────────────────────

const POS_ORDER: Record<string, number> = { 'Skip': 0, 'No. 2': 1, 'Lead': 2 };

function buildTeamLine(
  userName: string,
  myPosition: CompPosition,
  partners: { fullName: string; position: CompPosition }[],
): string {
  const members = [
    { name: userName, position: myPosition },
    ...partners.map((p) => ({ name: p.fullName, position: p.position })),
  ].sort((a, b) => (POS_ORDER[a.position ?? ''] ?? 99) - (POS_ORDER[b.position ?? ''] ?? 99));

  return members.map((m) => `${m.position ?? ''}: ${m.name}`).join(' · ');
}

function EntryCard({ entry, userName, onClick }: { entry: MyCompEntry; userName: string; onClick: () => void }) {
  const { label, className } = STATUS_CONFIG[entry.entryStatus];
  const isActive     = entry.entryStatus === 'active';
  const isKnockedOut = entry.entryStatus === 'knocked-out';

  const showTeam = entry.compType !== 'singles' && entry.match && entry.match.partners.length > 0;
  const teamLine = showTeam
    ? buildTeamLine(userName, entry.myPosition, entry.match!.partners)
    : null;

  return (
    <button
      onClick={onClick}
      title="Show Draw"
      className={`w-full text-left bg-white rounded-lg border p-4 transition-all hover:shadow-md cursor-pointer ${
        isActive ? 'border-blue-200 hover:border-blue-300' : 'border-gray-200 hover:border-gray-300'
      } ${isKnockedOut ? 'opacity-70' : ''}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="font-semibold text-gray-900">{entry.displayName}</p>
          <p className="text-xs text-gray-600 mt-0.5">
            {entry.compDescription ?? entry.compType}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${className}`}>
          {label}
        </span>
      </div>

      {/* Team composition (pairs / triples) + challenger notice */}
      {(teamLine || isActive) && (
        <div className="mb-3 space-y-1">
          {teamLine && (
            <p className="text-xs text-gray-600">{teamLine}</p>
          )}
          {isActive && (
            <div className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1.5">
              {entry.isChallenger ? 'You are the Challenger' : 'You are the Opponent'}
              {entry.isChallenger && entry.offerByDate && (
                <span className="font-medium"> — offer your opponent 3 dates by {formatDate(entry.offerByDate)}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Journey timeline */}
      {entry.journey.length > 0 && (
        <div className="divide-y divide-gray-100">
          {entry.journey.map((step) => (
            <JourneyRow key={step.matchId} step={step} />
          ))}
        </div>
      )}

      <div className="mt-3 text-xs text-blue-600 text-right">Show Draw →</div>
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

  const active     = entries.filter((e) => e.entryStatus === 'active');
  const awaiting   = entries.filter((e) => e.entryStatus === 'awaiting');
  const winner     = entries.filter((e) => e.entryStatus === 'winner');
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
                    <EntryCard key={e.compId} entry={e} userName={session?.user?.name ?? ''} onClick={() => router.push(`/competitions/${e.compId}`)} />
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
                    <EntryCard key={e.compId} entry={e} userName={session?.user?.name ?? ''} onClick={() => router.push(`/competitions/${e.compId}`)} />
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
                    <EntryCard key={e.compId} entry={e} userName={session?.user?.name ?? ''} onClick={() => router.push(`/competitions/${e.compId}`)} />
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
                    <EntryCard key={e.compId} entry={e} userName={session?.user?.name ?? ''} onClick={() => router.push(`/competitions/${e.compId}`)} />
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
