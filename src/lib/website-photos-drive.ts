// src/lib/website-photos-drive.ts
// Drive operations for Honours and Rowland winner PHOTOS — a different tree
// (WEBSITE_DOCUMENTS_FOLDER_ID/Honours|Rowland/<year>/) from the PDF document
// categories in website-documents-drive.ts. Backs the photo upload widgets on
// the Rowland Winners and Internal Honours admin pages.
//
// Rowland filename convention matches bhbc-website's lib/drive.ts
// listRowlandImages() exactly: the Edward/Gladys photo must contain
// "edward"/"gladys" (case-insensitive) in its filename. This module enforces
// that by renaming on upload (and replacing any existing photo for that
// competition first) so an admin can never upload a wrongly-matched file.
// Honours has no naming convention — any image in a year folder is shown.

import { getGoogleDriveClient, getOrCreateFolder, createResumableUploadSession, deleteFileFromDrive } from './drive';

function getWebsiteDocumentsFolderId(): string {
  const id = process.env.WEBSITE_DOCUMENTS_FOLDER_ID;
  if (!id) throw new Error('WEBSITE_DOCUMENTS_FOLDER_ID environment variable is not set.');
  return id;
}

export type RowlandCompetition = 'edward' | 'gladys';

export interface DrivePhoto {
  id: string;
  name: string;
}

/** Find a year subfolder without creating it — for listing, where an empty result is fine. */
async function findYearFolder(subfolder: 'Honours' | 'Rowland', year: number): Promise<string | null> {
  const drive = getGoogleDriveClient();
  const rootId = getWebsiteDocumentsFolderId();

  const subRes = await drive.files.list({
    q: `'${rootId}' in parents and name = '${subfolder}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
  });
  const subfolderId = subRes.data.files?.[0]?.id;
  if (!subfolderId) return null;

  const yearRes = await drive.files.list({
    q: `'${subfolderId}' in parents and name = '${year}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
  });
  return yearRes.data.files?.[0]?.id ?? null;
}

/** Resolve (creating as needed) a year subfolder — for uploads, where we're about to add a file. */
async function getOrCreateYearFolder(subfolder: 'Honours' | 'Rowland', year: number): Promise<string> {
  const drive = getGoogleDriveClient();
  const rootId = getWebsiteDocumentsFolderId();
  const subfolderId = await getOrCreateFolder(drive, subfolder, rootId);
  return getOrCreateFolder(drive, String(year), subfolderId);
}

async function listImagesInFolder(folderId: string): Promise<DrivePhoto[]> {
  const drive = getGoogleDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id, name)',
    orderBy: 'name',
  });
  return (res.data.files ?? []).filter((f): f is DrivePhoto => !!f.id && !!f.name);
}

function extensionOf(fileName: string): string {
  const match = fileName.match(/\.[a-zA-Z0-9]+$/);
  return match ? match[0] : '.jpg';
}

function guessImageMimeType(fileName: string): string {
  switch (extensionOf(fileName).toLowerCase()) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'image/jpeg';
  }
}

// ── Rowland ──────────────────────────────────────────────────────────────────

export async function listRowlandPhotos(year: number): Promise<Record<RowlandCompetition, DrivePhoto | null>> {
  const folderId = await findYearFolder('Rowland', year);
  const files = folderId ? await listImagesInFolder(folderId) : [];
  return {
    edward: files.find((f) => f.name.toLowerCase().includes('edward')) ?? null,
    gladys: files.find((f) => f.name.toLowerCase().includes('gladys')) ?? null,
  };
}

// Replaces any existing photo for this competition/year, then returns an upload
// session for the new one — filename is forced to "<competition><ext>" so the
// website's filename-matching logic always finds exactly one match.
export async function createRowlandPhotoUploadSession(
  year: number,
  competition: RowlandCompetition,
  originalFileName: string,
  origin?: string
): Promise<string> {
  const existing = await listRowlandPhotos(year);
  const current = existing[competition];
  if (current) await deleteFileFromDrive(current.id);

  const folderId = await getOrCreateYearFolder('Rowland', year);
  const fileName = `${competition}${extensionOf(originalFileName)}`;
  return createResumableUploadSession(fileName, guessImageMimeType(fileName), folderId, origin);
}

export async function deleteRowlandPhoto(year: number, competition: RowlandCompetition): Promise<void> {
  const existing = await listRowlandPhotos(year);
  const current = existing[competition];
  if (!current) return;
  await deleteFileFromDrive(current.id);
}

// ── Honours ──────────────────────────────────────────────────────────────────

export async function listHonoursPhotos(year: number): Promise<DrivePhoto[]> {
  const folderId = await findYearFolder('Honours', year);
  return folderId ? listImagesInFolder(folderId) : [];
}

// Honours allows multiple photos per year (a small gallery) — no renaming, no
// replacing an existing file.
export async function createHonoursPhotoUploadSession(
  year: number,
  originalFileName: string,
  origin?: string
): Promise<string> {
  const folderId = await getOrCreateYearFolder('Honours', year);
  return createResumableUploadSession(originalFileName, guessImageMimeType(originalFileName), folderId, origin);
}

export async function deleteHonoursPhoto(fileId: string): Promise<void> {
  await deleteFileFromDrive(fileId);
}
