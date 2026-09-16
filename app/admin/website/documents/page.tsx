// app/admin/website/documents/page.tsx
// Drag-and-drop maintenance page for the public site's /documents PDFs.
// Upload goes browser -> Google Drive directly via a resumable session (same
// pattern as AttachmentUpload.tsx) so large PDFs never touch Vercel's payload
// limit. New category names create a new top-level folder — bhbc-website's
// /documents page picks up any subfolder of the documents root automatically,
// no code change needed there. Access: Admin, Captain, GMC.

'use client';

import { useEffect, useRef, useState } from 'react';
import { getButtonClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';
import type { WebsiteDocumentCategory } from '@/lib/website-documents-drive';

const NEW_CATEGORY_VALUE = '__new__';

export default function ManageWebsiteDocumentsPage() {
  const [categories, setCategories] = useState<WebsiteDocumentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedCategory, setSelectedCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/website/documents');
      if (!res.ok) {
        setLoadError('Failed to load documents. Please refresh the page.');
        return;
      }
      const json = await res.json();
      const cats: WebsiteDocumentCategory[] = json.categories || [];
      setCategories(cats);
      // Default the category picker to the first existing category, if none chosen yet
      setSelectedCategory((current) => current || cats[0]?.name || NEW_CATEGORY_VALUE);
    } catch {
      setLoadError('Failed to load documents. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  };

  const handleFileSelect = (selected: File) => {
    if (selected.type !== 'application/pdf' && !selected.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files can be uploaded here.');
      return;
    }
    if (selected.size > 50 * 1024 * 1024) {
      setUploadError('File size exceeds 50MB.');
      return;
    }
    setFile(selected);
    setUploadError(null);
  };

  const handleUpload = async () => {
    setUploadError(null);

    const category = selectedCategory === NEW_CATEGORY_VALUE ? newCategoryName.trim() : selectedCategory;
    if (!category) {
      setUploadError('Choose or name a category first.');
      return;
    }
    if (!file) {
      setUploadError('Choose a PDF to upload.');
      return;
    }

    setUploading(true);
    try {
      // Step 1: get a Drive resumable upload session URI from our server
      const sessionRes = await fetch('/api/admin/website/documents/upload-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, fileName: file.name }),
      });
      if (!sessionRes.ok) {
        throw new Error((await sessionRes.json()).error || 'Failed to create upload session');
      }
      const { sessionUri } = await sessionRes.json();

      // Step 2: PUT the file directly to Drive (bypasses Vercel entirely)
      const driveRes = await fetch(sessionUri, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      });
      if (!driveRes.ok) {
        const text = await driveRes.text();
        throw new Error(`Drive upload failed: ${driveRes.status} ${text}`);
      }

      // Tell the server the upload completed — it never otherwise learns this,
      // since the bytes went straight from the browser to Drive. This is what
      // triggers the website's cache to flush.
      await fetch('/api/admin/website/documents', { method: 'POST' }).catch(() => {});

      setFile(null);
      setNewCategoryName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadCategories();
      setSelectedCategory(category);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload document.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteClick = (fileId: string) => {
    setConfirmDeleteId(fileId);
    setDeleteError(null);
  };

  const handleDeleteCancel = () => {
    setConfirmDeleteId(null);
    setDeleteError(null);
  };

  const handleDeleteConfirm = async (fileId: string) => {
    setDeletingId(fileId);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/website/documents/${fileId}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setDeleteError(json.error || 'Failed to delete document.');
        return;
      }
      setConfirmDeleteId(null);
      await loadCategories();
    } catch {
      setDeleteError('Failed to delete document. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <a href="/admin/website" className="text-sm text-blue-500 hover:text-blue-600 font-medium">
              ← Back to Website Admin
            </a>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2">Manage Documents</h1>
          <p className="text-sm text-gray-700 mb-6">
            PDFs shown on the public /documents page, grouped into categories.
            A new category name creates a new section on that page automatically.
          </p>

          {loadError ? <div className={getAlertClasses('danger') + ' mb-4'}>{loadError}</div> : null}

          {/* ── Upload ── */}
          <div className="bg-white shadow rounded-lg p-6 mb-6 text-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload a Document</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                className={getInputClasses()}
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                disabled={loading}
              >
                {categories.map((cat) => (
                  <option key={cat.name} value={cat.name}>{cat.name}</option>
                ))}
                <option value={NEW_CATEGORY_VALUE}>+ New category…</option>
              </select>
            </div>

            {selectedCategory === NEW_CATEGORY_VALUE ? (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New category name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  className={getInputClasses()}
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. AGM Minutes"
                />
              </div>
            ) : null}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">PDF file</label>
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
                  id="document-file-input"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                  className="sr-only"
                />
                {file ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-900">{file.name}</p>
                    <p className="text-xs text-gray-700">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    <button type="button" onClick={() => setFile(null)} className="text-sm text-red-600 hover:text-red-700">
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-sm text-gray-700">
                      <label htmlFor="document-file-input" className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer">
                        Choose a PDF
                      </label>{' '}or drag and drop
                    </div>
                    <p className="text-xs text-gray-700">PDF only, up to 50MB</p>
                  </div>
                )}
              </div>
            </div>

            {uploadError ? <div className={getAlertClasses('danger') + ' mb-4 text-sm'}>{uploadError}</div> : null}

            <button onClick={handleUpload} disabled={uploading || !file} className={getButtonClasses('primary', 'md')}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>

          {/* ── Existing documents ── */}
          {loading ? (
            <div className="text-sm text-gray-700 py-4">Loading documents…</div>
          ) : categories.length === 0 ? (
            <div className="text-sm text-gray-700 py-4">No document categories yet — upload the first PDF above.</div>
          ) : (
            <div className="space-y-4">
              {categories.map((cat) => (
                <div key={cat.name} className="bg-white shadow rounded-lg p-5 text-gray-900">
                  <p className="font-semibold text-gray-900 mb-2">{cat.name}</p>
                  {cat.files.length === 0 ? (
                    <p className="text-sm text-gray-700 italic">No PDFs in this category.</p>
                  ) : (
                    <ul className="space-y-2">
                      {cat.files.map((f) => (
                        <li key={f.id} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-gray-900 truncate">{f.name}</span>
                          {confirmDeleteId === f.id ? (
                            <div className="flex items-center gap-2 shrink-0">
                              {deleteError ? <span className="text-red-700 text-xs">{deleteError}</span> : null}
                              <button onClick={() => handleDeleteConfirm(f.id)} disabled={deletingId === f.id} className={getButtonClasses('danger', 'sm')}>
                                {deletingId === f.id ? 'Deleting…' : 'Confirm'}
                              </button>
                              <button onClick={handleDeleteCancel} disabled={deletingId === f.id} className={getButtonClasses('secondary', 'sm')}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => handleDeleteClick(f.id)} className={getButtonClasses('danger', 'sm') + ' shrink-0'}>
                              Delete
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
