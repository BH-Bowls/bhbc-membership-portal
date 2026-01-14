// src/types/attachments.ts
// Type definitions for Member Suggestion Attachments

export type AttachmentType = 'link' | 'image' | 'document';

export interface SuggestionAttachment {
  // Identification
  attachmentId: string; // Format: ATT-NNNNNN
  suggestionId: string;

  // Attachment details
  type: AttachmentType;
  driveFileId?: string | null; // Cloudinary publicId (kept as driveFileId for backward compatibility)
  url: string; // Cloudinary URL or external URL
  description: string;
  fileName?: string | null; // Original filename for uploaded files
  mimeType?: string | null; // MIME type for uploaded files
  fileSize?: number | null; // File size in bytes

  // Ordering and metadata
  displayOrder: number;
  addedAt: string;
  addedByUsername: string;

  // Status
  isDeleted?: boolean; // True if Drive file no longer exists

  // Internal
  _rowNumber?: number;
}

export interface AttachmentUploadRequest {
  suggestionId: string;
  type: AttachmentType;
  description: string;
  url?: string; // For external links
  file?: File; // For uploads
}
