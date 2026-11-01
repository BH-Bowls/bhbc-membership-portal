// src/lib/honours-print-spec.ts
// The print spec for the honours boards: the row and style settings in use, in plain text
// with the names the settings page shows (e.g. "Bright kit gold", "Lora, bold"), ready to
// paste into an email to a print shop or the committee.

import {
  BOARD_LAYOUTS, LINE_SPACINGS,
} from '@/types/honours-boards';
import type { BoardLayout, LineSpacing } from '@/types/honours-boards';
import { FONT_OPTIONS, LOGO_PLACES, NAME_ALIGNS, findPreset } from '@/types/honours-board-style';
import type { BoardStyleSettings, FontChoice } from '@/types/honours-board-style';

export interface PrintSpecOptions {
  style: BoardStyleSettings;
  rowControl: number;
  lineSpacing: LineSpacing;
  startYear: number;
  layout: BoardLayout;
  rowResult: string;   // the row settings' hint, e.g. "Rows 11.9mm, names about 26pt …"
  saved: boolean;      // true = the club's saved settings; false = changed for this print
}

/** A colour as the settings page names it, with its code and (for a preset) CMYK, e.g. "Navy: #1B2A4A (C100 M80 Y30 K35)". */
function colourName(hex: string | null): string {
  if (!hex) return 'none';
  const preset = findPreset(hex);
  return preset ? `${preset.name}: ${hex.toUpperCase()} (${preset.cmyk})` : `Custom: ${hex.toUpperCase()}`;
}

/** A font as the settings page names it, with regular or bold. */
function fontName(choice: FontChoice): string {
  const option = FONT_OPTIONS.find((f) => f.key === choice.font);
  // A custom font is a Google font chosen by name
  const name = option ? option.label : `${choice.customName || 'Custom'} (Google font)`;
  return `${name}, ${choice.bold ? 'bold' : 'regular'}`;
}

/** The whole spec as plain text, one setting per line under each heading. */
export function honoursPrintSpec(o: PrintSpecOptions): string {
  const s = o.style;
  const spacing = LINE_SPACINGS.find((l) => l.value === o.lineSpacing)?.label ?? o.lineSpacing;
  const layout = BOARD_LAYOUTS.find((l) => l.value === o.layout)?.label ?? o.layout;
  const pictures = LOGO_PLACES.find((l) => l.value === s.logo)?.label ?? s.logo;
  const align = NAME_ALIGNS.find((a) => a.value === s.nameAlign)?.label ?? s.nameAlign;

  // The pictures only have a panel to speak of when there are pictures
  const pictureLine = s.logo === 'none' ? pictures : `${pictures}, ${s.logoPanel ? 'white panel behind' : 'no panel behind'}`;

  return [
    `Honours boards: ${o.saved ? 'saved settings' : 'print settings (changed for this print, not saved)'}`,
    '',
    'Rows',
    `- Row control: ${o.rowControl}`,
    `- Line spacing: ${spacing}`,
    `- Start year: ${o.startYear}`,
    `- Layout: ${layout}`,
    `- Result: ${o.rowResult}`,
    '',
    'Sheet',
    `- Colour: ${colourName(s.background)}`,
    `- Bleed: ${s.bleed ? 'on (3mm all round)' : 'off'}`,
    '',
    'Title',
    `- Font colour: ${colourName(s.title)}`,
    `- Font: ${fontName(s.fonts.titles)}`,
    `- Line under the title: ${colourName(s.underline)}`,
    '',
    'Headings and years',
    `- Band colour: ${colourName(s.headingBand)}`,
    `- Heading font colour: ${colourName(s.headingText)}`,
    `- Year font colour: ${colourName(s.years)}`,
    `- Font: ${fontName(s.fonts.headings)}`,
    '',
    'Names',
    `- Font colour: ${colourName(s.text)}`,
    `- Font: ${fontName(s.fonts.names)}`,
    `- Alignment: ${align}`,
    `- Alternate years colour: ${colourName(s.stripes)}`,
    `- Fine line between years: ${colourName(s.yearLines)}`,
    `- Line between decades: ${colourName(s.decadeLines)}`,
    '',
    'Crest beside the title',
    `- ${pictureLine}`,
    '',
    'Test prints',
    `- Print settings note: ${s.printNote ? 'on' : 'off'}`,
  ].join('\n');
}
