// app/admin/website/rowland-winners/page.tsx
// Admin page for creating, editing, and deleting each season's Rowland Cup
// winners shown on the public site's /rowland page. One row per year — year
// is the primary key, so it can't be changed once created (delete + recreate).
// Photos for these years live in Drive, edited on the Documents admin page or
// directly in Drive — this page only manages the winning club names.
// Access: Admin, Captain, GMC (enforced by the API routes).

'use client';

import { useEffect, useState } from 'react';
import { getButtonClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import type { WebsiteRowlandWinners } from '@/lib/website-rowland-winners-supabase';

type FormState = { year: string; edward_winner: string; gladys_winner: string };

function emptyForm(year: string): FormState {
  return { year, edward_winner: '', gladys_winner: '' };
}

export default function ManageRowlandWinnersPage() {
  const [rows, setRows] = useState<WebsiteRowlandWinners[]>([]);
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
      const res = await fetch('/api/admin/website/rowland-winners');
      if (!res.ok) {
        setLoadError('Failed to load Rowland winners. Please refresh the page.');
        return;
      }
      const json = await res.json();
      setRows(json.rows || []);
    } catch {
      setLoadError('Failed to load Rowland winners. Please check your connection.');
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

  const handleEditClick = (row: WebsiteRowlandWinners) => {
    setEditingYear(row.year);
    setForm({
      year: String(row.year),
      edward_winner: row.edward_winner || '',
      gladys_winner: row.gladys_winner || '',
    });
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
      const payload = {
        year: yearNum,
        edward_winner: form.edward_winner.trim() || null,
        gladys_winner: form.gladys_winner.trim() || null,
      };

      const res = editingYear !== null
        ? await fetch(`/api/admin/website/rowland-winners/${editingYear}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/website/rowland-winners', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const json = await res.json();
        setFormError(json.error || 'Failed to save Rowland winners.');
        return;
      }

      setShowForm(false);
      setEditingYear(null);
      await loadRows();
    } catch {
      setFormError('Failed to save Rowland winners. Please try again.');
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
      const res = await fetch(`/api/admin/website/rowland-winners/${year}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setDeleteError(json.error || 'Failed to delete Rowland winners.');
        return;
      }
      setConfirmDeleteYear(null);
      await loadRows();
    } catch {
      setDeleteError('Failed to delete Rowland winners. Please try again.');
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
            <h1 className="text-2xl font-bold text-gray-900">Manage Rowland Cup Winners</h1>
            {!showForm ? (
              <button onClick={handleNewClick} className={getButtonClasses('primary', 'md')}>
                New Season
              </button>
            ) : null}
          </div>

          <p className="text-sm text-gray-700 mb-4">
            One record per season — the winning club for each draw. Winner
            photos live in Google Drive, not here — see the Documents admin
            page or upload directly to Drive under Rowland/&lt;year&gt;/.
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

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Edward Rowland Cup winner</label>
                <input
                  type="text"
                  className={getInputClasses()}
                  value={form.edward_winner}
                  onChange={(e) => setForm({ ...form, edward_winner: e.target.value })}
                  placeholder="e.g. Portslade"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Gladys Rowland Cup winner</label>
                <input
                  type="text"
                  className={getInputClasses()}
                  value={form.gladys_winner}
                  onChange={(e) => setForm({ ...form, gladys_winner: e.target.value })}
                  placeholder="e.g. Southwick Park"
                />
              </div>

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
            <div className="text-sm text-gray-700 py-4">Loading Rowland winners…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-gray-700 py-4">No seasons recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.year} className="bg-white shadow rounded-lg p-5 text-gray-900">
                  <p className="font-semibold text-gray-900 mb-1">{row.year}</p>
                  <p className="text-sm text-gray-700">Edward Rowland Cup: {row.edward_winner || '—'}</p>
                  <p className="text-sm text-gray-700">Gladys Rowland Cup: {row.gladys_winner || '—'}</p>

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
