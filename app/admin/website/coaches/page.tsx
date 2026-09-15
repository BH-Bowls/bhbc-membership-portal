// app/admin/website/coaches/page.tsx
// Admin page for creating, editing, and deleting coaches shown on the public
// site's /coaching page. Access: Admin, Captain, GMC (enforced by the API routes).

'use client';

import { useEffect, useState } from 'react';
import { getButtonClasses, getBadgeClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import type { WebsiteCoach } from '@/lib/website-coaches-supabase';

const EMPTY_FORM = { name: '', qualification: '', bio: '', active: true };

export default function ManageWebsiteCoachesPage() {
  const [coaches, setCoaches] = useState<WebsiteCoach[]>([]);
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
    loadCoaches();
  }, []);

  const loadCoaches = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/website/coaches');
      if (!res.ok) {
        setLoadError('Failed to load coaches. Please refresh the page.');
        return;
      }
      const json = await res.json();
      setCoaches(json.coaches || []);
    } catch {
      setLoadError('Failed to load coaches. Please check your connection.');
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

  const handleEditClick = (coach: WebsiteCoach) => {
    setEditingId(coach.id);
    setForm({ name: coach.name, qualification: coach.qualification, bio: coach.bio || '', active: coach.active });
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

    if (form.name.trim() === '') {
      setFormError('Name is required.');
      return;
    }
    if (form.qualification.trim() === '') {
      setFormError('Qualification is required.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        qualification: form.qualification.trim(),
        bio: form.bio.trim() || null,
        active: form.active,
      };

      const res = editingId
        ? await fetch(`/api/admin/website/coaches/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/website/coaches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const json = await res.json();
        setFormError(json.error || 'Failed to save coach.');
        return;
      }

      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadCoaches();
    } catch {
      setFormError('Failed to save coach. Please try again.');
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
      const res = await fetch(`/api/admin/website/coaches/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setDeleteError(json.error || 'Failed to delete coach.');
        return;
      }
      setConfirmDeleteId(null);
      await loadCoaches();
    } catch {
      setDeleteError('Failed to delete coach. Please try again.');
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
            <h1 className="text-2xl font-bold text-gray-900">Manage Coaches</h1>
            {!showForm ? (
              <button onClick={handleNewClick} className={getButtonClasses('primary', 'md')}>
                New Coach
              </button>
            ) : null}
          </div>

          {loadError ? <div className={getAlertClasses('danger') + ' mb-4'}>{loadError}</div> : null}

          {showForm ? (
            <div className="bg-white shadow rounded-lg p-6 mb-6 text-gray-900">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {editingId ? 'Edit Coach' : 'New Coach'}
              </h2>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  className={getInputClasses()}
                  value={form.name}
                  onChange={(e) => { setForm({ ...form, name: e.target.value }); setFormError(null); }}
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Qualification <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  className={getInputClasses()}
                  value={form.qualification}
                  onChange={(e) => { setForm({ ...form, qualification: e.target.value }); setFormError(null); }}
                  placeholder="e.g. Level 2 Bowls England Coach"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bio <span className="text-gray-700 font-normal">(optional)</span>
                </label>
                <textarea
                  className={getInputClasses() + ' min-h-[80px]'}
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="mb-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                <label htmlFor="active" className="text-sm font-medium text-gray-700">
                  Active — shown on the public site
                </label>
              </div>

              {formError ? <div className={getAlertClasses('danger') + ' mb-4 text-sm'}>{formError}</div> : null}

              <div className="flex gap-3">
                <button onClick={handleFormSave} disabled={saving} className={getButtonClasses('primary', 'md')}>
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Coach'}
                </button>
                <button onClick={handleFormCancel} disabled={saving} className={getButtonClasses('secondary', 'md')}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="text-sm text-gray-700 py-4">Loading coaches…</div>
          ) : coaches.length === 0 ? (
            <div className="text-sm text-gray-700 py-4">No coaches yet.</div>
          ) : (
            <div className="space-y-4">
              {coaches.map((coach) => (
                <div key={coach.id} className={`bg-white shadow rounded-lg p-5 text-gray-900 ${!coach.active ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {coach.active ? (
                      <span className={getBadgeClasses('success', 'sm')}>Active</span>
                    ) : (
                      <span className={getBadgeClasses('warning', 'sm')}>Inactive</span>
                    )}
                  </div>

                  <p className="font-semibold text-gray-900">{coach.name}</p>
                  <p className="text-sm text-gray-700">{coach.qualification}</p>
                  {coach.bio ? <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{coach.bio}</p> : null}

                  <div className="mt-4">
                    {confirmDeleteId === coach.id ? (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-gray-900 font-medium mb-2">Are you sure? This cannot be undone.</p>
                        {deleteError ? <p className="text-sm text-red-700 mb-2">{deleteError}</p> : null}
                        <div className="flex gap-2">
                          <button onClick={() => handleDeleteConfirm(coach.id)} disabled={deleting} className={getButtonClasses('danger', 'sm')}>
                            {deleting ? 'Deleting…' : 'Yes, Delete'}
                          </button>
                          <button onClick={handleDeleteCancel} disabled={deleting} className={getButtonClasses('secondary', 'sm')}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => handleEditClick(coach)} className={getButtonClasses('secondary', 'sm')}>
                          Edit
                        </button>
                        <button onClick={() => handleDeleteClick(coach.id)} className={getButtonClasses('danger', 'sm')}>
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
