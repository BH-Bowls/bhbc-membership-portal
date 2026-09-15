// app/admin/website/committee/page.tsx
// Admin page for creating, editing, and deleting committee members shown on the
// public site's /about page. Access: Admin, Captain, GMC (enforced by the API routes).

'use client';

import { useEffect, useState } from 'react';
import { getButtonClasses, getBadgeClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import type { WebsiteCommitteeMember } from '@/lib/website-committee-supabase';

const EMPTY_FORM = { name: '', role: '', email: '', display_order: '0', active: true };

export default function ManageWebsiteCommitteePage() {
  const [members, setMembers] = useState<WebsiteCommitteeMember[]>([]);
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
    loadMembers();
  }, []);

  const loadMembers = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/website/committee');
      if (!res.ok) {
        setLoadError('Failed to load committee. Please refresh the page.');
        return;
      }
      const json = await res.json();
      setMembers(json.committee || []);
    } catch {
      setLoadError('Failed to load committee. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleNewClick = () => {
    setEditingId(null);
    // Default new members to the end of the display order
    const maxOrder = members.reduce((max, m) => Math.max(max, m.display_order), 0);
    setForm({ ...EMPTY_FORM, display_order: String(maxOrder + 1) });
    setFormError(null);
    setShowForm(true);
  };

  const handleEditClick = (member: WebsiteCommitteeMember) => {
    setEditingId(member.id);
    setForm({
      name: member.name,
      role: member.role,
      email: member.email || '',
      display_order: String(member.display_order),
      active: member.active,
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

    if (form.name.trim() === '') {
      setFormError('Name is required.');
      return;
    }
    if (form.role.trim() === '') {
      setFormError('Role is required.');
      return;
    }
    if (form.email.trim() !== '' && !form.email.includes('@')) {
      setFormError('Email must be a valid address.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        role: form.role.trim(),
        email: form.email.trim() || null,
        display_order: Number(form.display_order) || 0,
        active: form.active,
      };

      const res = editingId
        ? await fetch(`/api/admin/website/committee/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/website/committee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const json = await res.json();
        setFormError(json.error || 'Failed to save committee member.');
        return;
      }

      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadMembers();
    } catch {
      setFormError('Failed to save committee member. Please try again.');
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
      const res = await fetch(`/api/admin/website/committee/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setDeleteError(json.error || 'Failed to delete committee member.');
        return;
      }
      setConfirmDeleteId(null);
      await loadMembers();
    } catch {
      setDeleteError('Failed to delete committee member. Please try again.');
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
            <h1 className="text-2xl font-bold text-gray-900">Manage Committee</h1>
            {!showForm ? (
              <button onClick={handleNewClick} className={getButtonClasses('primary', 'md')}>
                New Committee Member
              </button>
            ) : null}
          </div>

          {loadError ? <div className={getAlertClasses('danger') + ' mb-4'}>{loadError}</div> : null}

          {showForm ? (
            <div className="bg-white shadow rounded-lg p-6 mb-6 text-gray-900">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {editingId ? 'Edit Committee Member' : 'New Committee Member'}
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
                  Role <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  className={getInputClasses()}
                  value={form.role}
                  onChange={(e) => { setForm({ ...form, role: e.target.value }); setFormError(null); }}
                  placeholder="e.g. Chairman"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email <span className="text-gray-700 font-normal">(optional — shown on the contact form dropdown if set)</span>
                </label>
                <input
                  type="email"
                  className={getInputClasses()}
                  value={form.email}
                  onChange={(e) => { setForm({ ...form, email: e.target.value }); setFormError(null); }}
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Display order</label>
                <input
                  type="number"
                  className={getInputClasses() + ' max-w-[8rem]'}
                  value={form.display_order}
                  onChange={(e) => setForm({ ...form, display_order: e.target.value })}
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
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Committee Member'}
                </button>
                <button onClick={handleFormCancel} disabled={saving} className={getButtonClasses('secondary', 'md')}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="text-sm text-gray-700 py-4">Loading committee…</div>
          ) : members.length === 0 ? (
            <div className="text-sm text-gray-700 py-4">No committee members yet.</div>
          ) : (
            <div className="space-y-4">
              {members.map((member) => (
                <div key={member.id} className={`bg-white shadow rounded-lg p-5 text-gray-900 ${!member.active ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={getBadgeClasses('secondary', 'sm')}>#{member.display_order}</span>
                    {member.active ? (
                      <span className={getBadgeClasses('success', 'sm')}>Active</span>
                    ) : (
                      <span className={getBadgeClasses('warning', 'sm')}>Inactive</span>
                    )}
                  </div>

                  <p className="font-semibold text-gray-900">{member.name}</p>
                  <p className="text-sm text-gray-700">{member.role}</p>
                  {member.email ? <p className="text-sm text-gray-700">{member.email}</p> : null}

                  <div className="mt-4">
                    {confirmDeleteId === member.id ? (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-gray-900 font-medium mb-2">Are you sure? This cannot be undone.</p>
                        {deleteError ? <p className="text-sm text-red-700 mb-2">{deleteError}</p> : null}
                        <div className="flex gap-2">
                          <button onClick={() => handleDeleteConfirm(member.id)} disabled={deleting} className={getButtonClasses('danger', 'sm')}>
                            {deleting ? 'Deleting…' : 'Yes, Delete'}
                          </button>
                          <button onClick={handleDeleteCancel} disabled={deleting} className={getButtonClasses('secondary', 'sm')}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => handleEditClick(member)} className={getButtonClasses('secondary', 'sm')}>
                          Edit
                        </button>
                        <button onClick={() => handleDeleteClick(member.id)} className={getButtonClasses('danger', 'sm')}>
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
