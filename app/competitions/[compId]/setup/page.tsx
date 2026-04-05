// app/competitions/[compId]/setup/page.tsx
// Committee-only page to manage a competition:
//   Step 1 — configure play-by dates and finals date
//   Step 2 — enter the draw (who plays who in each match)

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { COMP_ROUND_LABELS, ROUND_ORDER } from '@/types/competitions';
import type { Competition, CompMatch, CompMemberInfo, CompRound } from '@/types/competitions';

// ============================================================================
// TYPES
// ============================================================================

type SetupStep = 'dates' | 'draw';

/** One slot per player within a side. All-empty side2 = bye. */
interface DrawEntry {
  matchId: string;
  round: CompRound;
  position: number;
  side1: string[];  // usernames, length = playersPerSide
  side2: string[];  // usernames, length = playersPerSide — all empty = bye
  playByDate: string;
  isBye?: boolean;  // true = prelim bye slot; false = real match (overrides empty-side2 check)
}

// ============================================================================
// HELPERS
// ============================================================================

function buildMatchId(compId: string, round: CompRound, pos: number): string {
  return `${compId}-${round.toLowerCase()}-${pos}`;
}

function playersPerSideFor(compType: string): number {
  if (compType === 'pairs') return 2;
  if (compType === 'triples') return 3;
  return 1;
}

function emptySide(n: number): string[] {
  return Array(n).fill('');
}

function formatDateShort(d: string): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return d; }
}

/** Mirror of server-side nextRoundLabel — determines what round comes after the current one. */
function nextRoundLabelClient(current: CompRound, nextCount: number): CompRound {
  if (current === 'Prelim') return 'R1';
  if (nextCount === 1) return 'F';
  if (nextCount === 2) return 'SF';
  if (nextCount === 4) return 'QF';
  if (nextCount === 8) return 'R2';
  return 'R1';
}

/**
 * Compute the ordered list of rounds that will exist for a given side count.
 * Used to show only the relevant date fields on the dates tab.
 * e.g. 21 entrants → ['Prelim','R1','QF','SF','F']  (no R2)
 *      32 entrants → ['R1','R2','QF','SF','F']
 */
function computeRequiredRounds(sideCount: number): CompRound[] {
  const { firstRound, totalSlots } = computeBracketInfo(sideCount);
  const rounds: CompRound[] = [firstRound];
  let current = firstRound;
  let count = totalSlots;
  while (count > 1) {
    count = Math.floor(count / 2);
    const next = nextRoundLabelClient(current, count);
    rounds.push(next);
    current = next;
  }
  return rounds;
}

/**
 * Given entrant count and players-per-side, derive the bracket structure:
 * whether a prelim is needed, how many matches it has, and the first round label.
 */
function computeBracketInfo(sideCount: number): {
  bracketSize: number;
  needsPrelim: boolean;
  firstRound: CompRound;
  totalSlots: number;  // first-round draw slots (incl. byes)
  prelimRealMatches: number; // actual play-off matches in prelim (not counting byes)
} {
  if (sideCount <= 1) {
    return { bracketSize: 2, needsPrelim: false, firstRound: 'F', totalSlots: 1, prelimRealMatches: 0 };
  }
  let bracketSize = 1;
  while (bracketSize < sideCount) bracketSize *= 2;

  const isPow2 = (sideCount & (sideCount - 1)) === 0;
  const needsPrelim = !isPow2;

  // Number of draw slots = bracketSize / 2 (half the full bracket)
  const totalSlots = Math.max(bracketSize / 2, 1);

  // Actual matches that need to be played in Prelim = sideCount - bracketSize/2
  const prelimRealMatches = needsPrelim ? sideCount - bracketSize / 2 : 0;

  // First round label
  const firstRound: CompRound = needsPrelim ? 'Prelim' : 'R1';

  return { bracketSize, needsPrelim, firstRound, totalSlots, prelimRealMatches };
}

// ============================================================================
// SUB-COMPONENT: player select dropdown
// ============================================================================

interface PlayerSelectProps {
  value: string;
  onChange: (v: string) => void;
  entrants: CompMemberInfo[];
  subs: CompMemberInfo[];
  allMembers: CompMemberInfo[];
  placeholder?: string;
  assignedCounts: Map<string, number>;
  selfUsername?: string;
}

function PlayerSelect({
  value, onChange, entrants, subs, allMembers, placeholder = 'Select player',
  assignedCounts, selfUsername,
}: PlayerSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sort each group alphabetically
  const sort = (arr: CompMemberInfo[]) =>
    [...arr].sort((a, b) => a.fullName.localeCompare(b.fullName));

  const entrantUsernames = new Set(entrants.map((e) => e.username.toLowerCase()));
  const subUsernames     = new Set(subs.map((s) => s.username.toLowerCase()));

  const sortedEntrants = sort(entrants);
  const sortedSubs     = sort(subs);
  const sortedOthers   = sort(
    allMembers.filter(
      (m) => !entrantUsernames.has(m.username.toLowerCase()) && !subUsernames.has(m.username.toLowerCase())
    )
  );

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Word-start search (matches "fe" → "John Ferris")
  function matches(m: CompMemberInfo): boolean {
    if (!search) return true;
    const words = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const nameWords = m.fullName.toLowerCase().split(/\s+/);
    return words.every((sw) => nameWords.some((nw) => nw.startsWith(sw)));
  }

  // A player is "taken" if assigned to at least one OTHER slot
  function isTaken(m: CompMemberInfo): boolean {
    const u = m.username.toLowerCase();
    const self = (selfUsername ?? '').toLowerCase();
    const count = assignedCounts.get(u) ?? 0;
    return count > 0 && (u !== self || count > 1);
  }

  // Flat selectable list across all groups (for arrow navigation)
  const selectableItems: CompMemberInfo[] = [
    ...sortedEntrants, ...sortedSubs, ...sortedOthers,
  ].filter((m) => matches(m) && !isTaken(m));

  // Reset highlight when search or open state changes
  useEffect(() => { setHighlightedIndex(0); }, [search, isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlightedIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  function handleSelect(m: CompMemberInfo) {
    if (isTaken(m)) return;
    onChange(m.username);
    setIsOpen(false);
    setSearch('');
  }

  // What to show in the trigger input
  const allKnown = [...entrants, ...subs, ...allMembers];
  const selectedMember = value ? allKnown.find((m) => m.username.toLowerCase() === value.toLowerCase()) : undefined;
  const displayName = selectedMember?.fullName ?? value;

  // Trigger border colour — amber if this username appears more than once
  const isDuplicate = value && (assignedCounts.get(value.toLowerCase()) ?? 0) > 1;
  const borderClass = isDuplicate
    ? 'border-amber-400 bg-amber-50'
    : value
    ? 'border-green-400 bg-green-50'
    : 'border-red-300 bg-red-50';

  function renderGroup(label: string, group: CompMemberInfo[]) {
    const filtered = group.filter(matches);
    if (filtered.length === 0) return null;
    return (
      <div key={label}>
        <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 sticky top-0">
          {label}
        </div>
        {filtered.map((m) => {
          const taken    = isTaken(m);
          const selected = m.username.toLowerCase() === value.toLowerCase();
          const itemIdx  = selectableItems.indexOf(m);
          const highlighted = !taken && itemIdx === highlightedIndex;
          return (
            <div
              key={m.username}
              data-idx={taken ? undefined : itemIdx}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(m); }}
              onMouseEnter={() => { if (!taken) setHighlightedIndex(itemIdx); }}
              className={`flex items-center justify-between px-3 py-2 text-sm ${
                taken
                  ? 'text-gray-300 cursor-not-allowed'
                  : highlighted
                  ? 'bg-blue-100 text-blue-900 cursor-pointer'
                  : selected
                  ? 'bg-blue-50 text-blue-800 cursor-pointer'
                  : 'text-gray-900 hover:bg-gray-100 cursor-pointer'
              }`}
            >
              <span>{m.fullName}</span>
              {selected && <span className="text-blue-500 text-xs ml-2">✓</span>}
              {taken && !selected && <span className="text-gray-300 text-[10px] ml-2">in use</span>}
            </div>
          );
        })}
      </div>
    );
  }

  const hasResults = [sortedEntrants, sortedSubs, sortedOthers].some((g) => g.filter(matches).length > 0);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? search : displayName}
          onChange={(e) => { setSearch(e.target.value); setIsOpen(true); }}
          onFocus={() => { setSearch(''); setIsOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setIsOpen(false); setSearch(''); return; }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIsOpen(true);
              setHighlightedIndex((i) => Math.min(i + 1, selectableItems.length - 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightedIndex((i) => Math.max(i - 1, 0));
              return;
            }
            if (e.key === 'Enter' && isOpen) {
              e.preventDefault();
              const hit = selectableItems[highlightedIndex] ?? selectableItems[0];
              if (hit) handleSelect(hit);
            }
          }}
          placeholder={placeholder}
          className={`block w-full rounded-md shadow-sm text-sm px-3 py-2 border focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${borderClass}`}
        />
        {value && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => { e.preventDefault(); onChange(''); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 leading-none"
            aria-label="Clear"
          >
            ×
          </button>
        )}
      </div>

      {isOpen && (
        <div ref={listRef} className="absolute z-30 left-0 w-64 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
          {hasResults ? (
            <>
              {renderGroup('Entrants', sortedEntrants)}
              {renderGroup('Substitutes', sortedSubs)}
              {renderGroup('Other members', sortedOthers)}
            </>
          ) : (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function CompetitionSetupPage({
  params,
}: {
  params: Promise<{ compId: string }>;
}) {
  const { data: session } = useSession();
  const router = useRouter();

  const [compId, setCompId] = React.useState<string>('');
  React.useEffect(() => { params.then((p) => setCompId(p.compId)); }, [params]);

  const [competition, setCompetition] = useState<Competition | null>(null);
  const [entrants, setEntrants] = useState<CompMemberInfo[]>([]);
  const [subs, setSubs] = useState<CompMemberInfo[]>([]);
  const [allMembers, setAllMembers] = useState<CompMemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<SetupStep>('dates');
  const [saving, setSaving] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);

  // Dates form
  const [finalsDate, setFinalsDate] = useState('');
  const [prelimPlayBy, setPrelimPlayBy] = useState('');
  const [r1PlayBy, setR1PlayBy] = useState('');
  const [r2PlayBy, setR2PlayBy] = useState('');
  const [qfPlayBy, setQfPlayBy] = useState('');
  const [sfPlayBy, setSfPlayBy] = useState('');

  // Comp start date (when the first round begins; leave blank if fixed-day like Triples)
  const [compStartDate, setCompStartDate] = useState('');

  // Manual draw count — used when there are no renewals entrants (e.g. centenary)
  const [manualDrawCount, setManualDrawCount] = useState('');

  // Draw entries
  const [drawEntries, setDrawEntries] = useState<DrawEntry[]>([]);
  const [allCompMatches, setAllCompMatches] = useState<CompMatch[]>([]);
  const [selectedEditRound, setSelectedEditRound] = useState<CompRound | null>(null);
  const [isEditingFirstRound, setIsEditingFirstRound] = useState(true);

  const role = session?.user?.role ?? '';
  const isCommittee = !!role && role !== 'Member';

  // ── Session storage key ─────────────────────────────────────────────────────
  const storageKey = compId ? `draw-draft-${compId}` : null;

  // Autosave draw to sessionStorage on every change — first round only.
  // Does NOT set hasUnsaved here; that is set explicitly by user-interaction
  // functions so that loadData restoring entries doesn't trigger the banner.
  useEffect(() => {
    if (!storageKey || drawEntries.length === 0 || !isEditingFirstRound) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(drawEntries));
    } catch { /* ignore storage errors */ }
  }, [drawEntries, storageKey, isEditingFirstRound]);

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadData = useCallback((discarding = false) => {
    if (!compId) return;
    setLoading(true);

    Promise.all([
      fetch(`/api/competitions/${compId}`).then((r) => r.json()),
      fetch(`/api/competitions/${compId}/entrants`).then((r) => r.json()),
      fetch('/api/competitions/members').then((r) => r.json()),
    ])
      .then(([compData, entrantData, memberData]) => {
        if (compData.error) throw new Error(compData.error);

        const comp: Competition = compData.competition;
        const matches: CompMatch[] = compData.matches || [];
        setCompetition(comp);

        setFinalsDate(comp.finalsDate || '');
        setPrelimPlayBy(comp.prelimPlayBy || '');
        setR1PlayBy(comp.r1PlayBy || '');
        setR2PlayBy(comp.r2PlayBy || '');
        setQfPlayBy(comp.qfPlayBy || '');
        setSfPlayBy(comp.sfPlayBy || '');
        setCompStartDate(comp.compStartDate || '');
        if (comp.drawSideCount) setManualDrawCount(String(comp.drawSideCount));

        const pps = playersPerSideFor(comp.compType);

        const loadedEntrants: CompMemberInfo[] = !entrantData.error ? (entrantData.entrants || []) : [];
        if (!entrantData.error) {
          setEntrants(loadedEntrants);
          setSubs(entrantData.subs || []);
        }

        const loadedSideCount = Math.ceil(loadedEntrants.length / pps);
        const { prelimRealMatches: loadedPrelimRealMatches } = computeBracketInfo(loadedSideCount);

        const membersObj = memberData.members as Record<string, CompMemberInfo>;
        const memberList = Object.values(membersObj)
          .filter((m) => m.memberType === 'Playing Man' || m.memberType === 'Playing Lady')
          .sort((a, b) => {
            const t = (x: CompMemberInfo) => x.memberType === 'PM' ? 1 : 2;
            return t(a) - t(b) || a.fullName.localeCompare(b.fullName);
          });
        setAllMembers(memberList);

        // Store all matches for round switching
        setAllCompMatches(matches);
        setIsEditingFirstRound(true);

        // Check sessionStorage for unsaved draft (unless we're discarding)
        const savedKey = `draw-draft-${compId}`;
        const savedDraft = !discarding && storageKey ? sessionStorage.getItem(savedKey) : null;

        // Determine the first round from data
        const roundsPresent = matches.length > 0
          ? [...new Set(matches.map((m) => m.round))].sort(
              (a, b) => ROUND_ORDER.indexOf(a as CompRound) - ROUND_ORDER.indexOf(b as CompRound)
            )
          : [];
        const firstRound = (roundsPresent[0] ?? 'R1') as CompRound;
        setSelectedEditRound(firstRound);

        if (savedDraft) {
          try {
            const parsed: DrawEntry[] = JSON.parse(savedDraft);
            if (parsed.length > 0) {
              setDrawEntries(parsed);
              setHasUnsaved(true);
              return; // skip loading from API matches
            }
          } catch { /* invalid JSON, fall through */ }
        }

        // Load from API matches (first round only)
        if (matches.length > 0) {
          const firstRoundMatches = matches
            .filter((m) => m.round === firstRound)
            .sort((a, b) => a.position - b.position);

          setDrawEntries(firstRoundMatches.map((m) => ({
            matchId: m.matchId,
            round: m.round,
            position: m.position,
            side1: padToLength(m.side1Usernames, pps),
            side2: m.side2Usernames ? padToLength(m.side2Usernames, pps) : emptySide(pps),
            playByDate: m.playByDate || '',
            isBye: m.round === 'Prelim' ? m.position > loadedPrelimRealMatches : undefined,
          })));
          setHasUnsaved(false);
        } else {
          // No saved draw in API — clear any stale entries (e.g. after discarding)
          setDrawEntries([]);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [compId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!loading && !isCommittee) router.replace(`/competitions/${compId}`);
  }, [loading, isCommittee, compId, router]);

  // ── Pad / trim array to exact length ──────────────────────────────────────
  function padToLength(arr: string[], len: number): string[] {
    const result = [...arr];
    while (result.length < len) result.push('');
    return result.slice(0, len);
  }

  // ── Discard unsaved draft ──────────────────────────────────────────────────
  function discardDraft() {
    if (storageKey) sessionStorage.removeItem(storageKey);
    setHasUnsaved(false);
    loadData(true);
  }

  // ── Switch to editing a different round ────────────────────────────────────
  function switchToRound(round: CompRound) {
    if (!competition) return;
    const pps = playersPerSideFor(competition.compType);
    const firstRound = selectedEditRound ?? round; // current first round

    // Compute the actual first round from bracket info (for accurate comparison)
    const sideCount = Math.ceil(entrants.length / pps);
    const bracketFirstRound = entrants.length > 0
      ? computeBracketInfo(sideCount).firstRound
      : 'R1';

    const switchingToFirst = round === bracketFirstRound;
    setSelectedEditRound(round);
    setIsEditingFirstRound(switchingToFirst);

    if (switchingToFirst) {
      // Restore first-round draft from session storage if available
      if (storageKey) {
        const draft = sessionStorage.getItem(storageKey);
        if (draft) {
          try {
            const parsed: DrawEntry[] = JSON.parse(draft);
            if (parsed.length > 0) {
              setDrawEntries(parsed);
              setHasUnsaved(true);
              return;
            }
          } catch { /* fall through */ }
        }
      }
    }

    // Load this round's matches from the stored data
    const roundMatches = allCompMatches
      .filter((m) => m.round === round)
      .sort((a, b) => a.position - b.position);

    setDrawEntries(roundMatches.map((m) => ({
      matchId: m.matchId,
      round: m.round,
      position: m.position,
      side1: padToLength(m.side1Usernames, pps),
      side2: m.side2Usernames ? padToLength(m.side2Usernames, pps) : emptySide(pps),
      playByDate: m.playByDate || '',
    })));
    setHasUnsaved(false);
  }

  // ── Save non-first-round changes via individual PATCH calls ─────────────────
  async function saveNonFirstRound() {
    setSaving(true);
    const errors: string[] = [];
    try {
      for (const entry of drawEntries) {
        const side1 = entry.side1.filter(Boolean);
        const side2 = entry.side2.filter(Boolean);

        // Skip completely empty matches with no date either
        if (side1.length === 0 && side2.length === 0 && !entry.playByDate) continue;

        const body: Record<string, unknown> = {
          playByDate: entry.playByDate || null,
        };
        if (side1.length > 0) body.side1Usernames = side1;
        if (side2.length > 0) body.side2Usernames = side2;

        const res = await fetch(`/api/competitions/${compId}/matches/${entry.matchId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          errors.push(`Match #${entry.position}: ${(d as any).error || 'Failed to save'}`);
        }
      }

      if (errors.length > 0) {
        alert('Some matches could not be saved:\n' + errors.join('\n'));
      } else {
        // Refresh the matches for this competition and re-show the same round
        const currentRound = selectedEditRound;
        const refreshed = await fetch(`/api/competitions/${compId}`).then((r) => r.json());
        const freshMatches: CompMatch[] = refreshed.matches || [];
        setAllCompMatches(freshMatches);

        if (currentRound && competition) {
          const pps = playersPerSideFor(competition.compType);
          const roundMatches = freshMatches
            .filter((m) => m.round === currentRound)
            .sort((a, b) => a.position - b.position);
          setDrawEntries(roundMatches.map((m) => ({
            matchId: m.matchId,
            round: m.round,
            position: m.position,
            side1: padToLength(m.side1Usernames, pps),
            side2: m.side2Usernames ? padToLength(m.side2Usernames, pps) : emptySide(pps),
            playByDate: m.playByDate || '',
          })));
        }
        setHasUnsaved(false);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Scheduled date options (from configured dates) ──────────────────────────
  function scheduledDateOptions(): { label: string; value: string }[] {
    const opts: { label: string; value: string }[] = [];
    if (prelimPlayBy) opts.push({ label: `Preliminary — ${formatDateShort(prelimPlayBy)}`, value: prelimPlayBy });
    if (r1PlayBy)     opts.push({ label: `Round 1 — ${formatDateShort(r1PlayBy)}`,          value: r1PlayBy });
    if (r2PlayBy)     opts.push({ label: `Round 2 — ${formatDateShort(r2PlayBy)}`,          value: r2PlayBy });
    if (qfPlayBy)     opts.push({ label: `Quarter Final — ${formatDateShort(qfPlayBy)}`,    value: qfPlayBy });
    if (sfPlayBy)     opts.push({ label: `Semi Final — ${formatDateShort(sfPlayBy)}`,       value: sfPlayBy });
    if (finalsDate)   opts.push({ label: `Final — ${formatDateShort(finalsDate)}`,          value: finalsDate });
    return opts;
  }

  // ── Save dates ─────────────────────────────────────────────────────────────
  async function saveDates() {
    setSaving(true);
    try {
      const res = await fetch(`/api/competitions/${compId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finalsDate: finalsDate || null,
          prelimPlayBy: prelimPlayBy || null,
          r1PlayBy: r1PlayBy || null,
          r2PlayBy: r2PlayBy || null,
          qfPlayBy: qfPlayBy || null,
          sfPlayBy: sfPlayBy || null,
          compStartDate: compStartDate || null,
          ...(entrants.length === 0 && manualDrawCount
            ? { drawSideCount: parseInt(manualDrawCount, 10) || null }
            : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to save dates');
      }
      setStep('draw');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Rebuild slots preserving existing player assignments ───────────────────
  // Used when entrant count changes after the bracket was already created.
  // Keeps existing assignments by position; adds empty slots for new positions.
  function rebuildSlots() {
    if (!competition) return;
    const pps = playersPerSideFor(competition.compType);
    const entrySideCount = Math.ceil(entrants.length / pps);
    const manualN = parseInt(manualDrawCount, 10);
    const sideCount = entrySideCount > 0 ? entrySideCount : (manualN >= 2 ? manualN : entrySideCount);
    const { firstRound, totalSlots, prelimRealMatches } = computeBracketInfo(sideCount);
    const defaultDate = firstRound === 'Prelim' ? prelimPlayBy : r1PlayBy;

    // Use saved matches (allCompMatches) as the source of existing player data
    const savedFirstRound = ([...new Set(allCompMatches.map((m) => m.round))] as CompRound[])
      .sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))[0];
    const savedByPosition = new Map(
      allCompMatches
        .filter((m) => m.round === savedFirstRound)
        .map((m) => [m.position, m])
    );

    setHasUnsaved(true);
    setDrawEntries(
      Array.from({ length: totalSlots }, (_, i) => {
        const pos = i + 1;
        const saved = savedByPosition.get(pos);
        return {
          matchId: buildMatchId(compId, firstRound, pos),
          round: firstRound,
          position: pos,
          side1: saved ? padToLength(saved.side1Usernames, pps) : emptySide(pps),
          side2: saved?.side2Usernames ? padToLength(saved.side2Usernames, pps) : emptySide(pps),
          playByDate: saved?.playByDate || defaultDate,
          isBye: firstRound === 'Prelim' ? i >= prelimRealMatches : undefined,
        };
      })
    );
  }

  // ── Initialise empty match slots from entrant count ────────────────────────
  function initialiseSlots(overrideSideCount?: number) {
    if (!competition) return;
    const pps = playersPerSideFor(competition.compType);
    const sideCount = overrideSideCount ?? Math.ceil(entrants.length / pps);
    const { firstRound, totalSlots, prelimRealMatches } = computeBracketInfo(sideCount);

    // Use the date that matches the first round
    const defaultDate = firstRound === 'Prelim' ? prelimPlayBy : r1PlayBy;

    setHasUnsaved(true);
    setDrawEntries(
      Array.from({ length: totalSlots }, (_, i) => ({
        matchId: buildMatchId(compId, firstRound, i + 1),
        round: firstRound,
        position: i + 1,
        side1: emptySide(pps),
        side2: emptySide(pps),
        playByDate: defaultDate,
        // First prelimRealMatches slots are real matches; the rest are bye slots
        isBye: firstRound === 'Prelim' ? i >= prelimRealMatches : undefined,
      }))
    );
  }

  // ── Update a single player slot ────────────────────────────────────────────
  function setPlayer(entryIdx: number, side: 'side1' | 'side2', slotIdx: number, username: string) {
    setHasUnsaved(true);
    setDrawEntries((prev) =>
      prev.map((e, i) => {
        if (i !== entryIdx) return e;
        const updated = [...e[side]];
        updated[slotIdx] = username;
        return { ...e, [side]: updated };
      })
    );
  }

  function addSlot() {
    if (!competition) return;
    const pps = playersPerSideFor(competition.compType);
    const maxPos = drawEntries.reduce((m, e) => Math.max(m, e.position), 0);
    // Match the round of existing entries (Prelim or R1)
    const existingRound = drawEntries[0]?.round ?? 'R1';
    const defaultDate = existingRound === 'Prelim' ? prelimPlayBy : r1PlayBy;
    setHasUnsaved(true);
    setDrawEntries((prev) => [
      ...prev,
      {
        matchId: buildMatchId(compId, existingRound, maxPos + 1),
        round: existingRound,
        position: maxPos + 1,
        side1: emptySide(pps),
        side2: emptySide(pps),
        playByDate: defaultDate,
      },
    ]);
  }

  function removeSlot(idx: number) {
    setHasUnsaved(true);
    setDrawEntries((prev) => prev.filter((_, i) => i !== idx));
  }

  function updatePlayByDate(idx: number, date: string) {
    setHasUnsaved(true);
    setDrawEntries((prev) => prev.map((e, i) => i === idx ? { ...e, playByDate: date } : e));
  }

  // ── Save draw ──────────────────────────────────────────────────────────────
  async function saveDraw() {
    if (!competition) return;
    if (!isEditingFirstRound) {
      await saveNonFirstRound();
      return;
    }
    setSaving(true);
    try {
      const matches: CompMatch[] = drawEntries.map((entry) => {
        const side2Filtered = entry.side2.filter(Boolean);
        const isBye = side2Filtered.length === 0;
        return {
          matchId: entry.matchId,
          round: entry.round,
          position: entry.position,
          side1Usernames: entry.side1.filter(Boolean),
          side2Usernames: isBye ? null : side2Filtered,
          status: 'Pending' as const,
          playByDate: entry.playByDate || null,
        };
      });

      const warnings: string[] = [];
      for (const m of matches) {
        if (m.side1Usernames.length === 0) {
          warnings.push(`Match #${m.position}: Side 1 has no players selected`);
        }
      }
      if (warnings.length > 0) {
        const ok = window.confirm(
          `Some matches are incomplete:\n\n${warnings.join('\n')}\n\nSave anyway?`
        );
        if (!ok) { setSaving(false); return; }
      }

      const res = await fetch(`/api/competitions/${compId}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches, drawSideCount: sideCount }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to save draw');
      }

      // Clear draft on successful save
      if (storageKey) sessionStorage.removeItem(storageKey);
      setHasUnsaved(false);

      router.push(`/competitions/${compId}`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  // Count of how many slots each username occupies in the round being edited.
  // Used by PlayerSelect to detect duplicates (count > 1) and block re-selection.
  const assignedCounts = React.useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const entry of drawEntries) {
      for (const u of [...entry.side1, ...entry.side2]) {
        if (u) {
          const key = u.toLowerCase();
          map.set(key, (map.get(key) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [drawEntries]);

  // Usernames assigned across ALL rounds — used for the entrant status bar so
  // players who appear in Prelim are still shown as assigned when editing R1.
  const allRoundsAssigned = React.useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const m of allCompMatches) {
      for (const u of [...m.side1Usernames, ...(m.side2Usernames ?? [])]) {
        if (u) set.add(u.toLowerCase());
      }
    }
    // Also include anything in the current draft not yet saved
    for (const entry of drawEntries) {
      for (const u of [...entry.side1, ...entry.side2]) {
        if (u) set.add(u.toLowerCase());
      }
    }
    return set;
  }, [allCompMatches, drawEntries]);

  const unassignedEntrants = entrants.filter(
    (e) => !allRoundsAssigned.has(e.username.toLowerCase())
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
        <div className="flex items-center justify-center py-24 text-gray-400">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
        <div className="container mx-auto px-4 py-12 max-w-2xl">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
        </div>
      </div>
    );
  }

  const comp = competition!;
  const pps = playersPerSideFor(comp.compType);
  const slotLabels =
    comp.compType === 'pairs'   ? ['Skip', 'Lead'] :
    comp.compType === 'triples' ? ['Skip', 'No.2', 'Lead'] :
    ['Player'];

  // Bracket info for the dates panel
  const sideCount = Math.ceil(entrants.length / pps);
  const manualN = parseInt(manualDrawCount, 10);
  const effectiveSideCount = entrants.length > 0 ? sideCount : (manualN >= 2 ? manualN : 0);
  const bracketInfo = effectiveSideCount >= 2 ? computeBracketInfo(effectiveSideCount) : null;
  // Derive required rounds: prefer computed bracket, else use rounds already present in saved matches
  const requiredRounds: CompRound[] = effectiveSideCount >= 2
    ? computeRequiredRounds(effectiveSideCount)
    : allCompMatches.length > 0
      ? ROUND_ORDER.filter((r) => allCompMatches.some((m) => m.round === r))
      : ['R1', 'QF', 'SF', 'F'];
  const dateOpts = scheduledDateOptions();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{comp.displayName} — Manage</h1>
          <p className="text-gray-500 text-sm mt-0.5 capitalize">{comp.compType} · {comp.status}</p>
        </div>

        {/* Step tabs */}
        <div className="flex gap-1 mb-6">
          {(['dates', 'draw'] as SetupStep[]).map((s) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                step === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s === 'dates' ? '1. Dates' : '2. Draw'}
            </button>
          ))}
        </div>

        {/* ── STEP 1: Dates ───────────────────────────────────────────────── */}
        {step === 'dates' && (
          <div className="space-y-4">

            {/* Entrant / bracket info panel */}
            {bracketInfo && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
                <p className="font-semibold text-blue-900 mb-2">
                  {entrants.length > 0
                    ? <>{entrants.length} entrant{entrants.length !== 1 ? 's' : ''}{pps > 1 && ` · ${sideCount} team${sideCount !== 1 ? 's' : ''}`}</>
                    : <>{effectiveSideCount} player{effectiveSideCount !== 1 ? 's' : ''} in draw</>
                  }
                </p>
                <ul className="text-blue-700 space-y-0.5 text-xs">
                  {bracketInfo.needsPrelim ? (
                    <>
                      <li>
                        <span className="font-medium">Preliminary:</span>{' '}
                        {bracketInfo.prelimRealMatches} match{bracketInfo.prelimRealMatches !== 1 ? 'es' : ''}
                        {' '}({bracketInfo.totalSlots - bracketInfo.prelimRealMatches} {pps > 1 ? 'team' : 'player'}{bracketInfo.totalSlots - bracketInfo.prelimRealMatches !== 1 ? 's' : ''} get byes to Round 1)
                        {' '}— set a Preliminary play-by date below
                      </li>
                      <li>
                        <span className="font-medium">Round 1 onwards:</span>{' '}
                        {bracketInfo.totalSlots} {pps > 1 ? 'team' : 'player'}{bracketInfo.totalSlots !== 1 ? 's' : ''}
                      </li>
                    </>
                  ) : (
                    <li>No Preliminary round needed — {effectiveSideCount} players fit the draw sheet cleanly.</li>
                  )}
                </ul>
              </div>
            )}

            {/* Entrant count mismatch — bracket needs rebuilding */}
            {bracketInfo && allCompMatches.length > 0 && competition?.drawSideCount != null &&
              effectiveSideCount > 0 && effectiveSideCount !== competition.drawSideCount && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm">
                  <p className="font-semibold text-amber-800 mb-1">Entrant count has changed</p>
                  <p className="text-amber-700">
                    The bracket was drawn for <strong>{competition.drawSideCount}</strong> player{competition.drawSideCount !== 1 ? 's' : ''} but there{' '}
                    {effectiveSideCount === 1 ? 'is' : 'are'} now <strong>{effectiveSideCount}</strong> player{effectiveSideCount !== 1 ? 's' : ''}.
                    {' '}Rebuilding will adjust the preliminary round — existing player assignments will be preserved where possible.
                  </p>
                  <button
                    onClick={() => { rebuildSlots(); setStep('draw'); }}
                    className="mt-3 px-4 py-1.5 bg-amber-600 text-white rounded-md hover:bg-amber-700 text-sm font-medium"
                  >
                    Rebuild Bracket
                  </button>
                </div>
              )}

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <h2 className="font-semibold text-gray-900 mb-2">Play-by dates &amp; finals</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Finals date — always shown */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Finals date
                    {!finalsDate && <span className="ml-1 text-xs text-amber-600 font-normal">required</span>}
                  </label>
                  <input
                    type="date"
                    value={finalsDate}
                    onChange={(e) => setFinalsDate(e.target.value)}
                    className={`block w-full rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm ${
                      !finalsDate ? 'border-amber-300' : 'border-gray-300'
                    }`}
                  />
                </div>

                {/* Round play-by dates — only show rounds the bracket actually needs */}
                {([
                  { round: 'Prelim' as CompRound, label: 'Preliminary play by', value: prelimPlayBy, setter: setPrelimPlayBy },
                  { round: 'R1'    as CompRound, label: 'Round 1 play by',       value: r1PlayBy,    setter: setR1PlayBy },
                  { round: 'R2'    as CompRound, label: 'Round 2 play by',       value: r2PlayBy,    setter: setR2PlayBy },
                  { round: 'QF'    as CompRound, label: 'Quarter Final play by', value: qfPlayBy,    setter: setQfPlayBy },
                  { round: 'SF'    as CompRound, label: 'Semi Final play by',    value: sfPlayBy,    setter: setSfPlayBy },
                ] as const).filter(({ round }) => requiredRounds.includes(round)).map(({ label, value, setter }) => (
                  <div key={label}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {label}
                      {!value && <span className="ml-1 text-xs text-amber-600 font-normal">required</span>}
                    </label>
                    <input
                      type="date"
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      className={`block w-full rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm ${
                        !value ? 'border-amber-300' : 'border-gray-300'
                      }`}
                    />
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-4">
                <div className="sm:w-1/2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Comp start date
                    <span className="ml-1 text-xs text-gray-400 font-normal">
                      — challengers must offer 3 dates within 7 days. Leave blank if first round is a fixed day (e.g. Triples).
                    </span>
                  </label>
                  <input
                    type="date"
                    value={compStartDate}
                    onChange={(e) => setCompStartDate(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>

              {/* Number of players — open-draw comps only (no renewals entrant list) */}
              {entrants.length === 0 && (() => {
                const n = parseInt(manualDrawCount, 10);
                const info = n >= 2 ? computeBracketInfo(n) : null;
                return (
                  <div className="border-t border-gray-100 pt-4">
                    <div className="sm:w-1/2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Number of players in draw
                        <span className="ml-1 text-xs text-gray-400 font-normal">— required to create the bracket</span>
                      </label>
                      <input
                        type="number"
                        min={2}
                        max={128}
                        value={manualDrawCount}
                        onChange={(e) => setManualDrawCount(e.target.value)}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                        placeholder="e.g. 16"
                      />
                      {info && (
                        <p className="mt-1.5 text-xs text-gray-500">
                          {info.needsPrelim
                            ? `Preliminary round: ${info.prelimRealMatches} match${info.prelimRealMatches !== 1 ? 'es' : ''}, ${info.totalSlots - info.prelimRealMatches} bye${info.totalSlots - info.prelimRealMatches !== 1 ? 's' : ''}`
                            : `No preliminary round — all ${n} players go straight to Round 1`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end pt-2">
                <button
                  onClick={saveDates}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save dates & continue →'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Draw ────────────────────────────────────────────────── */}
        {step === 'draw' && (
          <div className="space-y-5">

            {/* Round selector — shown when multiple rounds have matches */}
            {allCompMatches.length > 0 && (() => {
              const availableRounds = ROUND_ORDER.filter((r) =>
                allCompMatches.some((m) => m.round === r)
              );
              if (availableRounds.length < 2) return null;
              return (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    Editing round:
                  </label>
                  <select
                    value={selectedEditRound ?? availableRounds[0]}
                    onChange={(e) => switchToRound(e.target.value as CompRound)}
                    className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                  >
                    {availableRounds.map((r) => (
                      <option key={r} value={r}>{COMP_ROUND_LABELS[r] ?? r}</option>
                    ))}
                  </select>
                  {!isEditingFirstRound && (
                    <span className="text-xs text-gray-400">
                      Changes are saved directly to these matches
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Unsaved changes banner — first round only */}
            {hasUnsaved && isEditingFirstRound && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between text-sm">
                <span className="text-amber-800">You have unsaved changes to this draw.</span>
                <button
                  onClick={discardDraft}
                  className="text-amber-600 hover:text-amber-800 text-xs underline ml-4"
                >
                  Discard &amp; reload saved draw
                </button>
              </div>
            )}

            {/* Entrant status bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-gray-900 text-sm">
                  {entrants.length > 0
                    ? `Entrants — ${entrants.length - unassignedEntrants.length}/${entrants.length} assigned across all rounds`
                    : 'Draw — open draw (all members eligible)'}
                </h2>
                {isEditingFirstRound && drawEntries.length === 0 && entrants.length > 0 && (
                  <button
                    onClick={() => initialiseSlots()}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Create match slots from entrant count
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {entrants.map((e) => {
                  const assigned = allRoundsAssigned.has(e.username.toLowerCase());
                  return (
                    <span
                      key={e.username}
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        assigned
                          ? 'bg-green-100 text-green-700 line-through opacity-60'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                      title={e.username}
                    >
                      {e.fullName}
                    </span>
                  );
                })}
              </div>
              {subs.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-400 mb-1">Substitutes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {subs.map((s) => {
                      const used = (assignedCounts.get(s.username.toLowerCase()) ?? 0) > 0;
                      return (
                        <span
                          key={s.username}
                          className={`text-xs border px-2 py-0.5 rounded-full ${
                            used
                              ? 'bg-orange-50 text-orange-400 border-orange-200 line-through opacity-60'
                              : 'bg-orange-50 text-orange-700 border-orange-200'
                          }`}
                          title={s.username}
                        >
                          {s.fullName}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Match draw cards */}
            {drawEntries.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
                {isEditingFirstRound ? (
                  <>
                    <p className="text-gray-400 text-sm mb-4">No match slots yet.</p>
                    {entrants.length > 0 ? (
                      <button
                        onClick={() => initialiseSlots()}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                      >
                        Create slots from entrant count ({entrants.length} entrants)
                      </button>
                    ) : parseInt(manualDrawCount, 10) >= 2 ? (
                      <button
                        onClick={() => initialiseSlots(parseInt(manualDrawCount, 10))}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                      >
                        Create slots for {parseInt(manualDrawCount, 10)} players
                      </button>
                    ) : (
                      <p className="text-gray-400 text-sm">
                        Set the number of players on the dates page first.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-gray-400 text-sm">
                    No matches in this round yet. Save the first-round draw first.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {drawEntries.map((entry, idx) => {
                  const isByeEntry = entry.side2.every((s) => !s) && entry.isBye !== false;
                  return (
                    <div key={entry.matchId} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {COMP_ROUND_LABELS[entry.round] ?? entry.round} {entry.position}
                          {isByeEntry && (
                            <span className="ml-2 normal-case font-normal text-gray-400">· Bye</span>
                          )}
                        </span>
                        <div className="flex items-center gap-3">
                          {/* Date dropdown — restricted to scheduled dates */}
                          {dateOpts.length > 0 ? (
                            <select
                              value={entry.playByDate}
                              onChange={(e) => updatePlayByDate(idx, e.target.value)}
                              tabIndex={-1}
                              className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-xs"
                            >
                              <option value="">— date —</option>
                              {dateOpts.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="date"
                              value={entry.playByDate}
                              onChange={(e) => updatePlayByDate(idx, e.target.value)}
                              tabIndex={-1}
                              title="Play by date"
                              className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-xs"
                            />
                          )}
                          {isEditingFirstRound && (
                            <button
                              onClick={() => removeSlot(idx)}
                              tabIndex={-1}
                              className="text-red-400 hover:text-red-600 text-sm"
                              title="Remove match"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-start gap-4">
                        {/* Side 1 */}
                        <div className="flex-1 min-w-[180px]">
                          <p className="text-xs text-gray-400 mb-1">Side 1</p>
                          <div className="space-y-1.5">
                            {entry.side1.map((username, slotIdx) => (
                              <div key={slotIdx}>
                                {pps > 1 && (
                                  <p className="text-xs text-gray-400 mb-0.5">{slotLabels[slotIdx]}</p>
                                )}
                                <PlayerSelect
                                  value={username}
                                  onChange={(v) => setPlayer(idx, 'side1', slotIdx, v)}
                                  entrants={entrants}
                                  subs={subs}
                                  allMembers={allMembers}
                                  assignedCounts={assignedCounts}
                                  selfUsername={username}
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* VS divider + Side 2 — hidden for bye slots */}
                        {!isByeEntry && (
                          <>
                            <div className="flex items-center pt-5 text-gray-300 font-bold text-sm">vs</div>

                            <div className="flex-1 min-w-[180px]">
                              <p className="text-xs text-gray-400 mb-1">Side 2</p>
                              <div className="space-y-1.5">
                                {entry.side2.map((username, slotIdx) => (
                                  <div key={slotIdx}>
                                    {pps > 1 && (
                                      <p className="text-xs text-gray-400 mb-0.5">{slotLabels[slotIdx]}</p>
                                    )}
                                    <PlayerSelect
                                      value={username}
                                      onChange={(v) => setPlayer(idx, 'side2', slotIdx, v)}
                                      entrants={entrants}
                                      subs={subs}
                                      allMembers={allMembers}
                                      assignedCounts={assignedCounts}
                                      selfUsername={username}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {isEditingFirstRound && (
                  <button
                    onClick={addSlot}
                    className="w-full py-2 border border-dashed border-gray-300 rounded-xl text-sm text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
                  >
                    + Add match slot
                  </button>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-between">
              <button
                onClick={() => setStep('dates')}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 text-sm"
              >
                ← Back to dates
              </button>
              <button
                onClick={saveDraw}
                disabled={saving || drawEntries.length === 0}
                className="px-5 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium disabled:opacity-50"
              >
                {saving
                  ? 'Saving…'
                  : isEditingFirstRound
                  ? 'Save draw & go to draw sheet'
                  : `Save ${COMP_ROUND_LABELS[selectedEditRound!] ?? 'round'} changes`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
