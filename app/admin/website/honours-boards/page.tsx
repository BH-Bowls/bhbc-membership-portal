// app/admin/website/honours-boards/page.tsx
// Print Honours Boards — builds the printed sheets for the clubhouse honours boards as
// PDFs, in the browser, from the internal honours records. Each board's columns and layout,
// and the shared years, are set in Config > Honours Boards (Admin only).
// Access: Admin, Captain, GMC (enforced by the API routes).

'use client';

import { useEffect, useRef, useState } from 'react';
import { getButtonClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import { theme } from '@/config/theme';
import { MIN_READABLE_PT, layoutLabel, sheetForYear, sheetGeometry, sheetsUpTo, validateSheetSettings } from '@/types/honours-boards';
import type { BoardSheet, HonoursBoard } from '@/types/honours-boards';
import type { BodyFont, HonoursYearRow } from '@/lib/honours-board-pdf';

// Listed here as well as in honours-board-pdf.tsx so the page doesn't load the PDF library just to draw the picker
const BODY_FONT_OPTIONS: { value: BodyFont; hint: string }[] = [
  { value: 'Atkinson Hyperlegible Next', hint: 'Recommended — designed for low-vision readers' },
  { value: 'Inter', hint: 'Matches the website' },
  { value: 'Lora', hint: 'Traditional serif, reads a little smaller' },
];

export default function PrintHonoursBoardsPage() {
  const [boards, setBoards] = useState<HonoursBoard[]>([]);
  const [rows, setRows] = useState<HonoursYearRow[]>([]);
  const [startYear, setStartYear] = useState(0);
  const [yearsPerSet, setYearsPerSet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [boardId, setBoardId] = useState('');
  // The chosen sheet's first year; 0 = the board's current sheet
  const [sheetFirstYear, setSheetFirstYear] = useState(0);
  const [bodyFont, setBodyFont] = useState<BodyFont>('Atkinson Hyperlegible Next');

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Keeps the latest preview URL so it can be released when replaced or on leaving the page
  const previewUrlRef = useRef<string | null>(null);

  // Runs once on mount: load the boards, year settings and every season's honours
  useEffect(() => {
    async function load() {
      try {
        const [boardsRes, honoursRes] = await Promise.all([
          fetch('/api/admin/honours-boards'),
          fetch('/api/admin/website/honours-internal'),
        ]);
        const boardsData = await boardsRes.json();
        const honoursData = await honoursRes.json();
        if (!boardsRes.ok) throw new Error(boardsData.error || 'Failed to load honours boards');
        if (!honoursRes.ok) throw new Error(honoursData.error || 'Failed to load honours');
        setBoards(boardsData.boards);
        setStartYear(boardsData.startYear);
        setYearsPerSet(boardsData.yearsPerSet);
        setRows(honoursData.rows);
        if (boardsData.boards.length > 0) setBoardId(boardsData.boards[0].id);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Runs on leaving the page: release the last preview's memory
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  // The latest season with a record — years after it print as blank rows
  let lastSeason = 0;
  for (const r of rows) {
    if (Number(r.year) > lastSeason) lastSeason = Number(r.year);
  }
  const thisYear = new Date().getFullYear();

  // Settings are 0 until loaded, which is invalid — so no sheets are worked out before then
  const settingsError = validateSheetSettings(startYear, yearsPerSet);

  /** The latest year a board's sheets need to reach: a single sheet stops at the last season, with no spare rows. */
  function upToYear(b: HonoursBoard): number {
    if (b.layout === 'single') return lastSeason || thisYear;
    return Math.max(thisYear, lastSeason);
  }

  /** The sheet that changes this season for a board (null until the settings are valid). */
  function currentSheetFor(b: HonoursBoard): BoardSheet | null {
    return settingsError ? null : sheetForYear(upToYear(b), startYear, b.layout, yearsPerSet);
  }

  const board = boards.find((b) => b.id === boardId) || null;
  const sheets: BoardSheet[] = board && !settingsError ? sheetsUpTo(upToYear(board), startYear, board.layout, yearsPerSet) : [];
  const boardCurrent = board ? currentSheetFor(board) : null;
  const sheet = sheets.find((s) => s.firstYear === sheetFirstYear) || boardCurrent;
  const geometry = board && sheet ? sheetGeometry(board.layout, sheet, yearsPerSet) : null;

  /** Builds one sheet's PDF; the PDF library is only downloaded the first time this runs. */
  async function build(forBoard: HonoursBoard, forSheet: BoardSheet): Promise<{ blob: Blob; fileName: string }> {
    const { buildHonoursBoardPdf, honoursBoardFileName } = await import('@/lib/honours-board-pdf');
    const blob = await buildHonoursBoardPdf({
      board: forBoard,
      sheet: forSheet,
      yearsPerSet,
      rows,
      lastYearShown: lastSeason,
      bodyFont,
      clubName: theme.brand.name,
    });
    return { blob, fileName: honoursBoardFileName(forBoard, forSheet, yearsPerSet) };
  }

  /** Saves a Blob as a file via a temporary link. */
  function saveFile(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    // Give the browser a moment to start the download before releasing the memory
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function preview() {
    if (!board || !sheet) return;
    setWorking(true);
    setActionError(null);
    try {
      const { blob } = await build(board, sheet);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (err) {
      console.error('[honours-boards preview]', err);
      setActionError('Could not build the preview');
    } finally {
      setWorking(false);
    }
  }

  async function download() {
    if (!board || !sheet) return;
    setWorking(true);
    setActionError(null);
    try {
      const { blob, fileName } = await build(board, sheet);
      saveFile(blob, fileName);
    } catch (err) {
      console.error('[honours-boards download]', err);
      setActionError('Could not build the PDF');
    } finally {
      setWorking(false);
    }
  }

  /** The yearly job: the current sheet of every board, one PDF each. */
  async function downloadSeason() {
    setWorking(true);
    setActionError(null);
    try {
      // One board at a time, so the browser isn't asked for several downloads at once
      for (const b of boards) {
        const current = currentSheetFor(b);
        if (!current) continue;
        const { blob, fileName } = await build(b, current);
        saveFile(blob, fileName);
      }
    } catch (err) {
      console.error('[honours-boards season download]', err);
      setActionError('Could not build the PDFs');
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-5xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0 space-y-6">
          <div>
            <a href="/admin/website" className="text-sm text-blue-500 hover:text-blue-600 font-medium">
              ← Back to Website Admin
            </a>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Print Honours Boards</h1>
            <p className="text-sm text-gray-700">
              PDFs for the clubhouse boards, built from the{' '}
              <a href="/admin/website/honours-internal" className="text-blue-600 hover:text-blue-800">Internal Honours</a> records.
              Each board&apos;s columns and layout, and the years, are set in{' '}
              <a href="/admin/config?tab=honours" className="text-blue-600 hover:text-blue-800">Config &gt; Honours Boards</a> (Admin).
            </p>
          </div>

          {loadError && <div className={getAlertClasses('danger')}>{loadError}</div>}
          {!loadError && settingsError && <div className={getAlertClasses('danger')}>Honours board settings need fixing in Config: {settingsError}</div>}
          {!loadError && boards.length === 0 && <div className={getAlertClasses('warning')}>No boards set up yet — add one in Config &gt; Honours Boards.</div>}

          {/* The yearly job */}
          {!settingsError && boards.length > 0 && (
            <div className="bg-white shadow rounded-lg p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">This season&apos;s sheets</h2>
              <p className="text-sm text-gray-700">After entering {lastSeason || thisYear}&apos;s winners, reprint these. The other sheets never change.</p>
              <ul className="text-sm text-gray-900 list-disc pl-5">
                {boards.map((b) => {
                  const current = currentSheetFor(b);
                  if (!current) return null;
                  return (
                    <li key={b.id}>
                      {b.name}: {current.position === 'Single' ? 'the sheet' : `set ${current.set} ${current.position.toLowerCase()} sheet`} ({current.firstYear}–{current.lastYear})
                    </li>
                  );
                })}
              </ul>
              <button onClick={downloadSeason} disabled={working} className={getButtonClasses('primary', 'md')}>
                {working ? 'Building…' : `Download ${boards.length} PDF${boards.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}

          {/* Any one sheet, with a preview */}
          {board && sheets.length > 0 && (
            <div className="bg-white shadow rounded-lg p-5 space-y-4">
              <h2 className="font-semibold text-gray-900">Preview or print one sheet</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <label className="block">
                  <span className="text-gray-700">Board</span>
                  <select
                    value={boardId}
                    onChange={(e) => { setBoardId(e.target.value); setSheetFirstYear(0); }}
                    className={`${getInputClasses()} w-full mt-0.5`}
                  >
                    {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <span className="block text-xs text-gray-700 mt-1">{layoutLabel(board.layout)}</span>
                </label>
                <label className="block">
                  <span className="text-gray-700">Sheet</span>
                  <select value={sheet ? sheet.firstYear : 0} onChange={(e) => setSheetFirstYear(Number(e.target.value))} className={`${getInputClasses()} w-full mt-0.5`}>
                    {sheets.map((s) => (
                      <option key={s.firstYear} value={s.firstYear}>
                        {s.position === 'Single' ? '' : `Set ${s.set} · ${s.position} · `}{s.firstYear}–{s.lastYear}{boardCurrent && s.firstYear === boardCurrent.firstYear ? ' (current)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {geometry && (
                <p className="text-sm text-gray-900">
                  Names print at about {Math.round(geometry.namePt)}pt{board.layout === 'single' ? ', a little smaller each year as rows are added' : ''}.
                </p>
              )}
              {geometry && board.layout === 'single' && geometry.namePt < MIN_READABLE_PT && (
                <div className={getAlertClasses('warning')}>
                  Names are now below {MIN_READABLE_PT}pt and getting hard to read. Time to move this board to two sheets in Config.
                </div>
              )}

              <fieldset className="text-sm">
                <legend className="text-gray-700 mb-1">Font for names</legend>
                <div className="space-y-1">
                  {BODY_FONT_OPTIONS.map((f) => (
                    <label key={f.value} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="bodyFont" checked={bodyFont === f.value} onChange={() => setBodyFont(f.value)} className="h-4 w-4" />
                      <span className="text-gray-900">{f.value}</span>
                      <span className="text-gray-700">— {f.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {actionError && <div className={getAlertClasses('danger')}>{actionError}</div>}

              <div className="flex flex-wrap gap-2">
                <button onClick={preview} disabled={working || !sheet} className={getButtonClasses('secondary', 'md')}>
                  {working ? 'Building…' : 'Preview'}
                </button>
                <button onClick={download} disabled={working || !sheet} className={getButtonClasses('primary', 'md')}>
                  Download PDF
                </button>
              </div>

              {previewUrl && (
                <iframe
                  src={previewUrl}
                  title="Honours board preview"
                  className={`w-full border border-gray-200 rounded ${geometry && geometry.orientation === 'portrait' ? 'max-w-xl' : ''}`}
                  style={{ aspectRatio: geometry && geometry.orientation === 'portrait' ? '297 / 420' : '420 / 297' }}
                />
              )}

              {geometry && (
                <p className="text-xs text-gray-700">
                  Print at 100% / actual size on {geometry.paper}, {geometry.orientation}. The white margin means no bleed or
                  trimming is needed. Headings and names use the fonts embedded in the PDF, so the print shop sees exactly
                  what&apos;s previewed here.
                </p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
