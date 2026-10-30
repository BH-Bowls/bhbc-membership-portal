// src/lib/honours-plaque.ts
// Draws a photo plaque for an honours photo: the photo kept whole, with a band added
// underneath in the honours board style — the sheet colour for the band, a centred title in
// the title font and colour, and up to two lines of names in the names font and colour, with
// an optional border round the band. Browser only (canvas).

import { fontFileFor } from '@/types/honours-board-style';
import type { BoardStyleSettings } from '@/types/honours-board-style';

/** How big the plaque's text is, relative to the photo's width. */
export type PlaqueSize = 'small' | 'medium' | 'large' | 'xlarge';

export const PLAQUE_SIZES: { value: PlaqueSize; label: string; scale: number }[] = [
  { value: 'small', label: 'Small', scale: 0.8 },
  { value: 'medium', label: 'Medium', scale: 1 },
  { value: 'large', label: 'Large', scale: 1.25 },
  { value: 'xlarge', label: 'Extra large', scale: 1.5 },
];

export interface PlaqueText {
  title: string;
  lines: [string, string]; // two lines of names; either can be blank
}

export interface PlaqueOptions {
  size: PlaqueSize;
  border: string | null; // hex, or null for no border
}

/** The browser's names for the loaded title and names fonts. */
export interface PlaqueFonts {
  title: string;
  names: string;
}

// Font files already loaded into the page, by file address
const loadedFonts = new Map<string, string>();

/** Loads the font for one setting into the page (once per file) and returns its name for drawing. */
async function browserFont(choice: BoardStyleSettings['fonts']['titles']): Promise<string> {
  const file = await fontFileFor(choice, window.location.origin);
  let family = loadedFonts.get(file.url);
  if (!family) {
    family = `honours-plaque-${loadedFonts.size + 1}`;
    const face = new FontFace(family, `url(${file.url})`);
    try {
      await face.load();
    } catch {
      throw new Error(`Couldn't load the font ${file.family}. Check the internet connection and try again.`);
    }
    document.fonts.add(face);
    loadedFonts.set(file.url, family);
  }
  return family;
}

/** Loads the title and names fonts from the board style. Throws with a message to show. */
export async function loadPlaqueFonts(style: BoardStyleSettings): Promise<PlaqueFonts> {
  const [title, names] = await Promise.all([browserFont(style.fonts.titles), browserFont(style.fonts.names)]);
  return { title, names };
}

/** Reads a photo file, turned the right way up (phones store the rotation separately). */
export async function readPhoto(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("This photo can't be opened here. iPhone HEIC photos need saving as JPEG first.");
  }
}

// Sizes as a share of the photo's width (per cent), before the size setting
const TITLE_SIZE = 3.9;
const NAMES_SIZE = 3.0;
const PAD = 2.4;          // space round the text inside the band
const LINE_HEIGHT = 1.3;  // the fonts' natural line spacing
const BORDER_WIDTH = 0.35;
const BORDER_INSET = 1;   // the border sits this far in from the band's edges

/** True when there's something to put on the plaque. */
export function hasPlaqueText(text: PlaqueText): boolean {
  return text.title.trim() !== '' || text.lines.some((l) => l.trim() !== '');
}

/** Draws the photo and its plaque onto the canvas, at the photo's full size. */
export function drawPlaque(canvas: HTMLCanvasElement, photo: ImageBitmap, text: PlaqueText, style: BoardStyleSettings, fonts: PlaqueFonts, options: PlaqueOptions): void {
  const scale = PLAQUE_SIZES.find((s) => s.value === options.size)?.scale ?? 1;
  const W = photo.width;
  const unit = (W / 100) * scale;
  const pad = PAD * unit;
  const inset = options.border ? BORDER_INSET * unit : 0;
  const room = W - (pad + inset) * 2;

  // The plaque's lines, top to bottom: title, then the names lines that have something in them
  const lines: { text: string; family: string; colour: string; size: number }[] = [];
  if (text.title.trim()) lines.push({ text: text.title.trim(), family: fonts.title, colour: style.title, size: TITLE_SIZE * unit });
  for (const l of text.lines) {
    if (l.trim()) lines.push({ text: l.trim(), family: fonts.names, colour: style.text, size: NAMES_SIZE * unit });
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("This browser can't draw the plaque.");

  // A line too wide for the photo is made smaller to fit, never cut off
  for (const line of lines) {
    ctx.font = `${line.size}px "${line.family}"`;
    const width = ctx.measureText(line.text).width;
    if (width > room) line.size *= room / width;
  }

  const bandH = Math.round(lines.reduce((h, l) => h + l.size * LINE_HEIGHT, 0) + (pad + inset) * 2);
  canvas.width = W;
  canvas.height = photo.height + bandH;

  ctx.drawImage(photo, 0, 0);
  ctx.fillStyle = style.background;
  ctx.fillRect(0, photo.height, W, bandH);

  // Optional border, just inside the band like the edge of a plate
  if (options.border) {
    const lw = BORDER_WIDTH * unit;
    ctx.strokeStyle = options.border;
    ctx.lineWidth = lw;
    ctx.strokeRect(inset + lw / 2, photo.height + inset + lw / 2, W - inset * 2 - lw, bandH - inset * 2 - lw);
  }

  // Each line centred in its own slot
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let y = photo.height + pad + inset;
  for (const line of lines) {
    const slot = line.size * LINE_HEIGHT;
    ctx.font = `${line.size}px "${line.family}"`;
    ctx.fillStyle = line.colour;
    ctx.fillText(line.text, W / 2, y + slot / 2);
    y += slot;
  }
}

/** The saved file's name: the photo's name with " plaque" added (not added twice). */
export function plaqueFileName(photoName: string, asPng: boolean): string {
  const base = photoName.replace(/\.[a-z0-9]+$/i, '').replace(/ plaque$/i, '');
  return `${base} plaque${asPng ? '.png' : '.jpg'}`;
}

/** True for a file name made by plaqueFileName — so plaques aren't offered as photos to caption. */
export function isPlaqueFile(name: string): boolean {
  return / plaque\.[a-z0-9]+$/i.test(name);
}

/** The finished image: PNG if the photo was a PNG, otherwise a high-quality JPEG. */
export function plaqueBlob(canvas: HTMLCanvasElement, asPng: boolean): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't make the image."))), asPng ? 'image/png' : 'image/jpeg', 0.92);
  });
}
