'use client';

// src/components/HonoursBoardStyleEditor.tsx
// Edits how the printed honours boards look, grouped by what they change: ready-made schemes,
// the sheet (colour, bleed), the title, the headings and years, the names (with their
// stripes and lines), and the crest beside the title.
// Used on the Print Honours Boards page, for a preview or one-off print (an Admin can save
// it as the club style). Any colour can be typed as a hex code; a code that
// matches a named colour shows as that name.

import { useEffect, useState } from 'react';
import { getInputClasses } from '@/config/theme-helpers';
import {
  BACKGROUND_PRESETS, BAND_PRESETS, FONT_OPTIONS, FONT_SLOTS, LINE_PRESETS, LOGO_PLACES, NAME_ALIGNS, STRIPE_PRESETS, STYLE_SCHEMES, TEXT_PRESETS,
  contrastWarnings, customFontUrl, findPreset, lookupCustomFont, nearestWeight, normaliseHex,
} from '@/types/honours-board-style';
import type { BoardStyleSettings, ColourPreset, FontChoice, FontKey, FontSlot } from '@/types/honours-board-style';

export function HonoursBoardStyleEditor({ value, onChange }: { value: BoardStyleSettings; onChange: (style: BoardStyleSettings) => void }) {
  /** Changes some settings, keeping the rest. */
  function set(changes: Partial<BoardStyleSettings>) {
    onChange({ ...value, ...changes });
  }

  /** Changes one font setting. */
  function setFont(slot: FontSlot, changes: Partial<FontChoice>) {
    onChange({ ...value, fonts: { ...value.fonts, [slot]: { ...value.fonts[slot], ...changes } } });
  }

  const warnings = contrastWarnings(value);

  return (
    <div className="space-y-5 text-sm">
      {/* Ready-made schemes: set every colour at once, fonts left alone */}
      <div>
        <span className="block text-gray-700 mb-1">Start from a scheme</span>
        <div className="flex flex-wrap gap-2">
          {STYLE_SCHEMES.map((scheme) => (
            <button
              key={scheme.name}
              type="button"
              onClick={() => onChange({ ...value, ...scheme.colours })}
              title={scheme.hint}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 hover:bg-gray-50"
            >
              <span className="inline-block h-4 w-4 rounded-sm border border-gray-300" style={{ backgroundColor: scheme.colours.background }} />
              <span className="inline-block h-4 w-4 rounded-sm border border-gray-300" style={{ backgroundColor: scheme.colours.text }} />
              {scheme.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-700 mt-1">Each sets all the colours below; you can then change any of them.</p>
      </div>

      {/* The sheet */}
      <fieldset className="space-y-2">
        <legend className="font-medium text-gray-900">Sheet</legend>
        <ColourField
          label="Sheet colour"
          value={value.background}
          presets={BACKGROUND_PRESETS}
          onChange={(hex) => {
            // A coloured sheet needs printing to the edge, so bleed comes on; white doesn't need it
            set({ background: hex ?? value.background, bleed: hex !== '#ffffff' });
          }}
        />
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={value.bleed} onChange={(e) => set({ bleed: e.target.checked })} className="h-4 w-4 mt-0.5" />
          <span>
            <span className="text-gray-900">Add 3mm bleed</span>
            <span className="text-gray-700"> — 3mm of extra background all round for the print shop to trim off, so the colour runs to the very edge. Needed for any colour other than white.</span>
          </span>
        </label>
      </fieldset>

      {/* The title: club name, board name and the "(continued)" line */}
      <fieldset className="space-y-2">
        <legend className="font-medium text-gray-900">Title</legend>
        <ColourField label="Font colour" value={value.title} presets={TEXT_PRESETS} onChange={(hex) => hex && set({ title: hex })} />
        <FontRow slot="titles" value={value} setFont={setFont} />
        <ColourField label="Line under the title" value={value.underline} presets={LINE_PRESETS} allowNone onChange={(hex) => set({ underline: hex })} />
      </fieldset>

      {/* Column headings (on the band) and the years (on the sheet) share a font */}
      <fieldset className="space-y-2">
        <legend className="font-medium text-gray-900">Headings and years</legend>
        <ColourField label="Band colour" value={value.headingBand} presets={BAND_PRESETS} onChange={(hex) => hex && set({ headingBand: hex })} />
        <ColourField label="Heading font colour" value={value.headingText} presets={TEXT_PRESETS} onChange={(hex) => hex && set({ headingText: hex })} />
        <ColourField label="Year font colour" value={value.years} presets={TEXT_PRESETS} onChange={(hex) => hex && set({ years: hex })} />
        <FontRow slot="headings" value={value} setFont={setFont} />
        <p className="text-xs text-gray-700">The headings sit on the band and the years on the sheet, so each has its own colour.</p>
      </fieldset>

      {/* The names, and the stripes and lines that separate their rows */}
      <fieldset className="space-y-2">
        <legend className="font-medium text-gray-900">Names</legend>
        <ColourField label="Font colour" value={value.text} presets={TEXT_PRESETS} onChange={(hex) => hex && set({ text: hex })} />
        <FontRow slot="names" value={value} setFont={setFont} />
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
          <span className="sm:col-span-4 text-gray-900">In their column</span>
          <div className="sm:col-span-8 flex flex-wrap gap-4">
            {NAME_ALIGNS.map((a) => (
              <label key={a.value} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="honoursNameAlign" checked={value.nameAlign === a.value} onChange={() => set({ nameAlign: a.value })} className="h-4 w-4" />
                <span className="text-gray-900">{a.label}</span>
              </label>
            ))}
          </div>
        </div>
        <ColourField label="Alternate years colour" value={value.stripes} presets={STRIPE_PRESETS} allowNone onChange={(hex) => set({ stripes: hex })} />
        <ColourField label="Fine line between years" value={value.yearLines} presets={LINE_PRESETS} allowNone onChange={(hex) => set({ yearLines: hex })} />
        <ColourField label="Line between decades" value={value.decadeLines} presets={LINE_PRESETS} allowNone onChange={(hex) => set({ decadeLines: hex })} />
        <p className="text-xs text-gray-700">
          Custom fonts take any font from fonts.google.com by name; they&apos;re fetched when printing and embedded in the PDF.
        </p>
      </fieldset>

      {/* Club crest (and centenary pin) beside the title */}
      <fieldset className="space-y-2">
        <legend className="font-medium text-gray-900">Crest beside the title</legend>
        <div className="flex flex-wrap gap-4">
          {LOGO_PLACES.map((p) => (
            <label key={p.value} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="honoursCrest" checked={value.logo === p.value} onChange={() => set({ logo: p.value })} className="h-4 w-4" />
              <span className="text-gray-900">{p.label}</span>
            </label>
          ))}
        </div>
        {/* The panel only matters once there is a picture */}
        {value.logo !== 'none' && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={value.logoPanel} onChange={(e) => set({ logoPanel: e.target.checked })} className="h-4 w-4 mt-0.5" />
            <span>
              <span className="text-gray-900">White panel behind each picture</span>
              <span className="text-gray-700"> — not needed: the pictures are cut out so they sit on any colour, but a panel (like the app icon) is there if you prefer it.</span>
            </span>
          </label>
        )}
        <p className="text-xs text-gray-700">On the first sheet of each board only, in the space beside the title.</p>
      </fieldset>

      {/* Test prints: a note of how each sheet was printed, so prints can be compared */}
      <fieldset className="space-y-2">
        <legend className="font-medium text-gray-900">Test prints</legend>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={value.printNote} onChange={(e) => set({ printNote: e.target.checked })} className="h-4 w-4 mt-0.5" />
          <span>
            <span className="text-gray-900">Print settings note</span>
            <span className="text-gray-700"> — the fonts, row control, line spacing, name size and date, in small print at the bottom of every sheet. The last row of names (two if the rows are very small) is left off to make room. Not for the wall.</span>
          </span>
        </label>
      </fieldset>

      {warnings.length > 0 && (
        <ul className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-900 space-y-1">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <p className="text-xs text-gray-700">
        The PDF holds the colours as screen colours (RGB); the print shop converts them for printing
        (CMYK), which can shift them a little — navy is the one most likely to change. The CMYK
        values shown are a starting point to give them; ask for a proof before printing a full set.
      </p>
    </div>
  );
}

/** The font setting for one section (title, headings and years, or names). */
function FontRow({ slot, value, setFont }: { slot: FontSlot; value: BoardStyleSettings; setFont: (slot: FontSlot, changes: Partial<FontChoice>) => void }) {
  const info = FONT_SLOTS.find((f) => f.slot === slot);
  if (!info) return null;
  return <FontField label={info.label} hint={info.hint} sample={info.sample} value={value.fonts[slot]} onChange={(changes) => setFont(slot, changes)} />;
}

/** One colour: a named colour, none (where allowed) or any hex code. Also used by the photo plaque. */
export function ColourField({ label, value, presets, allowNone = false, onChange }: {
  label: string;
  value: string | null;
  presets: ColourPreset[];
  allowNone?: boolean;
  onChange: (hex: string | null) => void;
}) {
  const preset = value ? findPreset(value) : null;
  // The hex box is typed into freely; only a complete colour code is passed on
  const [typed, setTyped] = useState(value ?? '');
  const [customOpen, setCustomOpen] = useState(false);

  // When the value changes (a scheme, Back to saved, or a code typed here), show it in the box
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setTyped(value ?? '');
  }

  // Which option the list shows: a named colour, none, or custom
  const named = preset && presets.some((p) => p.hex === preset.hex) ? preset : null;
  const selected = value === null ? 'none' : named && !customOpen ? named.hex : 'custom';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
      <span className="sm:col-span-4 text-gray-900">{label}</span>
      <div className="sm:col-span-8 flex flex-wrap items-center gap-2">
        <span
          className="inline-block h-6 w-6 rounded border border-gray-300 shrink-0"
          style={{ backgroundColor: value ?? 'transparent', backgroundImage: value ? undefined : 'linear-gradient(45deg, transparent 45%, #b91c1c 45%, #b91c1c 55%, transparent 55%)' }}
          aria-hidden="true"
        />
        <select
          value={selected}
          onChange={(e) => {
            const choice = e.target.value;
            // Custom: keep the current colour and open the hex box to change it
            if (choice === 'custom') {
              setCustomOpen(true);
              if (value === null) onChange(presets[0].hex);
              return;
            }
            setCustomOpen(false);
            onChange(choice === 'none' ? null : choice);
          }}
          className={`${getInputClasses()} w-48`}
          aria-label={label}
        >
          {allowNone && <option value="none">None</option>}
          {presets.map((p) => <option key={p.hex} value={p.hex}>{p.name}</option>)}
          <option value="custom">{named || value === null ? 'Custom colour…' : `Custom (${preset ? preset.name : value})`}</option>
        </select>
        {selected === 'custom' && (
          <input
            type="text"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              // Only a full six-digit code is used — "#1b2" on the way to "#1b2a4a" isn't a colour yet
              const hex = /^#?[0-9a-f]{6}$/i.test(e.target.value.trim()) ? normaliseHex(e.target.value) : null;
              if (hex) onChange(hex);
            }}
            className={`${getInputClasses()} w-28 font-mono`}
            placeholder="#1b2a4a"
            aria-label={`${label} colour code`}
          />
        )}
        {value && (
          <span className="text-xs text-gray-700">
            {preset?.cmyk ? `${value} · approx. ${preset.cmyk}` : `${value} · ask the print shop to match this code`}
          </span>
        )}
      </div>
    </div>
  );
}

/** One font setting: bundled font or a Google font by name, regular or bold, with a sample. */
function FontField({ label, hint, sample, value, onChange }: {
  label: string;
  hint: string;
  sample: string;
  value: FontChoice;
  onChange: (changes: Partial<FontChoice>) => void;
}) {
  const [sampleFamily, setSampleFamily] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  // Runs when the font changes: load it into the page to show a sample, and for a Google
  // font check the name exists (after a pause in typing, so it isn't looked up every letter)
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        let url: string;
        let weightLabel = '';
        // A Google font: look it up first
        if (value.font === 'custom') {
          const name = value.customName.trim();
          if (!name) {
            setStatus('Type a font name from fonts.google.com');
            setSampleFamily(null);
            return;
          }
          setStatus('Looking up…');
          const info = await lookupCustomFont(name);
          if (cancelled) return;
          if (!info) {
            setStatus(`"${name}" isn't a Google font — check the spelling`);
            setSampleFamily(null);
            return;
          }
          const weight = nearestWeight(info.weights, value.bold);
          url = customFontUrl(info, weight);
          weightLabel = `Found ${info.family}, weight ${weight}`;
        } else {
          const option = FONT_OPTIONS.find((f) => f.key === value.font) ?? FONT_OPTIONS[0];
          url = `/fonts/honours-boards/${option.file}-${value.bold ? option.bold : option.regular}-normal.woff`;
        }
        // Load the file under its own name so the sample shows exactly what prints
        const family = `honours-sample-${url.replace(/[^a-z0-9]/gi, '')}`;
        const face = new FontFace(family, `url(${url})`);
        await face.load();
        document.fonts.add(face);
        if (cancelled) return;
        setSampleFamily(family);
        setStatus(weightLabel);
      } catch {
        if (!cancelled) setStatus("Couldn't load the font — check the internet connection");
      }
    }, value.font === 'custom' ? 600 : 0);
    // Runs when the font changes again before this one finished: ignore the old result
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value.font, value.bold, value.customName]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
      <div className="sm:col-span-4">
        <span className="block text-gray-900">{label}</span>
        <span className="block text-xs text-gray-700">{hint}</span>
      </div>
      <div className="sm:col-span-8 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <select value={value.font} onChange={(e) => onChange({ font: e.target.value as FontKey })} className={`${getInputClasses()} w-64`} aria-label={`${label} font`}>
            {FONT_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            <option value="custom">Custom (Google font)…</option>
          </select>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={value.bold} onChange={(e) => onChange({ bold: e.target.checked })} className="h-4 w-4" />
            <span className="text-gray-900">Bold</span>
          </label>
          {value.font === 'custom' && (
            <input
              type="text"
              value={value.customName}
              onChange={(e) => onChange({ customName: e.target.value })}
              className={`${getInputClasses()} w-48`}
              placeholder="e.g. EB Garamond"
              aria-label={`${label} Google font name`}
            />
          )}
        </div>
        {value.font !== 'custom' && (
          <span className="block text-xs text-gray-700">{FONT_OPTIONS.find((f) => f.key === value.font)?.hint}</span>
        )}
        {status && <span className="block text-xs text-gray-700">{status}</span>}
        {sampleFamily && (
          <span className="block text-lg text-gray-900" style={{ fontFamily: `"${sampleFamily}"` }}>{sample}</span>
        )}
      </div>
    </div>
  );
}
