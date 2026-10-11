'use client';

// app/halve-it/manage/nights/[nightId]/page.tsx
// Halve It score entry (Darts role / Admin). Two panels: tonight's players (the
// score grid) in the order they're written on the game sheets, and below it the
// rest of the team — clicking a name moves it to the end of tonight's list, so
// clicking down the sheet builds the grid in sheet order. One column per game;
// blank = didn't play that game (people come and go through the evening).
// Tab/Enter move down the column, matching how each game sheet is written up.
// Also the night's money in and out; the balance carries forward night to night.
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
import { formatMoney, formatNightDate, HALVEIT_MAX_SCORE, moneyInputValue, parseMoney } from '@/types/halveit';
import type { HalveItNight, HalveItNightStatus, HalveItPlayer } from '@/types/halveit';

interface GridDraft {
  cells: Record<string, string>;
  gamesCount: number;
  notes: string;
  order: string[];
  moneyIn: string;
  moneyOut: string;
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
  const [order, setOrder] = useState<string[]>([]); // tonight's players (ids), in game-sheet order
  const [moneyIn, setMoneyIn] = useState('');
  const [moneyOut, setMoneyOut] = useState('');
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

  /** Puts the night's saved scores, player order and money into the page. */
  function loadSaved() {
    if (!data || !night) return;
    const saved: Record<string, string> = {};
    const scored = new Set<string>();
    for (const s of data.scores) {
      if (s.nightId === nightId) {
        saved[cellKey(s.playerId, s.gameNo)] = String(s.score);
        scored.add(s.playerId);
      }
    }

    // The saved sheet order, then anyone with scores who isn't in it (nights entered
    // before the order was kept) — data.players is already alphabetical
    const teamIds = new Set<string>();
    for (const p of data.players) teamIds.add(p.id);
    const savedOrder: string[] = [];
    for (const id of night.playerOrder) {
      if (teamIds.has(id) && !savedOrder.includes(id)) savedOrder.push(id);
    }
    for (const p of data.players) {
      if (scored.has(p.id) && !savedOrder.includes(p.id)) savedOrder.push(p.id);
    }

    setCells(saved);
    setGamesCount(night.gamesCount);
    setNotes(night.notes || '');
    setOrder(savedOrder);
    setMoneyIn(moneyInputValue(night.moneyIn));
    setMoneyOut(moneyInputValue(night.moneyOut));
  }

  // Runs once, when the night and session first load: fill the grid from an
  // unsaved draft if there is one, otherwise from the saved scores. Later reloads
  // (e.g. after adding a player) must not wipe what's been typed.
  useEffect(() => {
    if (!data || !night || !userName || initialised.current) return;
    initialised.current = true;
    const draft = restoreDraft<GridDraft>(draftName, userName);
    // A draft saved before the sheet order existed has no order — use the saved night instead
    if (draft && Array.isArray(draft.order)) {
      setCells(draft.cells);
      setGamesCount(draft.gamesCount);
      setNotes(draft.notes);
      setOrder(draft.order);
      setMoneyIn(draft.moneyIn || '');
      setMoneyOut(draft.moneyOut || '');
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
    saveDraft(draftName, userName, { cells, gamesCount, notes, order, moneyIn, moneyOut });
  }, [dirty, cells, gamesCount, notes, order, moneyIn, moneyOut, draftName, userName]);

  // Runs while there are unsaved changes: warn before closing the tab or reloading
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Rows: tonight's players in sheet order (plus, as a safety net, anyone with a
  // score who somehow isn't in the order, so a score is never hidden)
  const rows = useMemo(() => {
    const result: HalveItPlayer[] = [];
    if (!data) return result;
    const byId = new Map<string, HalveItPlayer>();
    for (const p of data.players) byId.set(p.id, p);
    for (const id of order) {
      const p = byId.get(id);
      if (p && !result.includes(p)) result.push(p);
    }
    for (const key of Object.keys(cells)) {
      const p = byId.get(key.split(':')[0]);
      if (p && cells[key].trim() !== '' && !result.includes(p)) result.push(p);
    }
    return result;
  }, [data, cells, order]);

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

  // The rest of the team, not on tonight's list: active players, then inactive
  const shownIds = new Set<string>();
  for (const p of rows) shownIds.add(p.id);
  const benchActive: HalveItPlayer[] = [];
  const benchInactive: HalveItPlayer[] = [];
  for (const p of data.players) {
    if (shownIds.has(p.id)) continue;
    if (p.active) benchActive.push(p);
    else benchInactive.push(p);
  }

  // "Add a player" options: members not on the team yet
  const teamUsers = new Set<string>();
  for (const p of data.players) teamUsers.add(p.userName);
  const addOptions: { value: string; label: string }[] = [];
  for (const m of members) {
    if (!teamUsers.has(m.value)) addOptions.push(m);
  }

  // Money: blank counts as £0; null = not a valid amount
  const moneyInPence = parseMoney(moneyIn);
  const moneyOutPence = parseMoney(moneyOut);
  const moneyInvalid = moneyInPence === null || moneyOutPence === null;
  let carriedForward: number | null = null;
  if (moneyInPence !== null && moneyOutPence !== null) carriedForward = night.broughtForward + moneyInPence - moneyOutPence;
  const cannotSave = parsed.invalid > 0 || moneyInvalid;

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

  /** Whether a player has any score in the grid (so they can't be taken off tonight's list). */
  function playerHasScores(playerId: string): boolean {
    for (let g = 1; g <= gamesCount; g++) {
      const value = cells[cellKey(playerId, g)];
      if (value && value.trim() !== '') return true;
    }
    return false;
  }

  /** Tonight's player ids, in order. */
  function rowIds(): string[] {
    const ids: string[] = [];
    for (const p of rows) ids.push(p.id);
    return ids;
  }

  /** Adds a team player to the end of tonight's list. */
  function addToTonight(playerId: string) {
    setOrder([...rowIds(), playerId]);
    markEdited();
  }

  /** Takes a player (with no scores) off tonight's list, back to the rest of the team. */
  function removeFromTonight(playerId: string) {
    const ids: string[] = [];
    for (const id of rowIds()) {
      if (id !== playerId) ids.push(id);
    }
    setOrder(ids);
    markEdited();
  }

  /** Moves a player up (-1) or down (+1) tonight's list. */
  function moveRow(index: number, direction: number) {
    const ids = rowIds();
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    const moved = ids[index];
    ids[index] = ids[target];
    ids[target] = moved;
    setOrder(ids);
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

  /** Adds a member to the season's team, and to the end of tonight's list. */
  async function addNewPlayer() {
    if (!data || !addChoice) return;
    const userNameToAdd = addChoice;
    const idsBefore = rowIds();
    setAddChoice('');
    setSaving(true);
    try {
      const res = await fetch('/api/halve-it/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season: data.season, userName: userNameToAdd }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ text: json.error || 'Failed to add player', ok: false });
        return;
      }
      await reload();
      setOrder([...idsBefore, json.player.id]);
      markEdited();
    } catch {
      setMessage({ text: 'Failed to add player', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function save(status: HalveItNightStatus) {
    if (cannotSave || moneyInPence === null || moneyOutPence === null) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/halve-it/nights/${nightId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gamesCount,
          status,
          notes,
          moneyIn: moneyInPence,
          moneyOut: moneyOutPence,
          playerOrder: rowIds(),
          scores: parsed.scores,
        }),
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
                <th className="px-3 py-2 text-left sticky left-0 bg-gray-50">Tonight ({rows.length})</th>
                {gameNos.map((g) => <th key={g} className="px-1 py-2 text-center">Game {g}</th>)}
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-2 py-2"><span className="sr-only">Order</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((p, rowIdx) => {
                const hasScores = playerHasScores(p.id);
                let total = 0;
                for (const g of gameNos) {
                  const v = parseScore(cells[cellKey(p.id, g)] || '');
                  if (typeof v === 'number') total += v;
                }
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-1.5 whitespace-nowrap font-medium sticky left-0 bg-white">
                      <span className="inline-block w-6 text-gray-700 font-normal">{rowIdx + 1}.</span>{p.name}
                    </td>
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
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <button onClick={() => moveRow(rowIdx, -1)} disabled={rowIdx === 0} className="px-1.5 text-gray-900 hover:text-blue-700 disabled:text-gray-300" aria-label={`Move ${p.name} up`} title="Move up">↑</button>
                      <button onClick={() => moveRow(rowIdx, 1)} disabled={rowIdx === rows.length - 1} className="px-1.5 text-gray-900 hover:text-blue-700 disabled:text-gray-300" aria-label={`Move ${p.name} down`} title="Move down">↓</button>
                      <button
                        onClick={() => removeFromTonight(p.id)}
                        disabled={hasScores}
                        className="px-1.5 text-red-700 hover:text-red-900 disabled:text-gray-300"
                        aria-label={`Take ${p.name} off tonight's list`}
                        title={hasScores ? 'Clear their scores first' : 'Not playing tonight'}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={gamesCount + 3} className="px-3 py-6 text-center text-gray-700">Click names below in the order they&apos;re on the game sheet.</td></tr>
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

        <section className="bg-white shadow rounded-lg p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Rest of the team</h2>
            <p className="text-sm text-gray-700">Click a name to add it to the end of tonight&apos;s list.</p>
          </div>
          {benchActive.length === 0 && benchInactive.length === 0 ? (
            <p className="text-sm text-gray-700">Everyone in the team is on tonight&apos;s list.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {benchActive.map((p) => (
                <button key={p.id} onClick={() => addToTonight(p.id)} className="px-3 py-1.5 text-sm rounded-full border border-gray-300 bg-white text-gray-900 hover:bg-blue-50 hover:border-blue-400">
                  {p.name}
                </button>
              ))}
              {benchInactive.map((p) => (
                <button key={p.id} onClick={() => addToTonight(p.id)} title="Inactive" className="px-3 py-1.5 text-sm rounded-full border border-dashed border-gray-300 bg-gray-50 text-gray-700 hover:bg-blue-50 hover:border-blue-400">
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <div className="max-w-xl space-y-1 border-t border-gray-100 pt-3">
            <div className="flex gap-2 items-center">
              <SearchableSelect options={addOptions} value={addChoice} onChange={setAddChoice} placeholder="Add a player…" className="flex-1" />
              <button onClick={addNewPlayer} disabled={saving || !addChoice} className={getButtonClasses('secondary', 'md')}>Add</button>
            </div>
            <p className="text-sm text-gray-700">For members not in the team yet: they&apos;re added to the season&apos;s team and to tonight&apos;s list.</p>
          </div>
        </section>

        <section className="bg-white shadow rounded-lg p-4 space-y-3 max-w-xl">
          <h2 className="text-sm font-semibold text-gray-900">Money</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <div>
              <div className="text-sm font-medium text-gray-900 mb-1">Brought forward</div>
              <div className="py-2 text-gray-900">{formatMoney(night.broughtForward)}</div>
            </div>
            <div>
              <label htmlFor="money-in" className="block text-sm font-medium text-gray-900 mb-1">Money in (£)</label>
              <input
                id="money-in"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className={`${getInputClasses()} ${moneyInPence === null ? 'border-red-500 bg-red-50' : ''}`}
                value={moneyIn}
                onChange={(e) => { setMoneyIn(e.target.value); markEdited(); }}
              />
            </div>
            <div>
              <label htmlFor="money-out" className="block text-sm font-medium text-gray-900 mb-1">Money out (£)</label>
              <input
                id="money-out"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className={`${getInputClasses()} ${moneyOutPence === null ? 'border-red-500 bg-red-50' : ''}`}
                value={moneyOut}
                onChange={(e) => { setMoneyOut(e.target.value); markEdited(); }}
              />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900 mb-1">Carried forward</div>
              <div className="py-2 font-semibold text-gray-900">{carriedForward === null ? '—' : formatMoney(carriedForward)}</div>
            </div>
          </div>
          <p className="text-sm text-gray-700">Money out includes the monthly prize on the night it&apos;s paid. The balance starts at £0 each season.</p>
        </section>

        <div className="max-w-xl">
          <label className="block text-sm font-medium text-gray-900 mb-1">Notes (optional)</label>
          <textarea rows={2} className={getInputClasses()} value={notes} onChange={(e) => { setNotes(e.target.value); markEdited(); }} />
        </div>

        {parsed.invalid > 0 && <p className="text-sm text-red-700">Scores must be whole numbers from 0 to {HALVEIT_MAX_SCORE} — check the boxes in red.</p>}
        {moneyInvalid && <p className="text-sm text-red-700">Money in and out must be amounts in pounds, e.g. 12 or 12.50, up to £10,000.</p>}
        {message && <p className={`text-sm ${message.ok ? 'text-green-800' : 'text-red-700'}`}>{message.text}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-4">
          <button onClick={() => setConfirmDelete(true)} disabled={saving} className={getButtonClasses('danger', 'sm')}>Delete night</button>
          <div className="flex flex-wrap gap-2">
            {dirty && (
              <button onClick={discardChanges} disabled={saving} className={getButtonClasses('secondary', 'md')}>Discard changes</button>
            )}
            {isFinal ? (
              <>
                <button onClick={() => save('draft')} disabled={saving || cannotSave} className={getButtonClasses('secondary', 'md')}>Reopen as draft</button>
                <button onClick={() => save('final')} disabled={saving || cannotSave} className={getButtonClasses('primary', 'md')}>{saving ? 'Saving…' : 'Save'}</button>
              </>
            ) : (
              <>
                <button onClick={() => save('draft')} disabled={saving || cannotSave} className={getButtonClasses('secondary', 'md')}>{saving ? 'Saving…' : 'Save draft'}</button>
                <button onClick={() => save('final')} disabled={saving || cannotSave || parsed.scores.length === 0} className={getButtonClasses('primary', 'md')}>Save &amp; finalise</button>
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
