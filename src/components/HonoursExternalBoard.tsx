// src/components/HonoursExternalBoard.tsx
// The external honours board on Print Honours Boards (app/admin/website/honours-boards):
// county, national and other results from the External Honours records, in any of the club
// boards' layouts, at the row control, line spacing and style chosen on that page — so it
// matches the club boards hung beside it. One row per line of an entry; a long competition
// or list of winners wraps onto further rows (src/types/honours-external-board.ts).
// The sheets depend on how the text wraps, which needs the fonts, so they're worked out in
// the background whenever a choice changes; then any one sheet, or all, can be previewed
// and downloaded. The title, layout and years are for this print only.

'use client';

import { useEffect, useRef, useState } from 'react';
import { getButtonClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import { BOARD_LAYOUTS, sheetGeometry, sheetLabel } from '@/types/honours-boards';
import type { BoardLayout, LineSpacing } from '@/types/honours-boards';
import { DEFAULT_EXTERNAL_TITLE, externalRows } from '@/types/honours-external-board';
import type { ExternalHonour, ExternalSheet } from '@/types/honours-external-board';
import type { BoardStyleSettings } from '@/types/honours-board-style';

/** How a sheet is listed, e.g. "Set 1 · Sheet 3 (A3) · 2008–2015". */
function sheetName(layout: BoardLayout, external: ExternalSheet): string {
  const rows = external.rows;
  const years = rows.length === 0 ? 'blank' : rows[0].year === rows[rows.length - 1].year ? String(rows[0].year) : `${rows[0].year}–${rows[rows.length - 1].year}`;
  if (external.sheet.position === 'Single') return `The sheet · ${years}`;
  return `Set ${external.sheet.set} · ${sheetLabel(layout, external.sheet)} · ${years}`;
}

export function HonoursExternalBoard({ style, lineSpacing, rowControl, clubName }: {
  style: BoardStyleSettings;
  lineSpacing: LineSpacing;
  rowControl: number;
  clubName: string;
}) {
  const [entries, setEntries] = useState<ExternalHonour[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState(DEFAULT_EXTERNAL_TITLE);
  const [layout, setLayout] = useState<BoardLayout>('a2_plus_a3');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  // 'all', or the index of one sheet
  const [chosen, setChosen] = useState('all');

  // The sheets as worked out for a set of choices (planKey); a newer key means it's out of date
  const [plan, setPlan] = useState<{ key: string; sheets: ExternalSheet[] } | null>(null);
  const [planError, setPlanError] = useState<{ key: string; message: string } | null>(null);

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

  let firstYear = 0;
  let lastYear = 0;
  for (const e of entries) {
    if (firstYear === 0 || e.year < firstYear) firstYear = e.year;
    if (e.year > lastYear) lastYear = e.year;
  }
  // Blank or unreadable years mean "all of them"
  const fromYear = Number.isInteger(Number(fromText)) && fromText.trim() !== '' ? Number(fromText) : firstYear;
  const toYear = Number.isInteger(Number(toText)) && toText.trim() !== '' ? Number(toText) : lastYear;
  const rows = externalRows(entries, fromYear, toYear);
  const boardTitle = title.trim() || DEFAULT_EXTERNAL_TITLE;
  const planKey = JSON.stringify([entries.length, layout, fromYear, toYear, rowControl, lineSpacing, style.fonts, style.nameAlign]);

  // Works out the sheets whenever a choice that moves them changes (after a short pause, so
  // typing a year doesn't re-measure on every key)
  useEffect(() => {
    if (entries.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { planExternalHonours } = await import('@/lib/honours-board-pdf');
        const sheets = await planExternalHonours({ rows, layout, rowControl, lineSpacing, style });
        if (!cancelled) setPlan({ key: planKey, sheets });
      } catch (err) {
        console.error('[honours external plan]', err);
        if (!cancelled) {
          const message = err instanceof Error && err.name === 'HonoursFontError' ? err.message : 'Could not work out the sheets';
          setPlanError({ key: planKey, message });
        }
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
    // planKey covers everything the plan depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

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

  const sheets = plan && plan.key === planKey ? plan.sheets : null;
  const currentPlanError = planError && planError.key === planKey ? planError.message : null;
  const chosenIndex = chosen === 'all' ? -1 : Number(chosen);
  const chosenSheets = sheets ? (chosenIndex >= 0 && chosenIndex < sheets.length ? [sheets[chosenIndex]] : sheets) : [];
  const firstChosen = chosenSheets.length > 0 ? sheetGeometry(layout, chosenSheets[0].sheet, rowControl, lineSpacing) : null;
  const layoutInfo = BOARD_LAYOUTS.find((l) => l.value === layout);

  /** The message to show when a build fails: a font problem says what's wrong, anything else is generic. */
  function failureMessage(err: unknown, fallback: string): string {
    return err instanceof Error && err.name === 'HonoursFontError' ? err.message : fallback;
  }

  /** Builds a PDF of some sheets; the PDF library is only downloaded the first time it's needed. */
  async function build(list: ExternalSheet[]): Promise<Blob> {
    const { buildExternalHonoursPdf } = await import('@/lib/honours-board-pdf');
    return buildExternalHonoursPdf({ title: boardTitle, sheets: list, layout, rowControl, lineSpacing, style, clubName });
  }

  async function preview() {
    if (chosenSheets.length === 0) return;
    setWorking(true);
    setActionError(null);
    try {
      const blob = await build(chosenSheets);
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

  /** Downloads the chosen sheet, or every sheet as a PDF each (as the club boards are). */
  async function download() {
    if (chosenSheets.length === 0) return;
    setWorking(true);
    setActionError(null);
    try {
      const { externalHonoursFileName } = await import('@/lib/honours-board-pdf');
      // One sheet at a time, so the browser isn't asked for several downloads at once
      for (const external of chosenSheets) {
        const blob = await build([external]);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = externalHonoursFileName(boardTitle, layout, external, rowControl, style.bleed);
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (err) {
      console.error('[honours external download]', err);
      setActionError(failureMessage(err, 'Could not build the PDF'));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
        <label className="block sm:col-span-2">
          <span className="text-gray-700">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className={`${getInputClasses()} w-full mt-0.5`} />
        </label>
        <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1">
          <label className="block">
            <span className="text-gray-700">From</span>
            <input value={fromText} onChange={(e) => { setFromText(e.target.value); setChosen('all'); }} placeholder={String(firstYear)} inputMode="numeric" className={`${getInputClasses()} w-full mt-0.5`} />
          </label>
          <label className="block">
            <span className="text-gray-700">To</span>
            <input value={toText} onChange={(e) => { setToText(e.target.value); setChosen('all'); }} placeholder={String(lastYear)} inputMode="numeric" className={`${getInputClasses()} w-full mt-0.5`} />
          </label>
        </div>
        <label className="block sm:col-span-2">
          <span className="text-gray-700">Layout</span>
          <select value={layout} onChange={(e) => { setLayout(e.target.value as BoardLayout); setChosen('all'); }} className={`${getInputClasses()} w-full mt-0.5`}>
            {BOARD_LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          {layoutInfo && <span className="block text-xs text-gray-700 mt-1">{layoutInfo.hint}</span>}
        </label>
        <label className="block sm:col-span-2">
          <span className="text-gray-700">Sheet</span>
          <select value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={!sheets} className={`${getInputClasses()} w-full mt-0.5`}>
            <option value="all">{sheets ? `All ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'}` : 'Working out the sheets…'}</option>
            {sheets && sheets.map((external, i) => <option key={i} value={String(i)}>{sheetName(layout, external)}</option>)}
          </select>
        </label>
      </div>

      <p className="text-sm text-gray-900">
        {rows.length} {rows.length === 1 ? 'entry' : 'entries'} ({fromYear}–{toYear})
        {sheets ? ` on ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'}` : ''}.
        Rows, line spacing and style are the ones set for this print above, so the board matches the club boards;
        a long competition or list of winners wraps onto the next row.
      </p>

      {currentPlanError && <div className={getAlertClasses('danger')}>{currentPlanError}</div>}
      {actionError && <div className={getAlertClasses('danger')}>{actionError}</div>}

      <div className="flex flex-wrap gap-2">
        <button onClick={preview} disabled={working || chosenSheets.length === 0} className={getButtonClasses('secondary', 'md')}>
          {working ? 'Building…' : 'Preview'}
        </button>
        <button onClick={download} disabled={working || chosenSheets.length === 0} className={getButtonClasses('primary', 'md')}>
          {chosenSheets.length > 1 ? `Download ${chosenSheets.length} PDFs` : 'Download PDF'}
        </button>
      </div>

      {previewUrl && (
        <iframe
          src={previewUrl}
          title="External honours board preview"
          className={`w-full border border-gray-200 rounded ${firstChosen && firstChosen.orientation === 'portrait' ? 'max-w-xl' : ''}`}
          style={{ aspectRatio: firstChosen && firstChosen.orientation === 'portrait' ? '297 / 420' : '420 / 297' }}
        />
      )}

      {firstChosen && (
        <p className="text-xs text-gray-700">
          {chosenSheets.length > 1 ? 'A PDF per sheet, each' : 'Print'} at 100% / actual size
          {chosenSheets.length > 1 ? ' on its own paper size (in the file name)' : ` on ${firstChosen.paper}, ${firstChosen.orientation}`}.{' '}
          {style.bleed ? 'The PDF is 3mm bigger all round: ask the print shop to trim the bleed off.' : 'The margin means no bleed or trimming is needed.'}
        </p>
      )}
    </div>
  );
}
