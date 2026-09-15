// app/admin/website/honours-external/page.tsx
// Admin page for creating, editing, and deleting external (county/national/etc.)
// competition results shown on the public site's /honours page. Multiple rows
// per year are expected. Access: Admin, Captain, GMC (enforced by the API routes).

'use client';

import { useEffect, useState } from 'react';
import { getButtonClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import type { WebsiteHonoursExternal } from '@/lib/website-honours-external-supabase';

const EMPTY_FORM = { year: String(new Date().getFullYear()), competition: '', detail: '' };

export default function ManageHonoursExternalPage() {
  const [rows, setRows] = useState<WebsiteHonoursExternal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    loadRows();
  }, []);

  const loadRows = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/website/honours-external');
      if (!res.ok) {
        setLoadError('Failed to load results. Please refresh the page.');
        return;
      }
      const json = await res.json();
      setRows(json.rows || []);
    } catch {
      setLoadError('Failed to load results. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleNewClick = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const handleEditClick = (row: WebsiteHonoursExternal) => {
    setEditingId(row.id);
    setForm({ year: String(row.year), competition: row.competition, detail: row.detail || '' });
    setFormError(null);
    setShowForm(true);
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const handleFormSave = async () => {
    setFormError(null);

    const yearNum = Number(form.year);
    if (!Number.isInteger(yearNum) || yearNum <= 0) {
      setFormError('Year must be a whole number.');
      return;
    }
    if (form.competition.trim() === '') {
      setFormError('Competition is required.');
      return;
    }

    setSaving(true);
    try {
      const payload = { year: yearNum, competition: form.competition.trim(), detail: form.detail.trim() || null };

      const res = editingId
        ? await fetch(`/api/admin/website/honours-external/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/website/honours-external', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const json = await res.json();
        setFormError(json.error || 'Failed to save result.');
        return;
      }

      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadRows();
    } catch {
      setFormError('Failed to save result. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (id: string) => {
    setConfirmDeleteId(id);
    setDeleteError(null);
  };

  const handleDeleteCancel = () => {
    setConfirmDeleteId(null);
    setDeleteError(null);
  };

  const handleDeleteConfirm = async (id: string) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/website/honours-external/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setDeleteError(json.error || 'Failed to delete result.');
        return;
      }
      setConfirmDeleteId(null);
      await loadRows();
    } catch {
      setDeleteError('Failed to delete result. Please try again.');
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
            <h1 className="text-2xl font-bold text-gray-900">Manage External Honours Results</h1>
            {!showForm ? (
              <button onClick={handleNewClick} className={getButtonClasses('primary', 'md')}>
                New Result
              </button>
            ) : null}
          </div>

          <p className="text-sm text-gray-700 mb-4">
            County, national, or other external competition results — shown in the
            expandable year card on the public /honours page. Multiple results can
            share the same year.
          </p>

          {loadError ? <div className={getAlertClasses('danger') + ' mb-4'}>{loadError}</div> : null}

          {showForm ? (
            <div className="bg-white shadow rounded-lg p-6 mb-6 text-gray-900">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {editingId ? 'Edit Result' : 'New Result'}
              </h2>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Year <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  className={getInputClasses() + ' max-w-[8rem]'}
                  value={form.year}
                  onChange={(e) => { setForm({ ...form, year: e.target.value }); setFormError(null); }}
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Competition <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  className={getInputClasses()}
                  value={form.competition}
                  onChange={(e) => { setForm({ ...form, competition: e.target.value }); setFormError(null); }}
                  placeholder="e.g. Sussex County Championship"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Detail <span className="text-gray-700 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  className={getInputClasses()}
                  value={form.detail}
                  onChange={(e) => setForm({ ...form, detail: e.target.value })}
                  placeholder="e.g. J. Smith — Runner-up"
                />
              </div>

              {formError ? <div className={getAlertClasses('danger') + ' mb-4 text-sm'}>{formError}</div> : null}

              <div className="flex gap-3">
                <button onClick={handleFormSave} disabled={saving} className={getButtonClasses('primary', 'md')}>
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Result'}
                </button>
                <button onClick={handleFormCancel} disabled={saving} className={getButtonClasses('secondary', 'md')}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="text-sm text-gray-700 py-4">Loading results…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-gray-700 py-4">No external results yet.</div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.id} className="bg-white shadow rounded-lg p-5 text-gray-900">
                  <p className="text-xs font-semibold text-gray-500">{row.year}</p>
                  <p className="font-semibold text-gray-900">{row.competition}</p>
                  {row.detail ? <p className="text-sm text-gray-700">{row.detail}</p> : null}

                  <div className="mt-3">
                    {confirmDeleteId === row.id ? (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-gray-900 font-medium mb-2">Are you sure? This cannot be undone.</p>
                        {deleteError ? <p className="text-sm text-red-700 mb-2">{deleteError}</p> : null}
                        <div className="flex gap-2">
                          <button onClick={() => handleDeleteConfirm(row.id)} disabled={deleting} className={getButtonClasses('danger', 'sm')}>
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
                        <button onClick={() => handleDeleteClick(row.id)} className={getButtonClasses('danger', 'sm')}>
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
