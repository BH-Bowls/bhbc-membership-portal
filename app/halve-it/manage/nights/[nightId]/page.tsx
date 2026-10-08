'use client';

// app/halve-it/manage/nights/[nightId]/page.tsx
// Halve It score entry (Darts role / Admin). One row per player, one column per
// game; blank = didn't play that game (people come and go through the evening).
// Tab/Enter move down the column, matching how each game sheet is written up.
// Saves as a draft until finalised — only final nights count in the league.
// Unsaved edits are kept as a form draft, so leaving the page by accident (or the
// phone's back button) doesn't lose a half-entered night.

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getButtonClasses, getInputClasses } from '@/config/theme-helpers';
import { SearchableSelect } from '@/components/SearchableSelect';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RouterBackLink } from '@/components/RouterBackLink';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';
import { useHalveItData, useMemberOptions, Spinner } from '@/components/halveit/shared';
import { formatNightDate, HALVEIT_MAX_SCORE } from '@/types/halveit';
import type { HalveItNight, HalveItNightStatus, HalveItPlayer } from '@/types/halveit';

interface GridDraft {
  cells: Record<string, string>;
  gamesCount: number;
  notes: string;
  extraRows: string[];
}

const cellKey = (playerId: string, gameNo: number) => `${playerId}:${gameNo}`;

/** A typed score: null = blank (didn't play), 'invalid' = not a whole number 0–999. */
function parseScore(value: string): number | null | 'invalid' {
  const v = value.trim();
  if (v === '') return null;
  if (!/^\d+$/.test(v)) return 'invalid';
  const n = parseInt(v);
  if (n > HALVEIT_MAX_SCORE) return 'invalid';
  return n;
}

export default function HalveItScoreEntryPage({ params }: { params: Promise<{ nightId: string }> }) {
  const { nightId } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const userName = session && session.user ? session.user.userName : '';
  const draftName = `halveit-night-${nightId}`;

  const { data, error, loading, reload } = useHalveItData(`night=${encodeURIComponent(nightId)}`);
  const canManage = data !== null && data.canManage;
  const members = useMemberOptions(canManage);

  let night: HalveItNight | null = null;
  if (data) {
    for (const n of data.nights) {
      if (n.id === nightId) night = n;
    }
  }

  const manageHref = data ? `/halve-it/manage?season=${data.season}` : '/halve-it/manage';
  usePhoneBackNavigation(manageHref);

  const [cells, setCells] = useState<Record<string, string>>({});
  const [gamesCount, setGamesCount] = useState(1);
  const [notes, setNotes] = useState('');
  const [extraRows, setExtraRows] = useState<string[]>([]); // inactive players brought in for this night
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const initialised = useRef(false);

  const [addChoice, setAddChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Runs once the data arrives: anyone without the Darts role / Admin goes back to the league
  useEffect(() => {
    if (data && !data.canManage) router.push('/halve-it');
  }, [data, router]);

  /** Puts the night's saved scores into the grid. */
  function loadSaved() {
    if (!data || !night) return;
    const saved: Record<string, string> = {};
    for (const s of data.scores) {
      if (s.nightId === nightId) saved[cellKey(s.playerId, s.gameNo)] = String(s.score);
    }
    setCells(saved);
    setGamesCount(night.gamesCount);
    setNotes(night.notes || '');
    setExtraRows([]);
  }

  // Runs once, when the night and session first load: fill the grid from an
  // unsaved draft if there is one, otherwise from the saved scores. Later reloads
  // (e.g. after adding a player) must not wipe what's been typed.
  useEffect(() => {
    if (!data || !night || !userName || initialised.current) return;
    initialised.current = true;
    const draft = restoreDraft<GridDraft>(draftName, userName);
    if (draft) {
      setCells(draft.cells);
      setGamesCount(draft.gamesCount);
      setNotes(draft.notes);
      setExtraRows(draft.extraRows);
      setDirty(true);
      setRestored(true);
    } else {
      loadSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, night, userName, draftName]);

  // Runs on every edit: keep the unsaved grid as a draft
  useEffect(() => {
    if (!dirty || !userName) return;
    saveDraft(draftName, userName, { cells, gamesCount, notes, extraRows });
  }, [dirty, cells, gamesCount, notes, extraRows, draftName, userName]);

  // Runs while there are unsaved changes: warn before closing the tab or reloading
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Rows: active players, plus anyone with a score tonight or brought in for tonight
  const rows = useMemo(() => {
    const result: HalveItPlayer[] = [];
    if (!data) return result;
    const withScores = new Set<string>();
    for (const key of Object.keys(cells)) {
      if (cells[key].trim() !== '') withScores.add(key.split(':')[0]);
    }
    for (const p of data.players) {
      if (p.active || withScores.has(p.id) || extraRows.includes(p.id)) result.push(p);
    }
    return result;
  }, [data, cells, extraRows]);

  // The scores to save, and how many boxes hold something that isn't a valid score
  const parsed = useMemo(() => {
    const scores: { playerId: string; gameNo: number; score: number }[] = [];
    let invalid = 0;
    for (const p of rows) {
      for (let g = 1; g <= gamesCount; g++) {
        const v = parseScore(cells[cellKey(p.id, g)] || '');
        if (v === 'invalid') invalid++;
        else if (v !== null) scores.push({ playerId: p.id, gameNo: g, score: v });
      }
    }
    return { scores, invalid };
  }, [rows, cells, gamesCount]);

  if (loading && !data) return <Spinner />;
  if (!data || !night) return <p className="p-6 text-sm text-red-700">{error || 'Night not found'}</p>;
  if (!data.canManage) return null;

  // "Add a player" options: inactive team players not shown yet, then members not on the team
  const shownIds = new Set<string>();
  for (const p of rows) shownIds.add(p.id);
  const teamUsers = new Set<string>();
  const addOptions: { value: string; label: string }[] = [];
  for (const p of data.players) {
    teamUsers.add(p.userName);
    if (!shownIds.has(p.id)) addOptions.push({ value: `player:${p.id}`, label: `${p.name} (inactive)` });
  }
  for (const m of members) {
    if (!teamUsers.has(m.value)) addOptions.push({ value: `member:${m.value}`, label: m.label });
  }

  /** Whether anyone has a score in the given game (so the column can't be removed). */
  function gameHasScores(gameNo: number): boolean {
    for (const p of rows) {
      const value = cells[cellKey(p.id, gameNo)];
      if (value && value.trim() !== '') return true;
    }
    return false;
  }

  function markEdited() {
    setDirty(true);
    setMessage(null);
  }

  function setCell(playerId: string, gameNo: number, value: string) {
    setCells((c) => ({ ...c, [cellKey(playerId, gameNo)]: value }));
    markEdited();
  }

  function focusCell(row: number, game: number) {
    const input = document.getElementById(`cell-${row}-${game}`);
    if (input) input.focus();
  }

  // Tab / Enter go down the game's column (then on to the top of the next game);
  // Shift+Tab goes back up. Off either end of the grid, Tab behaves normally.
  function onCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: number, game: number) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    const back = e.key === 'Tab' && e.shiftKey;

    let target: [number, number] | null = null;
    if (back) {
      if (row > 0) target = [row - 1, game];
      else if (game > 1) target = [rows.length - 1, game - 1];
    } else {
      if (row + 1 < rows.length) target = [row + 1, game];
      else if (game < gamesCount) target = [0, game + 1];
    }

    if (target === null) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    e.preventDefault();
    focusCell(target[0], target[1]);
  }

  async function addRow() {
    if (!data || !addChoice) return;
    const split = addChoice.indexOf(':');
    const kind = addChoice.slice(0, split);
    const value = addChoice.slice(split + 1);
    setAddChoice('');

    // An inactive team player just gets a row for tonight
    if (kind === 'player') {
      setExtraRows((r) => [...r, value]);
      markEdited();
      return;
    }

    // A member not on the team is added to the season's team first
    setSaving(true);
    try {
      const res = await fetch('/api/halve-it/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season: data.season, userName: value }),
      });
      const json = await res.json();
      if (!res.ok) setMessage({ text: json.error || 'Failed to add player', ok: false });
      else await reload();
    } finally {
      setSaving(false);
    }
  }

  async function save(status: HalveItNightStatus) {
    if (parsed.invalid > 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/halve-it/nights/${nightId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gamesCount, status, notes, scores: parsed.scores }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ text: json.error || 'Failed to save', ok: false });
        return;
      }
      setDirty(false);
      setRestored(false);
      clearDraft(draftName, userName);
      await reload();
      setMessage({ text: status === 'final' ? 'Saved — this night now counts in the league' : 'Saved as draft', ok: true });
    } catch {
      setMessage({ text: 'Failed to save', ok: false });
    } finally {
      setSaving(false);
    }
  }

  function discardChanges() {
    clearDraft(draftName, userName);
    loadSaved();
    setDirty(false);
    setRestored(false);
    setMessage(null);
  }

  async function remove() {
    setConfirmDelete(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/halve-it/nights/${nightId}`, { method: 'DELETE' });
      if (!res.ok) {
        setMessage({ text: 'Failed to delete night', ok: false });
        return;
      }
      setDirty(false);
      clearDraft(draftName, userName);
      router.push(manageHref);
    } finally {
      setSaving(false);
    }
  }

  const gameNos: number[] = [];
  for (let g = 1; g <= gamesCount; g++) gameNos.push(g);
  const isFinal = night.status === 'final';
  const lastGameHasScores = gameHasScores(gamesCount);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main className="max-w-6xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <RouterBackLink fallbackHref={manageHref} label="Manage Halve It" />
            <h1 className="text-2xl font-bold text-gray-900">{formatNightDate(night.date)}</h1>
            <p className="text-sm text-gray-700">
              {isFinal ? 'Final — counts in the league' : 'Draft — not counted until finalised'}
              {dirty && <span className="ml-2 text-amber-800 font-medium">Unsaved changes</span>}
            </p>
          </div>
          {isFinal && <Link href={`/halve-it/nights/${night.id}`} className={getButtonClasses('secondary', 'md')}>View night</Link>}
        </div>

        {restored && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <span>Restored changes you hadn&apos;t saved.</span>
            <button onClick={discardChanges} className="font-medium underline">Discard them</button>
          </div>
        )}

        <div className="bg-white shadow rounded-lg overflow-x-auto">
          <table className="min-w-full text-sm text-gray-900">
            <thead className="bg-gray-50">
              <tr className="text-xs font-medium text-gray-700 uppercase tracking-wider">
                <th className="px-3 py-2 text-left sticky left-0 bg-gray-50">Player</th>
                {gameNos.map((g) => <th key={g} className="px-1 py-2 text-center">Game {g}</th>)}
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((p, rowIdx) => {
                let total = 0;
                for (const g of gameNos) {
                  const v = parseScore(cells[cellKey(p.id, g)] || '');
                  if (typeof v === 'number') total += v;
                }
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-1.5 whitespace-nowrap font-medium sticky left-0 bg-white">{p.name}</td>
                    {gameNos.map((g) => {
                      const value = cells[cellKey(p.id, g)] || '';
                      const bad = parseScore(value) === 'invalid';
                      return (
                        <td key={g} className="px-1 py-1.5">
                          <input
                            id={`cell-${rowIdx}-${g}`}
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={value}
                            onChange={(e) => setCell(p.id, g, e.target.value)}
                            onKeyDown={(e) => onCellKeyDown(e, rowIdx, g)}
                            className={`w-16 rounded border px-2 py-1 text-right text-gray-900 ${bad ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-white'}`}
                            aria-label={`${p.name} game ${g}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right font-semibold">{total}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={gamesCount + 2} className="px-3 py-6 text-center text-gray-700">No players in the team yet — add one below.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setGamesCount((n) => n + 1); markEdited(); }} disabled={gamesCount >= 50} className={getButtonClasses('secondary', 'sm')}>+ Game</button>
          <button
            onClick={() => { setGamesCount((n) => n - 1); markEdited(); }}
            disabled={gamesCount <= 1 || lastGameHasScores}
            title={lastGameHasScores ? 'Clear the last game\'s scores first' : undefined}
            className={getButtonClasses('secondary', 'sm')}
          >
            − Game
          </button>
          <span className="text-sm text-gray-700 ml-2">Leave a box blank if the player didn&apos;t play that game. Tab or Enter moves down to the next player for the same game.</span>
        </div>

        <div className="max-w-xl space-y-1">
          <div className="flex gap-2 items-center">
            <SearchableSelect options={addOptions} value={addChoice} onChange={setAddChoice} placeholder="Add a player for tonight…" className="flex-1" />
            <button onClick={addRow} disabled={saving || !addChoice} className={getButtonClasses('secondary', 'md')}>Add</button>
          </div>
          <p className="text-sm text-gray-700">New members are added to the season&apos;s team.</p>
        </div>

        <div className="max-w-xl">
          <label className="block text-sm font-medium text-gray-900 mb-1">Notes (optional)</label>
          <textarea rows={2} className={getInputClasses()} value={notes} onChange={(e) => { setNotes(e.target.value); markEdited(); }} />
        </div>

        {parsed.invalid > 0 && <p className="text-sm text-red-700">Scores must be whole numbers from 0 to {HALVEIT_MAX_SCORE} — check the boxes in red.</p>}
        {message && <p className={`text-sm ${message.ok ? 'text-green-800' : 'text-red-700'}`}>{message.text}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-4">
          <button onClick={() => setConfirmDelete(true)} disabled={saving} className={getButtonClasses('danger', 'sm')}>Delete night</button>
          <div className="flex flex-wrap gap-2">
            {dirty && (
              <button onClick={discardChanges} disabled={saving} className={getButtonClasses('secondary', 'md')}>Discard changes</button>
            )}
            {isFinal ? (
              <>
                <button onClick={() => save('draft')} disabled={saving || parsed.invalid > 0} className={getButtonClasses('secondary', 'md')}>Reopen as draft</button>
                <button onClick={() => save('final')} disabled={saving || parsed.invalid > 0} className={getButtonClasses('primary', 'md')}>{saving ? 'Saving…' : 'Save'}</button>
              </>
            ) : (
              <>
                <button onClick={() => save('draft')} disabled={saving || parsed.invalid > 0} className={getButtonClasses('secondary', 'md')}>{saving ? 'Saving…' : 'Save draft'}</button>
                <button onClick={() => save('final')} disabled={saving || parsed.invalid > 0 || parsed.scores.length === 0} className={getButtonClasses('primary', 'md')}>Save &amp; finalise</button>
              </>
            )}
          </div>
        </div>
      </main>

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete night?"
        message={`Delete ${formatNightDate(night.date)} and all its scores? This can't be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
