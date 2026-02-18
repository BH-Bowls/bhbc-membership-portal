// src/types/attachments.ts
// Type definitions for attachments (shared between Member Suggestions and Invite Games)

export type AttachmentType = 'link' | 'image' | 'document';

/**
 * Generic attachment — used by AttachmentsList and AttachmentUpload components.
 * Entity-specific types (SuggestionAttachment, InviteGameAttachment) extend this.
 */
export interface Attachment {
  // Identification
  attachmentId: string;

  // Attachment details
  type: AttachmentType;
  driveFileId?: string | null; // Cloudinary publicId
  url: string;
  description: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;

  // Ordering and metadata
  displayOrder: number;
  addedAt: string;
  addedByUsername: string;

  // Status
  isDeleted?: boolean;

  // Internal
  _rowNumber?: number;
}

export interface SuggestionAttachment extends Attachment {
  suggestionId: string;
}

export interface InviteGameAttachment extends Attachment {
  inviteGameId: string;
}

export interface AttachmentUploadRequest {
  suggestionId: string;
  type: AttachmentType;
  description: string;
  url?: string; // For external links
  file?: File; // For uploads
}
