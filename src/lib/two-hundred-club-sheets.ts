// src/lib/two-hundred-club-sheets.ts
// Data layer for the "200 Club" fundraiser. Three tabs live in the Members
// spreadsheet (column order doesn't matter — resolved via getColumnMap):
//   200 Club          — entries (assignments): Number | Member | Season  (Member = username)
//   200 Club Settings — per season: Season | Draws | Price | Numbers | Prizes
//   200 Club Winners  — results:   Season | Date | Position | Number | Member | Amount
// The full pool of numbers (1..Numbers) is rendered by the page; the entries tab
// only stores which numbers are assigned to whom.

import { getGoogleSheetsClient, getSpreadsheetId, getColumnMap, getColumnLetter, getAllUsers } from './sheets';

const ENTRIES_SHEET = '200 Club';
const SETTINGS_SHEET = '200 Club Settings';
const WINNERS_SHEET = '200 Club Winners';

export const MAX_PRIZES = 10;
export const DEFAULT_NUMBERS = 200;

// member = resolved display name; username = the raw value stored in the sheet.
export interface ClubEntry { number: string; member: string; username: string; season: string; }
// `numbers` = size of the pool (1..numbers). `amounts` = prize per position.
export interface ClubSettings { season: string; draws: number; price: number; numbers: number; amounts: number[]; }
export interface ClubWinner { season: string; date: string; position: number; number: string; member: string; amount: number; }
export interface RecordedWinner { position: number; number: string; member: string; username: string; amount: number; date: string; }

/** Read all data rows of a tab plus its column map. Returns null if the tab
 *  doesn't exist yet (graceful before the sheets are set up). */
async function readTab(sheetName: string): Promise<{ rows: any[][]; colMap: Record<string, number> } | null> {
  try {
    const colMap = await getColumnMap(sheetName);
    const resp = await getGoogleSheetsClient().spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: `'${sheetName}'!A2:ZZ`,
    });
    return { rows: resp.data.values || [], colMap };
  } catch {
    return null;
  }
}

/** Parse a possibly-formatted number ("£45", "45", "1,200") to a number. */
function toNum(v: any): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[£,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Map of username (lowercased) → full display name, for resolving the Member
 *  column. Falls back to an empty map if the Members sheet can't be read. */
async function buildNameByUser(): Promise<Map<string, string>> {
  try {
    const users = await getAllUsers();
    return new Map(users.map(u => [
      (u.userName || '').toLowerCase(),
      u.fullName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.userName,
    ]));
  } catch {
    return new Map();
  }
}

export async function getEntries(season?: string): Promise<ClubEntry[]> {
  const data = await readTab(ENTRIES_SHEET);
  if (!data) return [];
  const { rows, colMap } = data;
  const numberCol = colMap['number'] ?? 0;
  const memberCol = colMap['member'] ?? 1;
  const seasonCol = colMap['season'];

  // The Member column holds a username; resolve it to the member's full name.
  // If it isn't a known username (e.g. a plain name left in the sheet), show it as-is.
  const nameByUser = await buildNameByUser();

  const out: ClubEntry[] = [];
  for (const row of rows) {
    const number = (row[numberCol] ?? '').toString().trim();
    if (!number) continue;
    const s = seasonCol !== undefined ? (row[seasonCol] ?? '').toString().trim() : '';
    if (season && s && s !== season) continue;
    const raw = (row[memberCol] ?? '').toString().trim();
    out.push({ number, member: nameByUser.get(raw.toLowerCase()) || raw, username: raw, season: s });
  }
  return out;
}

export async function getAllSettings(): Promise<ClubSettings[]> {
  const data = await readTab(SETTINGS_SHEET);
  if (!data) return [];
  const { rows, colMap } = data;
  const out: ClubSettings[] = [];
  for (const row of rows) {
    const season = (row[colMap['season'] ?? 0] ?? '').toString().trim();
    if (!season) continue;

    // Prizes are stored as a single delimited list, e.g. "45 / 25 / 15 / 10".
    // The number of prizes = how many values are present.
    const prizesStr = String(row[colMap['prizes'] ?? -1] ?? '');
    const amounts = prizesStr.split('/').map((s: string) => s.trim()).filter(Boolean).map(toNum).slice(0, MAX_PRIZES);

    out.push({
      season,
      draws: toNum(row[colMap['draws'] ?? -1]) || 6,
      price: toNum(row[colMap['price'] ?? -1]) || 6,
      numbers: toNum(row[colMap['numbers'] ?? -1]) || DEFAULT_NUMBERS,
      amounts,
    });
  }
  return out;
}

export async function getWinners(season?: string): Promise<ClubWinner[]> {
  const data = await readTab(WINNERS_SHEET);
  if (!data) return [];
  const { rows, colMap } = data;
  const out: ClubWinner[] = [];
  for (const row of rows) {
    const s = (row[colMap['season'] ?? 0] ?? '').toString().trim();
    const number = (row[colMap['number'] ?? -1] ?? '').toString().trim();
    if (!s && !number) continue;
    if (season && s !== season) continue;
    out.push({
      season: s,
      date: (row[colMap['date'] ?? -1] ?? '').toString().trim(),
      position: toNum(row[colMap['position'] ?? -1]),
      number,
      member: (row[colMap['member'] ?? -1] ?? '').toString().trim(),
      amount: toNum(row[colMap['amount'] ?? -1]),
    });
  }
  return out;
}

/** The "current" season — the most recent one in Settings, else from entries. */
export async function getCurrentSeason(): Promise<string> {
  const settings = await getAllSettings();
  if (settings.length > 0) return settings.map(s => s.season).sort().reverse()[0];
  const seasons = [...new Set((await getEntries()).map(e => e.season).filter(Boolean))].sort().reverse();
  return seasons[0] || '';
}

/** Upsert the settings row for a season. */
export async function saveSettings(s: ClubSettings): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(SETTINGS_SHEET);
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${SETTINGS_SHEET}'!A2:ZZ` });
  const rows = resp.data.values || [];
  const seasonCol = colMap['season'] ?? 0;
  const rowIndex = rows.findIndex(r => (r[seasonCol] ?? '').toString().trim() === s.season);

  const maxCol = Math.max(...Object.values(colMap));
  const rowArr: (string | number)[] = new Array(maxCol + 1).fill('');
  const set = (field: string, val: string | number) => { const i = colMap[field]; if (i !== undefined) rowArr[i] = val; };
  set('season', s.season); set('draws', s.draws); set('price', s.price);
  set('numbers', s.numbers);
  // Prizes as a single delimited list (slash-separated, so a thousands comma is safe).
  set('prizes', s.amounts.join(' / '));

  if (rowIndex >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `'${SETTINGS_SHEET}'!A${rowIndex + 2}`, valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowArr] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: `'${SETTINGS_SHEET}'!A:A`, valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowArr] },
    });
  }
}

/** Record a draw — resolves each winning number to its member (from entries) and
 *  its prize amount (from the season settings), then appends the winner rows. */
export async function recordDraw(
  season: string,
  date: string,
  picks: { position: number; number: string }[],
): Promise<{ recorded: number; winners: RecordedWinner[] }> {
  const [entries, settingsList] = await Promise.all([getEntries(season), getAllSettings()]);
  const settings = settingsList.find(s => s.season === season);
  const prizeFor = (pos: number) => settings?.amounts[pos - 1] ?? 0;
  const entryFor = (num: string) => entries.find(e => e.number === num.trim());

  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(WINNERS_SHEET);
  const maxCol = Math.max(...Object.values(colMap));

  const values: (string | number)[][] = [];
  const winners: RecordedWinner[] = [];
  for (const pick of picks) {
    const number = (pick.number ?? '').toString().trim();
    if (!number) continue;
    const entry = entryFor(number);
    const member = entry?.member || '';
    const username = entry?.username || '';
    const amount = prizeFor(pick.position);

    const rowArr: (string | number)[] = new Array(maxCol + 1).fill('');
    const set = (field: string, val: string | number) => { const i = colMap[field]; if (i !== undefined) rowArr[i] = val; };
    set('season', season); set('date', date); set('position', pick.position);
    set('number', number); set('member', member); set('amount', amount);
    values.push(rowArr);
    winners.push({ position: pick.position, number, member, username, amount, date });
  }
  if (values.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: `'${WINNERS_SHEET}'!A:A`, valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }
  return { recorded: values.length, winners };
}

/** Assign (or clear) a number's holder for a season. `username` empty = clear.
 *  Upserts a row in the entries tab keyed by (number, season). */
export async function assignNumber(season: string, number: string, username: string): Promise<void> {
  const num = number.toString().trim();
  if (!num) return;
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(ENTRIES_SHEET);
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${ENTRIES_SHEET}'!A2:ZZ` });
  const rows = resp.data.values || [];
  const numberCol = colMap['number'] ?? 0;
  const memberCol = colMap['member'] ?? 1;
  const seasonCol = colMap['season'];

  const rowIndex = rows.findIndex(r =>
    (r[numberCol] ?? '').toString().trim() === num &&
    (seasonCol === undefined || (r[seasonCol] ?? '').toString().trim() === season)
  );

  if (rowIndex >= 0) {
    // Update just the Member cell of the existing row (blank username = clear).
    const cell = `'${ENTRIES_SHEET}'!${getColumnLetter(memberCol)}${rowIndex + 2}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: cell, valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[username]] },
    });
  } else if (username) {
    // No existing row and we're assigning — append a new one.
    const maxCol = Math.max(...Object.values(colMap));
    const rowArr: string[] = new Array(maxCol + 1).fill('');
    const set = (field: string, val: string) => { const i = colMap[field]; if (i !== undefined) rowArr[i] = val; };
    set('number', num); set('member', username);
    if (seasonCol !== undefined) set('season', season);
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: `'${ENTRIES_SHEET}'!A:A`, valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowArr] },
    });
  }
}
