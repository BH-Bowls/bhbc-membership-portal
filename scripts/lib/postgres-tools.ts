// scripts/lib/postgres-tools.ts
// Resolves pg_dump/psql/pg_restore to their full path. Windows doesn't reliably put
// PostgreSQL's bin/ on PATH even with the official installer's "Command Line Tools"
// component selected — confirmed 2026-08-17 (a bare "pg_dump" spawn failed with
// ENOENT). Defaults to the confirmed-working install location; override with
// POSTGRES_BIN_DIR in .env.local/.env.prod.local if your install lives elsewhere.

import { join } from 'path';

const DEFAULT_BIN_DIR = 'C:\\Program Files\\PostgreSQL\\18\\bin';

export function pgTool(name: 'pg_dump' | 'psql' | 'pg_restore'): string {
  const binDir = process.env.POSTGRES_BIN_DIR || DEFAULT_BIN_DIR;
  return join(binDir, `${name}.exe`);
}
