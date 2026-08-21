// app/fixtures/season-planning/reservations/page.tsx
// Season Planning — standing weekly rink reservations (league nights,
// Friday Night Drive, Greenkeepers morning, etc), plus one-off recurring
// bursts (e.g. a specific 6-week beginners course as a single row with its
// own dates, rather than several manual Events). Not season-scoped — this
// is a standing list, reused by whichever season's Friendlies capacity
// warnings are being viewed (see season-planning-capacity.ts).

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { hasRole } from '@/lib/role-utils';
import { getButtonClasses } from '@/config/theme-helpers';
import type { Reservation } from '@/lib/reservations-supabase';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toDateInputValue(dateStr: string | null): string {
  if (!dateStr) return '';
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) return `${ukMatch[3]}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;
  return '';
}

function ddmmToDisplay(ddmm: string): string {
  const [day, month] = ddmm.split('-');
  return `${day}/${month}`;
}

interface EditFields {
  name: string;
  weekday: number;
  time: string;
  rinksReserved: string;
  oneOff: boolean;
  startDate: string; // date input value
  endDate: string;
}

const BLANK_FIELDS: EditFields = { name: '', weekday: 1, time: '', rinksReserved: '', oneOff: false, startDate: '', endDate: '' };

export default function SeasonPlanningReservationsPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const role = session && session.user ? session.user.role : '';
  const isAdmin = hasRole(role, 'Admin');
  const isCaptain = hasRole(role, 'Captain');
  const canAccess = isAdmin || isCaptain;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [defaultWindow, setDefaultWindow] = useState({ start: '15-04', end: '30-09' });

  const [adding, setAdding] = useState(false);
  const [newFields, setNewFields] = useState<EditFields>(BLANK_FIELDS);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>(BLANK_FIELDS);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (session === null) { router.push('/'); return; }
    if (session && !canAccess) { router.push('/'); return; }
  }, [session, canAccess, router]);

  function loadReservations() {
    return fetch('/api/fixtures/season-planning/reservations')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setReservations(data.reservations || []);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (!canAccess) return;
    Promise.all([
      loadReservations(),
      fetch('/api/fixtures/season-planning/friendlies/capacity-config')
        .then((r) => r.json())
        .then((data) => {
          if (!data.error) setDefaultWindow({ start: data.reservationDefaultStart, end: data.reservationDefaultEnd });
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  function windowLabel(res: Reservation): string {
    if (res.startDate && res.endDate) return `${res.startDate} – ${res.endDate}`;
    return `Every season (${ddmmToDisplay(defaultWindow.start)} – ${ddmmToDisplay(defaultWindow.end)})`;
  }

  function fieldsToPayload(fields: EditFields) {
    return {
      name: fields.name,
      weekday: fields.weekday,
      time: fields.time,
      rinksReserved: parseInt(fields.rinksReserved, 10) || 0,
      startDate: fields.oneOff ? fields.startDate : null,
      endDate: fields.oneOff ? fields.endDate : null,
    };
  }

  function submitAdd() {
    setError(null);
    fetch('/api/fixtures/season-planning/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fieldsToPayload(newFields)),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAdding(false);
        setNewFields(BLANK_FIELDS);
        return loadReservations();
      })
      .catch((err) => setError(err.message));
  }

  function startEdit(res: Reservation) {
    setEditingId(res.id);
    setEditFields({
      name: res.name,
      weekday: res.weekday,
      time: res.time,
      rinksReserved: String(res.rinksReserved),
      oneOff: !!(res.startDate && res.endDate),
      startDate: toDateInputValue(res.startDate),
      endDate: toDateInputValue(res.endDate),
    });
  }

  function submitEdit() {
    if (!editingId) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/reservations/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fieldsToPayload(editFields)),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEditingId(null);
        return loadReservations();
      })
      .catch((err) => setError(err.message));
  }

  function submitDelete() {
    if (!deleteId) return;
    setError(null);
    fetch(`/api/fixtures/season-planning/reservations/${deleteId}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDeleteId(null);
        return loadReservations();
      })
      .catch((err) => setError(err.message));
  }

  if (!session || !canAccess) return null;

  const sortedReservations = [...reservations].sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));

  function renderFieldsForm(fields: EditFields, setFields: (f: EditFields) => void) {
    return (
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
          <input type="text" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
            value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Weekday</label>
          <select className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            value={fields.weekday} onChange={(e) => setFields({ ...fields, weekday: parseInt(e.target.value, 10) })}>
            {WEEKDAY_NAMES.map((name, idx) => <option key={idx} value={idx}>{name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Time</label>
          <input type="time" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            value={fields.time} onChange={(e) => setFields({ ...fields, time: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Rinks Reserved</label>
          <input type="number" min={0} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-24"
            value={fields.rinksReserved} onChange={(e) => setFields({ ...fields, rinksReserved: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 pb-1.5">
          <input type="checkbox" checked={fields.oneOff}
            onChange={(e) => setFields({ ...fields, oneOff: e.target.checked })} />
          One-off dates
        </label>
        {fields.oneOff && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Start date</label>
              <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                value={fields.startDate} onChange={(e) => setFields({ ...fields, startDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">End date</label>
              <input type="date" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                value={fields.endDate} onChange={(e) => setFields({ ...fields, endDate: e.target.value })} />
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Reservations</h1>
        <p className="text-sm text-gray-700 mb-4">
          Standing weekly rink commitments (league nights, Friday Night Drive, Greenkeepers morning, etc) that count against green capacity on Friendlies' same-day warnings. Evergreen reservations (no dates set) recur every season within the default window; a one-off (e.g. a specific beginners course) has its own explicit dates instead.
        </p>

        <div className="flex items-center justify-between mb-6 border-b border-gray-200 pb-2">
          <Link href="/fixtures/season-planning/friendlies" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            ← Friendlies
          </Link>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-700">Loading…</div>}

        {!loading && (
          <>
            <div className="flex justify-end mb-4">
              <button className={getButtonClasses('secondary')} onClick={() => setAdding(true)}>
                Add Reservation
              </button>
            </div>

            {adding && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h3 className="font-medium text-gray-900 mb-3 text-sm">New Reservation</h3>
                {renderFieldsForm(newFields, setNewFields)}
                <div className="flex gap-2 mt-3">
                  <button className={getButtonClasses('primary')} onClick={submitAdd}>Add</button>
                  <button className={getButtonClasses('secondary')} onClick={() => { setAdding(false); setNewFields(BLANK_FIELDS); }}>Cancel</button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
              {sortedReservations.length === 0 && (
                <div className="text-center py-12 text-gray-700 text-sm">
                  No reservations yet.
                </div>
              )}
              {sortedReservations.map((res) => (
                <div key={res.id} className="px-4 py-3">
                  {editingId === res.id ? (
                    <div>
                      {renderFieldsForm(editFields, setEditFields)}
                      <div className="flex gap-2 mt-3">
                        <button className={getButtonClasses('primary', 'sm')} onClick={submitEdit}>Save</button>
                        <button className={getButtonClasses('secondary', 'sm')} onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="w-24 text-sm text-gray-900">{WEEKDAY_NAMES[res.weekday]}</div>
                        <div className="w-16 text-sm text-gray-700">{res.time}</div>
                        <div className="text-sm text-gray-900 font-medium">{res.name}</div>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-800">
                          {res.rinksReserved} rink{res.rinksReserved === 1 ? '' : 's'}
                        </span>
                        <span className="text-xs text-gray-600">{windowLabel(res)}</span>
                      </div>
                      <div className="flex gap-2">
                        <button className="text-xs text-blue-600 hover:text-blue-800" onClick={() => startEdit(res)}>Edit</button>
                        <button className="text-xs text-red-600 hover:text-red-800" onClick={() => setDeleteId(res.id)}>Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="Delete this reservation?"
        message="This removes it from the standing list entirely. You can add it back manually later if needed."
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={submitDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
