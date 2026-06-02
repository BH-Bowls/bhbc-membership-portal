'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SearchableSelect } from '@/components/SearchableSelect';
import { getButtonClasses } from '@/config/theme-helpers';
import { hasRole } from '@/lib/role-utils';
import type { MarkerEntry } from '@/lib/markers-sheets';

interface MemberOption {
  value: string;
  label: string;
}

export default function MarkersPage() {
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';

  const [markers, setMarkers] = useState<MarkerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Add modal state
  const [addOpen, setAddOpen] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addIsWorker, setAddIsWorker] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<MarkerEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const role = session?.user?.role ?? '';
  const canEdit = hasRole(role, 'Captain', 'Admin');

  const fetchMarkers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/markers');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load markers');
        return;
      }
      setMarkers(data.markers || []);
    } catch {
      setError('Failed to load markers');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMemberOptions = useCallback(async () => {
    try {
      const res = await fetch('/api/members/lookup');
      const data = await res.json();
      if (data.members) {
        setMemberOptions(
          data.members.map((m: { userName: string; fullName: string }) => ({
            value: m.userName,
            label: m.fullName,
          }))
        );
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    fetchMarkers();
  }, [fetchMarkers]);

  function openAddModal() {
    setAddUsername('');
    setAddIsWorker(false);
    setAddError(null);
    setAddOpen(true);
    if (memberOptions.length === 0) fetchMemberOptions();
  }

  async function handleAdd() {
    if (!addUsername) {
      setAddError('Please select a member');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch('/api/markers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: addUsername, isWorker: addIsWorker }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || 'Failed to add marker');
        return;
      }
      setAddOpen(false);
      await fetchMarkers();
    } catch {
      setAddError('Failed to add marker');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/markers/${deleteTarget.rowNumber}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to delete marker');
        return;
      }
      setDeleteTarget(null);
      await fetchMarkers();
    } catch {
      setError('Failed to delete marker');
    } finally {
      setDeleting(false);
    }
  }

  const filtered = markers.filter(m => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      (m.fullName ?? m.name).toLowerCase().includes(term) ||
      m.name.toLowerCase().includes(term)
    );
  });

  function displayName(m: MarkerEntry) {
    return m.fullName ?? m.name;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
        showLogoOnly={isGuest}
      />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Markers</h1>
            <p className="text-gray-600 mt-1">Club members available to mark games</p>
          </div>
          {canEdit && (
            <button onClick={openAddModal} className={getButtonClasses('primary', 'md')}>
              Add Marker
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Search */}
        {!loading && markers.length > 0 && (
          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <p className="mt-2 text-gray-600">Loading markers…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-600">{markers.length === 0 ? 'No markers added yet.' : 'No results match your search.'}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Mobile</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Landline</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Email</th>
                    {canEdit && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filtered.map(m => (
                    <tr key={m.rowNumber} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          {displayName(m)}
                          {m.isWorker && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200">
                              Daytime Worker
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {m.mobile ? (
                          <a href={`tel:${m.mobile}`} className="text-blue-600 hover:underline">{m.mobile}</a>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {m.landline ? (
                          <a href={`tel:${m.landline}`} className="text-blue-600 hover:underline">{m.landline}</a>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {m.emailAddress ? (
                          <a href={`mailto:${m.emailAddress}`} className="text-blue-600 hover:underline truncate block max-w-[200px]">{m.emailAddress}</a>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setDeleteTarget(m)}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filtered.map(m => (
                <div key={m.rowNumber} className="bg-white rounded-lg shadow border border-gray-200 p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-gray-900">{displayName(m)}</div>
                      {m.isWorker && (
                        <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200">
                          Daytime Worker
                        </span>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => setDeleteTarget(m)}
                        className="text-red-500 hover:text-red-700 text-sm ml-2 shrink-0"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="mt-3 space-y-1 text-sm">
                    {m.mobile && (
                      <div className="flex gap-2">
                        <span className="text-gray-500 w-20">Mobile:</span>
                        <a href={`tel:${m.mobile}`} className="text-blue-600 hover:underline">{m.mobile}</a>
                      </div>
                    )}
                    {m.landline && (
                      <div className="flex gap-2">
                        <span className="text-gray-500 w-20">Landline:</span>
                        <a href={`tel:${m.landline}`} className="text-blue-600 hover:underline">{m.landline}</a>
                      </div>
                    )}
                    {m.emailAddress && (
                      <div className="flex gap-2">
                        <span className="text-gray-500 w-20">Email:</span>
                        <a href={`mailto:${m.emailAddress}`} className="text-blue-600 hover:underline break-all">{m.emailAddress}</a>
                      </div>
                    )}
                    {!m.mobile && !m.landline && !m.emailAddress && (
                      <p className="text-gray-400 italic">No contact details on record</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-3 text-xs text-gray-400">
              {filtered.length} marker{filtered.length !== 1 ? 's' : ''} shown
            </p>
          </>
        )}
      </div>

      {/* Add Marker modal */}
      <ConfirmDialog
        isOpen={addOpen}
        title="Add Marker"
        message="Select a member to add to the markers list."
        confirmLabel={adding ? 'Adding…' : 'Add'}
        onConfirm={handleAdd}
        onCancel={() => setAddOpen(false)}
        confirmDisabled={!addUsername || adding}
      >
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Member</label>
            <SearchableSelect
              options={memberOptions}
              value={addUsername}
              onChange={setAddUsername}
              placeholder="Search by name…"
              autoFocus
            />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={addIsWorker}
              onChange={e => setAddIsWorker(e.target.checked)}
              className="h-4 w-4 text-blue-600 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">
              Daytime worker <span className="text-gray-500">(usually unavailable to mark day games)</span>
            </span>
          </label>
          {addError && <p className="text-sm text-red-600">{addError}</p>}
        </div>
      </ConfirmDialog>

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Remove Marker"
        message={`Remove ${deleteTarget ? displayName(deleteTarget) : ''} from the markers list?`}
        confirmLabel={deleting ? 'Removing…' : 'Remove'}
        confirmVariant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        confirmDisabled={deleting}
      />
    </div>
  );
}
