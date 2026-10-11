// scripts/lib/backups.ts
// Shared helpers for db-dump.ts/db-restore.ts — the local backups/ folder they read
// from and write to. That folder is gitignored (see .gitignore's /backups/ entry) —
// real member data must never end up in git history.

import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

export const BACKUPS_DIR = join(process.cwd(), 'backups');

export function ensureBackupsDir(): void {
  if (!existsSync(BACKUPS_DIR)) {
    mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

/** Backup files in backups/ with this extension, oldest to newest (alphabetical sort
 *  matches chronological order since the names are zero-padded and year-first).
 *  '.dump' = db-dump.ts's data-only files; '.sql.gz' = full nightly / safety backups. */
export function listBackups(extension: string = '.dump'): string[] {
  if (!existsSync(BACKUPS_DIR)) return [];
  return readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(extension)).sort();
}

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** e.g. "2026-08-17-1432" — sortable, filename-safe (no colons — illegal on Windows). */
export function defaultBackupName(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
