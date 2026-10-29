// app/admin/website/honours-boards/page.tsx
// Print Honours Boards — builds the printed sheets for the clubhouse honours boards as
// PDFs, in the browser, from the internal honours records, and photo plaques for the
// champions photos. Everyone here can change the rows and style for one print; an Admin can
// also save them as the club's settings, and open Setup (start year and the boards themselves).
// Access: Admin, Captain, GMC (enforced by the API routes; saving is Admin only).

'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { hasRole } from '@/lib/role-utils';
import { getButtonClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import { theme } from '@/config/theme';
import {
  BOARD_LAYOUTS, MIN_READABLE_PT, a3Halves, sheetForYear, sheetGeometry, sheetLabel, sheetsUpTo, validateSheetSettings,
} from '@/types/honours-boards';
import { LINE_SPACING_KEY, YEARS_PER_SET_KEY } from '@/types/honours-boards';
import type { BoardLayout, BoardSheet, HonoursBoard, LineSpacing } from '@/types/honours-boards';
import type { HonoursYearRow } from '@/lib/honours-board-pdf';
import { HonoursBoardStyleEditor } from '@/components/HonoursBoardStyleEditor';
import { HonoursRowSettings } from '@/components/HonoursRowSettings';
import { HonoursPhotoPlaque } from '@/components/HonoursPhotoPlaque';
import { HonoursBoardsPanel } from '@/components/HonoursBoardsPanel';
import { DEFAULT_STYLE, STYLE_KEY, sameStyle } from '@/types/honours-board-style';
import type { BoardStyleSettings } from '@/types/honours-board-style';

/** Identifies a sheet in the picker — an A2 sheet and its first A3 half start in the same year. */
function sheetKey(s: BoardSheet): string {
  return `${s.firstYear}-${s.part ?? 0}`;
}

export default function PrintHonoursBoardsPage() {
  // Only an Admin can save the club's settings or open Setup (the API checks this too)
  const { data: session } = useSession();
  const isAdmin = !!session && hasRole(session.user?.role, 'Admin');
  const [setupOpen, setSetupOpen] = useState(false);
  // Saving the rows or style as the club's: what's happening, and any message
  const [savingSettings, setSavingSettings] = useState<'rows' | 'style' | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [boards, setBoards] = useState<HonoursBoard[]>([]);
  const [rows, setRows] = useState<HonoursYearRow[]>([]);
  const [startYear, setStartYear] = useState(0);
  // Row control and line spacing as saved for the club, and as used here (start as the saved
  // ones; changes are for this preview or print only)
  const [savedYearsPerSet, setSavedYearsPerSet] = useState(0);
  const [rowControl, setRowControl] = useState('');
  const [savedLineSpacing, setSavedLineSpacing] = useState<LineSpacing>('snug');
  const [lineSpacing, setLineSpacing] = useState<LineSpacing>('snug');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [boardId, setBoardId] = useState('');
  // Try a board in another layout without changing its saved one; '' = the saved layout
  const [previewLayout, setPreviewLayout] = useState<BoardLayout | ''>('');
  // The chosen sheet (see sheetKey); '' = the board's current sheet
  const [chosenSheet, setChosenSheet] = useState('');
  // The club's style as saved, and the style used here (starts as the saved one;
  // changes are for this preview or print only)
  const [savedStyle, setSavedStyle] = useState<BoardStyleSettings>(DEFAULT_STYLE);
  const [style, setStyle] = useState<BoardStyleSettings>(DEFAULT_STYLE);

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
        setSavedYearsPerSet(boardsData.yearsPerSet);
        setRowControl(String(boardsData.yearsPerSet));
        setSavedLineSpacing(boardsData.lineSpacing);
        setLineSpacing(boardsData.lineSpacing);
        setSavedStyle(boardsData.style);
        setStyle(boardsData.style);
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

  /** Reloads the boards and start year after a change in Setup; one-off changes here are kept. */
  async function reloadSetup() {
    const res = await fetch('/api/admin/honours-boards');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reload the honours boards');
    setBoards(data.boards);
    setStartYear(data.startYear);
    // The board being previewed may have just been deleted
    if (!data.boards.some((b: HonoursBoard) => b.id === boardId)) {
      setBoardId(data.boards.length > 0 ? data.boards[0].id : '');
      setPreviewLayout('');
      setChosenSheet('');
    }
  }

  /** Saves settings to the club's config (Admin only). */
  async function saveConfig(which: 'rows' | 'style', values: Record<string, string>): Promise<boolean> {
    setSavingSettings(which);
    setSettingsMessage(null);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        let reason = 'Failed to save';
        try { reason = (await res.json()).error || reason; } catch { /* no detail */ }
        throw new Error(reason);
      }
      return true;
    } catch (err) {
      setSettingsMessage({ ok: false, text: err instanceof Error ? err.message : 'Failed to save' });
      return false;
    } finally {
      setSavingSettings(null);
    }
  }

  /** Saves the row control and line spacing in use here as the club's. */
  async function saveRows() {
    if (await saveConfig('rows', { [YEARS_PER_SET_KEY]: String(yearsPerSet), [LINE_SPACING_KEY]: lineSpacing })) {
      setSavedYearsPerSet(yearsPerSet);
      setRowControl(String(yearsPerSet));
      setSavedLineSpacing(lineSpacing);
      setSettingsMessage({ ok: true, text: 'Rows saved — every print now starts from these.' });
    }
  }

  /** Saves the style in use here as the club's. */
  async function saveStyle() {
    if (await saveConfig('style', { [STYLE_KEY]: JSON.stringify(style) })) {
      setSavedStyle(style);
      setSettingsMessage({ ok: true, text: 'Style saved — every print now starts from this style.' });
    }
  }

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
  // Seasons with a record, newest first — the photo plaque's season list
  const seasons = rows.map((r) => Number(r.year)).filter((y) => y > 0).sort((a, b) => b - a);

  // Settings are 0 until loaded, which is invalid — so no sheets are worked out before then
  const settingsError = validateSheetSettings(startYear, savedYearsPerSet);
  // A row control typed here is used once it's valid; until then the saved one stays in use
  const rowControlValid = validateSheetSettings(startYear, Number(rowControl)) === null;
  const yearsPerSet = rowControlValid ? Number(rowControl) : savedYearsPerSet;
  const rowsChanged = yearsPerSet !== savedYearsPerSet || lineSpacing !== savedLineSpacing;

  /** Back to the club's saved row control and line spacing. */
  function rowsBackToSaved() {
    setRowControl(String(savedYearsPerSet));
    setLineSpacing(savedLineSpacing);
  }

  /** The latest year a board's sheets need to reach: a single sheet stops at the last season, with no spare rows. */
  function upToYear(b: HonoursBoard): number {
    if (b.layout === 'single') return lastSeason || thisYear;
    return Math.max(thisYear, lastSeason);
  }

  /** The sheet that changes this season for a board (null until the settings are valid). */
  function currentSheetFor(b: HonoursBoard): BoardSheet | null {
    return settingsError ? null : sheetForYear(upToYear(b), startYear, b.layout, yearsPerSet);
  }

  /**
   * Every sheet a board can print: all sheets up to the end of the current set (so the
   * set's later sheet can be printed blank, e.g. for a trial), with an A2 sheet also
   * offered as its two A3 halves where the layout allows.
   */
  function printableSheets(b: HonoursBoard): BoardSheet[] {
    const current = currentSheetFor(b);
    if (!current) return [];
    // Reach the end of the current set: include the next sheet if it's in the same set
    const next = sheetForYear(current.lastYear + 1, startYear, b.layout, yearsPerSet);
    const until = next && next.set === current.set && b.layout !== 'single' ? next.lastYear : upToYear(b);
    const list: BoardSheet[] = [];
    for (const s of sheetsUpTo(until, startYear, b.layout, yearsPerSet)) {
      list.push(...a3Halves(b.layout, s, yearsPerSet), s);
    }
    return list;
  }

  const savedBoard = boards.find((b) => b.id === boardId) || null;
  // The board as previewed: its saved layout, or the one chosen to try
  const board = savedBoard && previewLayout ? { ...savedBoard, layout: previewLayout } : savedBoard;
  const sheets: BoardSheet[] = board ? printableSheets(board) : [];
  const boardCurrent = board ? currentSheetFor(board) : null;
  const sheet = sheets.find((s) => sheetKey(s) === chosenSheet) || boardCurrent;
  const geometry = board && sheet ? sheetGeometry(board.layout, sheet, yearsPerSet, lineSpacing) : null;

  /** Builds one sheet's PDF; the PDF library is only downloaded the first time this runs. */
  async function build(forBoard: HonoursBoard, forSheet: BoardSheet): Promise<{ blob: Blob; fileName: string }> {
    const { buildHonoursBoardPdf, honoursBoardFileName } = await import('@/lib/honours-board-pdf');
    const blob = await buildHonoursBoardPdf({
      board: forBoard,
      sheet: forSheet,
      yearsPerSet,
      lineSpacing,
      rows,
      lastYearShown: lastSeason,
      style,
      clubName: theme.brand.name,
    });
    return { blob, fileName: honoursBoardFileName(forBoard, forSheet, yearsPerSet, style.bleed) };
  }

  /** The message to show when a build fails: a font problem says what's wrong, anything else is generic. */
  function failureMessage(err: unknown, fallback: string): string {
    return err instanceof Error && err.name === 'HonoursFontError' ? err.message : fallback;
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
      setActionError(failureMessage(err, 'Could not build the preview'));
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
      setActionError(failureMessage(err, 'Could not build the PDF'));
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
      setActionError(failureMessage(err, 'Could not build the PDFs'));
    } finally {
      setWorking(false);
    }
  }

  /**
   * A trial print of the A2-plus-A3 layout entirely on A3: sheets 1 and 2 (the A2 sheet's
   * two halves) and sheet 3, for every board — whatever layout each board is saved with.
   */
  async function downloadA3Trial() {
    setWorking(true);
    setActionError(null);
    try {
      for (const saved of boards) {
        const b: HonoursBoard = { ...saved, layout: 'a2_plus_a3' };
        // Sheets 1 and 2 in place of the A2 sheet; sheet 3 as it is
        const trialSheets = printableSheets(b).filter((s) => s.position !== 'Top' || s.part);
        for (const s of trialSheets) {
          const { blob, fileName } = await build(b, s);
          saveFile(blob, fileName);
        }
      }
    } catch (err) {
      console.error('[honours-boards A3 trial download]', err);
      setActionError(failureMessage(err, 'Could not build the PDFs'));
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
              {isAdmin
                ? ' The boards, their columns and the start year are in Setup; the rows and style are saved from the preview below.'
                : ' An Admin sets up the boards and saves the club\'s rows and style.'}
            </p>
          </div>

          {/* Setup: start year and the boards (Admin only) */}
          {isAdmin && !loading && !loadError && (
            <div className="bg-white shadow rounded-lg p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-gray-900">Setup</h2>
                  <p className="text-sm text-gray-700">
                    Start year {startYear || '—'} · {boards.length} {boards.length === 1 ? 'board' : 'boards'}: {boards.map((b) => b.name).join(', ') || 'none yet'}
                  </p>
                </div>
                <button onClick={() => setSetupOpen(!setupOpen)} className={getButtonClasses('secondary', 'sm')}>
                  {setupOpen ? 'Close' : 'Edit'}
                </button>
              </div>
              {setupOpen && (
                <HonoursBoardsPanel boards={boards} startYear={startYear} yearsPerSet={savedYearsPerSet} lineSpacing={savedLineSpacing} onChanged={reloadSetup} />
              )}
            </div>
          )}

          {loadError && <div className={getAlertClasses('danger')}>{loadError}</div>}
          {!loadError && settingsError && <div className={getAlertClasses('danger')}>Honours board settings need fixing{isAdmin ? ' in Setup' : ' by an Admin'}: {settingsError}</div>}
          {!loadError && boards.length === 0 && <div className={getAlertClasses('warning')}>No boards set up yet{isAdmin ? ' — add one in Setup.' : ' — an Admin adds them.'}</div>}

          {/* The yearly job */}
          {!settingsError && boards.length > 0 && (
            <div className="bg-white shadow rounded-lg p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">This season&apos;s sheets</h2>
              <p className="text-sm text-gray-700">After entering {lastSeason || thisYear}&apos;s winners, reprint these. The other sheets never change.</p>
              {/* A one-off row change moves the sheets, so say so where it matters most */}
              {rowsChanged && (
                <div className={getAlertClasses('warning')}>
                  Using the rows changed below for this print, not the club&apos;s saved ones.
                </div>
              )}
              <ul className="text-sm text-gray-900 list-disc pl-5">
                {boards.map((b) => {
                  const current = currentSheetFor(b);
                  if (!current) return null;
                  return (
                    <li key={b.id}>
                      {b.name}: {current.position === 'Single' ? 'the sheet' : `set ${current.set}, ${sheetLabel(b.layout, current)}`} ({current.firstYear}–{current.lastYear})
                    </li>
                  );
                })}
              </ul>
              <button onClick={downloadSeason} disabled={working} className={getButtonClasses('primary', 'md')}>
                {working ? 'Building…' : `Download ${boards.length} PDF${boards.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}

          {/* Trial print of the A2-plus-A3 layout, all on A3 */}
          {!settingsError && boards.length > 0 && (
            <div className="bg-white shadow rounded-lg p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">A3 trial print</h2>
              <p className="text-sm text-gray-700">
                Every board as three A3 landscape sheets: sheets 1 and 2 (which make up the A2 sheet) and
                sheet 3, the yearly sheet. Same years, sizes and columns as the final A2 and A3 prints. Uses
                the style chosen below.
              </p>
              <button onClick={downloadA3Trial} disabled={working} className={getButtonClasses('secondary', 'md')}>
                {working ? 'Building…' : `Download ${boards.length * 3} A3 PDFs`}
              </button>
            </div>
          )}

          {/* Any one sheet, with a preview */}
          {board && sheets.length > 0 && (
            <div className="bg-white shadow rounded-lg p-5 space-y-4">
              <h2 className="font-semibold text-gray-900">Preview or print one sheet</h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <label className="block">
                  <span className="text-gray-700">Board</span>
                  <select
                    value={boardId}
                    onChange={(e) => { setBoardId(e.target.value); setPreviewLayout(''); setChosenSheet(''); }}
                    className={`${getInputClasses()} w-full mt-0.5`}
                  >
                    {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-gray-700">Layout</span>
                  <select
                    value={previewLayout}
                    onChange={(e) => { setPreviewLayout(e.target.value as BoardLayout | ''); setChosenSheet(''); }}
                    className={`${getInputClasses()} w-full mt-0.5`}
                  >
                    {BOARD_LAYOUTS.map((l) => (
                      <option key={l.value} value={savedBoard && l.value === savedBoard.layout ? '' : l.value}>
                        {l.label}{savedBoard && l.value === savedBoard.layout ? ' (saved)' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs text-gray-700 mt-1">
                    {previewLayout
                      ? `Trying a different layout for this preview only. To keep it, change the board in Setup${isAdmin ? '' : ' (Admin)'}.`
                      : BOARD_LAYOUTS.find((l) => l.value === board.layout)?.hint}
                  </span>
                </label>
                <label className="block">
                  <span className="text-gray-700">Sheet</span>
                  <select value={sheet ? sheetKey(sheet) : ''} onChange={(e) => setChosenSheet(e.target.value)} className={`${getInputClasses()} w-full mt-0.5`}>
                    {sheets.map((s) => (
                      <option key={sheetKey(s)} value={sheetKey(s)}>
                        {s.position === 'Single' ? '' : `Set ${s.set} · ${sheetLabel(board.layout, s)} · `}{s.firstYear}–{s.lastYear}
                        {boardCurrent && sheetKey(s) === sheetKey(boardCurrent) ? ' (current)' : ''}
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
                  Names are now below {MIN_READABLE_PT}pt and getting hard to read. Time to move this board to two sheets in Setup.
                </div>
              )}

              {/* Rows: the saved row control and line spacing, or changed here for this print only */}
              <div className="text-sm space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-gray-900">
                    Rows: {rowsChanged ? 'changed for this print — not saved' : 'the club\'s (saved)'}
                  </span>
                  {/* Only offered once something has changed */}
                  {(rowsChanged || rowControl !== String(savedYearsPerSet)) && (
                    <button onClick={rowsBackToSaved} className="text-blue-600 hover:text-blue-800">Back to saved</button>
                  )}
                  {/* An Admin can keep them for every print */}
                  {isAdmin && rowsChanged && (
                    <button onClick={saveRows} disabled={savingSettings !== null} className={getButtonClasses('primary', 'sm')}>
                      {savingSettings === 'rows' ? 'Saving…' : 'Save as the club’s rows'}
                    </button>
                  )}
                </div>
                <details className="rounded-md border border-gray-200 p-3">
                  <summary className="cursor-pointer text-blue-600 hover:text-blue-800">Change the row control or line spacing for this print</summary>
                  <div className="mt-3">
                    <HonoursRowSettings
                      rowControl={rowControl}
                      onRowControl={setRowControl}
                      lineSpacing={lineSpacing}
                      onLineSpacing={setLineSpacing}
                      startYear={startYear}
                      layout={board.layout}
                      editable
                      radioName="honoursPrintLineSpacing"
                    />
                    <p className="text-xs text-gray-700 mt-3">
                      {isAdmin ? 'To keep them for every print, use “Save as the club’s rows” above.' : 'These are for this print only; an Admin can save them for every print.'}
                    </p>
                  </div>
                </details>
              </div>

              {/* The style: the club's saved one, or changed here for this print only */}
              <div className="text-sm space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-gray-900">
                    Style: {sameStyle(style, savedStyle) ? 'the club style (saved)' : 'changed for this print — not saved'}
                  </span>
                  {/* Only offered once something has changed */}
                  {!sameStyle(style, savedStyle) && (
                    <button onClick={() => setStyle(savedStyle)} className="text-blue-600 hover:text-blue-800">Back to saved</button>
                  )}
                  {/* An Admin can keep it for every print */}
                  {isAdmin && !sameStyle(style, savedStyle) && (
                    <button onClick={saveStyle} disabled={savingSettings !== null} className={getButtonClasses('primary', 'sm')}>
                      {savingSettings === 'style' ? 'Saving…' : 'Save as the club style'}
                    </button>
                  )}
                </div>
                <details className="rounded-md border border-gray-200 p-3">
                  <summary className="cursor-pointer text-blue-600 hover:text-blue-800">Change the style for this print</summary>
                  <div className="mt-3">
                    <HonoursBoardStyleEditor value={style} onChange={setStyle} />
                    <p className="text-xs text-gray-700 mt-3">
                      {isAdmin ? 'To keep it for every print, use “Save as the club style” above.' : 'This is for this print only; an Admin can save it for every print.'}
                    </p>
                  </div>
                </details>
              </div>

              {settingsMessage && <div className={getAlertClasses(settingsMessage.ok ? 'success' : 'danger')}>{settingsMessage.text}</div>}

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
                  Print at 100% / actual size on {geometry.paper}, {geometry.orientation}.{' '}
                  {/* Bleed makes the PDF bigger than the paper, so the print shop needs telling */}
                  {style.bleed
                    ? 'The PDF is 3mm bigger all round: ask the print shop to trim the bleed off.'
                    : 'The margin means no bleed or trimming is needed.'}{' '}
                  Every font is embedded in the PDF, so the print shop sees exactly what&apos;s previewed here.
                </p>
              )}
            </div>
          )}

          {/* A plaque under a season's champions photo, in the same style as the boards */}
          {!loadError && rows.length > 0 && (
            <div className="bg-white shadow rounded-lg p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">Photo plaque</h2>
              <p className="text-sm text-gray-700">
                Adds a title and names under a champions photo, in the style used for the boards. Uses the style
                as set for this print (above).
              </p>
              <HonoursPhotoPlaque style={style} years={seasons} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
