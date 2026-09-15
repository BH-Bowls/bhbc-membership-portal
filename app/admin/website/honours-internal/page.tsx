// app/admin/website/honours-internal/page.tsx
// Admin page for creating, editing, and deleting each season's internal honours
// record shown on the public site's /honours page. One row per year — year is
// the primary key, so it can't be changed once created (delete + recreate instead).
// Access: Admin, Captain, GMC (enforced by the API routes).
//
// Field labels/grouping mirror the website's own components/honours/ChampionsCard.tsx
// and HonoursTable.tsx CARD_SECTIONS — see bhbc-website's lib/honours.ts for the
// canonical HONOURS_LABELS this must stay in sync with.

'use client';

import { useEffect, useState } from 'react';
import { getButtonClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import type { WebsiteHonoursInternal } from '@/lib/website-honours-internal-supabase';
import HonoursPhotoManager from './HonoursPhotoManager';

// Field key, display label — grouped into sections for the form and the expanded list view
const SECTIONS: { heading: string; fields: { key: keyof Omit<WebsiteHonoursInternal, 'year'>; label: string }[] }[] = [
  { heading: 'Officials', fields: [
    { key: 'president', label: 'President' },
    { key: 'mens_captain', label: "Men's Captain" },
    { key: 'ladies_captain', label: 'Ladies Captain' },
  ] },
  { heading: "Men's Events", fields: [
    { key: 'mens_championship', label: "Men's Championship" },
    { key: 'mens_two_woods', label: "Men's Two Woods" },
  ] },
  { heading: "Ladies' Events", fields: [
    { key: 'ladies_maynard', label: 'Ladies Maynard' },
    { key: 'ladies_two_woods', label: 'Ladies Two Woods' },
  ] },
  { heading: 'Other Singles', fields: [
    { key: 'mixed_handicap', label: 'Mixed Handicap' },
    { key: 'oldland', label: 'Oldland' },
    { key: 'veterans_cup', label: 'Veterans Cup' },
    { key: 'centenary_cup', label: 'Centenary Cup' },
  ] },
  { heading: 'Pairs & Triples', fields: [
    { key: 'drawn_pairs', label: 'Drawn Pairs' },
    { key: 'drawn_triples', label: 'Drawn Triples' },
    { key: 'married_pairs', label: 'Married Pairs' },
    { key: 'australian_pairs', label: 'Australian Pairs' },
  ] },
];

const ALL_FIELD_KEYS = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

type FormState = { year: string } & Record<string, string>;

function emptyForm(year: string): FormState {
  const form: FormState = { year };
  for (const key of ALL_FIELD_KEYS) form[key] = '';
  return form;
}

export default function ManageHonoursInternalPage() {
  const [rows, setRows] = useState<WebsiteHonoursInternal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(String(new Date().getFullYear())));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDeleteYear, setConfirmDeleteYear] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    loadRows();
  }, []);

  const loadRows = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/website/honours-internal');
      if (!res.ok) {
        setLoadError('Failed to load honours records. Please refresh the page.');
        return;
      }
      const json = await res.json();
      setRows(json.rows || []);
    } catch {
      setLoadError('Failed to load honours records. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleNewClick = () => {
    setEditingYear(null);
    setForm(emptyForm(String(new Date().getFullYear())));
    setFormError(null);
    setShowForm(true);
  };

  const handleEditClick = (row: WebsiteHonoursInternal) => {
    setEditingYear(row.year);
    const next = emptyForm(String(row.year));
    for (const key of ALL_FIELD_KEYS) next[key] = (row as any)[key] || '';
    setForm(next);
    setFormError(null);
    setShowForm(true);
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingYear(null);
    setFormError(null);
  };

  const handleFormSave = async () => {
    setFormError(null);

    const yearNum = Number(form.year);
    if (!Number.isInteger(yearNum) || yearNum <= 0) {
      setFormError('Year must be a whole number.');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, string | number | null> = { year: yearNum };
      for (const key of ALL_FIELD_KEYS) {
        payload[key] = form[key]?.trim() || null;
      }

      const res = editingYear !== null
        ? await fetch(`/api/admin/website/honours-internal/${editingYear}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/website/honours-internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const json = await res.json();
        setFormError(json.error || 'Failed to save honours record.');
        return;
      }

      setShowForm(false);
      setEditingYear(null);
      await loadRows();
    } catch {
      setFormError('Failed to save honours record. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (year: number) => {
    setConfirmDeleteYear(year);
    setDeleteError(null);
  };

  const handleDeleteCancel = () => {
    setConfirmDeleteYear(null);
    setDeleteError(null);
  };

  const handleDeleteConfirm = async (year: number) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/website/honours-internal/${year}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setDeleteError(json.error || 'Failed to delete honours record.');
        return;
      }
      setConfirmDeleteYear(null);
      await loadRows();
    } catch {
      setDeleteError('Failed to delete honours record. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <a href="/admin/website" className="text-sm text-blue-500 hover:text-blue-600 font-medium">
              ← Back to Website Admin
            </a>
          </div>

          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Manage Internal Honours</h1>
            {!showForm ? (
              <button onClick={handleNewClick} className={getButtonClasses('primary', 'md')}>
                New Season
              </button>
            ) : null}
          </div>

          <p className="text-sm text-gray-700 mb-4">
            One record per season year — the club&apos;s own competition winners.
            Leave any field blank if that competition wasn&apos;t held, or the winner
            isn&apos;t known yet. Each season can also have one or more champions
            photos (drag and drop below its record).
          </p>

          {loadError ? <div className={getAlertClasses('danger') + ' mb-4'}>{loadError}</div> : null}

          {showForm ? (
            <div className="bg-white shadow rounded-lg p-6 mb-6 text-gray-900">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {editingYear !== null ? `Edit ${editingYear} Season` : 'New Season'}
              </h2>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Year <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  className={getInputClasses() + ' max-w-[8rem]'}
                  value={form.year}
                  disabled={editingYear !== null}
                  onChange={(e) => { setForm({ ...form, year: e.target.value }); setFormError(null); }}
                />
                {editingYear !== null ? (
                  <p className="text-xs text-gray-700 mt-1">Year can&apos;t be changed — delete and recreate instead.</p>
                ) : null}
              </div>

              {SECTIONS.map((section) => (
                <div key={section.heading} className="mb-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">{section.heading}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {section.fields.map((field) => (
                      <div key={field.key}>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                        <input
                          type="text"
                          className={getInputClasses()}
                          value={form[field.key]}
                          onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {formError ? <div className={getAlertClasses('danger') + ' mb-4 text-sm'}>{formError}</div> : null}

              <div className="flex gap-3">
                <button onClick={handleFormSave} disabled={saving} className={getButtonClasses('primary', 'md')}>
                  {saving ? 'Saving…' : editingYear !== null ? 'Save Changes' : 'Create Season'}
                </button>
                <button onClick={handleFormCancel} disabled={saving} className={getButtonClasses('secondary', 'md')}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="text-sm text-gray-700 py-4">Loading honours records…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-gray-700 py-4">No seasons recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.year} className="bg-white shadow rounded-lg p-5 text-gray-900">
                  <p className="font-semibold text-gray-900 mb-1">{row.year}</p>
                  <p className="text-sm text-gray-700">
                    {row.mens_championship ? `Men's Championship: ${row.mens_championship}` : 'Men’s Championship not recorded'}
                  </p>

                  <HonoursPhotoManager year={row.year} />

                  <div className="mt-3">
                    {confirmDeleteYear === row.year ? (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-gray-900 font-medium mb-2">Are you sure? This cannot be undone.</p>
                        {deleteError ? <p className="text-sm text-red-700 mb-2">{deleteError}</p> : null}
                        <div className="flex gap-2">
                          <button onClick={() => handleDeleteConfirm(row.year)} disabled={deleting} className={getButtonClasses('danger', 'sm')}>
                            {deleting ? 'Deleting…' : 'Yes, Delete'}
                          </button>
                          <button onClick={handleDeleteCancel} disabled={deleting} className={getButtonClasses('secondary', 'sm')}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => handleEditClick(row)} className={getButtonClasses('secondary', 'sm')}>
                          Edit
                        </button>
                        <button onClick={() => handleDeleteClick(row.year)} className={getButtonClasses('danger', 'sm')}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
