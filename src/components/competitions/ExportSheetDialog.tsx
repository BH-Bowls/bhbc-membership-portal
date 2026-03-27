// src/components/competitions/ExportSheetDialog.tsx
// Dialog for configuring and triggering a Google Sheet bracket export.

'use client';

import { useState } from 'react';
import type { Competition } from '@/types/competitions';
import { defaultConfig, type SheetExportConfig } from '@/lib/sheet-export-config';

interface ExportSheetDialogProps {
  competition: Competition;
  onClose: () => void;
}

export function ExportSheetDialog({ competition, onClose }: ExportSheetDialogProps) {
  const compType = competition.compType;
  const isPairsOrTriples = compType !== 'singles';

  const [config, setConfig] = useState<SheetExportConfig>(() => defaultConfig(compType));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ sheetUrl: string; sheetTitle: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof SheetExportConfig>(key: K, value: SheetExportConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  async function handleExport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/competitions/${competition.compId}/export-sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.detail || 'Export failed');
      setResult({ sheetUrl: data.sheetUrl, sheetTitle: data.sheetTitle });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Export Bracket to Google Sheet</h2>
          <p className="text-xs text-gray-500 mt-0.5">{competition.displayName}</p>
        </div>

        {result ? (
          /* ── Success state ── */
          <div className="px-6 py-6 space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
              <p className="font-semibold mb-1">Sheet created successfully</p>
              <p className="text-green-700 break-all">Tab name: <span className="font-mono">{result.sheetTitle}</span></p>
            </div>
            <a
              href={result.sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Open Spreadsheet →
            </a>
            <button
              onClick={onClose}
              className="block w-full text-center px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        ) : (
          /* ── Config form ── */
          <div className="px-6 py-4 space-y-4">

            {/* Rows per slot */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Rows per slot
                <span className="ml-1 text-gray-400 font-normal">(controls vertical spacing)</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={config.rowsPerSlot}
                onChange={e => update('rowsPerSlot', parseInt(e.target.value) || config.rowsPerSlot)}
                className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>

            {/* Column widths */}
            <div className="flex gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Match column width (px)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={config.matchColWidthPx}
                  onChange={e => update('matchColWidthPx', parseInt(e.target.value) || config.matchColWidthPx)}
                  className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Connector width (px, 0 = hide)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={config.connectorColWidthPx}
                  onChange={e => update('connectorColWidthPx', parseInt(e.target.value) || 0)}
                  className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>
            </div>

            {/* Pairs / Triples name format */}
            {isPairsOrTriples && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name format</label>
                <div className="flex gap-3">
                  {(['one-line', 'separate-rows'] as const).map(opt => (
                    <label key={opt} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="nameFormat"
                        value={opt}
                        checked={config.nameFormat === opt}
                        onChange={() => update('nameFormat', opt)}
                      />
                      {opt === 'one-line'
                        ? `All names on one line (e.g. Smith + Jones)`
                        : `One row per player`}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Name fit */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Long name handling</label>
              <div className="flex gap-3">
                {(['wrap', 'truncate'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="nameFit"
                      value={opt}
                      checked={config.nameFit === opt}
                      onChange={() => update('nameFit', opt)}
                    />
                    {opt === 'wrap' ? 'Wrap to next line' : 'Truncate (clip)'}
                  </label>
                ))}
              </div>
            </div>

            {/* Line width */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Line width
                <span className="ml-1 text-gray-400 font-normal">(boxes and connectors)</span>
              </label>
              <div className="flex gap-3">
                {(['SOLID', 'SOLID_MEDIUM', 'SOLID_THICK'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="lineStyle"
                      value={opt}
                      checked={config.lineStyle === opt}
                      onChange={() => update('lineStyle', opt)}
                    />
                    {opt === 'SOLID' ? 'Thin' : opt === 'SOLID_MEDIUM' ? 'Medium' : 'Thick'}
                  </label>
                ))}
              </div>
            </div>

            {/* Handicap */}
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.includeHandicap}
                  onChange={e => update('includeHandicap', e.target.checked)}
                />
                Include handicap after each name
              </label>
            </div>

            {/* Alternating colours */}
            <div className="flex gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Colour 1 (odd positions)</label>
                <input
                  type="color"
                  value={config.color1}
                  onChange={e => update('color1', e.target.value)}
                  className="h-8 w-16 border border-gray-300 rounded cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Colour 2 (even positions)</label>
                <input
                  type="color"
                  value={config.color2}
                  onChange={e => update('color2', e.target.value)}
                  className="h-8 w-16 border border-gray-300 rounded cursor-pointer"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleExport}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Exporting…' : 'Export to Sheet'}
              </button>
              <button
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
