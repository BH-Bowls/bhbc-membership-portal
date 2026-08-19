// src/components/SeasonPlanningCalendar.tsx
// "Calendar" button + popup, shared across every Season Planning screen
// (Events, Friendlies, Clubs list, Club Info). Shows the draft season's
// Friendlies month-by-month, a count badge per day, and a hover tooltip
// listing that day's fixtures (same style as the Club Info page's Clash
// badge). Deliberately does NOT refetch every time it's opened — the data
// is cached in sessionStorage (survives navigating between the 4 pages
// within the same tab, cleared when the tab closes) and only ever
// refreshed by the explicit Refresh button, since draft fixtures don't
// change from moment to moment the way live data might.

'use client';

import { useState } from 'react';

interface CalendarFixture {
  date: string; // DD/MM/YYYY
  clubName: string;
  description: string;
  homeAway: 'H' | 'A' | '';
  ladiesMen: string;
  format: string;
  planningStatus: string;
}

// Same three colours as the status badges on the Friendlies list itself.
const STATUS_BADGE_CLASSES: Record<string, string> = {
  Projected: 'bg-amber-100 text-amber-800',
  'Email Sent': 'bg-emerald-100 text-emerald-800',
  Confirmed: 'bg-green-100 text-green-800',
};
const STATUS_ORDER = ['Projected', 'Email Sent', 'Confirmed'];

interface CalendarSeason {
  year: number;
  startDate: string; // DD/MM/YYYY
  endDate: string;
}

interface CalendarCache {
  season: CalendarSeason | null;
  fixtures: CalendarFixture[];
  cachedAt: number;
}

const CACHE_KEY = 'season-planning-calendar-cache';
const MONTH_KEY = 'season-planning-calendar-month'; // last-viewed month, so close+reopen resumes where you left off
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseUKDate(dateStr: string): Date | null {
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthFromKey(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

/** Earliest fixture's month — the sensible first-open default, since the season's own start month (e.g. January) often has no fixtures at all. */
function earliestFixtureMonth(fixtures: CalendarFixture[]): Date | null {
  let earliest: Date | null = null;
  for (const f of fixtures) {
    const d = parseUKDate(f.date);
    if (d && (!earliest || d < earliest)) earliest = d;
  }
  return earliest ? new Date(earliest.getFullYear(), earliest.getMonth(), 1) : null;
}

function fixtureLabel(f: CalendarFixture): string {
  const who = f.clubName || f.description || 'Unknown';
  const parts = [who, f.homeAway === 'A' ? 'Away' : 'Home'];
  if (f.ladiesMen && f.ladiesMen !== 'Mixed') parts.push(f.ladiesMen);
  if (f.format) parts.push(f.format);
  return parts.join(', ');
}

/** e.g. "Confirmed games\n- Rottingdean, Home, 4 Triples" — one status's fixtures, for that status's own badge tooltip. */
function statusTooltip(status: string, statusFixtures: CalendarFixture[]): string {
  const header = `${status} games`;
  return [header, ...statusFixtures.map((f) => `- ${fixtureLabel(f)}`)].join('\n');
}

export function SeasonPlanningCalendar() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<CalendarSeason | null>(null);
  const [fixtures, setFixtures] = useState<CalendarFixture[]>([]);
  const [displayedMonth, setDisplayedMonth] = useState<Date | null>(null);

  function readCache(): CalendarCache | null {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeCache(data: CalendarCache) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      // sessionStorage unavailable (private browsing etc.) — fine, just won't persist across pages
    }
  }

  /**
   * Sets the initial month to show, in priority order: a month the user
   * already navigated to this session (sessionStorage, so close+reopen —
   * even on a different page — resumes there) > the earliest fixture's
   * month (the useful default, since the season's own start month is
   * usually empty) > the season's start month as a last resort. Never
   * overwrites a month already set for this component instance — so
   * clicking Refresh, or reopening within the same page visit, doesn't
   * yank the view back to the default.
   */
  function initMonthIfNeeded(data: { season: CalendarSeason | null; fixtures: CalendarFixture[] }) {
    setDisplayedMonth((prev) => {
      if (prev) return prev;
      const savedKey = (() => { try { return sessionStorage.getItem(MONTH_KEY); } catch { return null; } })();
      if (savedKey) return monthFromKey(savedKey);
      const earliest = earliestFixtureMonth(data.fixtures);
      if (earliest) return earliest;
      if (data.season) {
        const start = parseUKDate(data.season.startDate);
        if (start) return new Date(start.getFullYear(), start.getMonth(), 1);
      }
      return prev;
    });
  }

  function applyData(data: { season: CalendarSeason | null; fixtures: CalendarFixture[] }) {
    setSeason(data.season);
    setFixtures(data.fixtures);
    initMonthIfNeeded(data);
  }

  function fetchFresh() {
    setLoading(true);
    setError(null);
    fetch('/api/fixtures/season-planning/friendlies/calendar')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        applyData(data);
        writeCache({ season: data.season, fixtures: data.fixtures, cachedAt: Date.now() });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function open() {
    setIsOpen(true);
    const cached = readCache();
    if (cached) {
      applyData(cached);
    } else {
      fetchFresh();
    }
  }

  function shiftMonth(delta: number) {
    setDisplayedMonth((prev) => {
      const base = prev || new Date();
      const next = new Date(base.getFullYear(), base.getMonth() + delta, 1);
      try { sessionStorage.setItem(MONTH_KEY, monthKey(next)); } catch { /* private browsing etc. — just won't persist */ }
      return next;
    });
  }

  const fixturesByDate: Record<string, CalendarFixture[]> = {};
  for (const f of fixtures) {
    if (!fixturesByDate[f.date]) fixturesByDate[f.date] = [];
    fixturesByDate[f.date].push(f);
  }

  const grid: (Date | null)[] = [];
  if (displayedMonth) {
    const year = displayedMonth.getFullYear();
    const month = displayedMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < firstWeekday; i++) grid.push(null);
    for (let d = 1; d <= daysInMonth; d++) grid.push(new Date(year, month, d));
  }

  return (
    <>
      <button
        onClick={open}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
      >
        Calendar
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Season Planning Calendar{season ? ` — ${season.year}` : ''}
                </h2>
                <div className="flex items-center gap-3">
                  <button onClick={fetchFresh} disabled={loading} className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50">
                    {loading ? 'Refreshing…' : 'Refresh'}
                  </button>
                  <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
                </div>
              </div>

              {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

              {!season && !loading && !error && (
                <p className="text-sm text-gray-700 text-center py-8">No draft season yet — create it from the Events tab first.</p>
              )}

              {season && displayedMonth && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <button onClick={() => shiftMonth(-1)} className="px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded">‹</button>
                    <div className="text-sm font-medium text-gray-900">
                      {MONTH_NAMES[displayedMonth.getMonth()]} {displayedMonth.getFullYear()}
                    </div>
                    <button onClick={() => shiftMonth(1)} className="px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded">›</button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-700 mb-1">
                    {DAY_HEADERS.map((d) => <div key={d}>{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {grid.map((date, i) => {
                      if (!date) return <div key={i} className="h-16" />;
                      const dateKey = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
                      const dayFixtures = fixturesByDate[dateKey] || [];
                      const byStatus: Record<string, CalendarFixture[]> = {};
                      for (const f of dayFixtures) {
                        const status = f.planningStatus || 'Projected';
                        if (!byStatus[status]) byStatus[status] = [];
                        byStatus[status].push(f);
                      }
                      return (
                        <div key={i} className="h-16 border border-gray-100 rounded-md p-1 flex flex-col items-start">
                          <span className="text-xs text-gray-700">{date.getDate()}</span>
                          {dayFixtures.length > 0 && (
                            <div className="mt-auto self-center flex flex-wrap gap-0.5 justify-center">
                              {STATUS_ORDER.filter((status) => byStatus[status] && byStatus[status].length > 0).map((status) => (
                                <span
                                  key={status}
                                  title={statusTooltip(status, byStatus[status])}
                                  className={`text-xs font-medium px-1.5 py-0.5 rounded-full cursor-help ${STATUS_BADGE_CLASSES[status]}`}
                                >
                                  {byStatus[status].length}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
