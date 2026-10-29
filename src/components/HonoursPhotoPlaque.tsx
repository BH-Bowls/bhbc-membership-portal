// src/components/HonoursPhotoPlaque.tsx
// Photo plaque, on the Print Honours Boards page: choose a season's champions photo from
// Google Drive (WEBSITE_DOCUMENTS_FOLDER_ID/Honours/<year>) or from this computer, type a title
// and up to two lines of names, and a band is added under the photo in the honours board style.
// Save it back to that season's Drive folder as "<photo name> plaque" (the original is never
// changed; the website shows both), or download it.

'use client';

import { useEffect, useRef, useState } from 'react';
import { getAlertClasses, getButtonClasses, getInputClasses } from '@/config/theme-helpers';
import { ColourField } from '@/components/HonoursBoardStyleEditor';
import { TEXT_PRESETS } from '@/types/honours-board-style';
import type { BoardStyleSettings } from '@/types/honours-board-style';
import {
  PLAQUE_SIZES, drawPlaque, hasPlaqueText, isPlaqueFile, loadPlaqueFonts, plaqueBlob, plaqueFileName, readPhoto,
} from '@/lib/honours-plaque';
import type { PlaqueSize } from '@/lib/honours-plaque';

interface DrivePhoto {
  id: string;
  name: string;
}

/** The photo being captioned: where it came from, its name and its picture. */
interface ChosenPhoto {
  name: string;
  asPng: boolean;
  bitmap: ImageBitmap;
}

export function HonoursPhotoPlaque({ style, years }: { style: BoardStyleSettings; years: number[] }) {
  const [year, setYear] = useState(years[0] ?? new Date().getFullYear());
  const [photos, setPhotos] = useState<DrivePhoto[]>([]);
  const [listing, setListing] = useState(false);
  const [photo, setPhoto] = useState<ChosenPhoto | null>(null);
  const [opening, setOpening] = useState(false);

  const [title, setTitle] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [size, setSize] = useState<PlaqueSize>('medium');
  const [border, setBorder] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** Loads the list of photos in the chosen season's Drive folder. */
  async function loadPhotos(forYear: number) {
    setListing(true);
    try {
      const res = await fetch(`/api/admin/website/honours-photos/${forYear}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load photos');
      setPhotos(json.photos || []);
    } catch (err) {
      setPhotos([]);
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setListing(false);
    }
  }

  // Runs when the season changes: list that season's photos
  useEffect(() => {
    loadPhotos(year);
  }, [year]);

  const text = { title, lines: [line1, line2] as [string, string] };

  // Runs whenever the photo, wording or style changes: redraw the plaque (fonts load first)
  useEffect(() => {
    if (!photo || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    loadPlaqueFonts(style)
      .then((fonts) => {
        if (!cancelled) drawPlaque(canvas, photo.bitmap, { title, lines: [line1, line2] }, style, fonts, { size, border });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't draw the plaque");
      });
    return () => { cancelled = true; };
  }, [photo, title, line1, line2, size, border, style]);

  /** Opens a photo from the season's Drive folder. */
  async function chooseDrivePhoto(p: DrivePhoto) {
    setError(null);
    setMessage(null);
    setOpening(true);
    try {
      const res = await fetch(`/api/admin/website/honours-photos/${year}/${p.id}/content`);
      if (!res.ok) {
        let reason = 'Failed to load the photo';
        try { reason = (await res.json()).error || reason; } catch { /* not JSON — e.g. too big for the server */ }
        throw new Error(`${reason}. If it keeps failing, download it from Drive and use "From this computer".`);
      }
      const blob = await res.blob();
      setPhoto({ name: p.name, asPng: blob.type === 'image/png', bitmap: await readPhoto(blob) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the photo');
    } finally {
      setOpening(false);
    }
  }

  /** Opens a photo from this computer. */
  async function chooseComputerPhoto(file: File) {
    setError(null);
    setMessage(null);
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
      setError('Please choose an image file.');
      return;
    }
    setOpening(true);
    try {
      setPhoto({ name: file.name, asPng: file.type === 'image/png', bitmap: await readPhoto(file) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open the photo');
    } finally {
      setOpening(false);
    }
  }

  const fileName = photo ? plaqueFileName(photo.name, photo.asPng) : '';
  const existing = photos.find((p) => p.name === fileName) ?? null;
  const ready = !!photo && hasPlaqueText(text);

  /** Saves the plaque into the season's Drive folder, replacing an earlier plaque of the same name. */
  async function saveToDrive() {
    if (!photo || !canvasRef.current) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const blob = await plaqueBlob(canvasRef.current, photo.asPng);
      const sessionRes = await fetch(`/api/admin/website/honours-photos/${year}/upload-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName }),
      });
      if (!sessionRes.ok) throw new Error((await sessionRes.json()).error || 'Failed to start the upload');
      const { sessionUri } = await sessionRes.json();
      // The image goes straight from the browser to Drive
      const driveRes = await fetch(sessionUri, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
      if (!driveRes.ok) throw new Error(`Drive upload failed: ${driveRes.status}`);
      // Only once the new one is safely saved, remove the plaque it replaces
      if (existing) await fetch(`/api/admin/website/honours-photos/${year}/${existing.id}`, { method: 'DELETE' });
      // Tells the website to show it (its page is otherwise cached for a day)
      await fetch(`/api/admin/website/honours-photos/${year}`, { method: 'POST' }).catch(() => {});
      setMessage(`Saved "${fileName}" to the ${year} honours photos on Drive.`);
      await loadPhotos(year);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save to Drive');
    } finally {
      setSaving(false);
    }
  }

  /** Saves the plaque to this computer. */
  async function download() {
    if (!photo || !canvasRef.current) return;
    setError(null);
    try {
      const blob = await plaqueBlob(canvasRef.current, photo.asPng);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      // Give the browser a moment to start the download before releasing the memory
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to make the image');
    }
  }

  const photosToCaption = photos.filter((p) => !isPlaqueFile(p.name));
  const plaques = photos.filter((p) => isPlaqueFile(p.name));

  return (
    <div className="space-y-4 text-sm">
      {/* 1. The photo */}
      <fieldset className="space-y-2">
        <legend className="font-medium text-gray-900">1. Choose the photo</legend>
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-gray-900">Season</span>
          <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setMessage(null); }} className={`${getInputClasses()} w-28`}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        {listing ? (
          <p className="text-gray-700">Loading the {year} photos…</p>
        ) : photosToCaption.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {photosToCaption.map((p) => (
              <button key={p.id} onClick={() => chooseDrivePhoto(p)} disabled={opening} className={getButtonClasses(photo?.name === p.name ? 'primary' : 'secondary', 'sm')}>
                {p.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-gray-700">No {year} photos on Drive yet.</p>
        )}
        {plaques.length > 0 && <p className="text-xs text-gray-700">Plaques already saved for {year}: {plaques.map((p) => p.name).join(', ')}</p>}
        <label className={getButtonClasses('secondary', 'sm') + ' cursor-pointer inline-block'}>
          From this computer…
          <input type="file" accept="image/*" className="sr-only" disabled={opening} onChange={(e) => { const f = e.target.files?.[0]; if (f) chooseComputerPhoto(f); e.target.value = ''; }} />
        </label>
        {opening && <p className="text-gray-700">Opening the photo…</p>}
      </fieldset>

      {/* 2. The wording */}
      <fieldset className="space-y-2">
        <legend className="font-medium text-gray-900">2. Wording</legend>
        <label className="block">
          <span className="text-gray-900">Title</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Men's Championship 2025" className={`${getInputClasses()} w-full mt-0.5`} />
        </label>
        <label className="block">
          <span className="text-gray-900">Names</span>
          <input type="text" value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="J. Smith & A. N. Other" className={`${getInputClasses()} w-full mt-0.5`} />
        </label>
        <label className="block">
          <span className="text-gray-900">More names (optional)</span>
          <input type="text" value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Runners-up: B. Brown & C. Green" className={`${getInputClasses()} w-full mt-0.5`} />
        </label>
      </fieldset>

      {/* 3. The look: colours and fonts come from the print style; size and border are the plaque's own */}
      <fieldset className="space-y-2">
        <legend className="font-medium text-gray-900">3. Look</legend>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-gray-900">Text size</span>
          {PLAQUE_SIZES.map((s) => (
            <label key={s.value} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="honoursPlaqueSize" checked={size === s.value} onChange={() => setSize(s.value)} className="h-4 w-4" />
              <span className="text-gray-900">{s.label}</span>
            </label>
          ))}
        </div>
        <ColourField label="Border" value={border} presets={TEXT_PRESETS} allowNone onChange={setBorder} />
        <p className="text-xs text-gray-700">
          The plaque uses the print style above: the sheet colour for the band, the title font and colour for the
          title, and the names font and colour for the names.
        </p>
      </fieldset>

      {error && <div className={getAlertClasses('danger')}>{error}</div>}
      {message && <div className={getAlertClasses('success')}>{message}</div>}

      {/* 4. Preview and save */}
      {photo && (
        <div className="space-y-2">
          <canvas ref={canvasRef} className="max-w-full h-auto border border-gray-200 rounded" style={{ maxHeight: '70vh' }} />
          <p className="text-xs text-gray-700">Saves as &quot;{fileName}&quot;. The original photo isn&apos;t changed.</p>
          {existing && <p className="text-xs text-amber-800">A plaque with this name is already on Drive — saving replaces it.</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={saveToDrive} disabled={!ready || saving} className={getButtonClasses('primary', 'md')}>
              {saving ? 'Saving…' : `Save to Drive (${year} honours photos)`}
            </button>
            <button onClick={download} disabled={!ready || saving} className={getButtonClasses('secondary', 'md')}>
              Download
            </button>
          </div>
          {!hasPlaqueText(text) && <p className="text-xs text-gray-700">Type a title or names to save.</p>}
        </div>
      )}
    </div>
  );
}
