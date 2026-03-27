// app/rowland/[compId]/setup/page.tsx
// Committee management: play-by dates, number of teams, bracket slot assignment

'use client';

import { use, useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type { RowlandComp, RowlandMatch, RowlandMatchStatus, RowlandTeamRef } from '@/types/rowland';
import { ROWLAND_COMP_NAMES, ROWLAND_ROUND_LABELS } from '@/types/rowland';
import { getInputClasses } from '@/config/theme-helpers';

interface Club { clubId: string; clubName: string; }

// ============================================================================
// BRACKET MATH (mirrors computeRowlandBracket in rowland-sheets.ts)
// ============================================================================

interface BracketInfo {
  hasPrelim: boolean;
  prelimMatches: number;
  byeCount: number;
  r1Matches: number;
}

function computeBracketInfo(numTeams: number): BracketInfo {
  if (numTeams < 2) return { hasPrelim: false, prelimMatches: 0, byeCount: 0, r1Matches: 0 };
  let P = 1;
  while (P < numTeams) P *= 2;
  const hasPrelim = numTeams !== P;
  return {
    hasPrelim,
    prelimMatches: hasPrelim ? numTeams - P / 2 : 0,
    byeCount:      hasPrelim ? P - numTeams : 0,
    r1Matches:     (hasPrelim ? P / 2 : numTeams) / 2,
  };
}

// ============================================================================
// CLUB SELECT
// ============================================================================

interface ClubSelectProps {
  team: RowlandTeamRef | null;
  clubs: Club[];
  placeholder?: string;
  onSave: (team: RowlandTeamRef | null) => Promise<void>;
}

function ClubSelect({ team, clubs, placeholder = 'Search club…', onSave }: ClubSelectProps) {
  const [open, setOpen]         = useState(false);
  const [inputText, setInputText] = useState(team?.clubName ?? '');
  const [letter, setLetter]     = useState(team?.teamLetter ?? '');
  const [saving, setSaving]     = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep a ref to the latest team so the outside-click handler doesn't go stale
  const teamRef = useRef(team);
  useEffect(() => { teamRef.current = team; }, [team]);

  // Sync the club name input whenever the selected club changes
  useEffect(() => {
    setInputText(team?.clubName ?? '');
  }, [team?.clubId, team?.clubName]);

  // Reset the letter only when a DIFFERENT club is selected (not on every save)
  // Using clubId as dep prevents the useEffect from wiping a typed-but-unsaved letter
  useEffect(() => {
    setLetter(team?.teamLetter ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.clubId]);

  // Close on outside click, resetting input to the current team name
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setInputText(teamRef.current?.clubName ?? '');
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Filter: if inputText matches selected name (or is empty), show all; otherwise filter
  const searchTerm = team && inputText === team.clubName ? '' : inputText;
  const filtered = clubs.filter(c =>
    !searchTerm || c.clubName.toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 15);

  async function handleSelect(club: Club) {
    setOpen(false);
    setInputText(club.clubName);
    setSaving(true);
    try {
      await onSave({ clubId: club.clubId, clubName: club.clubName, teamLetter: letter.toUpperCase().slice(0, 1) });
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setInputText('');
    setLetter('');
    setOpen(false);
    setSaving(true);
    try {
      await onSave(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleLetterBlur() {
    // Use `team` prop directly — React synthetic event handlers always see fresh props,
    // unlike a ref which only updates after the useEffect flush.
    if (!team) return;
    const l = letter.toUpperCase().slice(0, 1);
    if (l === (team.teamLetter ?? '')) return;
    setSaving(true);
    try {
      await onSave({ ...team, teamLetter: l });
    } finally {
      setSaving(false);
    }
  }

  const inputBorder = saving
    ? 'border-blue-300 bg-blue-50'
    : team
    ? 'border-green-400 bg-green-50'
    : 'border-gray-300 bg-white';

  return (
    <div ref={containerRef} className="flex gap-1 items-start">
      <div className="flex-1 relative min-w-0">
        <input
          type="text"
          value={inputText}
          onChange={e => { setInputText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={saving}
          className={`w-full border rounded px-2 py-1 text-sm ${inputBorder} disabled:opacity-60`}
        />
        {open && (
          <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto">
            {team && (
              <button
                onMouseDown={e => { e.preventDefault(); handleClear(); }}
                className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 border-b border-gray-100"
              >
                Clear
              </button>
            )}
            {filtered.map(club => (
              <button
                key={club.clubId}
                onMouseDown={e => { e.preventDefault(); handleSelect(club); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50"
              >
                {club.clubName}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">No clubs found</p>
            )}
          </div>
        )}
      </div>
      <input
        type="text"
        placeholder="A/B"
        maxLength={1}
        value={letter}
        onChange={e => setLetter(e.target.value.toUpperCase())}
        onBlur={handleLetterBlur}
        className="w-12 shrink-0 border border-gray-300 rounded px-2 py-1 text-sm text-center bg-white"
      />
    </div>
  );
}

// ============================================================================
// PAGE
// ============================================================================

const DATE_FIELDS = [
  { key: 'prelim_play_by', label: ROWLAND_ROUND_LABELS['Prelim'] },
  { key: 'r1_play_by',     label: ROWLAND_ROUND_LABELS['R1']    },
  { key: 'r2_play_by',     label: ROWLAND_ROUND_LABELS['R2']    },
  { key: 'qf_play_by',     label: ROWLAND_ROUND_LABELS['QF']    },
  { key: 'sf_play_by',     label: ROWLAND_ROUND_LABELS['SF']    },
  { key: 'f_play_by',      label: ROWLAND_ROUND_LABELS['F']     },
];

export default function RowlandSetupPage({ params }: { params: Promise<{ compId: string }> }) {
  const { compId } = use(params);
  const { data: session } = useSession();
  const router = useRouter();

  const [comp, setComp]       = useState<RowlandComp | null>(null);
  const [matches, setMatches] = useState<RowlandMatch[]>([]);
  const [clubs, setClubs]     = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const [numTeams, setNumTeams] = useState('');
  const [dates, setDates] = useState<Record<string, string>>({
    prelim_play_by: '', r1_play_by: '', r2_play_by: '',
    qf_play_by: '', sf_play_by: '', f_play_by: '',
  });

  const role        = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== 'Club' && role !== '';

  useEffect(() => {
    if (session && !isCommittee) router.replace('/rowland');
  }, [session, isCommittee, router]);

  const loadData = useCallback(async () => {
    try {
      const [compRes, matchRes, clubRes] = await Promise.all([
        fetch(`/api/rowland/${compId}`),
        fetch(`/api/rowland/${compId}/matches`),
        fetch('/api/rowland/clubs'),
      ]);
      const compData  = await compRes.json();
      const matchData = await matchRes.json();
      const clubData  = await clubRes.json();
      if (compData.error) throw new Error(compData.error);

      const c: RowlandComp = compData.comp;
      setComp(c);
      setNumTeams(c.numTeams > 0 ? String(c.numTeams) : '');
      setDates({
        prelim_play_by: c.prelimPlayBy ?? '',
        r1_play_by:     c.r1PlayBy    ?? '',
        r2_play_by:     c.r2PlayBy    ?? '',
        qf_play_by:     c.qfPlayBy    ?? '',
        sf_play_by:     c.sfPlayBy    ?? '',
        f_play_by:      c.fPlayBy     ?? '',
      });
      setMatches(matchData.matches ?? []);
      setClubs(clubData.clubs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [compId]);

  useEffect(() => { loadData(); }, [loadData]);

  const save = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const n = parseInt(numTeams);
      const body: Record<string, string | number | null> = {
        prelimPlayBy: dates['prelim_play_by'] || null,
        r1PlayBy:     dates['r1_play_by']     || null,
        r2PlayBy:     dates['r2_play_by']     || null,
        qfPlayBy:     dates['qf_play_by']     || null,
        sfPlayBy:     dates['sf_play_by']     || null,
        fPlayBy:      dates['f_play_by']      || null,
      };
      if (!isNaN(n) && n >= 2) body.numTeams = n;

      const res  = await fetch(`/api/rowland/${compId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSaveMsg(data.bracketCreated ? 'Saved — bracket created' : 'Saved');
      await loadData();
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const saveTeam = async (matchId: string, side: 'home' | 'away', team: RowlandTeamRef | null) => {
    const field = side === 'home' ? 'homeTeam' : 'awayTeam';
    const res = await fetch(`/api/rowland/${compId}/matches/${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: team }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
    setMatches(prev => prev.map(m =>
      m.matchId === matchId ? { ...m, [field]: team } : m
    ));
  };

  const saveByeToggle = async (matchId: string, isBye: boolean) => {
    const res = await fetch(`/api/rowland/${compId}/matches/${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ awayTeam: null, status: isBye ? 'Bye' : 'Pending' }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
    setMatches(prev => prev.map(m =>
      m.matchId === matchId
        ? { ...m, awayTeam: null, status: (isBye ? 'Bye' : 'Pending') as RowlandMatchStatus }
        : m
    ));
  };

  // Derive bracket structure from loaded matches
  const prelimMatches = matches
    .filter(m => m.round === 'Prelim')
    .sort((a, b) => a.position - b.position);
  const r1Matches = matches
    .filter(m => m.round === 'R1')
    .sort((a, b) => a.position - b.position);

  const hasBracket   = matches.length > 0;
  const showPrelim   = hasBracket && prelimMatches.length > 0;
  const showR1Direct = hasBracket && prelimMatches.length === 0;

  // Bracket preview for numTeams input hint
  const n = parseInt(numTeams);
  const preview = !isNaN(n) && n >= 2 ? computeBracketInfo(n) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <button
            onClick={() => router.push(`/rowland/${compId}`)}
            className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
          >
            ← {comp ? (ROWLAND_COMP_NAMES[comp.compId] ?? comp.compName) : 'Back'}
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            Manage — {comp ? (ROWLAND_COMP_NAMES[comp.compId] ?? comp.compName) : '…'}
          </h1>
        </div>

        {loading && <div className="text-center py-12 text-gray-400">Loading…</div>}
        {error   && <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

        {!loading && !error && comp && (
          <div className="space-y-6">

            {/* ── Setup ── */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Setup</h2>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Number of teams</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 24"
                  value={numTeams}
                  onChange={e => setNumTeams(e.target.value)}
                  className={`${getInputClasses()} w-32`}
                />
                {comp.status === 'Not Started' && preview && (
                  <p className="mt-1 text-xs text-blue-600">
                    {preview.hasPrelim
                      ? `Saving will create a bracket: ${preview.prelimMatches + preview.byeCount} preliminary slots (${preview.byeCount} bye${preview.byeCount !== 1 ? 's' : ''} assigned during draw), then R1 (${preview.r1Matches} match${preview.r1Matches !== 1 ? 'es' : ''}).`
                      : `Saving will create a bracket: R1 with ${preview.r1Matches} match${preview.r1Matches !== 1 ? 'es' : ''}.`
                    }
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {DATE_FIELDS.map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                    <input
                      type="date"
                      value={dates[key] ?? ''}
                      onChange={e => setDates(prev => ({ ...prev, [key]: e.target.value }))}
                      className={getInputClasses()}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {saveMsg && <span className="text-sm text-gray-600">{saveMsg}</span>}
              </div>
            </div>

            {/* ── Draw — Prelim (byes mixed in at drawn positions) ── */}
            {showPrelim && (
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-1">Draw</h2>
                <p className="text-xs text-gray-500 mb-4">
                  Assign clubs to each slot. Use the <strong>Bye</strong> button on the away side when a bye was drawn at that position — the home club will advance directly to Round 1.
                </p>

                <div className="space-y-3">
                  {prelimMatches.map((match, idx) => {
                    const isBye = match.status === 'Bye';
                    return (
                      <div key={match.matchId} className={`border rounded-lg p-3 ${isBye ? 'border-amber-200 bg-amber-50' : 'border-gray-100'}`}>
                        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                          Match {idx + 1}{isBye && <span className="ml-2 text-amber-600 normal-case font-normal">— Bye</span>}
                        </div>
                        <div className="space-y-2">
                          {/* Home side */}
                          <div className="flex items-center gap-2">
                            <span className="w-10 text-xs text-gray-400 shrink-0">Home</span>
                            <div className="flex-1 min-w-0">
                              <ClubSelect
                                team={match.homeTeam}
                                clubs={clubs}
                                onSave={team => saveTeam(match.matchId, 'home', team)}
                              />
                            </div>
                          </div>
                          {/* Away side — club select OR bye indicator */}
                          <div className="flex items-center gap-2">
                            <span className="w-10 text-xs text-gray-400 shrink-0">Away</span>
                            {isBye ? (
                              <div className="flex-1 flex items-center gap-2">
                                <span className="flex-1 border border-amber-300 rounded px-2 py-1 text-sm bg-amber-100 text-amber-700 font-medium">
                                  Bye
                                </span>
                                <button
                                  onClick={() => saveByeToggle(match.matchId, false)}
                                  className="shrink-0 px-2 py-1 text-xs border border-amber-400 rounded text-amber-700 hover:bg-amber-100"
                                  title="Remove bye — assign a club instead"
                                >
                                  ✕ Remove
                                </button>
                              </div>
                            ) : (
                              <div className="flex-1 flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <ClubSelect
                                    team={match.awayTeam}
                                    clubs={clubs}
                                    onSave={team => saveTeam(match.matchId, 'away', team)}
                                  />
                                </div>
                                {!match.awayTeam && (
                                  <button
                                    onClick={() => saveByeToggle(match.matchId, true)}
                                    className="shrink-0 px-2 py-1 text-xs border border-gray-300 rounded text-gray-500 hover:bg-gray-50 hover:border-amber-400 hover:text-amber-700"
                                    title="Mark this position as a bye"
                                  >
                                    Bye
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Draw — R1 only (no prelim) ── */}
            {showR1Direct && (
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-1">Draw</h2>
                <p className="text-xs text-gray-500 mb-4">
                  Assign clubs to each Round 1 slot. Team letter (A/B) is optional.
                </p>
                <div className="space-y-3">
                  {r1Matches.map((match, idx) => (
                    <div key={match.matchId} className="border border-gray-100 rounded-lg p-3">
                      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        Match {idx + 1}
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="w-10 text-xs text-gray-400 shrink-0">Home</span>
                          <div className="flex-1 min-w-0">
                            <ClubSelect
                              team={match.homeTeam}
                              clubs={clubs}
                              onSave={team => saveTeam(match.matchId, 'home', team)}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-10 text-xs text-gray-400 shrink-0">Away</span>
                          <div className="flex-1 min-w-0">
                            <ClubSelect
                              team={match.awayTeam}
                              clubs={clubs}
                              onSave={team => saveTeam(match.matchId, 'away', team)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
