// app/admin/website/honours-internal/HonoursPhotoManager.tsx
// Per-season photo widget for the Internal Honours admin page — a small
// gallery, since a year folder can hold more than one champions photo (no
// naming convention needed, unlike Rowland's edward/gladys distinction).
// Uploads go browser -> Drive directly via a resumable session.

'use client';

import { useEffect, useState } from 'react';
import { getButtonClasses, getAlertClasses } from '@/config/theme-helpers';

interface DrivePhoto {
  id: string;
  name: string;
}

export default function HonoursPhotoManager({ year }: { year: number }) {
  const [photos, setPhotos] = useState<DrivePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/website/honours-photos/${year}`);
      if (!res.ok) {
        setError('Failed to load photos.');
        return;
      }
      const json = await res.json();
      setPhotos(json.photos || []);
    } catch {
      setError('Failed to load photos.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const sessionRes = await fetch(`/api/admin/website/honours-photos/${year}/upload-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
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

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId: string) => {
    setDeletingId(fileId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/website/honours-photos/${year}/${fileId}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error((await res.json()).error || 'Failed to delete photo');
      }
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete photo.');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return <p className="text-xs text-gray-700">Loading photos…</p>;
  }

  return (
    <div className="mt-3">
      {error ? <div className={getAlertClasses('danger') + ' text-xs mb-2'}>{error}</div> : null}

      {photos.length > 0 ? (
        <ul className="space-y-1 mb-2">
          {photos.map((photo) => (
            <li key={photo.id} className="flex items-center justify-between gap-2 text-xs">
              <a
                href={`https://drive.google.com/file/d/${photo.id}/view`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 underline truncate"
              >
                {photo.name}
              </a>
              {confirmDeleteId === photo.id ? (
                <span className="flex gap-1 shrink-0">
                  <button onClick={() => handleDelete(photo.id)} disabled={deletingId === photo.id} className={getButtonClasses('danger', 'sm')}>
                    {deletingId === photo.id ? 'Deleting…' : 'Confirm'}
                  </button>
                  <button onClick={() => setConfirmDeleteId(null)} disabled={deletingId === photo.id} className={getButtonClasses('secondary', 'sm')}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmDeleteId(photo.id)} className={getButtonClasses('danger', 'sm') + ' shrink-0'}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div
        onDragOver={(e) => { e.preventDefault(); setDraggingOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDraggingOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDraggingOver(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped) handleFileSelect(dropped);
        }}
        className={`border-2 border-dashed rounded-md p-3 text-xs text-gray-700 transition-colors ${
          draggingOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
        }`}
      >
        <label className={getButtonClasses('secondary', 'sm') + ' cursor-pointer inline-block'}>
          {uploading ? 'Uploading…' : 'Add photo'}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
          />
        </label>
        <span className="ml-2">or drag and drop</span>
      </div>
    </div>
  );
}
