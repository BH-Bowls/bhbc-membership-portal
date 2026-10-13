'use client';

// src/components/LabelLayoutsPanel.tsx
// Admin > Config > Labels: the named label-sheet layouts Print Labels can use
// (add / edit / delete), and which layout each label type starts on.
// See supabase/migrations/0076_label_layouts.sql.

import { useEffect, useState } from 'react';
import { getButtonClasses, getInputClasses } from '@/config/theme-helpers';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LABEL_TYPES, defaultLayoutKey, validateLayout } from '@/types/label-layouts';
import type { LabelLayout, LabelLayoutInput, LabelType } from '@/types/label-layouts';

// The form edits every number as text, so a half-typed value doesn't jump about
interface LayoutForm {
  name: string;
  description: string;
  widthMm: string;
  heightMm: string;
  topMarginMm: string;
  leftMarginMm: string;
  columnGapMm: string;
  rowGapMm: string;
  perRow: string;
  perCol: string;
  cardOutline: boolean;
}

const NUMBER_FIELDS: [keyof LayoutForm, string][] = [
  ['widthMm', 'Label width (mm)'],
  ['heightMm', 'Label height (mm)'],
  ['topMarginMm', 'Top margin (mm)'],
  ['leftMarginMm', 'Left margin (mm)'],
  ['columnGapMm', 'Column gap (mm)'],
  ['rowGapMm', 'Row gap (mm)'],
  ['perRow', 'Labels across'],
  ['perCol', 'Labels down'],
];

const EMPTY_FORM: LayoutForm = {
  name: '', description: '', widthMm: '', heightMm: '', topMarginMm: '0', leftMarginMm: '0',
  columnGapMm: '0', rowGapMm: '0', perRow: '', perCol: '', cardOutline: true,
};

function toForm(layout: LabelLayout): LayoutForm {
  return {
    name: layout.name,
    description: layout.description || '',
    widthMm: String(layout.widthMm),
    heightMm: String(layout.heightMm),
    topMarginMm: String(layout.topMarginMm),
    leftMarginMm: String(layout.leftMarginMm),
    columnGapMm: String(layout.columnGapMm),
    rowGapMm: String(layout.rowGapMm),
    perRow: String(layout.perRow),
    perCol: String(layout.perCol),
    cardOutline: layout.cardOutline,
  };
}

function fromForm(form: LayoutForm): LabelLayoutInput {
  // A blank number box becomes NaN, which validateLayout reports
  const num = (value: string) => (value.trim() === '' ? NaN : Number(value));
  return {
    name: form.name,
    description: form.description,
    widthMm: num(form.widthMm),
    heightMm: num(form.heightMm),
    topMarginMm: num(form.topMarginMm),
    leftMarginMm: num(form.leftMarginMm),
    columnGapMm: num(form.columnGapMm),
    rowGapMm: num(form.rowGapMm),
    perRow: num(form.perRow),
    perCol: num(form.perCol),
    cardOutline: form.cardOutline,
  };
}

export function LabelLayoutsPanel() {
  const [layouts, setLayouts] = useState<LabelLayout[]>([]);
  const [defaults, setDefaults] = useState<Partial<Record<LabelType, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The layout being edited: null = none, 'new' = adding one, otherwise its id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LayoutForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LabelLayout | null>(null);
  const [defaultsMessage, setDefaultsMessage] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/admin/labels/layouts');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load label layouts');
        return;
      }
      setLayouts(data.layouts);
      setDefaults(data.defaults || {});
      setError('');
    } catch {
      setError('Failed to load label layouts');
    } finally {
      setLoading(false);
    }
  }

  // Runs once on mount: load the layouts
  useEffect(() => {
    load();
  }, []);

  function startAdd() {
    setEditingId('new');
    setForm(EMPTY_FORM);
    setFormError('');
  }

  function startEdit(layout: LabelLayout) {
    setEditingId(layout.id);
    setForm(toForm(layout));
    setFormError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setFormError('');
  }

  async function saveLayout() {
    const input = fromForm(form);
    const invalid = validateLayout(input);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const isNew = editingId === 'new';
      const res = await fetch(isNew ? '/api/admin/labels/layouts' : `/api/admin/labels/layouts/${editingId}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Failed to save layout');
        return;
      }
      setEditingId(null);
      await load();
    } catch {
      setFormError('Failed to save layout');
    } finally {
      setSaving(false);
    }
  }

  async function deleteLayout() {
    const layout = confirmDelete;
    setConfirmDelete(null);
    if (!layout) return;
    try {
      const res = await fetch(`/api/admin/labels/layouts/${layout.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to delete layout');
        return;
      }
      if (editingId === layout.id) setEditingId(null);
      await load();
    } catch {
      setError('Failed to delete layout');
    }
  }

  /** Saves one label type's default layout straight away. */
  async function changeDefault(type: LabelType, id: string) {
    setDefaultsMessage('');
    const previous = defaults;
    setDefaults({ ...defaults, [type]: id });
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [defaultLayoutKey(type)]: id }),
      });
      if (!res.ok) throw new Error();
      setDefaultsMessage('Saved');
    } catch {
      setDefaults(previous);
      setDefaultsMessage('Failed to save');
    }
  }

  /** The label types a layout is the default for, e.g. "Address, Booklet". */
  function defaultFor(id: string): string {
    const types: string[] = [];
    for (const t of LABEL_TYPES) {
      if (defaults[t.id] === id) types.push(t.label);
    }
    return types.join(', ');
  }

  if (loading) return <p className="text-sm text-gray-700">Loading layouts…</p>;

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-700">{error}</p>}

      {/* Default layout per label type */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-900">Default layout for each label type</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {LABEL_TYPES.map((t) => (
            <label key={t.id} className="block">
              <span className="text-gray-700">{t.label}</span>
              <select
                value={defaults[t.id] || ''}
                onChange={(e) => changeDefault(t.id, e.target.value)}
                className={`${getInputClasses()} w-full mt-0.5`}
              >
                {!defaults[t.id] && <option value="">Choose…</option>}
                {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          ))}
        </div>
        {defaultsMessage && <p className={`text-sm ${defaultsMessage === 'Saved' ? 'text-green-800' : 'text-red-700'}`}>{defaultsMessage}</p>}
        <p className="text-xs text-gray-700">Print Labels starts each label type on its default; a different layout can still be picked for one print.</p>
      </div>

      {/* Layouts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">Sheet layouts</h3>
          {editingId === null && (
            <button onClick={startAdd} className="text-sm text-blue-600 hover:text-blue-800">+ Add layout</button>
          )}
        </div>

        {editingId === 'new' && (
          <LayoutEditor form={form} setForm={setForm} error={formError} saving={saving} onSave={saveLayout} onCancel={cancelEdit} />
        )}

        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md">
          {layouts.map((l) => (
            <li key={l.id} className="p-3 space-y-2">
              {editingId === l.id ? (
                <LayoutEditor form={form} setForm={setForm} error={formError} saving={saving} onSave={saveLayout} onCancel={cancelEdit} />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">
                      {l.name}
                      {defaultFor(l.id) && <span className="ml-2 text-xs font-normal text-blue-800">Default for {defaultFor(l.id)}</span>}
                    </div>
                    <div className="text-gray-700">
                      {l.widthMm} × {l.heightMm} mm · {l.perRow} across × {l.perCol} down ({l.perRow * l.perCol} per sheet) ·
                      margins top {l.topMarginMm}, left {l.leftMarginMm} · gaps {l.columnGapMm} / {l.rowGapMm} mm ·
                      {l.cardOutline ? ' card outline' : ' card fills label'}
                    </div>
                    {l.description && <div className="text-gray-700 mt-0.5">{l.description}</div>}
                  </div>
                  {editingId === null && (
                    <div className="flex gap-3 text-sm">
                      <button onClick={() => startEdit(l)} className="text-blue-600 hover:text-blue-800">Edit</button>
                      <button onClick={() => setConfirmDelete(l)} className="text-red-700 hover:text-red-900">Delete</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-700">
          Measurements are from the top-left corner of an A4 sheet. Before printing on a new sheet type, print a test on plain paper and hold it against a real sheet to check the margins.
        </p>
      </div>

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title="Delete layout?"
        message={confirmDelete ? `Delete the ${confirmDelete.name} layout?` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={deleteLayout}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function LayoutEditor({ form, setForm, error, saving, onSave, onCancel }: {
  form: LayoutForm;
  setForm: (form: LayoutForm) => void;
  error: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md bg-gray-50 p-3 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          <span className="text-gray-700">Name</span>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${getInputClasses()} w-full mt-0.5`} placeholder="e.g. Avery L7163" />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-gray-700">Description (optional)</span>
          <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${getInputClasses()} w-full mt-0.5`} />
        </label>
        {NUMBER_FIELDS.map(([key, label]) => (
          <label key={key} className="block">
            <span className="text-gray-700">{label}</span>
            <input
              type="text"
              inputMode="decimal"
              value={form[key] as string}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className={`${getInputClasses()} w-full mt-0.5`}
            />
          </label>
        ))}
        <label className="flex items-start gap-2 sm:col-span-2 cursor-pointer">
          <input type="checkbox" checked={form.cardOutline} onChange={(e) => setForm({ ...form, cardOutline: e.target.checked })} className="mt-0.5 h-4 w-4" />
          <span className="text-gray-900">
            Membership cards: draw a credit-card outline to cut out
            <span className="block text-xs text-gray-700">Untick for card-sized sheets, or stickers that go onto a blank card — the card then fills the whole label.</span>
          </span>
        </label>
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving} className={getButtonClasses('primary', 'sm')}>{saving ? 'Saving…' : 'Save layout'}</button>
        <button onClick={onCancel} disabled={saving} className={getButtonClasses('secondary', 'sm')}>Cancel</button>
      </div>
    </div>
  );
}
