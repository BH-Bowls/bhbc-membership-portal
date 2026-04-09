// src/lib/sheet-export-config.ts
// Client-safe types and defaults for the bracket sheet export.
// No server-only imports — safe to use in Client Components.

import type { CompType } from '@/types/competitions';

export interface SheetExportConfig {
  rowsPerSlot: number;          // rows per prelim slot (controls vertical spacing)
  matchColWidthPx: number;      // match column width in pixels
  connectorColWidthPx: number;  // connector gap column width in pixels; 0 = hide connectors
  lineStyle: 'SOLID' | 'SOLID_MEDIUM' | 'SOLID_THICK'; // border weight for boxes and connectors
  nameFormat: 'one-line' | 'separate-rows'; // pairs/triples: all names on one line or one row per player
  nameFit: 'wrap' | 'truncate'; // Google Sheets text wrap strategy
  includeHandicap: boolean;
  exportPrelimByes: boolean;    // whether to draw a box for each prelim bye slot
  color1: string; // hex background for odd-position matches (e.g. club blue tint)
  color2: string; // hex background for even-position matches (e.g. white)
}

export function defaultConfig(compType: CompType): SheetExportConfig {
  const isPairs   = compType === 'pairs';
  const isTriples = compType === 'triples';
  const rowsPerSide = isTriples ? 3 : isPairs ? 2 : 1;
  const matchBoxRows = 2 * rowsPerSide;
  return {
    rowsPerSlot:         Math.max(matchBoxRows + 1, 3),
    matchColWidthPx:     200,
    connectorColWidthPx: 30,
    nameFormat:          compType !== 'singles' ? 'separate-rows' : 'one-line',
    lineStyle:           'SOLID_MEDIUM',
    nameFit:             'wrap',
    includeHandicap:     false,
    exportPrelimByes:    true,
    color1:              '#D0E5F2', // light club blue (#588FB1 tint)
    color2:              '#FFFFFF', // white
  };
}
