// app/availability/groups/[groupId]/heatmap/page.tsx
// Read-only group availability heatmap — no poll/event required. Creator/Admin only.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getAlertClasses } from '@/config/theme-helpers';

interface HeatmapCell {
  free: number;
  busy: number;
  unknown: number;
}
interface HeatmapRow {
  date: string;
  cells: { morning: HeatmapCell; afternoon: HeatmapCell; evening: HeatmapCell };
}

const SESSIONS: { key: 'morning' | 'afternoon' | 'evening'; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
];

function heatColor(cell: HeatmapCell, totalMembers: number): string {
  if (totalMembers === 0) return 'bg-gray-50 text-gray-400';
  const freeRatio = cell.free / totalMembers;
  if (freeRatio >= 0.7) return 'bg-green-100 text-green-800';
  if (freeRatio >= 0.4) return 'bg-yellow-50 text-yellow-800';
  if (cell.free > 0) return 'bg-orange-50 text-orange-800';
  return 'bg-gray-50 text-gray-500';
}

export default function GroupHeatmapPage() {
  const params = useParams();
  const groupId = params.groupId as string;
  const { data: authSession } = useSession();

  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHeatmap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/availability/groups/${groupId}/heatmap`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load heatmap');
        return;
      }
      setRows(data.rows || []);
      setTotalMembers(data.totalMembers || 0);
    } catch {
      setError('Failed to load heatmap');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchHeatmap();
  }, [fetchHeatmap]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={authSession?.user?.name ?? undefined}
        userRole={authSession?.user?.role ?? undefined}
      />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Availability Heatmap</h1>
            <p className="text-gray-700 mt-1 text-sm">
              {totalMembers} member{totalMembers !== 1 ? 's' : ''} — how many are free per session, next 4 weeks.
              Based on each member&apos;s standard week and exceptions; blank means nobody has said yet.
            </p>
          </div>
          <Link href={`/availability/groups/${groupId}`} className="text-sm text-blue-600 hover:text-blue-800">
            &larr; Back to group
          </Link>
        </div>

        {error && <div className={getAlertClasses('danger')}>{error}</div>}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <p className="mt-2 text-gray-700">Loading...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-700">No data to show.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Date</th>
                    {SESSIONS.map((s) => (
                      <th key={s.key} className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => (
                    <tr key={row.date}>
                      <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">{row.date}</td>
                      {SESSIONS.map((s) => {
                        const cell = row.cells[s.key];
                        return (
                          <td key={s.key} className="px-1 py-1">
                            <div className={`rounded px-2 py-1.5 text-center text-xs font-medium ${heatColor(cell, totalMembers)}`}>
                              {cell.free} free
                              {cell.busy > 0 && <span className="block text-[10px] opacity-75">{cell.busy} busy</span>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
