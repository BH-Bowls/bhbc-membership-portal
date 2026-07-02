// app/competitions/my/page.tsx
// Personal competition progress — shows the user's full journey through every
// competition they have entered, including byes, wins/losses with scores,
// handicap starting scores, and their current pending match.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { EmailLink, PhoneLink } from '@/components/ContactLink';
import { COMP_ROUND_LABELS } from '@/types/competitions';
import type { MyCompEntry, CompPosition, JourneyStep, ContactInfo } from '../../api/competitions/my/route';
import { getButtonClasses, getInputClasses } from '@/config/theme-helpers';

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

// ── Contact line ─────────────────────────────────────────────────────────────

function ContactLine({ person, label }: { person: ContactInfo; label?: string }) {
  const hasContact = person.mobile || person.email;
  return (
    <div className="text-xs text-gray-600">
      <span className="font-medium text-gray-700">
        {label ?? person.fullName}
      </span>
      {hasContact ? (
        <>
          {person.mobile && (
            <> · <PhoneLink phone={person.mobile} stopPropagation /></>
          )}
          {person.email && (
            <> · <EmailLink email={person.email} stopPropagation /></>
          )}
        </>
      ) : (
        <span className="text-gray-400 italic"> — no contact details on record</span>
      )}
    </div>
  );
}

// ── Overall status badge ──────────────────────────────────────────────────────

const STATUS_CONFIG = {
  active:       { label: 'Active',        className: 'bg-blue-100 text-blue-700' },
  awaiting:     { label: 'Awaiting draw', className: 'bg-yellow-100 text-yellow-700' },
  winner:       { label: 'Winner',        className: 'bg-green-100 text-green-700' },
  'knocked-out':{ label: 'Knocked out',   className: 'bg-gray-200 text-gray-700' },
} as const;

// ── Planned date + marker input ───────────────────────────────────────────────
// Inline editor for a pending match — saves the arranged date and optional marker.
// For singles competitions a marker dropdown is shown below the date picker.

function PlannedDateInput({
  initialDate,
  initialMarker,
  isSingles,
  playingMembers,
  onSave,
}: {
  initialDate: string;
  initialMarker: string;
  isSingles: boolean;
  playingMembers: { username: string; fullName: string }[];
  onSave: (date: string, marker: string) => Promise<void>;
}) {
  // Pre-fill date from the match's existing arranged date
  const [dateValue, setDateValue] = useState(initialDate);
  // Pre-fill marker from the match's existing marker value
  const [markerValue, setMarkerValue] = useState(initialMarker);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Sync inputs when the parent receives fresh data (e.g. after a refetch)
  useEffect(() => {
    setDateValue(initialDate);
  }, [initialDate]);

  useEffect(() => {
    setMarkerValue(initialMarker);
  }, [initialMarker]);

  // Auto-dismiss the "Saved" confirmation after 4 seconds
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(t);
  }, [saved]);

  async function handleSave() {
    // A date is required before saving
    if (!dateValue) {
      setError('Please select a date');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Pass both date and marker so they are written in the same PATCH call
      await onSave(dateValue, markerValue);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      {/* Date input — full width so it's visually separate from the Save button */}
      <input
        type="date"
        value={dateValue}
        onChange={(e) => {
          setDateValue(e.target.value);
          setError(null);
          setSaved(false);
        }}
        className={getInputClasses(!!error)}
        aria-label="Planned match date"
      />

      {/* Marker dropdown — only shown for singles competitions */}
      {isSingles && playingMembers.length > 0 && (
        <select
          value={markerValue}
          onChange={(e) => {
            setMarkerValue(e.target.value);
            setSaved(false);
          }}
          className={getInputClasses(false)}
          aria-label="Marker"
        >
          <option value="">— No marker assigned —</option>
          {/* Loop through the sorted playing members list */}
          {playingMembers.map((m) => (
            <option key={m.username} value={m.username}>{m.fullName}</option>
          ))}
        </select>
      )}

      {/* Save button sits below all inputs so it is clear it saves both date and marker */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !dateValue}
          className={getButtonClasses('primary', 'sm')}
        >
          {saving ? '…' : 'Save'}
        </button>
        {error && <p className="text-[10px] text-red-600">{error}</p>}
        {saved && <p className="text-[10px] text-green-700">Saved</p>}
      </div>
    </div>
  );
}

// ── Journey step row ──────────────────────────────────────────────────────────

function JourneyRow({
  step,
  isSingles,
  playingMembers,
  onSavePlannedDate,
}: {
  step: JourneyStep;
  isSingles: boolean;
  playingMembers: { username: string; fullName: string }[];
  onSavePlannedDate?: (matchId: string, date: string, marker: string) => Promise<void>;
}) {
  const { matchStatus, round, opponents, myScore, oppScore,
          playByDate, playedDate, myHandicap, myStartScore, oppStartScore, marker } = step;

  const oppNames = opponents && opponents.length > 0 ? nameList(opponents) : null;

  // Determine the row state for conditional rendering
  const isBye     = matchStatus === 'Bye';
  const isWon     = matchStatus === 'Won' || matchStatus === 'WalkoverWon';
  const isLost    = matchStatus === 'Lost' || matchStatus === 'WalkoverLost';
  const isPending = matchStatus === 'Pending';

  const roundPill = (
    <span className="inline-block text-xs font-medium bg-gray-200 text-gray-800 rounded px-1.5 py-0.5 w-16 text-center shrink-0">
      {roundLabel(round)}
    </span>
  );

  // Handicap context line (handicap comp only — both players must have a handicap)
  const showHcp = myHandicap != null && opponents && opponents[0] != null && opponents[0].handicap != null;
  const oppHcp  = (opponents && opponents[0]) ? opponents[0].handicap : null;

  const hcpLine = showHcp ? (
    <span className="text-xs text-gray-700">
      Hcp: you {myHandicap} / opp {oppHcp}
      {myStartScore != null && oppStartScore != null && (
        <span className="ml-1 text-gray-700">
          · {isPending ? 'starts' : 'started'} {myStartScore}–{oppStartScore}
        </span>
      )}
    </span>
  ) : null;

  // Resolve the marker's full name for display — look up from the playing members list
  let markerFullName = '';
  if (marker) {
    for (let i = 0; i < playingMembers.length; i++) {
      if (playingMembers[i].username.toLowerCase() === marker.toLowerCase()) {
        markerFullName = playingMembers[i].fullName;
        break;
      }
    }
    // Fall back to the username if the member is not in the playing list (e.g. non-playing marker)
    if (!markerFullName) {
      markerFullName = marker;
    }
  }

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
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="text-sm font-medium text-blue-700">
                vs {oppNames ? oppNames : 'TBD'}
              </span>
            </div>
            {playByDate && (
              <p className="text-xs text-gray-700">Play by {formatDate(playByDate)}</p>
            )}
            {hcpLine && <p>{hcpLine}</p>}
            {playedDate && (
              <p className="text-xs text-green-700 font-medium">Arranged: {formatDate(playedDate)}</p>
            )}
            {/* Show the assigned marker name for singles comps */}
            {isSingles && markerFullName && (
              <p className="text-xs text-gray-700">Marker: {markerFullName}</p>
            )}
            {onSavePlannedDate && (
              <PlannedDateInput
                initialDate={playedDate || ''}
                initialMarker={marker || ''}
                isSingles={isSingles}
                playingMembers={playingMembers}
                onSave={(date, m) => onSavePlannedDate(step.matchId, date, m)}
              />
            )}
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

function EntryCard({
  entry,
  userName,
  onClick,
  playingMembers,
  onSavePlannedDate,
}: {
  entry: MyCompEntry;
  userName: string;
  onClick: () => void;
  playingMembers: { username: string; fullName: string }[];
  onSavePlannedDate?: (matchId: string, date: string, marker: string) => Promise<void>;
}) {
  const { label, className } = STATUS_CONFIG[entry.entryStatus];
  const isActive     = entry.entryStatus === 'active';
  const isKnockedOut = entry.entryStatus === 'knocked-out';

  const showTeam = entry.compType !== 'singles' && entry.match && entry.match.partners.length > 0;
  const teamLine = showTeam
    ? buildTeamLine(userName, entry.myPosition, entry.match!.partners)
    : null;

  return (
    <div
      className={`w-full text-left bg-white rounded-lg border p-4 ${
        isActive ? 'border-blue-200' : 'border-gray-200'
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

      {/* Team composition (pairs / triples) + contacts + challenger notice */}
      {(teamLine || isActive) && (
        <div className="mb-3 space-y-1.5">
          {teamLine && (
            <p className="text-xs text-gray-600">{teamLine}</p>
          )}

          {/* Contact details — only shown on active entries */}
          {isActive && entry.match && (() => {
            const { partners, opponents } = entry.match;
            const isSkip = entry.myPosition === 'Skip' || entry.compType === 'singles';
            const oppSkip = opponents?.[0] ?? null; // first opponent = skip (singles, pairs) or skip (triples)

            if (entry.compType === 'singles') {
              // Singles: show opponent contact
              return oppSkip ? (
                <div className="bg-gray-50 rounded p-2 space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Next Opponent</p>
                  <ContactLine person={oppSkip} />
                </div>
              ) : null;
            }

            if (entry.compType === 'pairs') {
              const isMarriedPairs = entry.compId === 'married-pairs';

              if (isMarriedPairs) {
                // Married Pairs: no partner details, always show both opponents
                return opponents && opponents.length > 0 ? (
                  <div className="bg-gray-50 rounded p-2 space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Next Opponents</p>
                    {opponents.map((o) => <ContactLine key={o.username} person={o} label={`${o.position ?? ''}: ${o.fullName}`} />)}
                  </div>
                ) : null;
              }

              // Regular pairs: partner + (if skip) opposing skip
              return (partners.length > 0 || (isSkip && oppSkip)) ? (
                <div className="bg-gray-50 rounded p-2 space-y-1">
                  {partners.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your Partner</p>
                      {partners.map((p) => <ContactLine key={p.username} person={p} />)}
                    </>
                  )}
                  {isSkip && oppSkip && (
                    <>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-1.5">Next Opposing Skip</p>
                      <ContactLine person={oppSkip} />
                    </>
                  )}
                </div>
              ) : null;
            }

            if (entry.compType === 'triples') {
              // Triples: other two team members
              return partners.length > 0 ? (
                <div className="bg-gray-50 rounded p-2 space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your Team</p>
                  {partners.map((p) => <ContactLine key={p.username} person={p} label={`${p.position ?? ''}: ${p.fullName}`} />)}
                </div>
              ) : null;
            }

            return null;
          })()}

          {isActive && (
            <div className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1.5 space-y-0.5">
              <div>
                {entry.isChallenger ? 'You are the Challenger' : 'You are the Opponent'}
                {entry.isChallenger && entry.offerByDate && (
                  <span className="font-medium"> — offer your opponent 3 dates by {formatDate(entry.offerByDate)}</span>
                )}
              </div>
              {entry.match?.playByDate && (
                <div>Round must be played by <span className="font-medium">{formatDate(entry.match.playByDate)}</span></div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Journey timeline */}
      {entry.journey.length > 0 && (
        <div className="divide-y divide-gray-100">
          {/* Loop through each match in the user's journey through this competition */}
          {entry.journey.map((step) => (
            <JourneyRow
              key={step.matchId}
              step={step}
              isSingles={entry.compType === 'singles'}
              playingMembers={playingMembers}
              onSavePlannedDate={onSavePlannedDate}
            />
          ))}
        </div>
      )}

      <div className="mt-3 text-right">
        <button
          onClick={onClick}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
        >
          Show Draw →
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyCompetitionsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [entries, setEntries] = useState<MyCompEntry[]>([]);
  // Playing members list from the API — used to populate the marker dropdown
  const [playingMembers, setPlayingMembers] = useState<{ username: string; fullName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = session?.user?.role || '';

  // Fetch the user's competition entries and the playing members list together
  const fetchEntries = useCallback(() => {
    setLoading(true);
    fetch('/api/competitions/my')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEntries(data.entries || []);
        // Store the playing members list returned by the API for the marker dropdown
        setPlayingMembers(data.playingMembers || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Save both the arranged date and the marker for a pending match.
  // marker is the username of the selected marker ('' = clear / no marker).
  async function handleSavePlannedDate(compId: string, matchId: string, date: string, marker: string) {
    const res = await fetch(`/api/competitions/${compId}/matches/${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // Send both fields in one request — marker may be '' to clear, which is fine
      body: JSON.stringify({ playedDate: date, marker }),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error || 'Failed to save');
    }
    fetchEntries();
    // TODO: call clearDiaryCache(session.user.userName) here when home-cache.ts is implemented
  }

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
                  {/* Loop through active competitions and render a card for each */}
                  {active.map((e) => (
                    <EntryCard
                      key={e.compId}
                      entry={e}
                      userName={session?.user?.name || ''}
                      onClick={() => router.push(`/competitions/${e.compId}`)}
                      playingMembers={playingMembers}
                      onSavePlannedDate={(matchId, date, marker) => handleSavePlannedDate(e.compId, matchId, date, marker)}
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
                  {/* Loop through competitions where the user is waiting for the next round draw */}
                  {awaiting.map((e) => (
                    <EntryCard
                      key={e.compId}
                      entry={e}
                      userName={session?.user?.name || ''}
                      onClick={() => router.push(`/competitions/${e.compId}`)}
                      playingMembers={playingMembers}
                      onSavePlannedDate={(matchId, date, marker) => handleSavePlannedDate(e.compId, matchId, date, marker)}
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
                  {/* Loop through competitions where the user is the winner */}
                  {winner.map((e) => (
                    <EntryCard
                      key={e.compId}
                      entry={e}
                      userName={session?.user?.name || ''}
                      onClick={() => router.push(`/competitions/${e.compId}`)}
                      playingMembers={playingMembers}
                      onSavePlannedDate={(matchId, date, marker) => handleSavePlannedDate(e.compId, matchId, date, marker)}
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
                  {/* Loop through competitions where the user has been eliminated */}
                  {knockedOut.map((e) => (
                    <EntryCard
                      key={e.compId}
                      entry={e}
                      userName={session?.user?.name || ''}
                      onClick={() => router.push(`/competitions/${e.compId}`)}
                      playingMembers={playingMembers}
                      onSavePlannedDate={(matchId, date, marker) => handleSavePlannedDate(e.compId, matchId, date, marker)}
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
