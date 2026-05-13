// src/components/AttachmentUpload.tsx
// Upload component for entity attachments.
// Images are compressed client-side before upload.
// File bytes go browser → Google Drive directly (no Vercel payload limit).

'use client';

import { useState, useRef } from 'react';
import imageCompression from 'browser-image-compression';
import type { AttachmentType } from '@/types/attachments';

interface AttachmentUploadProps {
  apiBasePath: string; // e.g. "/api/suggestions/SG-2026-001"
  onUploadComplete: () => void;
  onCancel: () => void;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Extract entityId from apiBasePath — last path segment.
function entityIdFromPath(apiBasePath: string): string {
  return apiBasePath.split('/').filter(Boolean).pop() || '';
}

export function AttachmentUpload({
  apiBasePath,
  onUploadComplete,
  onCancel,
}: AttachmentUploadProps) {
  const [type, setType] = useState<AttachmentType>('image');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<'compressing' | 'uploading' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  };

  const handleFileSelect = (selected: File) => {
    if (selected.size > 50 * 1024 * 1024) {
      setError('File size exceeds 50MB limit');
      return;
    }
    setType(IMAGE_TYPES.includes(selected.type) ? 'image' : 'document');
    setFile(selected);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!description.trim()) { setError('Description is required'); return; }
    if (type === 'link' && !url.trim()) { setError('URL is required for links'); return; }
    if (type !== 'link' && !file) { setError('Please select a file'); return; }

    setUploading(true);

    try {
      if (type === 'link') {
        await fetch(`${apiBasePath}/attachments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'link', description, url }),
        }).then(async (r) => {
          if (!r.ok) throw new Error((await r.json()).error || 'Failed to save link');
        });
        onUploadComplete();
        return;
      }

      // ── File upload ──────────────────────────────────────────────────────
      let uploadFile: File = file!;
      let finalMimeType = file!.type;
      let finalFileName = file!.name;

      // Compress and convert images to WebP client-side before upload
      if (IMAGE_TYPES.includes(file!.type)) {
        setUploadPhase('compressing');
        try {
          const compressed = await imageCompression(file!, {
            maxSizeMB: 2,
            maxWidthOrHeight: 2000,
            useWebWorker: true,
            fileType: 'image/webp',
            initialQuality: 0.85,
          });
          // Always use WebP — it's the right web format regardless of size comparison
          uploadFile = new File(
            [compressed],
            file!.name.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '.webp'),
            { type: 'image/webp' }
          );
          finalMimeType = 'image/webp';
          finalFileName = uploadFile.name;
        } catch {
          // Compression failed — upload original
        }
      }

      // Step 1: get a Drive resumable upload session URI from our server
      setUploadPhase('uploading');
      const entityId = entityIdFromPath(apiBasePath);
      const sessionRes = await fetch('/api/attachments/upload-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId, fileName: finalFileName, mimeType: finalMimeType }),
      });
      if (!sessionRes.ok) {
        throw new Error((await sessionRes.json()).error || 'Failed to create upload session');
      }
      const { sessionUri } = await sessionRes.json();

      // Step 2: PUT the file directly to Drive (bypasses Vercel entirely)
      const driveRes = await fetch(sessionUri, {
        method: 'PUT',
        headers: { 'Content-Type': finalMimeType },
        body: uploadFile,
      });
      if (!driveRes.ok) {
        const text = await driveRes.text();
        throw new Error(`Drive upload failed: ${driveRes.status} ${text}`);
      }
      const driveFile = await driveRes.json();
      const fileId: string = driveFile.id;

      // Step 3: confirm with our server — sets permissions and stores in Sheets
      setUploadPhase('saving');
      const confirmRes = await fetch(`${apiBasePath}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          description,
          fileId,
          fileName: finalFileName,
          mimeType: finalMimeType,
          fileSize: uploadFile.size,
        }),
      });
      if (!confirmRes.ok) {
        throw new Error((await confirmRes.json()).error || 'Failed to save attachment');
      }

      onUploadComplete();
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload attachment');
    } finally {
      setUploading(false);
      setUploadPhase(null);
    }
  };

  const uploadButtonLabel = () => {
    if (!uploading) return 'Upload';
    switch (uploadPhase) {
      case 'compressing': return 'Compressing…';
      case 'uploading':   return 'Uploading…';
      case 'saving':      return 'Saving…';
      default:            return 'Uploading…';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Add Attachment</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Type Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Attachment Type</label>
          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                value="file"
                checked={type !== 'link'}
                onChange={() => { setType('image'); setFile(null); setUrl(''); }}
                className="mr-2"
              />
              File
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="link"
                checked={type === 'link'}
                onChange={() => { setType('link'); setFile(null); }}
                className="mr-2"
              />
              Link
            </label>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this attachment"
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>

        {/* URL Input */}
        {type === 'link' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>
        )}

        {/* File Drop Zone */}
        {type !== 'link' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">File *</label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <input
                ref={fileInputRef}
                id="attachment-file-input"
                type="file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                accept="*"
                className="sr-only"
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                className="sr-only"
              />
              {file ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <button type="button" onClick={() => setFile(null)} className="text-sm text-red-600 hover:text-red-700">
                    Remove
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <div className="text-sm text-gray-600">
                    <label htmlFor="attachment-file-input" className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer">
                      Choose a file
                    </label>{' '}or drag and drop
                  </div>
                  <div className="text-sm text-gray-500">
                    or{' '}
                    <button type="button" onClick={() => cameraInputRef.current?.click()} className="text-blue-600 hover:text-blue-700 font-medium">
                      take a photo
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">Images, PDFs, documents, spreadsheets — up to 50MB</p>
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {uploading && (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {uploadButtonLabel()}
          </button>
        </div>
      </form>
    </div>
  );
}
