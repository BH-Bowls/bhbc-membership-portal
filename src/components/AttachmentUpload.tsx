// src/components/AttachmentUpload.tsx
// Upload component for suggestion attachments with drag-and-drop

'use client';

import { useState, useRef } from 'react';
import type { AttachmentType } from '@/types/attachments';

interface AttachmentUploadProps {
  apiBasePath: string; // e.g. "/api/suggestions/2026-001" or "/api/invite-games/IG-2026-001"
  onUploadComplete: () => void;
  onCancel: () => void;
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
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const handleFileSelect = (selectedFile: File) => {
    // Validate file size (50MB max)
    const maxSize = 50 * 1024 * 1024;
    if (selectedFile.size > maxSize) {
      setError('File size exceeds 50MB limit');
      return;
    }

    // Auto-detect type from the file
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (imageTypes.includes(selectedFile.type)) {
      setType('image');
    } else {
      setType('document');
    }

    setFile(selectedFile);
    setError(null);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!description.trim()) {
      setError('Description is required');
      return;
    }

    if (type === 'link' && !url.trim()) {
      setError('URL is required for links');
      return;
    }

    if (type !== 'link' && !file) {
      setError('Please select a file');
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('type', type);
      formData.append('description', description);

      if (type === 'link') {
        formData.append('url', url);
      } else if (file) {
        formData.append('file', file);
      }

      const response = await fetch(`${apiBasePath}/attachments`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        onUploadComplete();
      } else {
        setError(data.error || 'Failed to upload attachment');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setError('Failed to upload attachment');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Add Attachment</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Type Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Attachment Type
          </label>
          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                value="file"
                checked={type !== 'link'}
                onChange={() => {
                  setType('image');
                  setFile(null);
                  setUrl('');
                }}
                className="mr-2"
              />
              File
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="link"
                checked={type === 'link'}
                onChange={() => {
                  setType('link');
                  setFile(null);
                }}
                className="mr-2"
              />
              Link
            </label>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description *
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this attachment"
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>

        {/* URL Input (for links) */}
        {type === 'link' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              URL *
            </label>
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

        {/* File Upload (for images/documents) */}
        {type !== 'link' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              File *
            </label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <input
                ref={fileInputRef}
                id="attachment-file-input"
                type="file"
                onChange={handleFileInputChange}
                accept="*"
                className="sr-only"
              />
              {file ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <div className="text-sm text-gray-600">
                    <label
                      htmlFor="attachment-file-input"
                      className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                    >
                      Choose a file
                    </label>{' '}
                    or drag and drop
                  </div>
                  <p className="text-xs text-gray-500">
                    Images, PDFs, documents, spreadsheets — up to 50MB
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Actions */}
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
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </form>
    </div>
  );
}
