// src/components/HonoursExternalBoard.tsx
// The external honours board on Print Honours Boards (app/admin/website/honours-boards):
// county, national and other results from the External Honours records, printed in the
// style and line spacing chosen on that page. One row per entry; the entries run on over
// as many sheets as they need (src/types/honours-external-board.ts). The title, paper,
// rows and years are for this print only.

'use client';

import { useEffect, useRef, useState } from 'react';
import { getButtonClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import {
  DEFAULT_EXTERNAL_TITLE, EXTERNAL_PAPERS, MAX_EXTERNAL_ROWS, MIN_EXTERNAL_ROWS,
  defaultExternalRows, externalGeometry, externalRows, externalSheets,
} from '@/types/honours-external-board';
import type { ExternalHonour, ExternalPaper } from '@/types/honours-external-board';
import type { LineSpacing } from '@/types/honours-boards';
import type { BoardStyleSettings } from '@/types/honours-board-style';

export function HonoursExternalBoard({ style, lineSpacing, clubName }: {
  style: BoardStyleSettings;
  lineSpacing: LineSpacing;
  clubName: string;
}) {
  const [entries, setEntries] = useState<ExternalHonour[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState(DEFAULT_EXTERNAL_TITLE);
  const [paper, setPaper] = useState<ExternalPaper>('a3_portrait');
  const [rowsText, setRowsText] = useState(String(defaultExternalRows('a3_portrait')));
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');

  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Runs once: load the external results
  useEffect(() => {
    fetch('/api/admin/website/honours-external')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load the external honours');
        const list: ExternalHonour[] = [];
        for (const r of data.rows || []) list.push({ year: Number(r.year), competition: String(r.competition || ''), detail: r.detail || null });
        setEntries(list);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load the external honours'))
      .finally(() => setLoading(false));
  }, []);

  // Runs on leaving the page: release the last preview's memory
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  if (loading) return <p className="text-sm text-gray-700">Loading the external honours…</p>;
  if (loadError) return <div className={getAlertClasses('danger')}>{loadError}</div>;
  if (entries.length === 0) {
    return (
      <p className="text-sm text-gray-700">
        No external honours yet — add them in{' '}
        <a href="/admin/website/honours-external" className="text-blue-600 hover:text-blue-800">External Honours</a>.
      </p>
    );
  }

  let firstYear = entries[0].year;
  let lastYear = entries[0].year;
  for (const e of entries) {
    if (e.year < firstYear) firstYear = e.year;
    if (e.year > lastYear) lastYear = e.year;
  }
  // Blank or unreadable years mean "all of them"
  const fromYear = Number.isInteger(Number(fromText)) && fromText.trim() !== '' ? Number(fromText) : firstYear;
  const toYear = Number.isInteger(Number(toText)) && toText.trim() !== '' ? Number(toText) : lastYear;
  const rowsNum = Number(rowsText);
  const rowsValid = Number.isInteger(rowsNum) && rowsNum >= MIN_EXTERNAL_ROWS && rowsNum <= MAX_EXTERNAL_ROWS;
  const geometry = externalGeometry(paper, rowsValid ? rowsNum : defaultExternalRows(paper), lineSpacing);
  const rows = externalRows(entries, fromYear, toYear);
  const sheets = externalSheets(rows, geometry);
  const boardTitle = title.trim() || DEFAULT_EXTERNAL_TITLE;

  async function build(): Promise<{ blob: Blob; fileName: string }> {
    const { buildExternalHonoursPdf, externalHonoursFileName } = await import('@/lib/honours-board-pdf');
    const blob = await buildExternalHonoursPdf({ title: boardTitle, sheets, geometry, style, clubName });
    return { blob, fileName: externalHonoursFileName(boardTitle, sheets.length, geometry, style.bleed) };
  }

  /** The message to show when a build fails: a font problem says what's wrong, anything else is generic. */
  function failureMessage(err: unknown, fallback: string): string {
    return err instanceof Error && err.name === 'HonoursFontError' ? err.message : fallback;
  }

  async function preview() {
    setWorking(true);
    setActionError(null);
    try {
      const { blob } = await build();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (err) {
      console.error('[honours external preview]', err);
      setActionError(failureMessage(err, 'Could not build the preview'));
    } finally {
      setWorking(false);
    }
  }

  async function download() {
    setWorking(true);
    setActionError(null);
    try {
      const { blob, fileName } = await build();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error('[honours external download]', err);
      setActionError(failureMessage(err, 'Could not build the PDF'));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
        <label className="block sm:col-span-2">
          <span className="text-gray-700">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className={`${getInputClasses()} w-full mt-0.5`} />
        </label>
        <label className="block">
          <span className="text-gray-700">Paper</span>
          <select
            value={paper}
            onChange={(e) => { const p = e.target.value as ExternalPaper; setPaper(p); setRowsText(String(defaultExternalRows(p))); }}
            className={`${getInputClasses()} w-full mt-0.5`}
          >
            {EXTERNAL_PAPERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-gray-700">Rows on the first sheet</span>
          <input
            type="number" min={MIN_EXTERNAL_ROWS} max={MAX_EXTERNAL_ROWS}
            value={rowsText} onChange={(e) => setRowsText(e.target.value)}
            className={`${getInputClasses()} w-full mt-0.5`}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-gray-700">From</span>
            <input value={fromText} onChange={(e) => setFromText(e.target.value)} placeholder={String(firstYear)} inputMode="numeric" className={`${getInputClasses()} w-full mt-0.5`} />
          </label>
          <label className="block">
            <span className="text-gray-700">To</span>
            <input value={toText} onChange={(e) => setToText(e.target.value)} placeholder={String(lastYear)} inputMode="numeric" className={`${getInputClasses()} w-full mt-0.5`} />
          </label>
        </div>
      </div>

      {!rowsValid && (
        <p className="text-sm text-red-600">Rows must be a whole number from {MIN_EXTERNAL_ROWS} to {MAX_EXTERNAL_ROWS} — using {defaultExternalRows(paper)} for now.</p>
      )}

      <p className="text-sm text-gray-900">
        {rows.length} {rows.length === 1 ? 'entry' : 'entries'} ({fromYear}–{toYear}) on {sheets.length} {geometry.paper} {geometry.orientation}{' '}
        {sheets.length === 1 ? 'sheet' : 'sheets'}: {geometry.firstRows} rows on the first, {geometry.laterRows} on each one after.
        Names print at about {Math.round(geometry.namePt)}pt, and shrink to fit if they&apos;re long.
      </p>

      {actionError && <div className={getAlertClasses('danger')}>{actionError}</div>}

      <div className="flex flex-wrap gap-2">
        <button onClick={preview} disabled={working || rows.length === 0} className={getButtonClasses('secondary', 'md')}>
          {working ? 'Building…' : 'Preview'}
        </button>
        <button onClick={download} disabled={working || rows.length === 0} className={getButtonClasses('primary', 'md')}>
          Download PDF
        </button>
      </div>

      {previewUrl && (
        <iframe
          src={previewUrl}
          title="External honours board preview"
          className={`w-full border border-gray-200 rounded ${geometry.orientation === 'portrait' ? 'max-w-xl' : ''}`}
          style={{ aspectRatio: geometry.orientation === 'portrait' ? '297 / 420' : '420 / 297' }}
        />
      )}

      <p className="text-xs text-gray-700">
        One PDF, one page per sheet. Print at 100% / actual size on {geometry.paper}, {geometry.orientation}.{' '}
        {style.bleed ? 'The PDF is 3mm bigger all round: ask the print shop to trim the bleed off.' : 'The margin means no bleed or trimming is needed.'}
      </p>
    </div>
  );
}
