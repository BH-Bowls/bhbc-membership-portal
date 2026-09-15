// app/admin/website/announcements/page.tsx
// Admin page for creating, editing, and deleting announcements shown on the
// public site's home page. Access: Admin, Captain, GMC (enforced by the API routes).
// Distinct from /admin/announcements, which manages the portal's own home-page banners.

'use client';

import { useEffect, useState } from 'react';
import { getButtonClasses, getBadgeClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import type { WebsiteAnnouncement, WebsiteAnnouncementType } from '@/lib/website-announcements-supabase';

const TYPE_OPTIONS: { value: WebsiteAnnouncementType; label: string }[] = [
  { value: 'notice', label: 'Notice' },
  { value: 'open-day', label: 'Open Day' },
  { value: 'visiting-side', label: 'Visiting Side' },
  { value: 'event', label: 'Event' },
];

const EMPTY_FORM = {
  title: '', body: '', type: 'notice' as WebsiteAnnouncementType,
  cta_label: '', cta_url: '', start_date: '', end_date: '', active: true,
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ManageWebsiteAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<WebsiteAnnouncement[]>([]);
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
    loadAnnouncements();
  }, []);

  const loadAnnouncements = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/website/announcements');
      if (!res.ok) {
        setLoadError('Failed to load announcements. Please refresh the page.');
        return;
      }
      const json = await res.json();
      setAnnouncements(json.announcements || []);
    } catch {
      setLoadError('Failed to load announcements. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleNewClick = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, start_date: todayIso(), end_date: todayIso() });
    setFormError(null);
    setShowForm(true);
  };

  const handleEditClick = (a: WebsiteAnnouncement) => {
    setEditingId(a.id);
    setForm({
      title: a.title, body: a.body, type: a.type,
      cta_label: a.cta_label || '', cta_url: a.cta_url || '',
      start_date: a.start_date, end_date: a.end_date, active: a.active,
    });
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

    if (form.title.trim() === '') { setFormError('Title is required.'); return; }
    if (form.body.trim() === '') { setFormError('Body is required.'); return; }
    if (form.start_date === '') { setFormError('Start date is required.'); return; }
    if (form.end_date === '') { setFormError('End date is required.'); return; }
    if (form.end_date < form.start_date) { setFormError('End date must not be before start date.'); return; }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        type: form.type,
        cta_label: form.cta_label.trim() || null,
        cta_url: form.cta_url.trim() || null,
        start_date: form.start_date,
        end_date: form.end_date,
        active: form.active,
      };

      const res = editingId
        ? await fetch(`/api/admin/website/announcements/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/website/announcements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const json = await res.json();
        setFormError(json.error || 'Failed to save announcement.');
        return;
      }

      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadAnnouncements();
    } catch {
      setFormError('Failed to save announcement. Please try again.');
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
      const res = await fetch(`/api/admin/website/announcements/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setDeleteError(json.error || 'Failed to delete announcement.');
        return;
      }
      setConfirmDeleteId(null);
      await loadAnnouncements();
    } catch {
      setDeleteError('Failed to delete announcement. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const isCurrentlyActive = (a: WebsiteAnnouncement) => {
    const today = todayIso();
    return a.active && a.start_date <= today && today <= a.end_date;
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
            <h1 className="text-2xl font-bold text-gray-900">Manage Website Announcements</h1>
            {!showForm ? (
              <button onClick={handleNewClick} className={getButtonClasses('primary', 'md')}>
                New Announcement
              </button>
            ) : null}
          </div>

          {loadError ? <div className={getAlertClasses('danger') + ' mb-4'}>{loadError}</div> : null}

          {showForm ? (
            <div className="bg-white shadow rounded-lg p-6 mb-6 text-gray-900">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {editingId ? 'Edit Announcement' : 'New Announcement'}
              </h2>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  className={getInputClasses()}
                  value={form.title}
                  onChange={(e) => { setForm({ ...form, title: e.target.value }); setFormError(null); }}
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Body <span className="text-red-600">*</span>
                </label>
                <textarea
                  className={getInputClasses() + ' min-h-[80px]'}
                  value={form.body}
                  onChange={(e) => { setForm({ ...form, body: e.target.value }); setFormError(null); }}
                  rows={3}
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  className={getInputClasses()}
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as WebsiteAnnouncementType })}
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-4 mb-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Button label <span className="text-gray-700 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    className={getInputClasses()}
                    value={form.cta_label}
                    onChange={(e) => setForm({ ...form, cta_label: e.target.value })}
                    placeholder="e.g. Learn more"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Button link <span className="text-gray-700 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    className={getInputClasses()}
                    value={form.cta_url}
                    onChange={(e) => setForm({ ...form, cta_url: e.target.value })}
                    placeholder="/join or https://…"
                  />
                </div>
              </div>

              <div className="flex gap-4 mb-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start date <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="date"
                    className={getInputClasses()}
                    value={form.start_date}
                    onChange={(e) => { setForm({ ...form, start_date: e.target.value }); setFormError(null); }}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End date <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="date"
                    className={getInputClasses()}
                    value={form.end_date}
                    onChange={(e) => { setForm({ ...form, end_date: e.target.value }); setFormError(null); }}
                  />
                </div>
              </div>

              <div className="mb-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                <label htmlFor="active" className="text-sm font-medium text-gray-700">
                  Active — master on/off switch (still limited to the date range above)
                </label>
              </div>

              {formError ? <div className={getAlertClasses('danger') + ' mb-4 text-sm'}>{formError}</div> : null}

              <div className="flex gap-3">
                <button onClick={handleFormSave} disabled={saving} className={getButtonClasses('primary', 'md')}>
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Announcement'}
                </button>
                <button onClick={handleFormCancel} disabled={saving} className={getButtonClasses('secondary', 'md')}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="text-sm text-gray-700 py-4">Loading announcements…</div>
          ) : announcements.length === 0 ? (
            <div className="text-sm text-gray-700 py-4">No announcements yet.</div>
          ) : (
            <div className="space-y-4">
              {announcements.map((a) => (
                <div key={a.id} className={`bg-white shadow rounded-lg p-5 text-gray-900 ${!isCurrentlyActive(a) ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {isCurrentlyActive(a) ? (
                      <span className={getBadgeClasses('success', 'sm')}>Live</span>
                    ) : (
                      <span className={getBadgeClasses('warning', 'sm')}>Not showing</span>
                    )}
                    <span className={getBadgeClasses('secondary', 'sm')}>{TYPE_OPTIONS.find((t) => t.value === a.type)?.label ?? a.type}</span>
                  </div>

                  <p className="font-semibold text-gray-900">{a.title}</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.body}</p>
                  <p className="text-xs text-gray-700 mt-2">{a.start_date} – {a.end_date}</p>
                  {a.cta_label ? <p className="text-xs text-gray-700">Button: {a.cta_label} → {a.cta_url}</p> : null}

                  <div className="mt-4">
                    {confirmDeleteId === a.id ? (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-gray-900 font-medium mb-2">Are you sure? This cannot be undone.</p>
                        {deleteError ? <p className="text-sm text-red-700 mb-2">{deleteError}</p> : null}
                        <div className="flex gap-2">
                          <button onClick={() => handleDeleteConfirm(a.id)} disabled={deleting} className={getButtonClasses('danger', 'sm')}>
                            {deleting ? 'Deleting…' : 'Yes, Delete'}
                          </button>
                          <button onClick={handleDeleteCancel} disabled={deleting} className={getButtonClasses('secondary', 'sm')}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => handleEditClick(a)} className={getButtonClasses('secondary', 'sm')}>
                          Edit
                        </button>
                        <button onClick={() => handleDeleteClick(a.id)} className={getButtonClasses('danger', 'sm')}>
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
