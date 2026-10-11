'use client';

// src/components/halveit/shared.tsx
// Bits shared by the Halve It pages: the season data hook, member-options hook,
// loading spinner, season picker and position badge.

import { useCallback, useEffect, useState } from 'react';
import type { HalveItPlayer, HalveItSeasonData } from '@/types/halveit';
import { getInputClasses } from '@/config/theme-helpers';

/** Loads GET /api/halve-it with the given query (e.g. "season=2026", "player=ID"); null query = wait. */
export function useHalveItData(query: string | null) {
  const [data, setData] = useState<HalveItSeasonData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (query === null) return;
    let url = '/api/halve-it';
    if (query) url += `?${query}`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load Halve It');
        return;
      }
      setError('');
      setData(json);
    } catch {
      setError('Failed to load Halve It');
    } finally {
      setLoading(false);
    }
  }, [query]);

  // Runs on mount and whenever the query changes (e.g. a different season is picked)
  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return { data, error, loading, reload };
}

/** Loads the members who can be added to a team, once, for managers only. */
export function useMemberOptions(canManage: boolean) {
  const [members, setMembers] = useState<{ value: string; label: string }[]>([]);

  // Runs once the page knows the user can manage — the endpoint is Darts/Admin only
  useEffect(() => {
    if (!canManage) return;
    fetch('/api/halve-it/players')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && json.members) setMembers(json.members);
      })
      .catch(() => {});
  }, [canManage]);

  return members;
}

/** Reads ?season= from the current URL (avoids useSearchParams' Suspense requirement).
 *  null on the server, so nothing loads until the client knows the season. */
export function initialSeasonQuery(): string | null {
  if (typeof window === 'undefined') return null;
  const season = new URLSearchParams(window.location.search).get('season');
  if (!season) return '';
  return `season=${encodeURIComponent(season)}`;
}

/** Map of player id -> display name. */
export function playerNames(players: HalveItPlayer[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const p of players) names.set(p.id, p.name);
  return names;
}

/** Comma-separated names for a list of player ids. */
export function nameList(names: Map<string, string>, ids: string[]): string {
  const list: string[] = [];
  for (const id of ids) list.push(names.get(id) || 'Unknown');
  return list.join(', ');
}

export function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
    </div>
  );
}

export function SeasonPicker({ seasons, value, onChange }: { seasons: number[]; value: number; onChange: (season: number) => void }) {
  if (seasons.length < 2) return null;
  return (
    <select className={`${getInputClasses()} w-auto`} value={value} onChange={(e) => onChange(parseInt(e.target.value))}>
      {seasons.map((s) => <option key={s} value={s}>{s} season</option>)}
    </select>
  );
}

/** League position badge; tied positions show as e.g. "3=". */
export function Position({ position, tied = false }: { position: number; tied?: boolean }) {
  let colours = 'text-gray-900';
  if (position === 1) colours = 'bg-yellow-100 text-yellow-900';
  else if (position === 2) colours = 'bg-gray-200 text-gray-900';
  else if (position === 3) colours = 'bg-orange-100 text-orange-900';
  return (
    <span className={`inline-flex items-center justify-center min-w-7 h-7 px-1 rounded-full text-xs font-semibold ${colours}`}>
      {position}{tied ? '=' : ''}
    </span>
  );
}

/** Whether a ranked row shares its position with the row above or below. */
export function isTied<T>(rows: { position: number; item: T }[], index: number): boolean {
  const position = rows[index].position;
  if (index > 0 && rows[index - 1].position === position) return true;
  if (index < rows.length - 1 && rows[index + 1].position === position) return true;
  return false;
}
