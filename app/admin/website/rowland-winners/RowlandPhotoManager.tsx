// app/admin/website/rowland-winners/RowlandPhotoManager.tsx
// Per-season photo widget for the Rowland Winners admin page — one slot each
// for the Edward and Gladys Rowland Cup winner photo. Uploads go browser ->
// Drive directly via a resumable session (same pattern as the Documents page).
// The server always names the uploaded file "edward<ext>"/"gladys<ext>" and
// replaces any existing photo for that competition, so there's never more
// than one match for the website's filename-based lookup.

'use client';

import { useEffect, useState } from 'react';
import { getButtonClasses, getAlertClasses } from '@/config/theme-helpers';

interface DrivePhoto {
  id: string;
  name: string;
}

type Competition = 'edward' | 'gladys';

const LABELS: Record<Competition, string> = {
  edward: 'Edward Rowland Cup photo',
  gladys: 'Gladys Rowland Cup photo',
};

export default function RowlandPhotoManager({ year }: { year: number }) {
  const [photos, setPhotos] = useState<Record<Competition, DrivePhoto | null> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Competition | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Competition | null>(null);
  const [deleting, setDeleting] = useState<Competition | null>(null);
  const [draggingOver, setDraggingOver] = useState<Competition | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/website/rowland-photos/${year}`);
      if (!res.ok) {
        setError('Failed to load photos.');
        return;
      }
      const json = await res.json();
      setPhotos(json.photos);
    } catch {
      setError('Failed to load photos.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (competition: Competition, file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    setError(null);
    setUploading(competition);
    try {
      const sessionRes = await fetch(`/api/admin/website/rowland-photos/${year}/upload-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competition, fileName: file.name }),
      });
      if (!sessionRes.ok) {
        throw new Error((await sessionRes.json()).error || 'Failed to create upload session');
      }
      const { sessionUri } = await sessionRes.json();

      const driveRes = await fetch(sessionUri, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!driveRes.ok) {
        throw new Error(`Drive upload failed: ${driveRes.status}`);
      }

      // Tell the server the upload completed — it never otherwise learns this,
      // since the bytes went straight from the browser to Drive. This is what
      // triggers the website's cache to flush.
      await fetch(`/api/admin/website/rowland-photos/${year}`, { method: 'POST' }).catch(() => {});

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo.');
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (competition: Competition) => {
    setDeleting(competition);
    setError(null);
    try {
      const res = await fetch(`/api/admin/website/rowland-photos/${year}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competition }),
      });
      if (!res.ok) {
        throw new Error((await res.json()).error || 'Failed to delete photo');
      }
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete photo.');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return <p className="text-xs text-gray-700">Loading photos…</p>;
  }

  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {error ? <div className={getAlertClasses('danger') + ' text-xs sm:col-span-2'}>{error}</div> : null}

      {(['edward', 'gladys'] as Competition[]).map((competition) => {
        const photo = photos?.[competition] ?? null;
        return (
          <div
            key={competition}
            onDragOver={(e) => { e.preventDefault(); setDraggingOver(competition); }}
            onDragLeave={(e) => { e.preventDefault(); setDraggingOver(null); }}
            onDrop={(e) => {
              e.preventDefault();
              setDraggingOver(null);
              const dropped = e.dataTransfer.files[0];
              if (dropped) handleFileSelect(competition, dropped);
            }}
            className={`border-2 border-dashed rounded-md p-3 transition-colors ${
              draggingOver === competition ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
            }`}
          >
            <p className="text-xs font-semibold text-gray-700 mb-1">{LABELS[competition]}</p>

            {photo ? (
              <div className="text-xs text-gray-700 space-y-1">
                <a
                  href={`https://drive.google.com/file/d/${photo.id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 underline break-all"
                >
                  {photo.name}
                </a>
                {confirmDelete === competition ? (
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => handleDelete(competition)} disabled={deleting === competition} className={getButtonClasses('danger', 'sm')}>
                      {deleting === competition ? 'Deleting…' : 'Confirm'}
                    </button>
                    <button onClick={() => setConfirmDelete(null)} disabled={deleting === competition} className={getButtonClasses('secondary', 'sm')}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 pt-1">
                    <label className={getButtonClasses('secondary', 'sm') + ' cursor-pointer'}>
                      {uploading === competition ? 'Uploading…' : 'Replace'}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        disabled={uploading === competition}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(competition, f); }}
                      />
                    </label>
                    <button onClick={() => setConfirmDelete(competition)} className={getButtonClasses('danger', 'sm')}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-700">
                <label className={getButtonClasses('secondary', 'sm') + ' cursor-pointer inline-block'}>
                  {uploading === competition ? 'Uploading…' : 'Choose photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={uploading === competition}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(competition, f); }}
                  />
                </label>
                <span className="ml-2">or drag and drop</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
