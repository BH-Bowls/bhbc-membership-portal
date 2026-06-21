// app/admin/members/email-inclusion/page.tsx
// Bulk manage the `include` (Y/N) flag that controls renewal/member email
// recipients. Filter by name or a curated column, tick/untick the filtered view,
// then save changes in one batch. Admin only (middleware.ts).

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses, getInputClasses, getCardClasses } from '@/config/theme-helpers';

// A member with the fields the inclusion filters need.
interface Member {
  userName: string;
  firstName: string;
  lastName: string;
  memberType: string;
  yearStarted: number | null;
  include: string;
  ageDemographic: string;
  honorary: string;
  role: string;
  gmc: string;
}

// Curated columns the admin can filter on.
const FILTER_COLUMNS = [
  { key: 'yearStarted', label: 'Year Started' },
  { key: 'memberType', label: 'Member Type' },
  { key: 'ageDemographic', label: 'Age Demographic' },
  { key: 'honorary', label: 'Honorary' },
  { key: 'role', label: 'Role' },
  { key: 'gmc', label: 'GMC' },
  { key: 'include', label: 'Include' },
];

// Get a member's value for a given filter column, as a string.
function fieldValue(m: Member, key: string): string {
  if (key === 'yearStarted') return m.yearStarted !== null ? String(m.yearStarted) : '';
  if (key === 'memberType') return m.memberType || '';
  if (key === 'ageDemographic') return m.ageDemographic || '';
  if (key === 'honorary') return m.honorary || '';
  if (key === 'role') return m.role || '';
  if (key === 'gmc') return m.gmc || '';
  if (key === 'include') return m.include || '';
  return '';
}

export default function EmailInclusionPage() {
  const { data: session } = useSession();

  const [members, setMembers] = useState<Member[] | null>(null);
  // userName -> currently ticked (include = Y)
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  // Snapshot of the saved state, to diff against
  const [original, setOriginal] = useState<Record<string, boolean>>({});

  const [search, setSearch] = useState('');
  const [filterColumn, setFilterColumn] = useState('');
  const [filterValue, setFilterValue] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Load all members and seed the tick state from their current include flag
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/admin/members');
        if (!res.ok) {
          setError('Failed to load members.');
          setMembers([]);
          return;
        }
        const json = await res.json();
        const list: Member[] = json.members || [];
        const state: Record<string, boolean> = {};
        for (let i = 0; i < list.length; i++) {
          state[list[i].userName] = list[i].include === 'Y';
        }
        setMembers(list);
        setIncluded(state);
        setOriginal({ ...state });
      } catch {
        setError('Failed to load members.');
        setMembers([]);
      }
    };
    load();
  }, []);

  // Apply the name + column filters
  const searchLower = search.trim().toLowerCase();
  const filterValueLower = filterValue.trim().toLowerCase();
  const filtered: Member[] = [];
  if (members) {
    for (let i = 0; i < members.length; i++) {
      const m = members[i];

      // Name filter
      const fullName = `${m.firstName} ${m.lastName}`.toLowerCase();
      if (searchLower !== '' && !fullName.includes(searchLower)) {
        continue;
      }

      // Column filter (only when both a column and a value are chosen)
      if (filterColumn !== '' && filterValueLower !== '') {
        const value = fieldValue(m, filterColumn).toLowerCase();
        // Role is multi-value (comma-separated) so use contains; others exact match
        const matches = filterColumn === 'role' ? value.includes(filterValueLower) : value === filterValueLower;
        if (!matches) {
          continue;
        }
      }

      filtered.push(m);
    }
  }

  // Toggle one member
  const toggle = (userName: string) => {
    setIncluded((prev) => ({ ...prev, [userName]: !prev[userName] }));
  };

  // Set every member in the filtered view to a value
  const setFilteredTo = (value: boolean) => {
    setIncluded((prev) => {
      const next = { ...prev };
      for (let i = 0; i < filtered.length; i++) {
        next[filtered[i].userName] = value;
      }
      return next;
    });
  };

  // Count included / unsaved changes
  let includedCount = 0;
  let changeCount = 0;
  if (members) {
    for (let i = 0; i < members.length; i++) {
      const name = members[i].userName;
      if (included[name]) includedCount++;
      if (included[name] !== original[name]) changeCount++;
    }
  }

  // Save the changed rows
  const save = async () => {
    if (!members || changeCount === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    // Build the changed entries only
    const updates: { userName: string; include: string }[] = [];
    for (let i = 0; i < members.length; i++) {
      const name = members[i].userName;
      if (included[name] !== original[name]) {
        updates.push({ userName: name, include: included[name] ? 'Y' : 'N' });
      }
    }

    try {
      const res = await fetch('/api/admin/members/bulk-include', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to save changes.');
        setSaving(false);
        return;
      }
      // The saved state becomes the new baseline
      setOriginal({ ...included });
      setNotice(`Saved — ${json.updated} member${json.updated === 1 ? '' : 's'} updated.`);
      setSaving(false);
    } catch {
      setError('Failed to save changes.');
      setSaving(false);
    }
  };

  const navName = session && session.user && session.user.name ? session.user.name : undefined;
  const navRole = session && session.user ? session.user.role : undefined;

  // Value control for the chosen filter column (enum columns get a dropdown)
  const valueControl = () => {
    if (filterColumn === 'memberType') {
      return (
        <select className={getInputClasses()} value={filterValue} onChange={(e) => setFilterValue(e.target.value)}>
          <option value="">—</option>
          <option>Playing Lady</option>
          <option>Social Lady</option>
          <option>Playing Man</option>
          <option>Social Man</option>
        </select>
      );
    }
    if (filterColumn === 'ageDemographic') {
      return (
        <select className={getInputClasses()} value={filterValue} onChange={(e) => setFilterValue(e.target.value)}>
          <option value="">—</option>
          <option>U18</option>
          <option>18-24</option>
          <option>25-59</option>
          <option>60+</option>
          <option>80+</option>
        </select>
      );
    }
    if (filterColumn === 'honorary' || filterColumn === 'include') {
      return (
        <select className={getInputClasses()} value={filterValue} onChange={(e) => setFilterValue(e.target.value)}>
          <option value="">—</option>
          <option value="Y">Y</option>
          <option value="N">N</option>
        </select>
      );
    }
    if (filterColumn === 'gmc') {
      return (
        <select className={getInputClasses()} value={filterValue} onChange={(e) => setFilterValue(e.target.value)}>
          <option value="">—</option>
          <option value="GMC">GMC</option>
        </select>
      );
    }
    // yearStarted, role — free text
    return (
      <input
        type="text"
        className={getInputClasses()}
        placeholder={filterColumn === 'yearStarted' ? 'e.g. 2026' : 'value'}
        value={filterValue}
        onChange={(e) => setFilterValue(e.target.value)}
      />
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={navName} userRole={navRole} />

      <main className="max-w-3xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <Link href="/admin/members/list" className="text-sm text-gray-700 mb-2 inline-block hover:text-gray-900">← Back to members</Link>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Email Inclusion</h1>
        <p className="text-sm text-gray-700 mb-4">
          Set which members are included in renewal / member emails. Filter, tick or untick the filtered list, then save.
        </p>

        {error ? (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">{notice}</div>
        ) : null}

        {/* Filters */}
        <div className={`${getCardClasses('md')} mb-4`}>
          <input
            type="text"
            placeholder="Search by name…"
            className={`${getInputClasses()} mb-3`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Filter column</label>
              <select className={getInputClasses()} value={filterColumn} onChange={(e) => { setFilterColumn(e.target.value); setFilterValue(''); }}>
                <option value="">— none —</option>
                {FILTER_COLUMNS.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
              {filterColumn === '' ? (
                <input type="text" className={getInputClasses()} value="" disabled placeholder="choose a column first" />
              ) : valueControl()}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-sm text-gray-700">
            {members === null ? 'Loading…' : `${includedCount} of ${members.length} included · ${changeCount} unsaved change${changeCount === 1 ? '' : 's'}`}
          </p>
          <div className="flex gap-2">
            <button className={getButtonClasses('secondary', 'sm')} onClick={() => setFilteredTo(true)} disabled={!members}>
              Tick filtered
            </button>
            <button className={getButtonClasses('secondary', 'sm')} onClick={() => setFilteredTo(false)} disabled={!members}>
              Untick filtered
            </button>
            <button className={getButtonClasses('primary', 'sm')} onClick={save} disabled={saving || changeCount === 0}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Member checkbox list */}
        <div className={`${getCardClasses('md')}`}>
          {members === null ? (
            <p className="text-sm text-gray-700">Loading members…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-700">No members match the current filter.</p>
          ) : (
            <div>
              {filtered.map((m) => (
                <label key={m.userName} className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-b-0 cursor-pointer">
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-gray-900">{m.firstName} {m.lastName}</span>
                    <span className="block text-xs text-gray-700">
                      {m.memberType}{m.yearStarted ? ` · ${m.yearStarted}` : ''}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="flex-shrink-0 h-4 w-4"
                    checked={included[m.userName] === true}
                    onChange={() => toggle(m.userName)}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
