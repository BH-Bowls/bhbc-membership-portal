// src/lib/website-documents-drive.ts
// Drive operations for the public bhbc-website's /documents PDF categories —
// backs the Admin > Website > Documents upload page. Uses the same shared
// service account as bhbc-website's own (read-only) lib/drive.ts, but with
// full Drive write scope (getGoogleDriveClient) since this is the one place
// in either repo that ever writes into WEBSITE_DOCUMENTS_FOLDER_ID.
//
// Subfolder names excluded here match bhbc-website's lib/drive.ts exactly —
// those hold photos for /honours, /gallery, and /rowland, not public PDFs.

import { getGoogleDriveClient, getOrCreateFolder, createResumableUploadSession, deleteFileFromDrive } from './drive';

const NON_DOCUMENT_SUBFOLDERS = ['Honours', 'Gallery', 'Rowland'];

function getWebsiteDocumentsFolderId(): string {
  const id = process.env.WEBSITE_DOCUMENTS_FOLDER_ID;
  if (!id) throw new Error('WEBSITE_DOCUMENTS_FOLDER_ID environment variable is not set.');
  return id;
}

export interface WebsiteDocumentFile {
  id: string;
  name: string;
}

export interface WebsiteDocumentCategory {
  name: string;
  files: WebsiteDocumentFile[];
}

/**
 * List every document category (subfolder of the documents root, excluding the
 * photo-only Honours/Gallery/Rowland subfolders) and the PDFs within each —
 * for display and category-selection on the admin upload page.
 */
export async function listWebsiteDocumentCategories(): Promise<WebsiteDocumentCategory[]> {
  const drive = getGoogleDriveClient();
  const rootId = getWebsiteDocumentsFolderId();

  const foldersResponse = await drive.files.list({
    q: `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    includeItemsFromAllDrives: false,
    supportsAllDrives: false,
  });

  const folders = (foldersResponse.data.files ?? []).filter(
    (f) => f.name && !NON_DOCUMENT_SUBFOLDERS.includes(f.name)
  );

  const categories: WebsiteDocumentCategory[] = [];
  for (const folder of folders) {
    if (!folder.id || !folder.name) continue;

    const filesResponse = await drive.files.list({
      q: `'${folder.id}' in parents and mimeType = 'application/pdf' and trashed = false`,
      fields: 'files(id, name)',
      includeItemsFromAllDrives: false,
      supportsAllDrives: false,
    });

    const files = (filesResponse.data.files ?? [])
      .filter((f): f is { id: string; name: string } => !!f.id && !!f.name)
      .sort((a, b) => b.name.localeCompare(a.name));

    categories.push({ name: folder.name, files });
  }

  categories.sort((a, b) => a.name.localeCompare(b.name));
  return categories;
}

/** Resolve (or create) a category subfolder by name under the documents root. */
export async function getOrCreateWebsiteDocumentCategory(categoryName: string): Promise<string> {
  if (NON_DOCUMENT_SUBFOLDERS.includes(categoryName)) {
    throw new Error(`"${categoryName}" is reserved and can't be used as a document category`);
  }
  const drive = getGoogleDriveClient();
  const rootId = getWebsiteDocumentsFolderId();
  return getOrCreateFolder(drive, categoryName, rootId);
}

/** Create a Drive resumable upload session for a new PDF in the given category. */
export async function createWebsiteDocumentUploadSession(
  categoryName: string,
  fileName: string,
  origin?: string
): Promise<string> {
  const folderId = await getOrCreateWebsiteDocumentCategory(categoryName);
  return createResumableUploadSession(fileName, 'application/pdf', folderId, origin);
}

/** Permanently delete a document file from Drive. Tolerates already-deleted files. */
export async function deleteWebsiteDocument(fileId: string): Promise<void> {
  return deleteFileFromDrive(fileId);
}
