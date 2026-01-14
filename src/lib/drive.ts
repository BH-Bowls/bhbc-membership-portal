// src/lib/drive.ts
// Google Drive operations for Member Suggestion Attachments

import { google } from 'googleapis';
import { Readable } from 'stream';

// ============================================================================
// ENVIRONMENT VARIABLES
// ============================================================================

function getServiceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL is not set');
  }
  return email;
}

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) {
    throw new Error('GOOGLE_PRIVATE_KEY is not set');
  }
  return key.replace(/\\n/g, '\n');
}

function getAttachmentsFolderId(): string {
  const folderId = process.env.GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID;
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID is not set. Create a folder in Drive and add its ID to .env.local');
  }
  return folderId;
}

// ============================================================================
// GOOGLE DRIVE CLIENT
// ============================================================================

export function getGoogleDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: getServiceAccountEmail(),
      private_key: getPrivateKey(),
    },
    scopes: [
      'https://www.googleapis.com/auth/drive.file', // Manage files created by this app
      'https://www.googleapis.com/auth/drive', // Full Drive access (needed for folder operations)
    ],
  });

  return google.drive({ version: 'v3', auth });
}

// ============================================================================
// FOLDER OPERATIONS
// ============================================================================

/**
 * Get or create a subfolder for a suggestion
 * Folder structure: BHBC Suggestion Attachments/{suggestionId}/
 */
export async function getOrCreateSuggestionFolder(suggestionId: string): Promise<string> {
  const drive = getGoogleDriveClient();
  const parentFolderId = getAttachmentsFolderId();

  try {
    // Check if folder already exists
    const searchResponse = await drive.files.list({
      q: `name='${suggestionId}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id!;
    }

    // Create new folder
    const createResponse = await drive.files.create({
      requestBody: {
        name: suggestionId,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id',
      supportsAllDrives: true,
    });

    return createResponse.data.id!;
  } catch (error) {
    console.error(`[getOrCreateSuggestionFolder] Error for ${suggestionId}:`, error);
    throw new Error(`Failed to create folder for suggestion ${suggestionId}`);
  }
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Upload a file to a suggestion's folder
 */
export async function uploadFileToDrive(
  suggestionId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<{ fileId: string; webViewLink: string; webContentLink: string }> {
  const drive = getGoogleDriveClient();

  try {
    // Get or create the suggestion folder
    const folderId = await getOrCreateSuggestionFolder(suggestionId);

    // Convert buffer to readable stream
    const readable = Readable.from(fileBuffer);

    // Upload file
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: mimeType,
        body: readable,
      },
      fields: 'id, webViewLink, webContentLink',
      supportsAllDrives: true,
    });

    // Make file accessible via link (anyone with link can view)
    await drive.permissions.create({
      fileId: response.data.id!,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
      supportsAllDrives: true,
    });

    return {
      fileId: response.data.id!,
      webViewLink: response.data.webViewLink!,
      webContentLink: response.data.webContentLink!,
    };
  } catch (error) {
    console.error(`[uploadFileToDrive] Error uploading ${fileName}:`, error);
    throw new Error(`Failed to upload file: ${fileName}`);
  }
}

/**
 * Delete a file from Drive
 */
export async function deleteFileFromDrive(fileId: string): Promise<void> {
  const drive = getGoogleDriveClient();

  try {
    await drive.files.delete({
      fileId: fileId,
      supportsAllDrives: true,
    });
  } catch (error: any) {
    // If file not found (404), consider it already deleted
    if (error?.status === 404 || error?.code === 404) {
      console.log(`[deleteFileFromDrive] File ${fileId} not found (already deleted)`);
      return;
    }
    console.error(`[deleteFileFromDrive] Error deleting file ${fileId}:`, error);
    throw new Error(`Failed to delete file from Drive: ${fileId}`);
  }
}

/**
 * Check if a file exists in Drive
 */
export async function checkFileExists(fileId: string): Promise<boolean> {
  const drive = getGoogleDriveClient();

  try {
    await drive.files.get({
      fileId: fileId,
      fields: 'id',
      supportsAllDrives: true,
    });
    return true;
  } catch (error: any) {
    if (error?.status === 404 || error?.code === 404) {
      return false;
    }
    console.error(`[checkFileExists] Error checking file ${fileId}:`, error);
    return false;
  }
}

/**
 * Get file metadata from Drive
 */
export async function getFileMetadata(fileId: string): Promise<{
  name: string;
  mimeType: string;
  size: string;
  webViewLink: string;
  webContentLink: string;
} | null> {
  const drive = getGoogleDriveClient();

  try {
    const response = await drive.files.get({
      fileId: fileId,
      fields: 'name, mimeType, size, webViewLink, webContentLink',
      supportsAllDrives: true,
    });

    return {
      name: response.data.name!,
      mimeType: response.data.mimeType!,
      size: response.data.size!,
      webViewLink: response.data.webViewLink!,
      webContentLink: response.data.webContentLink!,
    };
  } catch (error: any) {
    if (error?.status === 404 || error?.code === 404) {
      return null;
    }
    console.error(`[getFileMetadata] Error getting metadata for ${fileId}:`, error);
    return null;
  }
}

/**
 * Get thumbnail URL for an image file
 */
export function getThumbnailUrl(fileId: string, size: number = 200): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}
