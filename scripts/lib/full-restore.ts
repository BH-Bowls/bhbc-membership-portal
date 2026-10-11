// scripts/lib/full-restore.ts
// Shared engine for the two FULL (schema + data) restore scripts:
//   db-drill-restore-dev.ts        — disaster-recovery drill into dev
//   db-restore-production-full.ts  — genuine production restore
// They restore the nightly backups made by .github/workflows/db-backup.yml
// (plain SQL, gzipped, schemas public + website). See specs/DATABASE_BACKUP_SPEC.md §6.
//
// Not to be confused with db-dump.ts / db-restore.ts, which copy DATA ONLY between
// environments and rely on the migrations for the table structure.

import { spawn, execFileSync } from 'child_process';
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync, WriteStream } from 'fs';
import { join } from 'path';
import { Transform, TransformCallback } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip, createGzip } from 'zlib';
import { parse } from 'dotenv';
import { BACKUPS_DIR, ensureBackupsDir, listBackups, ask, defaultBackupName } from './backups';
import { pgTool } from './postgres-tools';

// Same refs as the db-link-* npm scripts. Each restore script insists its env file
// points at its own project, so neither can be aimed at the other by mistake.
export const DEV_PROJECT_REF = 'ofqepimyooesuckyrane';
export const PRODUCTION_PROJECT_REF = 'ovmaeycnlubjxsyrswoz';

// The schemas a full backup holds (keep in step with the workflow's --schema flags)
const BACKUP_SCHEMAS = ['public', 'website'];

// Anything smaller than this can't be a real backup of this database
const MIN_BACKUP_BYTES = 50 * 1024;

export interface Target {
  envFile: string;
  poolerUrl: string;
  databaseName: string;
  projectRef: string;
  host: string;
  port: string;
}

/**
 * Read the connection details straight from one env file. Deliberately NOT via
 * process.env, so a variable already set in the shell can't redirect the restore.
 */
export function readTarget(envFile: string): Target {
  const path = join(process.cwd(), envFile);
  if (!existsSync(path)) throw new Error(`${envFile} not found in ${process.cwd()}`);
  const vars = parse(readFileSync(path));
  const poolerUrl = vars.SUPABASE_POOLER_URL || '';
  if (!poolerUrl) throw new Error(`SUPABASE_POOLER_URL is not set in ${envFile}`);

  // postgresql://postgres.<ref>:<password>@<host>:<port>/postgres
  const match = poolerUrl.match(/^postgres(?:ql)?:\/\/([^:@]+)(?::[^@]*)?@([^:/]+):(\d+)\//);
  if (!match) throw new Error(`SUPABASE_POOLER_URL in ${envFile} isn't a postgresql:// URL`);
  const user = match[1];
  const dot = user.indexOf('.');
  return {
    envFile,
    poolerUrl,
    databaseName: vars.SUPABASE_DATABASE_NAME || '(SUPABASE_DATABASE_NAME not set)',
    projectRef: dot >= 0 ? user.slice(dot + 1) : '',
    host: match[2],
    port: match[3],
  };
}

/** Stop unless the target is the expected project, over the session pooler. */
export function checkTarget(target: Target, expectedRef: string, label: string): void {
  if (target.projectRef !== expectedRef) {
    throw new Error(
      `${target.envFile} points at project "${target.projectRef}", but the ${label} project is "${expectedRef}". Refusing to continue.`
    );
  }
  if (target.port === '6543') {
    throw new Error(
      `${target.envFile}'s SUPABASE_POOLER_URL uses port 6543 (transaction pooler). A restore needs the session pooler (port 5432) — copy it from Supabase → Connect → Session pooler.`
    );
  }
}

export function printTarget(target: Target, label: string): void {
  console.log(`\nTarget:   ${label.toUpperCase()} — ${target.databaseName}`);
  console.log(`Project:  ${target.projectRef}`);
  console.log(`Host:     ${target.host}:${target.port}`);
  console.log(`Env file: ${target.envFile}\n`);
}

function toolPath(name: 'pg_dump' | 'psql'): string {
  const path = pgTool(name);
  if (!existsSync(path)) {
    throw new Error(`${name} not found at ${path}. Set POSTGRES_BIN_DIR to your PostgreSQL bin folder.`);
  }
  return path;
}

/**
 * Ask which backups/*.sql.gz file to restore (newest first; Enter = newest).
 * Returns the full path, or null if there are none / the answer was invalid.
 */
export async function chooseBackup(): Promise<string | null> {
  const files = listBackups('.sql.gz').reverse();
  if (files.length === 0) {
    console.log(`No .sql.gz backups in ${BACKUPS_DIR}.`);
    console.log('Download one from the "BHBC Database Backups" Drive folder into backups/ first.');
    return null;
  }
  console.log('Backups available (newest first):');
  const shown = Math.min(files.length, 15);
  for (let i = 0; i < shown; i++) {
    const size = (statSync(join(BACKUPS_DIR, files[i])).size / (1024 * 1024)).toFixed(1);
    console.log(`  ${i + 1}. ${files[i]}  (${size} MB)`);
  }
  const answer = (await ask(`\nWhich backup? [1]: `)).trim();
  const index = answer === '' ? 0 : parseInt(answer, 10) - 1;
  if (isNaN(index) || index < 0 || index >= shown) {
    console.log('Not a valid choice.');
    return null;
  }
  return join(BACKUPS_DIR, files[index]);
}

/**
 * Check a .sql.gz backup is a complete pg_dump: decompresses cleanly, isn't tiny, and
 * has "PostgreSQL database dump complete" in its last lines (pg_dump 17.6+ adds an
 * \unrestrict line after it, so it isn't literally the last line).
 */
export async function verifyBackup(file: string): Promise<void> {
  const size = statSync(file).size;
  if (size < MIN_BACKUP_BYTES) throw new Error(`${file} is only ${size} bytes — not a real backup.`);
  let tail = '';
  const keepTail = new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
      tail = (tail + chunk.toString('utf8')).slice(-2000);
      done();
    },
  });
  await pipeline(createReadStream(file), createGunzip(), keepTail);
  if (tail.indexOf('-- PostgreSQL database dump complete') < 0) {
    throw new Error(`${file} doesn't end with "PostgreSQL database dump complete" — it is incomplete.`);
  }
}

/**
 * Full dump (same flags as the nightly workflow) of the target into backups/,
 * streamed through gzip — never buffered — then verified. Returns the file path.
 */
export async function dumpFull(target: Target, prefix: string): Promise<string> {
  ensureBackupsDir();
  const file = join(BACKUPS_DIR, `${prefix}-${defaultBackupName()}.sql.gz`);
  const args = [target.poolerUrl, '--no-owner'];
  for (const s of BACKUP_SCHEMAS) args.push(`--schema=${s}`);

  const child = spawn(toolPath('pg_dump'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
  const exited = new Promise<number>((resolve) => child.on('close', (code) => resolve(code === null ? 1 : code)));
  await pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(file));
  const code = await exited;
  if (code !== 0) throw new Error(`pg_dump failed (exit ${code}): ${stderr.trim()}`);
  await verifyBackup(file);
  return file;
}

// Supabase's own admin role sets default privileges on public; the dump includes them
// but our postgres login isn't allowed to change another role's defaults
// ("permission denied to change default privileges"). They only affect objects that
// supabase_admin itself creates — every table here is created by postgres, whose own
// defaults ARE restored — so these lines are skipped (and counted in the log).
const SKIPPED_LINE_PREFIX = 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ';

/**
 * Passes the SQL through line by line, counting the rows in each COPY block (so the
 * restore can be checked against what the backup actually contained) and dropping the
 * supabase_admin default-privilege lines above (never inside COPY data).
 */
class CopyRowCounter extends Transform {
  counts = new Map<string, number>();
  skipped = 0;
  private partial = '';
  private table: string | null = null;

  _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    const text = this.partial + chunk.toString('utf8');
    const lines = text.split('\n');
    this.partial = lines.pop() as string;
    let out = '';
    for (const line of lines) {
      if (this.keepLine(line)) out += line + '\n';
    }
    done(null, out);
  }

  _flush(done: TransformCallback): void {
    if (this.partial && this.keepLine(this.partial)) this.push(this.partial);
    done();
  }

  /** Count the line; return false if it should be left out of the restore. */
  private keepLine(line: string): boolean {
    if (this.table === null) {
      if (line.startsWith(SKIPPED_LINE_PREFIX)) {
        this.skipped++;
        return false;
      }
      // COPY public.members (col, col, ...) FROM stdin;
      const m = line.match(/^COPY ([^ ]+) .*FROM stdin;$/);
      if (m) {
        this.table = m[1].replace(/"/g, '');
        this.counts.set(this.table, 0);
      }
      return true;
    }
    if (line === '\\.') {
      this.table = null;
      return true;
    }
    this.counts.set(this.table, (this.counts.get(this.table) as number) + 1);
    return true;
  }
}

/** Write to a stream and wait if it's full (so a big dump never piles up in memory). */
function writeAndWait(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve) => {
    if (stream.write(text)) resolve();
    else stream.once('drain', () => resolve());
  });
}

/**
 * Wipe and rebuild the backup's schemas from a .sql.gz backup, in ONE transaction:
 *   BEGIN; DROP SCHEMA website, public CASCADE; <the dump>; COMMIT;
 * psql runs with ON_ERROR_STOP, so any error ends it before COMMIT and the whole
 * thing — the drop included — rolls back, leaving the database as it was.
 * Returns the row counts the dump contained (table → rows).
 */
export async function restoreFull(target: Target, file: string, logFile: string): Promise<Map<string, number>> {
  const log: WriteStream = createWriteStream(logFile);
  const child = spawn(toolPath('psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', target.poolerUrl], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  // If psql stops on an error it closes its input — ignore the resulting EPIPE here,
  // the exit code below reports the real failure.
  child.stdin.on('error', () => {});
  const exited = new Promise<number>((resolve) => child.on('close', (code) => resolve(code === null ? 1 : code)));

  // Progress: how much of the compressed file has been read
  const total = statSync(file).size;
  let read = 0;
  let lastShown = -1;
  const progress = new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
      read += chunk.length;
      const pct = Math.floor((read / total) * 20) * 5;
      if (pct !== lastShown) {
        lastShown = pct;
        process.stdout.write(`\r  Restoring… ${pct}%`);
      }
      done(null, chunk);
    },
  });
  const counter = new CopyRowCounter();

  let dropSql = 'BEGIN;\n';
  for (let i = BACKUP_SCHEMAS.length - 1; i >= 0; i--) {
    dropSql += `DROP SCHEMA IF EXISTS ${BACKUP_SCHEMAS[i]} CASCADE;\n`;
  }
  await writeAndWait(child.stdin, dropSql);
  try {
    await pipeline(createReadStream(file), progress, createGunzip(), counter, child.stdin, { end: false });
    await writeAndWait(child.stdin, '\nCOMMIT;\n');
  } catch {
    // psql exited early (an error) — fall through to the exit code
  }
  child.stdin.end();
  const code = await exited;
  process.stdout.write('\n');
  if (counter.skipped > 0) {
    log.write(`\n[restore script] Skipped ${counter.skipped} "${SKIPPED_LINE_PREFIX.trim()}" line(s) — Supabase's own admin defaults, which this login can't set.\n`);
  }
  log.end();
  if (code !== 0) {
    throw new Error(`psql stopped with an error (exit ${code}) — NOTHING was changed (the transaction rolled back). Details in ${logFile}`);
  }

  // Tell the app's Supabase API (PostgREST) to pick up the rebuilt tables
  runSql(target, "NOTIFY pgrst, 'reload schema';");
  return counter.counts;
}

/** Run a small SQL statement and return its unaligned output (tuples only). */
function runSql(target: Target, sql: string): string {
  return execFileSync(toolPath('psql'), ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', target.poolerUrl, '-c', sql], {
    encoding: 'utf8',
  });
}

/**
 * Compare live row counts with what the backup contained. Prints a table of any
 * differences and returns how many tables differ.
 */
export function checkRowCounts(target: Target, expected: Map<string, number>): number {
  const tables = Array.from(expected.keys()).sort();
  if (tables.length === 0) {
    console.log('The backup contained no table data to check.');
    return 0;
  }
  const parts: string[] = [];
  for (const t of tables) {
    const [schema, name] = t.split('.');
    parts.push(`select '${t}', count(*) from "${schema}"."${name}"`);
  }
  const output = runSql(target, parts.join(' union all '));
  const actual = new Map<string, number>();
  for (const line of output.split('\n')) {
    const [table, count] = line.trim().split('|');
    if (table) actual.set(table, parseInt(count, 10));
  }

  let differences = 0;
  let totalRows = 0;
  for (const t of tables) {
    const want = expected.get(t) as number;
    const got = actual.has(t) ? (actual.get(t) as number) : -1;
    totalRows += want;
    if (want !== got) {
      differences++;
      console.log(`  MISMATCH ${t}: backup had ${want}, database now has ${got < 0 ? 'nothing' : got}`);
    }
  }
  if (differences === 0) {
    console.log(`Row counts match the backup: ${tables.length} tables, ${totalRows} rows.`);
  }
  return differences;
}

export function restoreLogPath(label: string): string {
  ensureBackupsDir();
  return join(BACKUPS_DIR, `restore-${label}-${defaultBackupName()}.log`);
}
