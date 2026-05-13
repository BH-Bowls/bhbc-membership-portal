// src/lib/drive.ts
// Google Drive operations for attachment storage.
// Service account handles all auth — no individual user OAuth needed.
// Files are stored under a shared root folder, one subfolder per entity.

import { google } from 'googleapis';
import { OAuth2Client, GoogleAuth } from 'google-auth-library';

function getServiceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL is not set');
  return email;
}

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) throw new Error('GOOGLE_PRIVATE_KEY is not set');
  return key.replace(/\\n/g, '\n');
}

function getRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID;
  if (!id) throw new Error('GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID is not set');
  return id;
}

function getDriveAuth(): OAuth2Client | GoogleAuth {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new OAuth2Client(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }

  return new GoogleAuth({
    credentials: {
      client_email: getServiceAccountEmail(),
      private_key: getPrivateKey(),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

export function getGoogleDriveClient() {
  return google.drive({ version: 'v3', auth: getDriveAuth() as any });
}

function getCategoryFolderName(entityId: string): string {
  if (entityId.startsWith('IG-')) return 'Invite Games';
  if (entityId.startsWith('league-')) return 'Leagues';
  return 'Member Suggestions';
}

async function getOrCreateFolder(drive: any, name: string, parentId: string): Promise<string> {
  const search = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (search.data.files && search.data.files.length > 0) {
    return search.data.files[0].id!;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  return created.data.id!;
}

// Get or create the entity subfolder, nested under a category folder.
// Structure: <root>/<category>/<entityId>/
// Pass category explicitly when the entityId doesn't have a recognisable prefix (e.g. Rowland matchIds).
export async function getOrCreateEntityFolder(entityId: string, category?: string): Promise<string> {
  const drive = getGoogleDriveClient();
  const rootId = getRootFolderId();
  const categoryName = category ?? getCategoryFolderName(entityId);
  const categoryId = await getOrCreateFolder(drive, categoryName, rootId);
  return await getOrCreateFolder(drive, entityId, categoryId);
}

// Create a Drive resumable upload session.
// Returns the session URI — the browser PUTs file bytes directly to this URL.
// The session URI is pre-authenticated so no further auth is needed from the browser.
export async function createResumableUploadSession(
  fileName: string,
  mimeType: string,
  folderId: string,
  origin?: string,
): Promise<string> {
  const auth = getDriveAuth();
  let accessToken: string | null | undefined;

  if (auth instanceof OAuth2Client) {
    const tokenResponse = await auth.getAccessToken();
    accessToken = tokenResponse.token;
  } else {
    accessToken = await (auth as GoogleAuth).getAccessToken();
  }

  if (!accessToken) throw new Error('Failed to obtain Google access token');

  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mimeType,
  };
  // Origin is required for Google to add CORS headers to the session URI,
  // allowing the browser to PUT file bytes directly to Drive.
  if (origin) headers['Origin'] = origin;

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    { method: 'POST', headers, body: metadata }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create Drive upload session: ${response.status} ${text}`);
  }

  const sessionUri = response.headers.get('Location');
  if (!sessionUri) throw new Error('No Location header in Drive resumable upload response');

  return sessionUri;
}

// Set "anyone with the link can view" permission on a file.
// Called server-side after the browser confirms the upload completed.
export async function setPublicReadPermission(fileId: string): Promise<void> {
  const drive = getGoogleDriveClient();
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  });
}

// Delete a file from Drive. Tolerates 404 (already deleted).
export async function deleteFileFromDrive(fileId: string): Promise<void> {
  const drive = getGoogleDriveClient();
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (error: any) {
    if (error?.status === 404 || error?.code === 404) {
      console.log(`[Drive] File ${fileId} not found (already deleted)`);
      return;
    }
    throw error;
  }
}

// Check if a Drive file exists (for attachment validation).
export async function checkDriveFileExists(fileId: string): Promise<boolean> {
  const drive = getGoogleDriveClient();
  try {
    await drive.files.get({ fileId, fields: 'id', supportsAllDrives: true });
    return true;
  } catch (error: any) {
    if (error?.status === 404 || error?.code === 404) return false;
    console.error(`[Drive] Error checking file ${fileId}:`, error);
    return false;
  }
}

// Upload file buffer directly (used by migration script, not production upload path).
export async function uploadFileToDrive(
  entityId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const drive = getGoogleDriveClient();
  const folderId = await getOrCreateEntityFolder(entityId);

  const { Readable } = await import('stream');
  const readable = Readable.from(fileBuffer);

  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: readable },
    fields: 'id',
    supportsAllDrives: true,
  });

  const fileId = response.data.id!;
  await setPublicReadPermission(fileId);
  return fileId;
}

// ── URL helpers (usable server-side; client has its own copy) ────────────────

export function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function driveEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export function driveDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export function driveThumbnailUrl(fileId: string, size = 200): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

// Returns true if the id is a Drive file ID (no slashes).
// Cloudinary publicIds always contain slashes (folder/subfolder/filename).
export function isDriveFileId(id: string | null | undefined): boolean {
  return !!id && !id.includes('/');
}
