'use client';

// src/components/halveit/shared.tsx
// Bits shared by the Halve It pages: the season data hook, loading spinner,
// season picker and position cell.

import { useCallback, useEffect, useState } from 'react';
import type { HalveItSeasonData } from '@/types/halveit';
import { getInputClasses } from '@/config/theme-helpers';

/** Loads GET /api/halve-it with the given query (e.g. "season=2026", "player=ID"); null query = wait. */
export function useHalveItData(query: string | null) {
  const [data, setData] = useState<HalveItSeasonData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (query === null) return;
    try {
      const res = await fetch(`/api/halve-it${query ? `?${query}` : ''}`);
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

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return { data, error, loading, reload };
}

/** Reads ?season= from the current URL (avoids useSearchParams' Suspense requirement).
 *  null on the server, so nothing loads until the client knows the season. */
export function initialSeasonQuery(): string | null {
  if (typeof window === 'undefined') return null;
  const season = new URLSearchParams(window.location.search).get('season');
  return season ? `season=${encodeURIComponent(season)}` : '';
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
  const medal = position === 1 ? 'bg-yellow-100 text-yellow-800' : position === 2 ? 'bg-gray-200 text-gray-800' : position === 3 ? 'bg-orange-100 text-orange-800' : 'text-gray-600';
  return (
    <span className={`inline-flex items-center justify-center min-w-7 h-7 px-1 rounded-full text-xs font-semibold ${medal}`}>
      {position}{tied ? '=' : ''}
    </span>
  );
}

/** Whether a ranked row shares its position with another row. */
export function isTied<T>(rows: { position: number; item: T }[], index: number): boolean {
  const p = rows[index].position;
  return rows[index - 1]?.position === p || rows[index + 1]?.position === p;
}
