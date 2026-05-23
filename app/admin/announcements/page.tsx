// app/admin/announcements/page.tsx
// Admin page for creating, editing, and deleting home page announcements.
// Access: Admin, Captain, GMC. Route protected in middleware.ts.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses, getBadgeClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import type { Announcement } from '@/types/diary';

// Format an ISO datetime string into a human-readable expiry string
// e.g. "Fri 23 May 2026 at 11:59pm"
function formatExpiry(isoString: string): string {
  // Parse the ISO string — safe because it was written by the app, not from Sheets
  const date = new Date(isoString);

  // Guard against invalid dates
  if (isNaN(date.getTime())) {
    return isoString;
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = days[date.getDay()];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  // 12-hour time with am/pm
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  if (hours > 12) {
    hours = hours - 12;
  }
  if (hours === 0) {
    hours = 12;
  }
  const minuteStr = minutes < 10 ? '0' + minutes : String(minutes);

  return `${dayName} ${day} ${month} ${year} at ${hours}:${minuteStr}${ampm}`;
}

// Format an ISO datetime string to a local date value for <input type="date">
function isoToDateInput(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  // YYYY-MM-DD format required by <input type="date">
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Format an ISO datetime string to a local time value for <input type="time">
function isoToTimeInput(isoString: string): string {
  if (!isoString) return '23:59';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '23:59';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Build an ISO string from a date input and an optional time input
// Defaults to 23:59:00 local time if timeStr is blank
function buildExpiresAt(dateStr: string, timeStr: string): string {
  // Use 23:59 as default time when the user leaves the time field blank
  const resolvedTime = timeStr.trim() === '' ? '23:59:00' : timeStr + ':00';
  const combined = dateStr + 'T' + resolvedTime;
  return new Date(combined).toISOString();
}

export default function ManageAnnouncementsPage() {
  // Session for navbar and username
  const { data: session } = useSession();

  // Full list of announcements (active + expired)
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  // Loading state for initial fetch
  const [loading, setLoading] = useState(true);

  // Page-level error (load failure)
  const [loadError, setLoadError] = useState<string | null>(null);

  // ─── New/Edit form state ──────────────────────────────────────────────────────

  // Whether the inline form is visible
  const [showForm, setShowForm] = useState(false);

  // The announcement being edited (null = new)
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form field values
  const [formMessage, setFormMessage] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('23:59');

  // Form-level validation/API error
  const [formError, setFormError] = useState<string | null>(null);

  // Whether a save request is in flight
  const [saving, setSaving] = useState(false);

  // ─── Delete confirmation state ────────────────────────────────────────────────

  // The ID of the announcement the user has clicked Delete on (null = none)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Whether a delete request is in flight
  const [deleting, setDeleting] = useState(false);

  // Delete error message
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Load all announcements from the admin API on mount
  useEffect(() => {
    loadAnnouncements();
  }, []);

  // Fetch the full list including expired from the admin endpoint
  const loadAnnouncements = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Admin endpoint returns all announcements (active and expired)
      const res = await fetch('/api/admin/announcements');
      if (!res.ok) {
        setLoadError('Failed to load announcements. Please refresh the page.');
        return;
      }
      const json = await res.json();
      setAnnouncements(json.announcements || []);
    } catch {
      // Network error
      setLoadError('Failed to load announcements. Please check your connection.');
    } finally {
      // Clear loading state regardless of outcome
      setLoading(false);
    }
  };

  // Open the inline form for creating a new announcement
  const handleNewClick = () => {
    // Reset all form fields and clear any previous error
    setEditingId(null);
    setFormMessage('');
    setFormDate('');
    setFormTime('23:59');
    setFormError(null);
    // Show the form
    setShowForm(true);
  };

  // Open the inline form pre-populated with an existing announcement's values
  const handleEditClick = (announcement: Announcement) => {
    // Populate form fields from the existing announcement
    setEditingId(announcement.id);
    setFormMessage(announcement.message);
    setFormDate(isoToDateInput(announcement.expiresAt));
    setFormTime(isoToTimeInput(announcement.expiresAt));
    setFormError(null);
    // Show the form
    setShowForm(true);
  };

  // Cancel the form without saving
  const handleFormCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormMessage('');
    setFormDate('');
    setFormTime('23:59');
    setFormError(null);
  };

  // Save (create or update) the announcement
  const handleFormSave = async () => {
    setFormError(null);

    // Client-side validation — message must not be empty
    if (formMessage.trim() === '') {
      setFormError('Message is required.');
      return;
    }

    // Client-side validation — date must be selected
    if (formDate.trim() === '') {
      setFormError('Expiry date is required.');
      return;
    }

    // Build the ISO expiry datetime
    const expiresAt = buildExpiresAt(formDate, formTime);

    // Confirm the expiry is in the future before calling the API
    if (new Date(expiresAt) <= new Date()) {
      setFormError('The expiry date and time must be in the future.');
      return;
    }

    setSaving(true);
    try {
      let res: Response;

      // Choose POST (create) or PATCH (update) based on whether we are editing
      if (editingId) {
        // Update existing announcement
        res = await fetch(`/api/admin/announcements/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: formMessage.trim(), expiresAt }),
        });
      } else {
        // Create new announcement
        res = await fetch('/api/admin/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: formMessage.trim(), expiresAt }),
        });
      }

      if (!res.ok) {
        const json = await res.json();
        setFormError(json.error || 'Failed to save announcement.');
        return;
      }

      // Success — close the form and reload the list
      setShowForm(false);
      setEditingId(null);
      setFormMessage('');
      setFormDate('');
      setFormTime('23:59');
      await loadAnnouncements();
    } catch {
      setFormError('Failed to save announcement. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Show the inline delete confirmation for a given announcement
  const handleDeleteClick = (id: string) => {
    // Set the ID to confirm — the card will render the confirmation prompt
    setConfirmDeleteId(id);
    setDeleteError(null);
  };

  // Cancel the delete confirmation
  const handleDeleteCancel = () => {
    setConfirmDeleteId(null);
    setDeleteError(null);
  };

  // Execute the delete after confirmation
  const handleDeleteConfirm = async (id: string) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      // Call the DELETE endpoint for this announcement
      const res = await fetch(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setDeleteError(json.error || 'Failed to delete announcement.');
        return;
      }

      // Success — dismiss confirmation and reload the list
      setConfirmDeleteId(null);
      await loadAnnouncements();
    } catch {
      setDeleteError('Failed to delete announcement. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  // Convert null to undefined — Navbar expects string | undefined, not null
  const userName = session && session.user && session.user.name ? session.user.name : undefined;
  const userRole = session && session.user ? session.user.role : undefined;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={userName} userRole={userRole} />

      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Back link */}
          <div className="mb-4">
            <a
              href="/"
              className="text-sm text-blue-500 hover:text-blue-600 font-medium"
            >
              ← Back to Home
            </a>
          </div>

          {/* Page heading */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Manage Announcements</h1>
            {/* New Announcement button — hidden while the form is already open */}
            {!showForm ? (
              <button
                onClick={handleNewClick}
                className={getButtonClasses('primary', 'md')}
              >
                New Announcement
              </button>
            ) : null}
          </div>

          {/* Page-level load error */}
          {loadError ? (
            <div className={getAlertClasses('danger') + ' mb-4'}>
              {loadError}
            </div>
          ) : null}

          {/* ── Inline form for new / edit ── */}
          {showForm ? (
            <div className="bg-white shadow rounded-lg p-6 mb-6 text-gray-900">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {editingId ? 'Edit Announcement' : 'New Announcement'}
              </h2>

              {/* Message textarea */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message <span className="text-red-600">*</span>
                </label>
                <textarea
                  className={getInputClasses(!!formError && formMessage.trim() === '') + ' min-h-[100px]'}
                  value={formMessage}
                  onChange={(e) => {
                    // Update message field and clear any existing form error
                    setFormMessage(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="Enter announcement text…"
                  rows={4}
                />
              </div>

              {/* Date and time row */}
              <div className="flex gap-4 mb-4">
                {/* Expiry date */}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expires on <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="date"
                    className={getInputClasses(!!formError && formDate.trim() === '')}
                    value={formDate}
                    onChange={(e) => {
                      // Update date and clear form error
                      setFormDate(e.target.value);
                      setFormError(null);
                    }}
                  />
                </div>

                {/* Expiry time — optional, defaults to 23:59 */}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expires at <span className="text-gray-700 font-normal">(optional — defaults to 11:59pm)</span>
                  </label>
                  <input
                    type="time"
                    className={getInputClasses()}
                    value={formTime}
                    onChange={(e) => {
                      // Update time field
                      setFormTime(e.target.value);
                      setFormError(null);
                    }}
                  />
                </div>
              </div>

              {/* Form-level validation error */}
              {formError ? (
                <div className={getAlertClasses('danger') + ' mb-4 text-sm'}>
                  {formError}
                </div>
              ) : null}

              {/* Form action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleFormSave}
                  disabled={saving}
                  className={getButtonClasses('primary', 'md')}
                >
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Announcement'}
                </button>
                <button
                  onClick={handleFormCancel}
                  disabled={saving}
                  className={getButtonClasses('secondary', 'md')}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {/* ── Announcement list ── */}
          {loading ? (
            // Loading state
            <div className="text-sm text-gray-700 py-4">Loading announcements…</div>
          ) : announcements.length === 0 ? (
            // Empty state
            <div className="text-sm text-gray-700 py-4">No announcements yet.</div>
          ) : (
            // Announcement cards — active first (sorted by createdAt desc from API)
            <div className="space-y-4">
              {announcements.map((announcement) => (
                <div
                  key={announcement.id}
                  className={`bg-white shadow rounded-lg p-5 text-gray-900 ${announcement.isExpired ? 'opacity-60' : ''}`}
                >
                  {/* Card header — status badge */}
                  <div className="flex items-center gap-2 mb-2">
                    {announcement.isExpired ? (
                      <span className={getBadgeClasses('warning', 'sm')}>Expired</span>
                    ) : (
                      <span className={getBadgeClasses('success', 'sm')}>Active</span>
                    )}
                  </div>

                  {/* Message body */}
                  <p className="text-sm text-gray-900 mb-2 whitespace-pre-wrap">{announcement.message}</p>

                  {/* Metadata */}
                  <div className="text-xs text-gray-700 space-y-0.5 mb-4">
                    <p>Expires: {formatExpiry(announcement.expiresAt)}</p>
                    <p>Created by {announcement.createdBy} on {announcement.createdAt ? new Date(announcement.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</p>
                    {announcement.updatedBy ? (
                      <p>Last edited by {announcement.updatedBy}</p>
                    ) : null}
                  </div>

                  {/* Action buttons or delete confirmation */}
                  {confirmDeleteId === announcement.id ? (
                    // Inline delete confirmation — no window.confirm()
                    <div className="bg-red-50 border border-red-200 rounded-md p-3">
                      <p className="text-sm text-gray-900 font-medium mb-2">
                        Are you sure? This cannot be undone.
                      </p>
                      {/* Show delete error inline */}
                      {deleteError ? (
                        <p className="text-sm text-red-700 mb-2">{deleteError}</p>
                      ) : null}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDeleteConfirm(announcement.id)}
                          disabled={deleting}
                          className={getButtonClasses('danger', 'sm')}
                        >
                          {deleting ? 'Deleting…' : 'Yes, Delete'}
                        </button>
                        <button
                          onClick={handleDeleteCancel}
                          disabled={deleting}
                          className={getButtonClasses('secondary', 'sm')}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Normal action buttons
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditClick(announcement)}
                        className={getButtonClasses('secondary', 'sm')}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteClick(announcement.id)}
                        className={getButtonClasses('danger', 'sm')}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
