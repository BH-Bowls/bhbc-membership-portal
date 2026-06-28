'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { hasRole } from '@/lib/role-utils';

interface Entry { number: string; member: string; username: string; season: string; }
interface Settings { season: string; draws: number; price: number; numbers: number; amounts: number[]; }
interface Member { username: string; name: string; }
const MAX_PRIZES = 10;
const DEFAULT_NUMBERS = 200;
interface Winner { season: string; date: string; position: number; number: string; member: string; amount: number; }
interface Data { season: string; seasons: string[]; settings: Settings | null; entries: Entry[]; winners: Winner[]; members: Member[]; }

const gbp = (n: number) => `£${Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
const ordinal = (p: number) => (p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : `${p}th`);

// A native <input type="date"> gives YYYY-MM-DD; store it as the friendly "10 May 2026".
// Built from numeric parts (never new Date(string), which mis-parses UK dates).
function friendlyDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const y = Number(parts[0]); const mo = Number(parts[1]); const d = Number(parts[2]);
  if (!y || !mo || !d) return iso;
  return new Date(y, mo - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function TwoHundredClubPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || '';
  const canManage = hasRole(role, 'GMC', 'Admin');

  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<'none' | 'season' | 'draw'>('none');
  const [draftSettings, setDraftSettings] = useState<Settings | null>(null);

  const load = useCallback(async (s?: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/200-club${s ? `?season=${encodeURIComponent(s)}` : ''}`);
      const d = await res.json();
      if (res.ok) setData(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const entries = data?.entries ?? [];
  const settings = data?.settings ?? null;

  // While "Set season prizes" is open, reflect its draft values live in the banner.
  const effSettings = (panel === 'season' && draftSettings) ? draftSettings : settings;

  // Derived figures. The pool size is the "Numbers available" setting; the page
  // renders 1..total, merged with whoever holds each number (the entries tab).
  const total = effSettings?.numbers ?? DEFAULT_NUMBERS;     // size of the pool
  const sold = entries.filter(e => e.member.trim()).length;  // numbers with a holder = paid for
  const price = effSettings?.price ?? 6;
  const draws = effSettings?.draws ?? 6;
  const prizesPerDraw = effSettings ? effSettings.amounts.reduce((a, b) => a + b, 0) : 0;
  const takings = sold * price;
  const totalPrizes = prizesPerDraw * draws;
  const remaining = takings - totalPrizes;

  // The full pool, 1..total, each with its holder (or blank = unallocated). Any entry
  // whose number falls outside 1..total is appended so nothing is hidden.
  const poolNumbers = useMemo(() => {
    const byNumber = new Map(entries.map(e => [e.number, e]));
    const list: { number: string; member: string; username: string }[] = [];
    for (let i = 1; i <= total; i++) {
      const key = String(i);
      const e = byNumber.get(key);
      list.push({ number: key, member: e ? e.member.trim() : '', username: e ? e.username : '' });
    }
    for (const e of entries) {
      if (!byNumber.has(e.number)) continue;
      const inRange = Number(e.number) >= 1 && Number(e.number) <= total && String(Number(e.number)) === e.number;
      if (!inRange) list.push({ number: e.number, member: e.member.trim(), username: e.username });
    }
    return list;
  }, [entries, total]);

  // Winners grouped by draw date (most recent first)
  const draws_grouped = useMemo(() => {
    const map = new Map<string, Winner[]>();
    for (const w of data?.winners ?? []) {
      if (!map.has(w.date)) map.set(w.date, []);
      map.get(w.date)!.push(w);
    }
    return Array.from(map.entries())
      .map(([date, ws]) => ({ date, winners: ws.sort((a, b) => a.position - b.position) }))
      .reverse();
  }, [data?.winners]);

  const filteredNumbers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return poolNumbers;
    return poolNumbers.filter(e => e.number.toLowerCase().includes(q) || e.member.toLowerCase().includes(q));
  }, [poolNumbers, search]);

  // GMC/Admin: edit who holds a number.
  const [editingNumber, setEditingNumber] = useState<string | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);

  const assign = useCallback(async (number: string, username: string) => {
    if (!data) return;
    setAssignSaving(true);
    try {
      const res = await fetch('/api/200-club/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season: data.season, number, username }),
      });
      if (res.ok) {
        // Optimistic update so the list doesn't flash a full reload.
        setData(prev => {
          if (!prev) return prev;
          const found = prev.members.find(m => m.username === username);
          const name = username ? (found ? found.name : username) : '';
          const others = prev.entries.filter(e => e.number !== number);
          return { ...prev, entries: [...others, { number, member: name, username, season: prev.season }] };
        });
        setEditingNumber(null);
      }
    } finally {
      setAssignSaving(false);
    }
  }, [data]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">200 Club</h1>
          {data && data.seasons.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              Season
              <select
                value={data.season}
                onChange={(e) => load(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-green-600 focus:outline-none"
              >
                {data.seasons.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
        </div>

        {loading ? (
          <p className="text-gray-600">Loading…</p>
        ) : !data ? (
          <p className="text-gray-600">Could not load the 200 Club.</p>
        ) : (
          <>
            {/* Summary banner */}
            <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              {effSettings ? (
                <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-5">
                  <Stat label="Numbers" value={String(total)} sub={`${sold} sold`} />
                  <Stat label="Takings" value={gbp(takings)} sub={`${sold} × ${gbp(price)}`} />
                  <Stat label="Prizes / draw" value={gbp(prizesPerDraw)} sub={effSettings.amounts.map(a => gbp(a)).join(' / ')} />
                  <Stat label={`Prizes · ${draws} draws`} value={gbp(totalPrizes)} />
                  <Stat label="Remaining" value={gbp(remaining)} highlight />
                </div>
              ) : (
                <p className="text-sm text-gray-600">
                  No prize settings for {data.season || 'this season'} yet.
                  {canManage ? ' Use “Set season” to add them.' : ''}
                </p>
              )}
            </div>

            {/* GMC/Admin controls */}
            {canManage && (
              <div className="mb-6 flex flex-wrap gap-3">
                <button onClick={() => setPanel(panel === 'season' ? 'none' : 'season')} className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
                  Set season prizes
                </button>
                <button onClick={() => setPanel(panel === 'draw' ? 'none' : 'draw')} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
                  Record a draw
                </button>
              </div>
            )}

            {canManage && panel === 'season' && (
              <SeasonForm season={data.season} settings={settings} onChange={setDraftSettings} onDone={() => { setPanel('none'); setDraftSettings(null); load(data.season); }} />
            )}
            {canManage && panel === 'draw' && (
              <DrawForm season={data.season} numPrizes={settings?.amounts.length ?? 3} entries={entries} onDone={() => { setPanel('none'); load(data.season); }} />
            )}

            {/* Winners */}
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-gray-900">Winners</h2>
              {draws_grouped.length === 0 ? (
                <p className="text-sm text-gray-600">No draws recorded yet for {data.season || 'this season'}.</p>
              ) : (
                <div className="space-y-3">
                  {draws_grouped.map(({ date, winners }) => (
                    <div key={date} className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                      <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-800">{date}</div>
                      <table className="w-full text-sm">
                        <tbody>
                          {winners.map((w, i) => (
                            <tr key={i} className="border-b border-gray-50 last:border-0">
                              <td className="px-4 py-2 font-medium text-gray-700 w-16">{ordinal(w.position)}</td>
                              <td className="px-4 py-2 w-16 text-gray-500">No. {w.number}</td>
                              <td className="px-4 py-2 text-gray-900">{w.member || <span className="text-gray-400">—</span>}</td>
                              <td className="px-4 py-2 text-right font-semibold text-green-700">{gbp(w.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Entries */}
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-gray-900">Numbers ({total} · {sold} sold)</h2>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search number or member…"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-green-600 focus:outline-none"
                />
              </div>
              {filteredNumbers.length === 0 ? (
                <p className="text-sm text-gray-700">No numbers{search ? ' match your search' : ''}.</p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-700">
                        <th className="px-4 py-2 font-medium w-20">Number</th>
                        <th className="px-4 py-2 font-medium">Member</th>
                        {canManage && <th className="px-4 py-2 font-medium w-44 text-right">Manage</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredNumbers.map((e) => {
                        const allocated = !!e.member;
                        const editing = editingNumber === e.number;
                        return (
                          <tr key={e.number} className={`border-b border-gray-50 last:border-0 ${allocated ? '' : 'bg-amber-50'}`}>
                            <td className="px-4 py-2 font-medium text-gray-700 align-top">{e.number}</td>
                            <td className="px-4 py-2 text-gray-900 align-top">
                              {editing ? (
                                <MemberPicker
                                  members={data.members}
                                  saving={assignSaving}
                                  onPick={(username) => assign(e.number, username)}
                                  onCancel={() => setEditingNumber(null)}
                                />
                              ) : (
                                allocated ? e.member : <span className="text-amber-700">unallocated</span>
                              )}
                            </td>
                            {canManage && (
                              <td className="px-4 py-2 text-right align-top whitespace-nowrap">
                                {!editing && (
                                  <>
                                    <button onClick={() => setEditingNumber(e.number)} className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                                      {allocated ? 'Edit' : 'Assign'}
                                    </button>
                                    {allocated && (
                                      <button onClick={() => assign(e.number, '')} disabled={assignSaving} className="ml-1 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                                        Clear
                                      </button>
                                    )}
                                  </>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div>
      <div className={`text-lg font-bold ${highlight ? 'text-green-700' : 'text-gray-900'}`}>{value}</div>
      <div className="text-xs font-medium text-gray-700">{label}</div>
      {sub && <div className="text-[11px] text-gray-600">{sub}</div>}
    </div>
  );
}

// Searchable member dropdown for assigning a number's holder.
function MemberPicker({ members, saving, onPick, onCancel }: { members: Member[]; saving: boolean; onPick: (username: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = query ? members.filter(m => m.name.toLowerCase().includes(query)) : members;
    return base.slice(0, 8);
  }, [q, members]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search member…"
          disabled={saving}
          className="w-48 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-green-600 focus:outline-none disabled:opacity-50"
        />
        <button type="button" onClick={onCancel} className="text-xs font-medium text-gray-700 hover:underline">Cancel</button>
      </div>
      {matches.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-56 w-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {matches.map(m => (
            <button
              key={m.username}
              type="button"
              onClick={() => onPick(m.username)}
              disabled={saving}
              className="block w-full px-3 py-1.5 text-left text-sm text-gray-900 hover:bg-green-50 disabled:opacity-50"
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SeasonForm({ season, settings, onChange, onDone }: { season: string; settings: Settings | null; onChange: (s: Settings) => void; onDone: () => void }) {
  const [meta, setMeta] = useState({
    season: season || new Date().getFullYear().toString(),
    draws: String(settings?.draws ?? 6),
    price: String(settings?.price ?? 6),
    numbers: String(settings?.numbers ?? DEFAULT_NUMBERS),
  });
  const [amounts, setAmounts] = useState<string[]>(
    (settings?.amounts && settings.amounts.length > 0 ? settings.amounts : [0, 0, 0]).map(String)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Feed draft values up so the banner rolls the totals live as you type.
  useEffect(() => {
    onChange({
      season: meta.season,
      draws: Number(meta.draws) || 0,
      price: Number(meta.price) || 0,
      numbers: Number(meta.numbers) || DEFAULT_NUMBERS,
      amounts: amounts.map(a => Number(a) || 0),
    });
  }, [meta, amounts, onChange]);

  function setPrizeCount(n: number) {
    const count = Math.max(1, Math.min(MAX_PRIZES, n || 1));
    setAmounts(prev => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push('0');
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/200-club/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season: meta.season,
          draws: Number(meta.draws),
          price: Number(meta.price),
          numbers: Number(meta.numbers),
          amounts: amounts.map(a => Number(a) || 0),
        }),
      });
      const d = await res.json();
      if (res.ok) onDone(); else setError(d.error || 'Failed to save');
    } catch { setError('Failed to save'); } finally { setSaving(false); }
  }

  const metaField = (key: keyof typeof meta, label: string, prefix?: string) => (
    <label className="flex flex-col text-sm text-gray-700">
      {label}
      <div className="flex items-center">
        {prefix && <span className="mr-1 text-gray-500">{prefix}</span>}
        <input
          value={meta[key]}
          onChange={(e) => setMeta({ ...meta, [key]: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 focus:border-green-600 focus:outline-none"
        />
      </div>
    </label>
  );

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 font-semibold text-gray-900">Season prizes</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metaField('season', 'Season')}
        {metaField('draws', 'Draws')}
        {metaField('price', 'Price per number', '£')}
        {metaField('numbers', 'Numbers available')}
        <label className="flex flex-col text-sm text-gray-700">
          Number of prizes
          <input
            type="number" min={1} max={MAX_PRIZES} value={amounts.length}
            onChange={(e) => setPrizeCount(parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 focus:border-green-600 focus:outline-none"
          />
        </label>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {amounts.map((amt, i) => (
          <label key={i} className="flex flex-col text-sm text-gray-700">
            {ordinal(i + 1)} prize
            <div className="flex items-center">
              <span className="mr-1 text-gray-500">£</span>
              <input
                value={amt}
                onChange={(e) => setAmounts(amounts.map((a, j) => (j === i ? e.target.value : a)))}
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 focus:border-green-600 focus:outline-none"
              />
            </div>
          </label>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
      </div>
    </form>
  );
}

function DrawForm({ season, numPrizes, entries, onDone }: { season: string; numPrizes: number; entries: Entry[]; onDone: () => void }) {
  const positions = Array.from({ length: Math.max(1, numPrizes) }, (_, i) => i + 1);
  const [date, setDate] = useState('');
  const [numbers, setNumbers] = useState<{ [pos: number]: string }>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const valueAt = (pos: number) => numbers[pos] ?? '';
  const memberFor = (num: string) => entries.find(e => e.number === num.trim())?.member || '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const picks = positions.map(pos => ({ position: pos, number: valueAt(pos) })).filter(p => p.number.trim());
      const res = await fetch('/api/200-club/draw', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ season, date: friendlyDate(date), picks }),
      });
      const d = await res.json();
      if (res.ok) onDone(); else setError(d.error || 'Failed to record draw');
    } catch { setError('Failed to record draw'); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 font-semibold text-gray-900">Record a draw — {season}</h3>
      <label className="mb-3 flex flex-col text-sm text-gray-700 sm:w-56">
        Draw date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-gray-900 focus:border-green-600 focus:outline-none" />
      </label>
      <div className="space-y-2">
        {positions.map(pos => (
          <div key={pos} className="flex items-center gap-3">
            <span className="w-10 text-sm font-medium text-gray-700">{ordinal(pos)}</span>
            <input
              value={valueAt(pos)}
              onChange={(e) => setNumbers({ ...numbers, [pos]: e.target.value })}
              placeholder="Number"
              className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-green-600 focus:outline-none"
            />
            <span className="text-sm text-gray-600">
              {valueAt(pos).trim() ? (memberFor(valueAt(pos)) || <span className="text-amber-600">number not found</span>) : ''}
            </span>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={saving || !date.trim()} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Record draw'}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
      </div>
    </form>
  );
}
