/**
 * Sheets stores timestamps as "DD/MM/YYYY HH:MM:SS" (UK format, not ISO despite what
 * SCHEMA.md's documentation claims for some fields) — passing these straight to a
 * Postgres timestamptz column fails outright (Postgres tries to parse "20/05/2025" as
 * MM/DD and rejects day 20 as an invalid month). This is the exact "new
 * Date(sheetDateString) silently fails on Sheets dates" trap CLAUDE.md warns about, just
 * surfacing as a hard error here instead of a silent misparse.
 *
 * Shared by every migrate-*.ts script — extracted after the third copy-paste.
 */
export function parseSheetTimestamp(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Comma before the time is optional — Applications data uses "DD/MM/YYYY, HH:MM",
  // Members/Leavers data uses "DD/MM/YYYY HH:MM:SS" (no comma, seconds included).
  const ukMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ukMatch) {
    const [, day, month, year, hour, minute, second] = ukMatch;
    const date = new Date(
      parseInt(year), parseInt(month) - 1, parseInt(day),
      hour ? parseInt(hour) : 0, minute ? parseInt(minute) : 0, second ? parseInt(second) : 0
    );
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) return parsed.toISOString();

  console.warn(`   !! Could not parse timestamp "${trimmed}" — leaving null`);
  return null;
}
