// scripts/migrate-cloudinary-to-drive.ts
// One-shot migration: download all Cloudinary attachment files and re-upload to Google Drive.
// Updates the driveFileId and url fields in all attachment Sheets tabs,
// and score_sheet_url in all Rowland match sheets.
//
// Run with:  npx dotenv -e .env.local -- npx tsx scripts/migrate-cloudinary-to-drive.ts

import 'dotenv/config';
import { google } from 'googleapis';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

// ── Config ───────────────────────────────────────────────────────────────────

const MEMBERS_SPREADSHEET_ID = process.env.MEMBERS_SPREADSHEET_ID!;
const LEAGUES_SPREADSHEET_ID = process.env.LEAGUES_SPREADSHEET_ID!;
const ROWLAND_SPREADSHEET_ID = process.env.ROWLAND_SPREADSHEET_ID!;
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID!;
const CLOUDINARY_CLOUD = process.env.CLOUDINARY_CLOUD_NAME!;
const CLOUDINARY_KEY   = process.env.CLOUDINARY_API_KEY!;
const CLOUDINARY_SECRET = process.env.CLOUDINARY_API_SECRET!;

// Attachment tabs: each row has drive_file_id + url updated
const SHEET_TABS = [
  { tab: 'MemberSuggestionsAttachments', idField: 'suggestion_id', spreadsheetId: MEMBERS_SPREADSHEET_ID },
  { tab: 'InviteGamesAttachments',       idField: 'invite_game_id', spreadsheetId: MEMBERS_SPREADSHEET_ID },
  { tab: 'LeagueAttachments',            idField: 'league_id', spreadsheetId: LEAGUES_SPREADSHEET_ID },
];

// Rowland match tabs: each row has score_sheet_url updated directly
const ROWLAND_TABS = [
  'Rowland_edward-a',
  'Rowland_edward-b',
  'Rowland_gladys-a',
  'Rowland_gladys-b',
];

// ── Google clients ────────────────────────────────────────────────────────────

function getDriveClient() {
  const userToken = process.env.GOOGLE_USER_TOKEN;
  if (userToken) {
    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({ access_token: userToken });
    console.log('  (using personal access token for Drive uploads)');
    return google.drive({ version: 'v3', auth: oauth2 });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    console.log('  (using OAuth refresh token for Drive uploads)');
    return google.drive({ version: 'v3', auth: oauth2 });
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
      private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
      private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ── Drive helpers ─────────────────────────────────────────────────────────────

const folderCache: Record<string, string> = {};

function getCategoryFolderName(entityId: string, category?: string): string {
  if (category) return category;
  if (entityId.startsWith('IG-')) return 'Invite Games';
  if (entityId.startsWith('league-')) return 'Leagues';
  return 'Member Suggestions';
}

async function getOrCreateFolder(drive: any, name: string, parentId: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  if (folderCache[cacheKey]) return folderCache[cacheKey];

  const search = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (search.data.files?.length > 0) {
    folderCache[cacheKey] = search.data.files[0].id;
    return folderCache[cacheKey];
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

  folderCache[cacheKey] = created.data.id;
  return folderCache[cacheKey];
}

async function getOrCreateEntityFolder(drive: any, entityId: string, category?: string): Promise<string> {
  const categoryName = getCategoryFolderName(entityId, category);
  const categoryId = await getOrCreateFolder(drive, categoryName, ROOT_FOLDER_ID);
  return await getOrCreateFolder(drive, entityId, categoryId);
}

async function uploadToDrive(
  drive: any,
  entityId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  category?: string,
): Promise<string> {
  const folderId = await getOrCreateEntityFolder(drive, entityId, category);

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(fileBuffer) },
    fields: 'id',
    supportsAllDrives: true,
  });

  const fileId: string = res.data.id;

  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  });

  return fileId;
}

// ── Cloudinary helpers ────────────────────────────────────────────────────────

function configureCloudinary() {
  cloudinary.config({ cloud_name: CLOUDINARY_CLOUD, api_key: CLOUDINARY_KEY, api_secret: CLOUDINARY_SECRET });
}

// Uses cloudinary.utils.api_sign_request (SHA-1) — the same approach as src/lib/cloudinary.ts
function buildDownloadUrl(publicId: string, format: string, resourceType: 'image' | 'raw'): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const params: Record<string, string> = {
    public_id: publicId,
    timestamp: String(timestamp),
    type: 'upload',
  };
  if (format) params.format = format;

  const signature = cloudinary.utils.api_sign_request(params, CLOUDINARY_SECRET);

  const qs = new URLSearchParams({ ...params, api_key: CLOUDINARY_KEY, signature: signature as string });
  return `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${resourceType}/download?${qs}`;
}

async function downloadFromCloudinary(publicId: string, resourceType: 'image' | 'raw'): Promise<Buffer | null> {
  const attempts: Array<[string, string, 'image' | 'raw']> = [];

  // Attempt 1: full publicId as-is
  attempts.push([publicId, '', resourceType]);

  // Attempt 2: for raw files, split the extension into the format param
  if (resourceType === 'raw') {
    const extMatch = publicId.match(/\.([^/.]+)$/);
    if (extMatch) {
      const format = extMatch[1];
      const cleanId = publicId.slice(0, -extMatch[0].length);
      attempts.push([cleanId, format, resourceType]);
    }
  }

  // Attempt 3: opposite resource type (fallback)
  const altType = resourceType === 'image' ? 'raw' : 'image';
  attempts.push([publicId, '', altType]);

  for (const [pid, fmt, rt] of attempts) {
    try {
      const url = buildDownloadUrl(pid, fmt, rt);
      const response = await fetch(url);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
      console.log(`      (tried ${rt}/${pid} → ${response.status})`);
    } catch { /* try next */ }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  configureCloudinary();
  const drive = getDriveClient();
  const sheets = getSheetsClient();

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  const colLetter = (idx: number) => {
    let s = '';
    idx++;
    while (idx > 0) { s = String.fromCharCode(64 + (idx % 26 || 26)) + s; idx = Math.floor((idx - 1) / 26); }
    return s;
  };

  for (const { tab, idField, spreadsheetId } of SHEET_TABS) {
    console.log(`\n=== ${tab} (spreadsheet: ${spreadsheetId}) ===`);

    try {
      // Read all rows
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tab}!A1:AZ`,
      });

      const rows = res.data.values || [];
      if (rows.length < 2) { console.log('  No data rows.'); continue; }

      const headers = rows[0].map((h: string) => h.toLowerCase().replace(/\s+/g, '_'));
      const col = (name: string) => headers.indexOf(name);

      const colAttachmentId = col('attachment_id');
      const colEntityId     = col(idField);
      const colDriveFileId  = col('drive_file_id');
      const colUrl          = col('url');
      const colType         = col('type');
      const colFileName     = col('file_name');
      const colMimeType     = col('mime_type');
      const colIsDeleted    = col('is_deleted');

      if ([colAttachmentId, colEntityId, colDriveFileId, colUrl].some(c => c === -1)) {
        console.log(`  ⚠ Missing expected columns in ${tab}, skipping.`);
        continue;
      }

      const updates: any[] = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const driveFileId = row[colDriveFileId] || '';
        const attachmentId = row[colAttachmentId] || '';
        const entityId = row[colEntityId] || '';
        const type = (row[colType] || '').toLowerCase();
        const fileName = row[colFileName] || 'file';
        const mimeType = row[colMimeType] || 'application/octet-stream';
        const isDeleted = (row[colIsDeleted] || '').toUpperCase() === 'TRUE';

        // Skip links, already-deleted, already-migrated (no slash = Drive ID), and empty
        if (!driveFileId || !driveFileId.includes('/') || type === 'link' || isDeleted) {
          if (driveFileId && !driveFileId.includes('/') && type !== 'link' && !isDeleted) {
            console.log(`  ⟳ ${attachmentId} — already on Drive, skipping`);
            totalSkipped++;
          }
          continue;
        }

        console.log(`  ↓ ${attachmentId} (${entityId}) — downloading from Cloudinary: ${driveFileId}`);

        const resourceType = type === 'image' ? 'image' : 'raw';
        const buffer = await downloadFromCloudinary(driveFileId, resourceType);

        if (!buffer) {
          console.log(`    ✗ Could not download — skipping`);
          totalFailed++;
          continue;
        }

        try {
          const newFileId = await uploadToDrive(drive, entityId, buffer, fileName, mimeType);
          const newUrl = `https://drive.google.com/file/d/${newFileId}/view`;

          console.log(`    ✓ Uploaded to Drive: ${newFileId}`);

          // Prepare batch update for driveFileId and url columns
          const rowNum = i + 1; // 1-indexed, +1 for header row
          updates.push(
            { range: `${tab}!${colLetter(colDriveFileId)}${rowNum}`, values: [[newFileId]] },
            { range: `${tab}!${colLetter(colUrl)}${rowNum}`,         values: [[newUrl]] },
          );

          totalMigrated++;
        } catch (err) {
          console.log(`    ✗ Drive upload failed: ${err}`);
          totalFailed++;
        }
      }

      if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { data: updates, valueInputOption: 'USER_ENTERED' },
        });
        console.log(`  ✓ Updated ${updates.length / 2} rows in Sheets`);
      }
    } catch (err) {
      console.error(`  ✗ Tab ${tab} failed entirely: ${err}`);
    }
  }

  // ── Rowland score sheets ───────────────────────────────────────────────────
  // score_sheet_url stores a full Cloudinary CDN URL — download directly, no signing needed.

  for (const tab of ROWLAND_TABS) {
    console.log(`\n=== ${tab} (Rowland, spreadsheet: ${ROWLAND_SPREADSHEET_ID}) ===`);

    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: ROWLAND_SPREADSHEET_ID,
        range: `${tab}!A1:AZ`,
      });

      const rows = res.data.values || [];
      if (rows.length < 2) { console.log('  No data rows.'); continue; }

      const headers = rows[0].map((h: string) => h.toLowerCase().replace(/\s+/g, '_'));
      const col = (name: string) => headers.indexOf(name);
      const colMatchId       = col('match_id');
      const colScoreSheetUrl = col('score_sheet_url');

      if (colMatchId === -1 || colScoreSheetUrl === -1) {
        console.log(`  ⚠ Missing expected columns in ${tab}, skipping.`);
        continue;
      }

      const updates: any[] = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const matchId       = row[colMatchId] || '';
        const scoreSheetUrl = row[colScoreSheetUrl] || '';

        if (!scoreSheetUrl) continue;

        // Already on Drive
        if (scoreSheetUrl.includes('drive.google.com')) {
          console.log(`  ⟳ ${matchId} — already on Drive, skipping`);
          totalSkipped++;
          continue;
        }

        // Not a Cloudinary URL — skip
        if (!scoreSheetUrl.includes('cloudinary.com')) continue;

        console.log(`  ↓ ${matchId} — downloading score sheet from Cloudinary`);

        try {
          const response = await fetch(scoreSheetUrl);
          if (!response.ok) {
            console.log(`    ✗ Could not download (${response.status}) — skipping`);
            totalFailed++;
            continue;
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          const mimeType = response.headers.get('content-type') || 'image/jpeg';
          const ext = mimeType.includes('png') ? '.png' : mimeType.includes('webp') ? '.webp' : '.jpg';
          const fileName = `score-sheet${ext}`;

          const newFileId = await uploadToDrive(drive, matchId, buffer, fileName, mimeType, 'Rowland');
          const newUrl = `https://drive.google.com/file/d/${newFileId}/view`;

          console.log(`    ✓ Uploaded to Drive: ${newFileId}`);

          const rowNum = i + 1;
          updates.push({
            range: `${tab}!${colLetter(colScoreSheetUrl)}${rowNum}`,
            values: [[newUrl]],
          });
          totalMigrated++;
        } catch (err) {
          console.log(`    ✗ Failed: ${err}`);
          totalFailed++;
        }
      }

      if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: ROWLAND_SPREADSHEET_ID,
          requestBody: { data: updates, valueInputOption: 'USER_ENTERED' },
        });
        console.log(`  ✓ Updated ${updates.length} rows in Sheets`);
      }
    } catch (err) {
      console.error(`  ✗ Tab ${tab} failed entirely: ${err}`);
    }
  }

  console.log(`\n=== Migration complete ===`);
  console.log(`  Migrated: ${totalMigrated}`);
  console.log(`  Skipped (already on Drive): ${totalSkipped}`);
  console.log(`  Failed:   ${totalFailed}`);
}

main().catch((err) => { console.error('Migration failed:', err); process.exit(1); });
