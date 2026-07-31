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

// Service-account-only Drive client — bypasses the OAuth refresh token path.
// Use for read-only operations like listing documents where the folder is shared
// with the service account email, not the personal OAuth account.
export function getServiceAccountDriveClient() {
  const auth = new google.auth.JWT({
    email: getServiceAccountEmail(),
    key: getPrivateKey(),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
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
// Uses the service-account (read-only) client — the OAuth client's refresh token can
// lapse (invalid_grant), and a failed auth must NOT be read as "file missing".
export async function checkDriveFileExists(fileId: string): Promise<boolean> {
  const drive = getServiceAccountDriveClient();
  try {
    await drive.files.get({ fileId, fields: 'id', supportsAllDrives: true });
    return true;
  } catch (error: any) {
    // Only a genuine 404 means the file is gone. For any other error (auth, network,
    // quota) assume the file is still present — never mark an attachment deleted on
    // the strength of a transient/auth failure.
    if (error?.status === 404 || error?.code === 404) return false;
    console.error(`[Drive] Error checking file ${fileId} (assuming present):`, error);
    return true;
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

// ── Portal documents listing ─────────────────────────────────────────────────

export interface DocumentFile {
  name: string
  webViewLink: string
  mimeType: string
}

export interface DocumentFolder {
  name: string
  files: DocumentFile[]
  subfolders: DocumentFolder[]
}

/**
 * Recursively list the PDF files and subfolders inside a Drive folder.
 * Files are sorted by name descending; subfolders alphabetically.
 */
async function listFolderContents(
  drive: any,
  folderId: string
): Promise<{ files: DocumentFile[]; subfolders: DocumentFolder[] }> {
  // PDF files directly in this folder
  const filesResponse = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`,
    fields: 'files(id, name, webViewLink, mimeType)',
    includeItemsFromAllDrives: false,
    supportsAllDrives: false,
  });
  const files: DocumentFile[] = (filesResponse.data.files ?? [])
    .filter((f: any) => f.name && f.webViewLink && f.mimeType)
    .map((f: any) => ({ name: f.name!, webViewLink: f.webViewLink!, mimeType: f.mimeType! }));
  files.sort((a, b) => b.name.localeCompare(a.name));

  // Subfolders directly in this folder, recursed into
  const subfoldersResponse = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    includeItemsFromAllDrives: false,
    supportsAllDrives: false,
  });
  const subfolders: DocumentFolder[] = [];
  for (const sub of subfoldersResponse.data.files ?? []) {
    if (!sub.id || !sub.name) continue;
    const contents = await listFolderContents(drive, sub.id);
    subfolders.push({ name: sub.name, files: contents.files, subfolders: contents.subfolders });
  }
  subfolders.sort((a, b) => a.name.localeCompare(b.name));

  return { files, subfolders };
}

/**
 * List the folder tree (PDF files + nested subfolders) under the portal
 * documents root folder. Each top-level folder becomes a collapsible section on
 * /documents, and subfolders are expandable within it.
 */
export async function listPortalDocuments(): Promise<DocumentFolder[]> {
  const rootId = process.env.PORTAL_DOCUMENTS_FOLDER_ID;
  if (!rootId) throw new Error('PORTAL_DOCUMENTS_FOLDER_ID is not set');

  const drive = getServiceAccountDriveClient();

  const foldersResponse = await drive.files.list({
    q: `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    includeItemsFromAllDrives: false,
    supportsAllDrives: false,
  });

  const results: DocumentFolder[] = [];
  for (const folder of foldersResponse.data.files ?? []) {
    if (!folder.id || !folder.name) continue;
    const contents = await listFolderContents(drive, folder.id);
    results.push({ name: folder.name, files: contents.files, subfolders: contents.subfolders });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

// ── Guide documents (Guides subfolder of the attachments root) ───────────────

// Small in-memory cache of resolved guide file IDs (name → fileId). Guides rarely
// change, so this avoids two Drive lookups on every button click. Reset on restart.
const guideFileIdCache = new Map<string, { fileId: string; name: string; at: number }>();
const GUIDE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Find a PDF by name inside the "Guides" subfolder of the attachments root.
 * Matches case-insensitively, ignoring a trailing ".pdf". Returns null if the
 * Guides folder or a matching PDF isn't found.
 */
export async function findGuidePdf(guideName: string): Promise<{ fileId: string; name: string } | null> {
  const cacheKey = guideName.trim().toLowerCase();
  const cached = guideFileIdCache.get(cacheKey);
  if (cached && Date.now() - cached.at < GUIDE_CACHE_TTL_MS) {
    return { fileId: cached.fileId, name: cached.name };
  }

  // Use the service account (read-only) — the same client the /documents page uses
  // for manually-curated Drive PDFs. The OAuth/personal-account client is unreliable
  // for this (its refresh token expires → invalid_grant). Requires the Guides folder
  // to be shared with the service-account email.
  const drive = getServiceAccountDriveClient();
  const rootId = getRootFolderId();

  // Locate the "Guides" subfolder (search only — never create).
  const folderRes = await drive.files.list({
    q: `name = 'Guides' and '${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    includeItemsFromAllDrives: false,
    supportsAllDrives: false,
  });
  const guidesFolderId = folderRes.data.files && folderRes.data.files[0] ? folderRes.data.files[0].id : null;
  if (!guidesFolderId) return null;

  // Find the PDF whose name (minus .pdf) matches the requested guide.
  const filesRes = await drive.files.list({
    q: `'${guidesFolderId}' in parents and mimeType = 'application/pdf' and trashed = false`,
    fields: 'files(id, name)',
    includeItemsFromAllDrives: false,
    supportsAllDrives: false,
  });
  const files = filesRes.data.files || [];
  const target = guideName.trim().toLowerCase();
  const match = files.find((f: any) => {
    const n = (f.name || '').toLowerCase().replace(/\.pdf$/, '').trim();
    return n === target;
  });
  if (!match || !match.id) return null;

  const result = { fileId: match.id, name: match.name || `${guideName}.pdf` };
  guideFileIdCache.set(cacheKey, { ...result, at: Date.now() });
  return result;
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
