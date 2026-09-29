'use client';

// app/admin/lockers/page.tsx
// Locker Register — the master record of every locker, its key(s) and who has it
// (Admin only). The only place a member's locker can be changed; profiles show it
// read-only. Locker labels on /labels print from here.

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { hasRole } from '@/lib/role-utils';
import { getButtonClasses, getInputClasses, getCardClasses, getBadgeClasses } from '@/config/theme-helpers';
import { SearchableSelect } from '@/components/SearchableSelect';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LOCKER_ROOMS, LOCKER_STATUS_LABELS } from '@/types/lockers';
import type { LockerInput, LockerRoom, LockerStatus, LockerWithMember } from '@/types/lockers';

type RoomFilter = 'all' | LockerRoom;
type StatusFilter = 'all' | LockerStatus;

const STATUS_BADGE: Record<LockerStatus, 'primary' | 'secondary' | 'success' | 'warning'> = {
  member: 'success',
  club: 'primary',
  occupied: 'warning',
  empty: 'secondary',
};

interface EditState {
  id: string | null; // null = adding
  room: LockerRoom;
  lockerNumber: string;
  keyNumber: string;
  keysCount: string; // '' = unknown
  status: LockerStatus;
  userName: string;
  notes: string;
}

export default function LockerRegisterPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [lockers, setLockers] = useState<LockerWithMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [memberOptions, setMemberOptions] = useState<{ value: string; label: string }[]>([]);

  const [roomFilter, setRoomFilter] = useState<RoomFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isAdmin = !!session && hasRole(session.user?.role, 'Admin');

  useEffect(() => {
    if (status === 'loading') return;
    if (!isAdmin) router.push('/');
  }, [status, isAdmin, router]);

  const loadLockers = () =>
    fetch('/api/admin/lockers')
      .then((r) => r.json())
      .then((data) => {
        if (data.lockers) setLockers(data.lockers);
        else setLoadError(data.error || 'Failed to load lockers');
      })
      .catch(() => setLoadError('Failed to load lockers'))
      .finally(() => setLoading(false));

  useEffect(() => {
    if (!isAdmin) return;
    loadLockers();
    fetch('/api/admin/members')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && Array.isArray(json.members)) {
          setMemberOptions(
            json.members
              .filter((m: any) => m.memberType) // skip shared accounts (Kiosk/Captain)
              .map((m: any) => ({ value: m.userName, label: `${m.knownAs || m.firstName} ${m.lastName}` }))
              .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label))
          );
        }
      })
      .catch(() => {});
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return lockers.filter((l) => {
      if (roomFilter !== 'all' && l.room !== roomFilter) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (!term) return true;
      return [l.memberName, l.keyNumber, l.notes, String(l.lockerNumber)].some((v) => v && v.toLowerCase().includes(term));
    });
  }, [lockers, roomFilter, statusFilter, search]);

  const counts = useMemo(() => {
    const result: Record<string, Record<LockerStatus, number>> = {};
    for (const room of LOCKER_ROOMS) result[room] = { member: 0, club: 0, occupied: 0, empty: 0 };
    for (const l of lockers) result[l.room][l.status]++;
    return result;
  }, [lockers]);

  function openAdd() {
    const room: LockerRoom = roomFilter === 'all' ? 'Mens' : roomFilter;
    const next = lockers.filter((l) => l.room === room).reduce((max, l) => Math.max(max, l.lockerNumber), 0) + 1;
    setEdit({ id: null, room, lockerNumber: String(next), keyNumber: '', keysCount: '', status: 'empty', userName: '', notes: '' });
    setSaveError('');
  }

  function openEdit(l: LockerWithMember) {
    setEdit({
      id: l.id,
      room: l.room,
      lockerNumber: String(l.lockerNumber),
      keyNumber: l.keyNumber || '',
      keysCount: l.keysCount === null ? '' : String(l.keysCount),
      status: l.status,
      userName: l.userName || '',
      notes: l.notes || '',
    });
    setSaveError('');
  }

  async function save() {
    if (!edit) return;
    const locker: LockerInput = {
      room: edit.room,
      lockerNumber: parseInt(edit.lockerNumber),
      keyNumber: edit.keyNumber,
      keysCount: edit.keysCount.trim() === '' ? null : parseInt(edit.keysCount),
      status: edit.status,
      userName: edit.status === 'empty' ? null : edit.userName || null,
      notes: edit.notes,
    };
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(edit.id ? `/api/admin/lockers/${edit.id}` : '/api/admin/lockers', {
        method: edit.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locker }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || 'Failed to save locker');
        return;
      }
      setEdit(null);
      await loadLockers();
    } catch {
      setSaveError('Failed to save locker');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!edit || !edit.id) return;
    setConfirmDelete(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/lockers/${edit.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || 'Failed to delete locker');
        return;
      }
      setEdit(null);
      await loadLockers();
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading' || (isAdmin && loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }
  if (!isAdmin) return null;

  // Leavers keep their allocation until it's changed, so the option list needs them too
  const allocatedLeaverOptions = lockers
    .filter((l) => l.userName && !l.memberActive && !memberOptions.some((o) => o.value === l.userName))
    .map((l) => ({ value: l.userName as string, label: `${l.memberName || l.userName} (leaver)` }));
  const selectOptions = [...memberOptions, ...allocatedLeaverOptions.filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i)];

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-6xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Locker Register</h1>
            <p className="text-sm text-gray-500">The master record of lockers and keys. Members see their locker read-only on their profile.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/labels" className={getButtonClasses('secondary', 'md')}>Print locker labels</Link>
            <button onClick={openAdd} className={getButtonClasses('primary', 'md')}>Add locker</button>
          </div>
        </div>

        {loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {/* Summary per room */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {LOCKER_ROOMS.map((room) => (
            <div key={room} className={getCardClasses('sm')}>
              <div className="text-sm font-medium text-gray-900 mb-2">{room}</div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(LOCKER_STATUS_LABELS) as LockerStatus[]).map((s) => (
                  <span key={s} className={getBadgeClasses(STATUS_BADGE[s], 'md')}>
                    {LOCKER_STATUS_LABELS[s]}: {counts[room][s]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className={`${getCardClasses('sm')} flex flex-wrap items-center gap-3`}>
          <select className={`${getInputClasses()} w-auto`} value={roomFilter} onChange={(e) => setRoomFilter(e.target.value as RoomFilter)}>
            <option value="all">All rooms</option>
            {LOCKER_ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className={`${getInputClasses()} w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">All statuses</option>
            {(Object.keys(LOCKER_STATUS_LABELS) as LockerStatus[]).map((s) => <option key={s} value={s}>{LOCKER_STATUS_LABELS[s]}</option>)}
          </select>
          <input
            type="text"
            placeholder="Search name, key, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${getInputClasses()} flex-1 min-w-[12rem]`}
          />
          <span className="text-xs text-gray-500">{filtered.length} locker{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Register */}
        <div className="bg-white shadow rounded-lg overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2">Room</th>
                <th className="px-3 py-2">No.</th>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Keys</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Member</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-700">{l.room}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900">{l.lockerNumber}</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{l.keyNumber || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{l.keysCount === null ? '?' : l.keysCount}</td>
                  <td className="px-3 py-2">
                    <span className={getBadgeClasses(STATUS_BADGE[l.status], 'sm')}>{LOCKER_STATUS_LABELS[l.status]}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-900">
                    {l.memberName || <span className="text-gray-400">—</span>}
                    {l.userName && !l.memberActive && <span className={`${getBadgeClasses('danger', 'sm')} ml-2`}>Leaver</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{l.notes}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(l)} className="text-blue-600 hover:text-blue-800 text-sm font-medium">Edit</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No lockers match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Add / edit dialog */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setEdit(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900">{edit.id ? `Edit ${edit.room} locker ${edit.lockerNumber}` : 'Add locker'}</h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Room</label>
                <select className={getInputClasses()} value={edit.room} onChange={(e) => setEdit({ ...edit, room: e.target.value as LockerRoom })}>
                  {LOCKER_ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Locker number</label>
                <input type="number" min={1} className={getInputClasses()} value={edit.lockerNumber} onChange={(e) => setEdit({ ...edit, lockerNumber: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Key number</label>
                <input type="text" className={getInputClasses()} value={edit.keyNumber} onChange={(e) => setEdit({ ...edit, keyNumber: e.target.value })} placeholder="e.g. ZA 0412" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">No. of keys</label>
                <input type="number" min={0} className={getInputClasses()} value={edit.keysCount} onChange={(e) => setEdit({ ...edit, keysCount: e.target.value })} placeholder="Unknown" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                className={getInputClasses()}
                value={edit.status}
                onChange={(e) => {
                  const s = e.target.value as LockerStatus;
                  setEdit({ ...edit, status: s, userName: s === 'empty' ? '' : edit.userName });
                }}
              >
                {(Object.keys(LOCKER_STATUS_LABELS) as LockerStatus[]).map((s) => <option key={s} value={s}>{LOCKER_STATUS_LABELS[s]}</option>)}
              </select>
            </div>

            {edit.status !== 'empty' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Allocated to{edit.status === 'member' ? '' : ' (optional)'}
                </label>
                <div className="flex gap-2 items-center">
                  <SearchableSelect
                    options={selectOptions}
                    value={edit.userName}
                    onChange={(v) => setEdit({ ...edit, userName: v })}
                    placeholder="Search members…"
                    className="flex-1"
                  />
                  {edit.userName && edit.status !== 'member' && (
                    <button type="button" onClick={() => setEdit({ ...edit, userName: '' })} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea rows={2} className={getInputClasses()} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </div>

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}

            <div className="flex items-center justify-between pt-2">
              {edit.id ? (
                <button onClick={() => setConfirmDelete(true)} disabled={saving} className={getButtonClasses('danger', 'sm')}>Delete</button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={() => setEdit(null)} disabled={saving} className={getButtonClasses('secondary', 'md')}>Cancel</button>
                <button onClick={save} disabled={saving} className={getButtonClasses('primary', 'md')}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete locker?"
        message={edit ? `Remove ${edit.room} locker ${edit.lockerNumber} from the register? This can't be undone.` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
