// src/components/AttachmentsList.tsx
// Display and manage suggestion attachments

'use client';

import { useState, useEffect } from 'react';
import type { Attachment } from '@/types/attachments';
import { ConfirmDialog } from './ConfirmDialog';

interface AttachmentsListProps {
  apiBasePath: string; // e.g. "/api/suggestions/2026-001" or "/api/invite-games/IG-2026-001"
  attachments: Attachment[];
  canDelete: boolean;
  onDelete: () => void;
}

// MIME types / extensions that browsers can display inline
const VIEWABLE_MIME_TYPES = ['application/pdf'];
const VIEWABLE_EXTENSIONS = ['.pdf'];

function isViewableInBrowser(attachment: Attachment): boolean {
  if (attachment.type === 'image' || attachment.type === 'link') return true;
  const mime = (attachment.mimeType || '').toLowerCase();
  if (VIEWABLE_MIME_TYPES.includes(mime)) return true;
  const name = (attachment.fileName || '').toLowerCase();
  return VIEWABLE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Build the server-side proxy URL for an attachment.
 *   ?inline=true  → Content-Disposition: inline  (view in browser)
 *   (default)     → Content-Disposition: attachment (download)
 */
function getProxyUrl(
  apiBasePath: string,
  attachment: Attachment,
  inline: boolean
): string {
  const base = `${apiBasePath}/attachments/${attachment.attachmentId}`;
  return inline ? `${base}?inline=true` : base;
}

export function AttachmentsList({
  apiBasePath,
  attachments,
  canDelete,
  onDelete,
}: AttachmentsListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    attachmentId: string | null;
    description: string;
  }>({
    isOpen: false,
    attachmentId: null,
    description: '',
  });

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // ---- Handlers ----

  const handleDeleteClick = (attachment: Attachment) => {
    setConfirmDialog({
      isOpen: true,
      attachmentId: attachment.attachmentId,
      description: attachment.description,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDialog.attachmentId) return;

    setDeletingId(confirmDialog.attachmentId);

    try {
      const response = await fetch(
        `${apiBasePath}/attachments/${confirmDialog.attachmentId}`,
        {
          method: 'DELETE',
        }
      );

      if (response.ok) {
        onDelete();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to delete attachment');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete attachment');
    } finally {
      setDeletingId(null);
      setConfirmDialog({ isOpen: false, attachmentId: null, description: '' });
    }
  };

  /**
   * Handle clicking a document attachment.
   * Viewable files (PDF): open via proxy with ?inline=true in a new tab.
   * Other documents: navigate to proxy URL which triggers download with correct filename.
   */
  const handleDocumentClick = (
    e: React.MouseEvent,
    attachment: Attachment
  ) => {
    e.preventDefault();

    if (isViewableInBrowser(attachment)) {
      // Open inline in new tab — the server sets Content-Disposition: inline
      window.open(getProxyUrl(apiBasePath, attachment, true), '_blank');
    } else {
      // Trigger download — the server sets Content-Disposition: attachment with filename
      // Using a hidden link avoids popup blockers
      const a = document.createElement('a');
      a.href = getProxyUrl(apiBasePath, attachment, false);
      a.download = ''; // browser will use the Content-Disposition filename
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      const filename = attachment.fileName || attachment.description;
      setToast(`Downloaded "${filename}"`);
    }
  };

  // ---- Helpers ----

  const getThumbnailUrl = (attachment: Attachment) => {
    if (attachment.type === 'image' && attachment.url) {
      return attachment.url;
    }
    return null;
  };

  const getIcon = (attachment: Attachment) => {
    if (attachment.isDeleted) {
      return (
        <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      );
    }

    if (attachment.type === 'link') {
      return (
        <svg className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
      );
    }

    if (attachment.type === 'document') {
      return (
        <svg className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
      );
    }

    return null;
  };

  // ---- Render ----

  if (attachments.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <svg
          className="mx-auto h-12 w-12 text-gray-400 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
          />
        </svg>
        <p>No attachments yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {attachments.map((attachment) => {
        const isDocument = attachment.type === 'document';

        return (
          <div
            key={attachment.attachmentId}
            className={`flex items-start gap-4 p-4 rounded-lg border ${
              attachment.isDeleted
                ? 'bg-red-50 border-red-200'
                : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
            }`}
          >
            {/* Thumbnail or Icon */}
            <div className="flex-shrink-0">
              {attachment.type === 'image' && !attachment.isDeleted ? (
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <img
                    src={getThumbnailUrl(attachment) || ''}
                    alt={attachment.description}
                    className="w-16 h-16 object-cover rounded border border-gray-300 hover:opacity-80 transition-opacity"
                    onError={(e) => {
                      e.currentTarget.src =
                        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"%3E%3Cpath strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"%3E%3C/path%3E%3C/svg%3E';
                    }}
                  />
                </a>
              ) : (
                <div className="w-16 h-16 flex items-center justify-center">
                  {getIcon(attachment)}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {attachment.isDeleted ? (
                    <div>
                      <p className="text-sm font-medium text-red-700">
                        {attachment.description}
                      </p>
                      <p className="text-xs text-red-600 mt-1">
                        File no longer available
                      </p>
                    </div>
                  ) : isDocument ? (
                    <button
                      onClick={(e) => handleDocumentClick(e, attachment)}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline block truncate text-left"
                    >
                      {attachment.description}
                    </button>
                  ) : (
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline block truncate"
                    >
                      {attachment.description}
                    </a>
                  )}

                  {/* Metadata */}
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
                    <span className="capitalize">{attachment.type}</span>
                    {attachment.fileName && (
                      <>
                        <span>•</span>
                        <span className="truncate max-w-[200px]">
                          {attachment.fileName}
                        </span>
                      </>
                    )}
                    {attachment.fileSize && (
                      <>
                        <span>•</span>
                        <span>{(attachment.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                      </>
                    )}
                    <span>•</span>
                    <span>
                      Added by {attachment.addedByUsername}
                    </span>
                  </div>
                </div>

                {/* Delete Button */}
                {canDelete && !attachment.isDeleted && (
                  <button
                    onClick={() => handleDeleteClick(attachment)}
                    disabled={deletingId === attachment.attachmentId}
                    className={`flex-shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-50 ${
                      deletingId === attachment.attachmentId
                        ? 'text-red-400'
                        : 'text-red-600 hover:text-red-700 hover:bg-red-50'
                    }`}
                    title="Delete attachment"
                  >
                    {deletingId === attachment.attachmentId ? (
                      <span className="flex items-center gap-1.5">
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Deleting...
                      </span>
                    ) : (
                      'Delete'
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Download toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-gray-800 text-white px-5 py-3 rounded-lg shadow-lg animate-fade-in">
          <svg className="h-5 w-5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span className="text-sm">{toast}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-gray-400 hover:text-white">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title="Delete Attachment"
        message={`Are you sure you want to delete "${confirmDialog.description}"? This will permanently remove the file.`}
        confirmLabel={deletingId ? 'Deleting...' : 'Delete'}
        confirmDisabled={!!deletingId}
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          if (!deletingId) {
            setConfirmDialog({ isOpen: false, attachmentId: null, description: '' });
          }
        }}
      />
    </div>
  );
}
