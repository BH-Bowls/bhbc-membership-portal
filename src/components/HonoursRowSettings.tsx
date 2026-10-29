// src/components/HonoursRowSettings.tsx
// Row control and line spacing for the printed honours boards, side by side, with one hint
// that works out what they give for a board's layout: row height, name size, the years on each
// sheet and the spare years left. Used on the Print Honours Boards page.

'use client';

import { getInputClasses } from '@/config/theme-helpers';
import {
  LINE_SPACINGS, sheetForYear, sheetGeometry, sheetLabel, validateSheetSettings,
} from '@/types/honours-boards';
import type { BoardLayout, LineSpacing } from '@/types/honours-boards';

const PT_PER_MM = 72 / 25.4;
// Capital letters are about 70% of the font size in the board fonts — close enough for a hint
const CAP_SHARE = 0.7;

interface Props {
  rowControl: string;                 // as typed, so a half-typed number isn't lost
  onRowControl: (value: string) => void;
  lineSpacing: LineSpacing;
  onLineSpacing: (value: LineSpacing) => void;
  startYear: number;
  layout: BoardLayout;                // the layout the hint describes
  editable: boolean;                  // false = show the values as text
  radioName: string;                  // keeps two copies on a page from sharing radio buttons
}

export function HonoursRowSettings({ rowControl, onRowControl, lineSpacing, onLineSpacing, startYear, layout, editable, radioName }: Props) {
  const spacingLabel = LINE_SPACINGS.find((l) => l.value === lineSpacing)?.label ?? 'Snug';

  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-gray-900 mb-1">Row control</label>
          {editable ? (
            <input type="text" inputMode="numeric" value={rowControl} onChange={(e) => onRowControl(e.target.value)} className={`${getInputClasses()} max-w-[10rem]`} />
          ) : (
            <span className="text-gray-900">{rowControl || '—'}</span>
          )}
          <p className="text-xs text-gray-700 mt-1">
            Sets the row height on every board. Lower gives taller rows and bigger names, but fewer years per sheet.
          </p>
        </div>
        <div>
          <span className="block text-gray-900 mb-1">Line spacing</span>
          {editable ? (
            <div className="flex flex-wrap gap-4">
              {LINE_SPACINGS.map((l) => (
                <label key={l.value} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name={radioName} checked={lineSpacing === l.value} onChange={() => onLineSpacing(l.value)} className="h-4 w-4" />
                  <span className="text-gray-900">{l.label}</span>
                </label>
              ))}
            </div>
          ) : (
            <span className="text-gray-900">{spacingLabel}</span>
          )}
          <p className="text-xs text-gray-700 mt-1">
            Same rows, more space between them: Comfortable makes the names about 12% smaller, Generous about 22%.
          </p>
        </div>
      </div>
      <p className="text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-md p-2">
        {rowSummary(Number(rowControl), lineSpacing, startYear, layout)}
      </p>
      <p className="text-xs text-gray-700">
        Changing either moves or resizes every sheet, so all the printed sheets would need reprinting.
      </p>
    </div>
  );
}

/** One plain-English sentence on what a row control and line spacing give for a layout. */
function rowSummary(perSet: number, spacing: LineSpacing, startYear: number, layout: BoardLayout): string {
  const invalid = validateSheetSettings(startYear, perSet);
  if (invalid) return invalid;

  const first = sheetForYear(startYear, startYear, layout, perSet);
  if (!first) return '';
  const g = sheetGeometry(layout, first, perSet, spacing);
  const pt = Math.round(g.namePt);
  const capMm = ((g.namePt * CAP_SHARE) / PT_PER_MM).toFixed(1);

  // A single sheet ignores the row control: every year shares the sheet, smaller each season
  if (layout === 'single') {
    return "On a single sheet the row control doesn't apply — every year shares the sheet, so names get smaller each season.";
  }

  const second = sheetForYear(first.lastYear + 1, startYear, layout, perSet);
  const thisYear = new Date().getFullYear();
  const current = sheetForYear(Math.max(thisYear, startYear), startYear, layout, perSet);

  const parts = [
    `Rows ${g.rowHeightMm.toFixed(1)}mm, names about ${pt}pt (capitals about ${capMm}mm tall).`,
    `${sheetLabel(layout, first)}: ${first.lastYear - first.firstYear + 1} years, ${first.firstYear}–${first.lastYear}`,
  ];
  // Two-sheet layouts: the second sheet of the set, at the same row height
  if (second) {
    parts[1] += `; ${sheetLabel(layout, second)}: ${second.lastYear - second.firstYear + 1} years, ${second.firstYear}–${second.lastYear}`;
  }
  parts[1] += '.';
  // How long the sheet being filled now lasts
  if (current) {
    const spare = current.lastYear - thisYear;
    parts.push(`The current sheet runs to ${current.lastYear}: ${spare} spare ${spare === 1 ? 'year' : 'years'}.`);
  }
  return parts.join(' ');
}
