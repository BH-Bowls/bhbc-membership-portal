'use client';

// app/halve-it/manage/nights/[nightId]/page.tsx
// Halve It score entry (Darts role / Admin). One row per player, one column per
// game; blank = didn't play that game (people come and go through the evening).
// Tab/Enter move down the column, matching how each game sheet is written up.
// Saves as a draft until finalised — only final nights count in the league.

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getButtonClasses, getInputClasses } from '@/config/theme-helpers';
import { SearchableSelect } from '@/components/SearchableSelect';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useHalveItData, Spinner } from '@/components/halveit/shared';
import { formatNightDate, HALVEIT_MAX_SCORE } from '@/types/halveit';
import type { HalveItNightStatus } from '@/types/halveit';

const cellKey = (playerId: string, gameNo: number) => `${playerId}:${gameNo}`;

function parseScore(value: string): number | null | 'invalid' {
  const v = value.trim();
  if (v === '') return null;
  if (!/^\d+$/.test(v)) return 'invalid';
  const n = parseInt(v);
  return n > HALVEIT_MAX_SCORE ? 'invalid' : n;
}

export default function HalveItScoreEntryPage({ params }: { params: Promise<{ nightId: string }> }) {
  const { nightId } = use(params);
  const router = useRouter();
  const { data, error, loading, reload } = useHalveItData(`night=${encodeURIComponent(nightId)}`);
  const night = data?.nights.find((n) => n.id === nightId) ?? null;

  const [cells, setCells] = useState<Record<string, string>>({});
  const [gamesCount, setGamesCount] = useState(1);
  const [notes, setNotes] = useState('');
  const [extraRows, setExtraRows] = useState<string[]>([]); // inactive players brought in for this night
  const [dirty, setDirty] = useState(false);
  const initialised = useRef(false);

  const [members, setMembers] = useState<{ value: string; label: string }[]>([]);
  const [addChoice, setAddChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (data && !data.canManage) router.push('/halve-it');
  }, [data, router]);

  // Load the saved night into the grid once — later reloads (e.g. after adding a
  // player) must not wipe what's been typed
  useEffect(() => {
    if (!data || !night || initialised.current) return;
    initialised.current = true;
    const initial: Record<string, string> = {};
    for (const s of data.scores) if (s.nightId === nightId) initial[cellKey(s.playerId, s.gameNo)] = String(s.score);
    setCells(initial);
    setGamesCount(night.gamesCount);
    setNotes(night.notes || '');
  }, [data, night, nightId]);

  useEffect(() => {
    if (!data?.canManage || members.length) return;
    fetch('/api/halve-it/players')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => json?.members && setMembers(json.members))
      .catch(() => {});
  }, [data, members.length]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Rows: active players, plus anyone with a score tonight or brought in for tonight
  const rows = useMemo(() => {
    if (!data) return [];
    const withScores = new Set(Object.keys(cells).filter((k) => cells[k].trim() !== '').map((k) => k.split(':')[0]));
    return data.players.filter((p) => p.active || withScores.has(p.id) || extraRows.includes(p.id));
  }, [data, cells, extraRows]);

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
  if (!data || !night) return <p className="p-6 text-sm text-red-600">{error || 'Night not found'}</p>;
  if (!data.canManage) return null;

  const shownIds = new Set(rows.map((p) => p.id));
  const teamUsers = new Set(data.players.map((p) => p.userName));
  const addOptions = [
    ...data.players.filter((p) => !shownIds.has(p.id)).map((p) => ({ value: `player:${p.id}`, label: `${p.name} (inactive)` })),
    ...members.filter((m) => !teamUsers.has(m.value)).map((m) => ({ value: `member:${m.value}`, label: m.label })),
  ];

  const gameHasScores = (g: number) => rows.some((p) => (cells[cellKey(p.id, g)] || '').trim() !== '');

  function setCell(playerId: string, gameNo: number, value: string) {
    setCells((c) => ({ ...c, [cellKey(playerId, gameNo)]: value }));
    setDirty(true);
    setMessage(null);
  }

  function focusCell(row: number, game: number) {
    document.getElementById(`cell-${row}-${game}`)?.focus();
  }

  // Tab / Enter go down the game's column (then on to the top of the next game);
  // Shift+Tab goes back up. Off either end of the grid, Tab behaves normally.
  function onCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: number, game: number) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    const back = e.key === 'Tab' && e.shiftKey;
    const target = back
      ? row > 0 ? [row - 1, game] : game > 1 ? [rows.length - 1, game - 1] : null
      : row + 1 < rows.length ? [row + 1, game] : game < gamesCount ? [0, game + 1] : null;
    if (!target) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    e.preventDefault();
    focusCell(target[0], target[1]);
  }

  async function addRow() {
    if (!data || !addChoice) return;
    const [kind, value] = [addChoice.slice(0, addChoice.indexOf(':')), addChoice.slice(addChoice.indexOf(':') + 1)];
    setAddChoice('');
    if (kind === 'player') {
      setExtraRows((r) => [...r, value]);
      return;
    }
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
    if (parsed.invalid) return;
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
      await reload();
      setMessage({ text: status === 'final' ? 'Saved — this night now counts in the league' : 'Saved as draft', ok: true });
    } catch {
      setMessage({ text: 'Failed to save', ok: false });
    } finally {
      setSaving(false);
    }
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
      router.push(`/halve-it/manage?season=${data?.season}`);
    } finally {
      setSaving(false);
    }
  }

  const gameNos = Array.from({ length: gamesCount }, (_, i) => i + 1);
  const isFinal = night.status === 'final';

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-6xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/halve-it/manage?season=${data.season}`} className="text-sm text-blue-600 hover:underline">← Manage Halve It</Link>
            <h1 className="text-2xl font-bold text-gray-900">{formatNightDate(night.date)}</h1>
            <p className="text-sm text-gray-500">
              {isFinal ? 'Final — counts in the league' : 'Draft — not counted until finalised'}
              {dirty && <span className="ml-2 text-amber-700 font-medium">Unsaved changes</span>}
            </p>
          </div>
          {isFinal && <Link href={`/halve-it/nights/${night.id}`} className={getButtonClasses('secondary', 'md')}>View night</Link>}
        </div>

        <div className="bg-white shadow rounded-lg overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-xs font-medium text-gray-500 uppercase tracking-wider">
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
                    <td className="px-3 py-1.5 whitespace-nowrap font-medium text-gray-900 sticky left-0 bg-white">{p.name}</td>
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
                            className={`w-16 rounded border px-2 py-1 text-right ${bad ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                            aria-label={`${p.name} game ${g}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{total}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={gamesCount + 2} className="px-3 py-6 text-center text-gray-500">No players in the team yet — add one below.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setGamesCount((n) => n + 1); setDirty(true); }} disabled={gamesCount >= 50} className={getButtonClasses('secondary', 'sm')}>+ Game</button>
          <button
            onClick={() => { setGamesCount((n) => n - 1); setDirty(true); }}
            disabled={gamesCount <= 1 || gameHasScores(gamesCount)}
            title={gameHasScores(gamesCount) ? 'Clear the last game\'s scores first' : undefined}
            className={getButtonClasses('secondary', 'sm')}
          >
            − Game
          </button>
          <span className="text-xs text-gray-500 ml-2">Leave a box blank if the player didn&apos;t play that game. Tab or Enter moves down to the next player for the same game.</span>
        </div>

        <div className="flex gap-2 items-center max-w-xl">
          <SearchableSelect options={addOptions} value={addChoice} onChange={setAddChoice} placeholder="Add a player for tonight…" className="flex-1" />
          <button onClick={addRow} disabled={saving || !addChoice} className={getButtonClasses('secondary', 'md')}>Add</button>
        </div>
        <p className="text-xs text-gray-500 -mt-3">New members are added to the season&apos;s team.</p>

        <div className="max-w-xl">
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
          <textarea rows={2} className={getInputClasses()} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
        </div>

        {parsed.invalid > 0 && <p className="text-sm text-red-600">Scores must be whole numbers from 0 to {HALVEIT_MAX_SCORE} — check the boxes in red.</p>}
        {message && <p className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-4">
          <button onClick={() => setConfirmDelete(true)} disabled={saving} className={getButtonClasses('danger', 'sm')}>Delete night</button>
          <div className="flex flex-wrap gap-2">
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
