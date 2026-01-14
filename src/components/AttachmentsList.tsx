// src/components/AttachmentsList.tsx
// Display and manage suggestion attachments

'use client';

import { useState } from 'react';
import type { SuggestionAttachment } from '@/types/attachments';
import { ConfirmDialog } from './ConfirmDialog';

interface AttachmentsListProps {
  suggestionId: string;
  attachments: SuggestionAttachment[];
  canDelete: boolean;
  onDelete: () => void;
}

export function AttachmentsList({
  suggestionId,
  attachments,
  canDelete,
  onDelete,
}: AttachmentsListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    attachmentId: string | null;
    description: string;
  }>({
    isOpen: false,
    attachmentId: null,
    description: '',
  });

  const handleDeleteClick = (attachment: SuggestionAttachment) => {
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
        `/api/suggestions/${suggestionId}/attachments/${confirmDialog.attachmentId}`,
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

  const getThumbnailUrl = (attachment: SuggestionAttachment) => {
    // For images, Cloudinary will automatically generate optimized thumbnails
    // The URL stored in attachment.url is already optimized by Cloudinary
    if (attachment.type === 'image' && attachment.url) {
      // Cloudinary URL is already optimized, just use it
      // If we want a specific thumbnail size, we could use the publicId to generate one
      // but for now, the stored URL works great
      return attachment.url;
    }
    return null;
  };

  const getIcon = (attachment: SuggestionAttachment) => {
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
      {attachments.map((attachment) => (
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
                    // Fallback if thumbnail fails
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
                  className="flex-shrink-0 p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                  title="Delete attachment"
                >
                  {deletingId === attachment.attachmentId ? (
                    <svg
                      className="animate-spin h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
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
                  ) : (
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title="Delete Attachment"
        message={`Are you sure you want to delete "${confirmDialog.description}"? This will permanently remove the file.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() =>
          setConfirmDialog({ isOpen: false, attachmentId: null, description: '' })
        }
      />
    </div>
  );
}
