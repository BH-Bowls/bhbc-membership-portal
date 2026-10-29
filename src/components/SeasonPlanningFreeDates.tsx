// src/components/SeasonPlanningFreeDates.tsx
// "Free Dates" button + popup, mounted alongside the Calendar button on every
// Season Planning screen. Lists the draft season's free afternoons month by
// month as comma-separated text ("May: Sat 2, Sun 3, Wed 6"), with a Copy
// button per month and a Copy all, for pasting straight into an outreach
// email. A date is busy if ANY fixture (Friendly/Event/League, any status,
// Home or Away) starts before AFTERNOON_CUTOFF that day — evening fixtures
// don't block it, since Friendlies are played in the afternoon. A fixture
// with no time set counts as busy, to be safe. Reservations are ignored —
// they're standing rink bookings, not fixtures. Unlike the Calendar, this
// refetches every time it's opened (one small query), so it never shows a
// stale list after editing fixtures; the weekday/month filters are
// remembered per browser.

'use client';

import { useState } from 'react';

interface FreeDatesFixture {
  date: string; // DD/MM/YYYY
  time: string; // HH:MM, or '' when not set
}

interface FreeDatesSeason {
  year: number;
  startDate: string; // DD/MM/YYYY
  endDate: string;
}

interface FreeDatesFilters {
  weekdays: number[]; // 0=Sun..6=Sat
  fromMonth: string | null; // YYYY-MM, null = season start
  toMonth: string | null; // YYYY-MM, null = season end
}

const AFTERNOON_CUTOFF = '17:00';
const FILTERS_KEY = 'season-planning-free-dates-filters';
const DEFAULT_WEEKDAYS = [0, 2, 3, 4, 5, 6]; // Mondays off by default, matching the Friendlies page's Monday warning
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first for the tick boxes
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseUKDate(dateStr: string): Date | null {
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function toUKDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function blocksAfternoon(f: FreeDatesFixture): boolean {
  return !f.time || f.time < AFTERNOON_CUTOFF;
}

function readFilters(): FreeDatesFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        weekdays: Array.isArray(parsed.weekdays) ? parsed.weekdays : DEFAULT_WEEKDAYS,
        fromMonth: parsed.fromMonth || null,
        toMonth: parsed.toMonth || null,
      };
    }
  } catch {
    // localStorage unavailable (private browsing etc.) — fall back to defaults
  }
  return { weekdays: DEFAULT_WEEKDAYS, fromMonth: null, toMonth: null };
}

function writeFilters(filters: FreeDatesFilters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // just won't be remembered
  }
}

interface MonthFreeDates {
  key: string; // YYYY-MM
  label: string; // "May"
  days: string[]; // ["Sat 2", "Sun 3"]
}

/** Every month of the season, each with its free afternoons on the chosen weekdays. */
function computeFreeDates(season: FreeDatesSeason, fixtures: FreeDatesFixture[], weekdays: number[]): MonthFreeDates[] {
  const start = parseUKDate(season.startDate);
  const end = parseUKDate(season.endDate);
  if (!start || !end) return [];

  const busy = new Set(fixtures.filter(blocksAfternoon).map((f) => f.date));
  const months: MonthFreeDates[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = monthKey(d);
    let month = months[months.length - 1];
    if (!month || month.key !== key) {
      month = { key, label: MONTH_NAMES[d.getMonth()], days: [] };
      months.push(month);
    }
    if (weekdays.includes(d.getDay()) && !busy.has(toUKDate(d))) {
      month.days.push(`${DAY_NAMES[d.getDay()]} ${d.getDate()}`);
    }
  }
  return months;
}

function monthLine(m: MonthFreeDates): string {
  return `${m.label}: ${m.days.length > 0 ? m.days.join(', ') : 'none'}`;
}

export function SeasonPlanningFreeDates() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<FreeDatesSeason | null>(null);
  const [fixtures, setFixtures] = useState<FreeDatesFixture[]>([]);
  const [filters, setFilters] = useState<FreeDatesFilters>({ weekdays: DEFAULT_WEEKDAYS, fromMonth: null, toMonth: null });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function open() {
    setIsOpen(true);
    setFilters(readFilters());
    setLoading(true);
    setError(null);
    fetch('/api/fixtures/season-planning/free-dates')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSeason(data.season);
        setFixtures(data.fixtures || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function updateFilters(next: FreeDatesFilters) {
    setFilters(next);
    writeFilters(next);
  }

  function toggleWeekday(day: number) {
    const weekdays = filters.weekdays.includes(day)
      ? filters.weekdays.filter((d) => d !== day)
      : [...filters.weekdays, day];
    updateFilters({ ...filters, weekdays });
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
    }).catch(() => setError('Could not copy to the clipboard'));
  }

  const allMonths = season ? computeFreeDates(season, fixtures, filters.weekdays) : [];
  // A remembered month from a previous season won't be in this one's range — fall back to the full season.
  const fromKey = filters.fromMonth && allMonths.some((m) => m.key === filters.fromMonth) ? filters.fromMonth : allMonths[0]?.key;
  const toKey = filters.toMonth && allMonths.some((m) => m.key === filters.toMonth) ? filters.toMonth : allMonths[allMonths.length - 1]?.key;
  const shownMonths = allMonths.filter((m) => fromKey && toKey && m.key >= fromKey && m.key <= toKey);
  const allText = shownMonths.map(monthLine).join('\n');

  return (
    <>
      <button
        onClick={open}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
      >
        Free Dates
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold text-gray-900">
                  Free Dates{season ? ` — ${season.year}` : ''}
                </h2>
                <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>
              <p className="text-xs text-gray-700 mb-4">
                Afternoons with no fixture of any kind (Friendlies, Events or Leagues, any status, Home or Away).
                Fixtures starting at {AFTERNOON_CUTOFF} or later don&apos;t count.
              </p>

              {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

              {loading && <p className="text-sm text-gray-700 text-center py-8">Loading…</p>}

              {!season && !loading && !error && (
                <p className="text-sm text-gray-700 text-center py-8">No draft season yet — create it from the Events tab first.</p>
              )}

              {season && !loading && (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    {WEEKDAY_ORDER.map((day) => (
                      <label key={day} className="flex items-center gap-1 text-sm text-gray-700">
                        <input type="checkbox" checked={filters.weekdays.includes(day)} onChange={() => toggleWeekday(day)} />
                        {DAY_NAMES[day]}
                      </label>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mb-4 text-sm text-gray-700">
                    <span>From</span>
                    <select
                      value={fromKey || ''}
                      onChange={(e) => updateFilters({ ...filters, fromMonth: e.target.value })}
                      className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                    >
                      {allMonths.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                    <span>to</span>
                    <select
                      value={toKey || ''}
                      onChange={(e) => updateFilters({ ...filters, toMonth: e.target.value })}
                      className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                    >
                      {allMonths.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                    <button
                      onClick={() => copy(allText, 'all')}
                      disabled={shownMonths.length === 0}
                      className="ml-auto px-3 py-1 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {copiedKey === 'all' ? 'Copied' : 'Copy all'}
                    </button>
                  </div>

                  {shownMonths.length === 0 ? (
                    <p className="text-sm text-gray-700 text-center py-4">No months in range.</p>
                  ) : (
                    <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                      {shownMonths.map((m) => (
                        <div key={m.key} className="flex items-start gap-3 p-3">
                          <div className="flex-1 text-sm text-gray-900">
                            <span className="font-medium">{m.label}:</span>{' '}
                            {m.days.length > 0 ? m.days.join(', ') : <span className="text-gray-500">none</span>}
                          </div>
                          <button
                            onClick={() => copy(monthLine(m), m.key)}
                            className="text-sm text-blue-600 hover:text-blue-800 shrink-0"
                          >
                            {copiedKey === m.key ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
