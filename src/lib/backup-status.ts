// src/lib/backup-status.ts
// Read-only health check for the nightly database backups (see /admin/backups).
// The backups are made by .github/workflows/db-backup.yml, which uploads one
// backup-YYYY-MM-DD-HHMM.sql.gz file to Google Drive each day. This file lists those
// files and works out whether they look healthy. It never changes or downloads them.

import { getGoogleDriveClient } from './drive';

// Matches the file name the workflow writes. Anything else (e.g. "Copy of backup-...")
// is ignored, so a stray file can't make the backups look healthier than they are.
const BACKUP_FILE_NAME = /^backup-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz$/;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// GitHub often starts the scheduled run hours late, so a normal gap between two
// backups can be well over 24 hours. These limits leave room for that.
const WARNING_AGE_HOURS = 36; // one run has probably been missed
const PROBLEM_AGE_HOURS = 60; // two runs have probably been missed

// The workflow itself refuses a backup under 50 KB, so the same floor is used here.
const MIN_BACKUP_BYTES = 51200;

// The database only grows slowly, so a sudden large drop is worth a look.
const MAX_SHRINK_PERCENT = 20;

// How many complete days to look back through for a missing backup.
const GAP_CHECK_DAYS = 14;

// The workflow deletes backups older than 90 days. One extra day allows for late runs.
const RETENTION_DAYS = 91;

export type BackupHealth = 'ok' | 'warning' | 'problem';

export interface BackupFile {
  name: string;
  createdTime: string; // ISO date-time from Drive
  sizeBytes: number;
}

export interface BackupCheck {
  label: string;
  health: BackupHealth;
  detail: string;
}

export interface BackupStatus {
  health: BackupHealth;
  checks: BackupCheck[];
  recentBackups: BackupFile[];
  totalCount: number;
  totalBytes: number;
  oldestTime: string | null;
  checkedAt: string;
}

// List every backup file in Drive, newest first.
// Uses the OAuth client, not the service account that read paths normally prefer: the
// backup folder belongs to the club's Google account and is shared with no one, so the
// service account can't see it. A lapsed refresh token therefore throws here, and the
// page reports that as a failed check rather than as "no backups".
export async function listBackupFiles(): Promise<BackupFile[]> {
  const drive = getGoogleDriveClient();
  const files: BackupFile[] = [];
  let pageToken: string | undefined = undefined;

  // Drive returns results in pages, so keep asking until there are no more
  do {
    const response: any = await drive.files.list({
      q: "name contains 'backup' and name contains '.sql.gz' and trashed=false",
      fields: 'nextPageToken, files(name, createdTime, size)',
      orderBy: 'createdTime desc',
      pageSize: 100,
      pageToken,
    });

    const pageFiles = response.data.files;
    if (pageFiles) {
      for (const file of pageFiles) {
        if (BACKUP_FILE_NAME.test(file.name)) {
          files.push({
            name: file.name,
            createdTime: file.createdTime,
            sizeBytes: Number(file.size),
          });
        }
      }
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

// Turn a time into its UTC day, e.g. 2026-11-04, to match the day the workflow ran.
function getUtcDay(timeMs: number): string {
  return new Date(timeMs).toISOString().substring(0, 10);
}

// Check how long ago the newest backup was made
function checkLatestAge(latest: BackupFile, nowMs: number): BackupCheck {
  const ageHours = Math.floor((nowMs - new Date(latest.createdTime).getTime()) / HOUR_MS);

  let health: BackupHealth = 'ok';
  if (ageHours >= PROBLEM_AGE_HOURS) {
    health = 'problem';
  } else if (ageHours >= WARNING_AGE_HOURS) {
    health = 'warning';
  }

  return { label: 'Latest backup', health, detail: `Made ${ageHours} hours ago.` };
}

// Check the newest backup isn't suspiciously small
function checkLatestSize(latest: BackupFile, previous: BackupFile | null): BackupCheck {
  const label = 'Latest backup size';
  const sizeKb = Math.round(latest.sizeBytes / 1024);

  if (latest.sizeBytes < MIN_BACKUP_BYTES) {
    return { label, health: 'problem', detail: `${sizeKb} KB, which is under the 50 KB minimum.` };
  }

  if (previous !== null && previous.sizeBytes > 0) {
    const shrinkPercent = ((previous.sizeBytes - latest.sizeBytes) / previous.sizeBytes) * 100;
    if (shrinkPercent > MAX_SHRINK_PERCENT) {
      return {
        label,
        health: 'warning',
        detail: `${sizeKb} KB, which is ${Math.round(shrinkPercent)}% smaller than the backup before it.`,
      };
    }
  }

  return { label, health: 'ok', detail: `${sizeKb} KB, in line with the backup before it.` };
}

// Check every recent day has a backup. Today is left out because it may not have run yet.
// Days before the very first backup aren't counted as missing.
function checkMissingDays(files: BackupFile[], nowMs: number): BackupCheck {
  const label = `Last ${GAP_CHECK_DAYS} days`;

  const daysWithBackup = new Set<string>();
  for (const file of files) {
    daysWithBackup.add(getUtcDay(new Date(file.createdTime).getTime()));
  }

  const firstBackup = files[files.length - 1];
  const firstDay = getUtcDay(new Date(firstBackup.createdTime).getTime());

  const missingDays: string[] = [];
  for (let i = 1; i <= GAP_CHECK_DAYS; i++) {
    const day = getUtcDay(nowMs - i * DAY_MS);
    // These are YYYY-MM-DD strings, so comparing them as text compares the dates
    if (day >= firstDay && !daysWithBackup.has(day)) {
      missingDays.push(day);
    }
  }

  if (missingDays.length > 0) {
    return { label, health: 'warning', detail: `No backup found for ${missingDays.join(', ')}.` };
  }
  return { label, health: 'ok', detail: 'A backup was made every day.' };
}

// Check old backups are being cleared out
function checkRetention(files: BackupFile[], nowMs: number): BackupCheck {
  const label = 'Old backups cleared';

  let expiredCount = 0;
  for (const file of files) {
    if (nowMs - new Date(file.createdTime).getTime() > RETENTION_DAYS * DAY_MS) {
      expiredCount = expiredCount + 1;
    }
  }

  if (expiredCount > 0) {
    return { label, health: 'warning', detail: `${expiredCount} backups are older than 90 days and should have been deleted.` };
  }
  return { label, health: 'ok', detail: 'Nothing older than 90 days is being kept.' };
}

// Work out the overall health from a list of backups (newest first).
// Kept separate from the Drive call so the rules can be tested without Drive.
export function evaluateBackups(files: BackupFile[], nowMs: number): BackupStatus {
  const checkedAt = new Date(nowMs).toISOString();

  if (files.length === 0) {
    return {
      health: 'problem',
      checks: [{ label: 'Backups found', health: 'problem', detail: 'No backup files were found in Google Drive.' }],
      recentBackups: [],
      totalCount: 0,
      totalBytes: 0,
      oldestTime: null,
      checkedAt,
    };
  }

  let previous: BackupFile | null = null;
  if (files.length > 1) {
    previous = files[1];
  }

  const checks: BackupCheck[] = [
    checkLatestAge(files[0], nowMs),
    checkLatestSize(files[0], previous),
    checkMissingDays(files, nowMs),
    checkRetention(files, nowMs),
  ];

  // The overall result is the worst result of any single check
  let health: BackupHealth = 'ok';
  for (const check of checks) {
    if (check.health === 'problem') {
      health = 'problem';
    } else if (check.health === 'warning' && health === 'ok') {
      health = 'warning';
    }
  }

  let totalBytes = 0;
  for (const file of files) {
    totalBytes = totalBytes + file.sizeBytes;
  }

  return {
    health,
    checks,
    recentBackups: files.slice(0, GAP_CHECK_DAYS),
    totalCount: files.length,
    totalBytes,
    oldestTime: files[files.length - 1].createdTime,
    checkedAt,
  };
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const files = await listBackupFiles();
  return evaluateBackups(files, Date.now());
}
