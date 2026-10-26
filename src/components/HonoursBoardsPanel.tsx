'use client';

// src/components/HonoursBoardsPanel.tsx
// Admin > Config > Honours Boards: the printed honours boards for the clubhouse wall —
// the years shared by every board, and each board's layout and columns
// (add / edit / delete). See supabase/migrations/0078 to 0080.

import { useEffect, useState } from 'react';
import { getButtonClasses, getInputClasses } from '@/config/theme-helpers';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  BOARD_LAYOUTS, HONOURS_BOARD_FIELDS, START_YEAR_KEY, YEARS_PER_SET_KEY,
  fieldLabel, layoutLabel, sheetForYear, sheetGeometry, sheetLabel, sheetsUpTo, validateBoard, validateSheetSettings,
} from '@/types/honours-boards';
import type { BoardLayout, HonoursBoard, HonoursBoardInput } from '@/types/honours-boards';

// The form edits numbers as text, so a half-typed value doesn't jump about
interface ColumnForm {
  field: string;
  heading: string;
  width: string;
}

interface BoardForm {
  name: string;
  displayOrder: string;
  layout: BoardLayout;
  columns: ColumnForm[];
}

const EMPTY_FORM: BoardForm = { name: '', displayOrder: '0', layout: 'a2_plus_a3', columns: [] };

function toForm(board: HonoursBoard): BoardForm {
  return {
    name: board.name,
    displayOrder: String(board.displayOrder),
    layout: board.layout,
    columns: board.columns.map((c) => ({ field: c.field, heading: c.heading, width: String(c.width) })),
  };
}

function fromForm(form: BoardForm): HonoursBoardInput {
  // A blank number box becomes NaN, which validateBoard reports
  const num = (value: string) => (value.trim() === '' ? NaN : Number(value));
  return {
    name: form.name,
    displayOrder: num(form.displayOrder),
    layout: form.layout,
    columns: form.columns.map((c) => ({ field: c.field, heading: c.heading, width: num(c.width) })),
  };
}

export function HonoursBoardsPanel() {
  const [boards, setBoards] = useState<HonoursBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Shared year settings, as saved and as being edited
  const [startYear, setStartYear] = useState('');
  const [yearsPerSet, setYearsPerSet] = useState('');
  const [editStartYear, setEditStartYear] = useState('');
  const [editYearsPerSet, setEditYearsPerSet] = useState('');
  const [isEditingSheets, setIsEditingSheets] = useState(false);
  const [savingSheets, setSavingSheets] = useState(false);
  const [sheetsError, setSheetsError] = useState('');

  // The board being edited: null = none, 'new' = adding one, otherwise its id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BoardForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<HonoursBoard | null>(null);

  async function load() {
    try {
      const [boardsRes, configRes] = await Promise.all([fetch('/api/admin/honours-boards'), fetch('/api/admin/config')]);
      const boardsData = await boardsRes.json();
      const configData = await configRes.json();
      if (!boardsRes.ok) {
        setError(boardsData.error || 'Failed to load honours boards');
        return;
      }
      if (!configRes.ok) {
        setError(configData.error || 'Failed to load honours board settings');
        return;
      }
      setBoards(boardsData.boards);
      setStartYear(configData.config[START_YEAR_KEY] || '');
      setYearsPerSet(configData.config[YEARS_PER_SET_KEY] || '');
      setError('');
    } catch {
      setError('Failed to load honours boards');
    } finally {
      setLoading(false);
    }
  }

  // Runs once on mount: load the boards and year settings
  useEffect(() => {
    load();
  }, []);

  async function saveSheets() {
    const start = Number(editStartYear);
    const perSet = Number(editYearsPerSet);
    const invalid = validateSheetSettings(start, perSet);
    if (invalid) {
      setSheetsError(invalid);
      return;
    }
    setSavingSheets(true);
    setSheetsError('');
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [START_YEAR_KEY]: String(start), [YEARS_PER_SET_KEY]: String(perSet) }),
      });
      if (!res.ok) throw new Error();
      setStartYear(String(start));
      setYearsPerSet(String(perSet));
      setIsEditingSheets(false);
    } catch {
      setSheetsError('Failed to save sheet settings');
    } finally {
      setSavingSheets(false);
    }
  }

  function startAdd() {
    // New boards go to the end of the list
    let lastOrder = 0;
    for (const b of boards) {
      if (b.displayOrder > lastOrder) lastOrder = b.displayOrder;
    }
    setEditingId('new');
    setForm({ ...EMPTY_FORM, displayOrder: String(lastOrder + 1) });
    setFormError('');
  }

  function startEdit(board: HonoursBoard) {
    setEditingId(board.id);
    setForm(toForm(board));
    setFormError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setFormError('');
  }

  async function saveBoard() {
    const input = fromForm(form);
    const invalid = validateBoard(input);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const isNew = editingId === 'new';
      const res = await fetch(isNew ? '/api/admin/honours-boards' : `/api/admin/honours-boards/${editingId}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Failed to save board');
        return;
      }
      setEditingId(null);
      await load();
    } catch {
      setFormError('Failed to save board');
    } finally {
      setSaving(false);
    }
  }

  async function deleteBoard() {
    const board = confirmDelete;
    setConfirmDelete(null);
    if (!board) return;
    try {
      const res = await fetch(`/api/admin/honours-boards/${board.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to delete board');
        return;
      }
      if (editingId === board.id) setEditingId(null);
      await load();
    } catch {
      setError('Failed to delete board');
    }
  }

  if (loading) return <p className="text-sm text-gray-700">Loading honours boards…</p>;

  const thisYear = new Date().getFullYear();
  const start = Number(startYear);
  const perSet = Number(yearsPerSet);
  const settingsValid = validateSheetSettings(start, perSet) === null;

  /** One line per sheet of a layout, up to the one holding this year — only that last one still changes. */
  function layoutSheets(layout: BoardLayout) {
    if (!settingsValid) return [];
    const current = sheetForYear(thisYear, start, layout, perSet);
    return sheetsUpTo(thisYear, start, layout, perSet).map((s) => ({
      sheet: s,
      isCurrent: current !== null && s.firstYear === current.firstYear,
      namePt: Math.round(sheetGeometry(layout, s, perSet).namePt),
    }));
  }

  // Competitions that aren't on any board, so nothing gets left off the wall by accident
  const placed = new Set<string>();
  for (const b of boards) {
    for (const c of b.columns) placed.add(c.field);
  }
  const unplaced = HONOURS_BOARD_FIELDS.filter((f) => !placed.has(f.field));

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-700">{error}</p>}

      {/* Shared year settings */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">Sheets</h3>
          {!isEditingSheets ? (
            <button
              onClick={() => { setEditStartYear(startYear); setEditYearsPerSet(yearsPerSet); setSheetsError(''); setIsEditingSheets(true); }}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Edit
            </button>
          ) : (
            <div className="flex gap-3">
              <button onClick={() => { setIsEditingSheets(false); setSheetsError(''); }} className="text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
              <button onClick={saveSheets} disabled={savingSheets} className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50">
                {savingSheets ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-700">
          Each board chooses a layout (below). With two sheets, the first has the title and the
          second holds the later years at the same row spacing — then a second set when that
          fills. Only the sheet holding the current year needs reprinting each season. A single
          sheet holds every year so far and is reprinted each year, a little smaller each time.
        </p>

        {sheetsError && <p className="text-sm text-red-700">{sheetsError}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="block text-gray-900 mb-1">Start year</label>
            {isEditingSheets ? (
              <input type="text" inputMode="numeric" value={editStartYear} onChange={(e) => setEditStartYear(e.target.value)} className={`${getInputClasses()} max-w-[10rem]`} />
            ) : (
              <span className="text-gray-900">{startYear || '—'}</span>
            )}
            <p className="text-xs text-gray-700 mt-1">The first year on the wall. Raise it later to roll the oldest years off instead of adding a second set.</p>
          </div>
          <div>
            <label className="block text-gray-900 mb-1">Row control</label>
            {isEditingSheets ? (
              <input type="text" inputMode="numeric" value={editYearsPerSet} onChange={(e) => setEditYearsPerSet(e.target.value)} className={`${getInputClasses()} max-w-[10rem]`} />
            ) : (
              <span className="text-gray-900">{yearsPerSet || '—'}</span>
            )}
            <p className="text-xs text-gray-700 mt-1">
              Sets the row spacing, and so the name size, on every board. Lower gives bigger names but fewer rows per
              sheet. With an A2 sheet and A3 continuation: 71 gives names about 21pt (A2 sheet to 2026, 26 spare years);
              65 about 23pt (A2 to 2022, 20 spare); 63 about 24pt (A2 to 2020, 16 spare). Changing it moves every
              sheet&apos;s years, so all the printed sheets would need reprinting.
            </p>
          </div>
        </div>

        {/* What each layout gives with these settings */}
        {settingsValid && (
          <div className="space-y-3">
            {BOARD_LAYOUTS.map((l) => (
              <div key={l.value} className="text-sm">
                <div className="font-medium text-gray-900">{l.label}</div>
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md mt-1">
                  {layoutSheets(l.value).map(({ sheet: s, isCurrent, namePt }) => (
                    <li key={s.firstYear} className="p-2 flex flex-wrap justify-between gap-2">
                      <span className="text-gray-900">
                        {s.position === 'Single' ? '' : `Set ${s.set} · ${sheetLabel(l.value, s)} · `}{s.firstYear}–{s.lastYear} · names about {namePt}pt
                      </span>
                      {s.position === 'Single' ? (
                        <span className="text-blue-800">Reprinted each season, a little smaller each time</span>
                      ) : isCurrent ? (
                        <span className="text-blue-800">Current — reprint each season ({s.lastYear - thisYear} spare years)</span>
                      ) : (
                        <span className="text-green-800">Complete — never changes</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Boards */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">Boards</h3>
          {editingId === null && (
            <button onClick={startAdd} className="text-sm text-blue-600 hover:text-blue-800">+ Add board</button>
          )}
        </div>

        {editingId === 'new' && (
          <BoardEditor form={form} setForm={setForm} error={formError} saving={saving} onSave={saveBoard} onCancel={cancelEdit} />
        )}

        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md">
          {boards.map((b) => (
            <li key={b.id} className="p-3 space-y-2">
              {editingId === b.id ? (
                <BoardEditor form={form} setForm={setForm} error={formError} saving={saving} onSave={saveBoard} onCancel={cancelEdit} />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">{b.name}</div>
                    <div className="text-gray-700">{layoutLabel(b.layout)}</div>
                    <div className="text-gray-700">
                      {b.columns.length} {b.columns.length === 1 ? 'column' : 'columns'}: {b.columns.map((c) => c.heading).join(' · ')}
                    </div>
                  </div>
                  {editingId === null && (
                    <div className="flex gap-3 text-sm">
                      <button onClick={() => startEdit(b)} className="text-blue-600 hover:text-blue-800">Edit</button>
                      <button onClick={() => setConfirmDelete(b)} className="text-red-700 hover:text-red-900">Delete</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
          {boards.length === 0 && <li className="p-3 text-sm text-gray-700">No boards yet.</li>}
        </ul>

        {unplaced.length > 0 && (
          <p className="text-sm text-amber-800">Not on any board: {unplaced.map((f) => f.label).join(', ')}</p>
        )}
        <p className="text-xs text-gray-700">
          Column widths are relative: 1 suits a single name, about 1.5 a pair, about 2 a triple.
          Headings are what&apos;s printed, so they can differ from the names used on the website.
        </p>
        <p className="text-sm">
          <a href="/admin/website/honours-boards" className="text-blue-600 hover:text-blue-800">Print the boards →</a>
        </p>
      </div>

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title="Delete board?"
        message={confirmDelete ? `Delete the ${confirmDelete.name} board? The honours themselves are not affected.` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={deleteBoard}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function BoardEditor({ form, setForm, error, saving, onSave, onCancel }: {
  form: BoardForm;
  setForm: (form: BoardForm) => void;
  error: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  /** Replaces one column's values, leaving the rest alone. */
  function updateColumn(index: number, changes: Partial<ColumnForm>) {
    const columns = form.columns.map((c, i) => (i === index ? { ...c, ...changes } : c));
    setForm({ ...form, columns });
  }

  /** Picking a competition fills in its default heading, unless one has been typed. */
  function changeField(index: number, field: string) {
    const current = form.columns[index];
    const headingUntouched = current.heading.trim() === '' || current.heading === fieldLabel(current.field);
    updateColumn(index, headingUntouched ? { field, heading: fieldLabel(field) } : { field });
  }

  /** Swaps a column with its neighbour (direction -1 = left, 1 = right). */
  function moveColumn(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= form.columns.length) return;
    const columns = [...form.columns];
    [columns[index], columns[target]] = [columns[target], columns[index]];
    setForm({ ...form, columns });
  }

  function removeColumn(index: number) {
    setForm({ ...form, columns: form.columns.filter((_, i) => i !== index) });
  }

  function addColumn() {
    setForm({ ...form, columns: [...form.columns, { field: '', heading: '', width: '1' }] });
  }

  // Each competition can only appear once on a board, so hide ones already used elsewhere on it
  const usedFields = new Set(form.columns.map((c) => c.field));

  return (
    <div className="space-y-3 rounded-md bg-gray-50 p-3 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <label className="block sm:col-span-3">
          <span className="text-gray-700">Name</span>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${getInputClasses()} w-full mt-0.5`} placeholder="e.g. Pairs & Triples" />
        </label>
        <label className="block">
          <span className="text-gray-700">Order</span>
          <input type="text" inputMode="numeric" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} className={`${getInputClasses()} w-full mt-0.5`} />
        </label>
      </div>

      <label className="block">
        <span className="text-gray-700">Layout</span>
        <select value={form.layout} onChange={(e) => setForm({ ...form, layout: e.target.value as BoardLayout })} className={`${getInputClasses()} w-full mt-0.5`}>
          {BOARD_LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <span className="block text-xs text-gray-700 mt-1">{BOARD_LAYOUTS.find((l) => l.value === form.layout)?.hint}</span>
      </label>

      <div className="space-y-2">
        <span className="block text-gray-700">Columns, left to right (the year column is added automatically)</span>
        {form.columns.map((col, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <select
              value={col.field}
              onChange={(e) => changeField(i, e.target.value)}
              className={`${getInputClasses()} col-span-12 sm:col-span-4`}
              aria-label={`Column ${i + 1} competition`}
            >
              {col.field === '' && <option value="">Choose…</option>}
              {HONOURS_BOARD_FIELDS.filter((f) => f.field === col.field || !usedFields.has(f.field)).map((f) => (
                <option key={f.field} value={f.field}>{f.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={col.heading}
              onChange={(e) => updateColumn(i, { heading: e.target.value })}
              className={`${getInputClasses()} col-span-7 sm:col-span-4`}
              placeholder="Printed heading"
              aria-label={`Column ${i + 1} heading`}
            />
            <input
              type="text"
              inputMode="decimal"
              value={col.width}
              onChange={(e) => updateColumn(i, { width: e.target.value })}
              className={`${getInputClasses()} col-span-2 sm:col-span-1`}
              aria-label={`Column ${i + 1} width`}
              title="Relative width"
            />
            <div className="col-span-3 sm:col-span-3 flex gap-2 justify-end">
              <button onClick={() => moveColumn(i, -1)} disabled={i === 0} className="text-blue-600 hover:text-blue-800 disabled:opacity-30" aria-label={`Move column ${i + 1} left`}>←</button>
              <button onClick={() => moveColumn(i, 1)} disabled={i === form.columns.length - 1} className="text-blue-600 hover:text-blue-800 disabled:opacity-30" aria-label={`Move column ${i + 1} right`}>→</button>
              <button onClick={() => removeColumn(i)} className="text-red-700 hover:text-red-900" aria-label={`Remove column ${i + 1}`}>Remove</button>
            </div>
          </div>
        ))}
        <button onClick={addColumn} className="text-blue-600 hover:text-blue-800">+ Add column</button>
      </div>

      {error && <p className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving} className={getButtonClasses('primary', 'sm')}>{saving ? 'Saving…' : 'Save board'}</button>
        <button onClick={onCancel} disabled={saving} className={getButtonClasses('secondary', 'sm')}>Cancel</button>
      </div>
    </div>
  );
}
