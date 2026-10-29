// src/types/honours-board-style.ts
// How the printed honours boards look: background, stripes, lines, colours and fonts.
// One club style is saved in Config (config key honours_board_style, as JSON) and the
// print page starts from it, with changes allowed for a preview or a one-off print.
// Every colour is stored as a hex code, so any colour can be used; a code that matches
// one of the named colours below is shown as that name. Shared by the Config panel, the
// print page and the PDF builder — no PDF library code here.

export const STYLE_KEY = 'honours_board_style';

// ── Colours ──

/** A named colour offered in the pickers. cmyk: a starting point for the print shop. */
export interface ColourPreset {
  name: string;
  hex: string;
  cmyk?: string;
}

const WHITE: ColourPreset = { name: 'White', hex: '#ffffff', cmyk: 'C0 M0 Y0 K0' };
const IVORY: ColourPreset = { name: 'Ivory', hex: '#faf7f0', cmyk: 'C0 M1 Y4 K2' };
const NAVY: ColourPreset = { name: 'Navy', hex: '#1b2a4a', cmyk: 'C100 M80 Y30 K35' };
const STONE: ColourPreset = { name: 'Stone', hex: '#f2eee6', cmyk: 'C0 M2 Y5 K5' };
const GREY: ColourPreset = { name: 'Grey', hex: '#f3f4f6', cmyk: 'C2 M1 Y0 K3' };
const PALE_GREEN: ColourPreset = { name: 'Green', hex: '#e6f2ea', cmyk: 'C8 M0 Y6 K3' };
const LIGHTER_NAVY: ColourPreset = { name: 'Lighter navy', hex: '#22345a', cmyk: 'C95 M75 Y25 K25' };
const DARK_GREEN: ColourPreset = { name: 'Club green', hex: '#14532d', cmyk: 'C85 M30 Y90 K40' };
const WEB_GOLD: ColourPreset = { name: 'Website gold', hex: '#d97706', cmyk: 'C0 M55 Y100 K10' };
const KIT_GOLD: ColourPreset = { name: 'Kit gold', hex: '#f2b33d', cmyk: 'C0 M30 Y80 K0' };
const KIT_GOLD_BRIGHT: ColourPreset = { name: 'Bright kit gold', hex: '#f6c453', cmyk: 'C0 M22 Y75 K0' };
const NEAR_BLACK: ColourPreset = { name: 'Near black', hex: '#111827', cmyk: 'C70 M60 Y40 K90' };
const LINE_GREY: ColourPreset = { name: 'Line grey', hex: '#d6d3d1', cmyk: 'C0 M2 Y3 K18' };
const LINE_IVORY: ColourPreset = { name: 'Line ivory', hex: '#ddd6c8', cmyk: 'C0 M4 Y10 K15' };

/** Background choices: white and ivory print with a white margin unless bleed is on; navy needs bleed. */
export const BACKGROUND_PRESETS: ColourPreset[] = [WHITE, IVORY, NAVY];
/** Stripe (alternate year) choices; "none" is offered separately. */
export const STRIPE_PRESETS: ColourPreset[] = [STONE, GREY, PALE_GREEN, LIGHTER_NAVY];
/** Text colour choices: names and years, titles, headings. */
export const TEXT_PRESETS: ColourPreset[] = [NEAR_BLACK, DARK_GREEN, WEB_GOLD, KIT_GOLD, KIT_GOLD_BRIGHT, NAVY, WHITE];
/** Line colour choices: fine lines, decade lines, the line under the title. */
export const LINE_PRESETS: ColourPreset[] = [LINE_GREY, LINE_IVORY, DARK_GREEN, WEB_GOLD, KIT_GOLD, LIGHTER_NAVY];
/** Heading band choices. */
export const BAND_PRESETS: ColourPreset[] = [DARK_GREEN, NAVY, KIT_GOLD, WEB_GOLD, NEAR_BLACK];

const ALL_PRESETS: ColourPreset[] = [
  WHITE, IVORY, NAVY, STONE, GREY, PALE_GREEN, LIGHTER_NAVY, DARK_GREEN, WEB_GOLD, KIT_GOLD, KIT_GOLD_BRIGHT, NEAR_BLACK, LINE_GREY, LINE_IVORY,
];

/** The named colour for a hex code, if it's one of ours (case doesn't matter). */
export function findPreset(hex: string, presets: ColourPreset[] = ALL_PRESETS): ColourPreset | null {
  const wanted = hex.toLowerCase();
  for (const p of presets) {
    if (p.hex === wanted) return p;
  }
  return null;
}

/** A tidy "#rrggbb", or null if it isn't a colour code. Accepts "1b2a4a", "#1B2A4A" and short "#fff". */
export function normaliseHex(value: string): string | null {
  let v = value.trim().toLowerCase();
  if (!v.startsWith('#')) v = `#${v}`;
  // Short form: each digit doubled
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

/** Contrast ratio between two colours (1 to 21), as the accessibility guidelines measure it. */
export function contrastRatio(hexA: string, hexB: string): number {
  // Relative brightness of a colour, weighted for how the eye sees red, green and blue
  function luminance(hex: string): number {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ── Fonts ──

/** The fonts bundled with the portal; 'custom' is any Google font, fetched by name when printing. */
export type FontKey = 'atkinson' | 'inter' | 'lora' | 'tinos' | 'custom';

export interface FontOption {
  key: Exclude<FontKey, 'custom'>;
  label: string;
  hint: string;
  family: string;               // the family name the PDF uses
  file: string;                 // file name in /public/fonts/honours-boards, before "-{weight}-normal.woff"
  regular: number;              // the weight used for "regular"
  bold: number;                 // the weight used for "bold"
}

export const FONT_OPTIONS: FontOption[] = [
  { key: 'atkinson', label: 'Atkinson Hyperlegible Next', hint: 'Designed for low-vision readers', family: 'Atkinson Hyperlegible Next', file: 'atkinson-hyperlegible-next-latin', regular: 500, bold: 600 },
  { key: 'inter', label: 'Inter', hint: 'Matches the website', family: 'Inter', file: 'inter-latin', regular: 500, bold: 600 },
  { key: 'lora', label: 'Lora', hint: 'Traditional serif, used for the titles', family: 'Lora', file: 'lora-latin', regular: 500, bold: 600 },
  { key: 'tinos', label: 'Times New Roman (as Tinos)', hint: 'Same letter shapes and widths as Times New Roman, free to use', family: 'Tinos', file: 'tinos-latin', regular: 400, bold: 700 },
];

/** One font setting: which font, regular or bold, and the Google font name when custom. */
export interface FontChoice {
  font: FontKey;
  bold: boolean;
  customName: string;
}

/** The three places a font is used. */
export type FontSlot = 'titles' | 'years' | 'names';

// sample: the example line shown under each font choice
export const FONT_SLOTS: { slot: FontSlot; label: string; hint: string; sample: string }[] = [
  { slot: 'titles', label: 'Titles and headings', hint: 'Club name, board name and column headings', sample: "Men's Championship, Veterans Cup" },
  { slot: 'years', label: 'Years', hint: 'The year at the start of each row', sample: '1986, 2013, 2045' },
  { slot: 'names', label: 'Names', hint: 'The winners', sample: '1987 J. Smith & A. N. Other' },
];

// ── The whole style ──

/** A picture beside the title: its file in /public, and width ÷ height. */
export interface TitlePicture {
  file: string;
  aspect: number;
  heightShare: number; // of the full picture height — the solid round pin looks bigger, so it's drawn a little smaller
}

// Both cut out on a transparent background, so they sit straight on any colour.
// The crest is the club's drawing (specs/BHBC-Logo.jpg); the pin is the 2002 centenary
// badge, from the website's history photo with the enamel colours evened out and the
// reflections and dust taken out.
export const CREST: TitlePicture = { file: '/images/honours-boards/crest.png', aspect: 311 / 504, heightShare: 1 };
export const CENTENARY_PIN: TitlePicture = { file: '/images/honours-boards/centenary-pin.png', aspect: 738 / 665, heightShare: 0.85 };

/** What goes beside the title: nothing, the crest on the left or both sides, or crest left and pin right. */
export type LogoPlace = 'none' | 'left' | 'both' | 'crest_pin';

export const LOGO_PLACES: { value: LogoPlace; label: string }[] = [
  { value: 'none', label: 'Nothing' },
  { value: 'left', label: 'Crest on the left' },
  { value: 'both', label: 'Crest both sides' },
  { value: 'crest_pin', label: 'Crest left, centenary pin right' },
];

/** The pictures either side of the title for a choice (null = none that side). */
export function titlePictures(place: LogoPlace): { left: TitlePicture | null; right: TitlePicture | null } {
  if (place === 'left') return { left: CREST, right: null };
  if (place === 'both') return { left: CREST, right: CREST };
  if (place === 'crest_pin') return { left: CREST, right: CENTENARY_PIN };
  return { left: null, right: null };
}

/** Where the names sit in their column. */
export type NameAlign = 'left' | 'center' | 'right';

export const NAME_ALIGNS: { value: NameAlign; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centred' },
  { value: 'right', label: 'Right' },
];

export interface BoardStyleSettings {
  background: string;          // hex
  bleed: boolean;              // 3mm extra background all round, for the print shop to trim off
  stripes: string | null;      // alternate-year tint, hex; null = no stripes
  yearLines: string | null;    // fine line between years, hex; null = none
  decadeLines: string | null;  // stronger line above each new decade, hex; null = none
  text: string;                // names and years
  title: string;               // club name, board name, "(continued)" line
  underline: string | null;    // short line under the board name; null = none
  headingBand: string;
  headingText: string;
  logo: LogoPlace;             // pictures beside the title
  logoPanel: boolean;          // a white panel behind each picture
  nameAlign: NameAlign;        // names left, centred or right in their column
  fonts: Record<FontSlot, FontChoice>;
}

/** Today's look: white sheet, stone stripes, green title and headings, decade lines. */
export const DEFAULT_STYLE: BoardStyleSettings = {
  background: WHITE.hex,
  bleed: false,
  stripes: STONE.hex,
  yearLines: null,
  decadeLines: DARK_GREEN.hex,
  text: NEAR_BLACK.hex,
  title: DARK_GREEN.hex,
  underline: null,
  headingBand: DARK_GREEN.hex,
  headingText: WHITE.hex,
  logo: 'none',
  logoPanel: false,
  nameAlign: 'center',
  fonts: {
    titles: { font: 'lora', bold: true, customName: '' },
    years: { font: 'lora', bold: true, customName: '' },
    names: { font: 'atkinson', bold: false, customName: '' },
  },
};

/** Ready-made combinations — picking one sets every colour, leaving the fonts alone. */
export const STYLE_SCHEMES: { name: string; hint: string; colours: Omit<BoardStyleSettings, 'fonts' | 'logo' | 'nameAlign'> }[] = [
  {
    name: 'White and green',
    hint: 'Stone stripes, green headings',
    colours: {
      background: WHITE.hex, bleed: false, stripes: STONE.hex, yearLines: null, decadeLines: DARK_GREEN.hex,
      text: NEAR_BLACK.hex, title: DARK_GREEN.hex, underline: null, headingBand: DARK_GREEN.hex, headingText: WHITE.hex, logoPanel: false,
    },
  },
  {
    name: 'Ivory and green',
    hint: 'Warm off-white, fine lines, gold line under the title',
    colours: {
      background: IVORY.hex, bleed: true, stripes: null, yearLines: LINE_IVORY.hex, decadeLines: DARK_GREEN.hex,
      text: NEAR_BLACK.hex, title: DARK_GREEN.hex, underline: WEB_GOLD.hex, headingBand: DARK_GREEN.hex, headingText: WHITE.hex, logoPanel: false,
    },
  },
  {
    name: 'Navy and gold',
    hint: 'The playing kit: navy sheet, gold names, lighter navy stripes — bold names read better on navy',
    colours: {
      background: NAVY.hex, bleed: true, stripes: LIGHTER_NAVY.hex, yearLines: null, decadeLines: KIT_GOLD.hex,
      text: KIT_GOLD.hex, title: KIT_GOLD_BRIGHT.hex, underline: KIT_GOLD.hex, headingBand: KIT_GOLD.hex, headingText: NAVY.hex, logoPanel: false,
    },
  },
];

/** Reads a saved style, filling anything missing or invalid from the default — never throws. */
export function parseBoardStyle(raw: string | null | undefined): BoardStyleSettings {
  let saved: Record<string, unknown> = {};
  // Nothing saved yet (or not JSON) means the default look
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') saved = parsed;
  } catch {
    saved = {};
  }

  /** A saved colour, or the default if it's missing or not a colour code. */
  function colour(key: keyof BoardStyleSettings, fallback: string): string {
    const v = saved[key];
    return typeof v === 'string' ? normaliseHex(v) ?? fallback : fallback;
  }
  /** As colour(), but null (switched off) is a valid saved value. */
  function optionalColour(key: keyof BoardStyleSettings, fallback: string | null): string | null {
    if (saved[key] === null) return null;
    const v = saved[key];
    return typeof v === 'string' ? normaliseHex(v) ?? fallback : fallback;
  }
  /** A saved font choice, or the default for that slot. */
  function font(slot: FontSlot): FontChoice {
    const fallback = DEFAULT_STYLE.fonts[slot];
    const fonts = saved.fonts as Record<string, Partial<FontChoice>> | undefined;
    const v = fonts && typeof fonts === 'object' ? fonts[slot] : undefined;
    if (!v || typeof v !== 'object') return fallback;
    const known = v.font === 'custom' || FONT_OPTIONS.some((f) => f.key === v.font);
    return {
      font: known ? (v.font as FontKey) : fallback.font,
      bold: typeof v.bold === 'boolean' ? v.bold : fallback.bold,
      customName: typeof v.customName === 'string' ? v.customName : '',
    };
  }

  const d = DEFAULT_STYLE;
  return {
    background: colour('background', d.background),
    bleed: typeof saved.bleed === 'boolean' ? saved.bleed : d.bleed,
    stripes: optionalColour('stripes', d.stripes),
    yearLines: optionalColour('yearLines', d.yearLines),
    decadeLines: optionalColour('decadeLines', d.decadeLines),
    text: colour('text', d.text),
    title: colour('title', d.title),
    underline: optionalColour('underline', d.underline),
    headingBand: colour('headingBand', d.headingBand),
    headingText: colour('headingText', d.headingText),
    logo: LOGO_PLACES.some((p) => p.value === saved.logo) ? (saved.logo as LogoPlace) : d.logo,
    logoPanel: typeof saved.logoPanel === 'boolean' ? saved.logoPanel : d.logoPanel,
    nameAlign: NAME_ALIGNS.some((a) => a.value === saved.nameAlign) ? (saved.nameAlign as NameAlign) : d.nameAlign,
    fonts: { titles: font('titles'), years: font('years'), names: font('names') },
  };
}

/** True when two styles print the same — used to show "(saved)" and "Back to saved". */
export function sameStyle(a: BoardStyleSettings, b: BoardStyleSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Pairs of colours that may be hard to read, with a plain-English description of each. */
export function contrastWarnings(style: BoardStyleSettings): string[] {
  const warnings: string[] = [];
  // 4.5 is the usual minimum for text; anything under it is worth a second look on the wall
  const checks: [string, string, string][] = [
    [style.text, style.background, 'Names on the background'],
    [style.title, style.background, 'Title on the background'],
    [style.headingText, style.headingBand, 'Headings on the heading band'],
  ];
  if (style.stripes) checks.push([style.text, style.stripes, 'Names on the stripes']);
  for (const [fore, back, what] of checks) {
    const ratio = contrastRatio(fore, back);
    if (ratio < 4.5) warnings.push(`${what}: contrast ${ratio.toFixed(1)} to 1 — may be hard to read (4.5 or more is best)`);
  }
  // Fonts set to Custom with no name fall back to the default
  for (const { slot, label } of FONT_SLOTS) {
    const f = style.fonts[slot];
    if (f.font === 'custom' && f.customName.trim() === '') warnings.push(`${label}: no Google font name given`);
  }
  return warnings;
}

/** The Fontsource id for a Google font name, e.g. "EB Garamond" → "eb-garamond". */
export function fontsourceId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** What a Google font offers, from the Fontsource catalogue. */
export interface CustomFontInfo {
  id: string;
  family: string;
  weights: number[];
}

/**
 * Looks up a Google font by name in the free Fontsource catalogue (in the browser).
 * Returns null if there's no such font, or it has no Latin letters.
 */
export async function lookupCustomFont(name: string): Promise<CustomFontInfo | null> {
  const id = fontsourceId(name);
  if (!id) return null;
  const res = await fetch(`https://api.fontsource.org/v1/fonts/${id}`);
  // 404 = not a font Fontsource knows
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data.weights) || !Array.isArray(data.subsets) || !data.subsets.includes('latin')) return null;
  return { id: data.id, family: data.family, weights: data.weights as number[] };
}

/** The available weight nearest the one wanted (400 for regular, 700 for bold). */
export function nearestWeight(weights: number[], bold: boolean): number {
  const wanted = bold ? 700 : 400;
  let best = weights[0] ?? wanted;
  for (const w of weights) {
    if (Math.abs(w - wanted) < Math.abs(best - wanted)) best = w;
  }
  return best;
}

/** Address of a custom font's file on the Fontsource CDN (WOFF — the PDF library can't read WOFF2). */
export function customFontUrl(info: CustomFontInfo, weight: number): string {
  return `https://cdn.jsdelivr.net/fontsource/fonts/${info.id}@latest/latin-${weight}-normal.woff`;
}
