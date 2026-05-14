/**
 * verify-schema.ts
 * Fetches the header row + up to 3 data rows from every documented sheet tab
 * and prints structured output for comparison against SCHEMA.md.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/verify-schema.ts
 */

import { google } from 'googleapis';

const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
const SA_KEY   = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n');

const SPREADSHEETS: Record<string, string> = {
  MEMBERS:    process.env.MEMBERS_SPREADSHEET_ID!,
  FRIENDLIES: process.env.FRIENDLIES_SPREADSHEET_ID!,
  CONTACTS:   process.env.MATCH_DAY_CONTACTS_SPREADSHEET_ID!,
  COMPS:      process.env.COMPETITIONS_SPREADSHEET_ID!,
  ROWLAND:    process.env.ROWLAND_SPREADSHEET_ID!,
  LEAGUES:    process.env.LEAGUES_SPREADSHEET_ID!,
  CONFIG:     process.env.PORTAL_CONFIG_SPREADSHEET_ID!,
};

const SHEET_TABS: Record<string, string[]> = {
  MEMBERS: [
    'Members',
    'LoginAttempts',
    'ImpersonationLog',
    'MemberEmails',
    'PasswordResetRequests',
    'Renewals',
    'RenewalPayments',
    'CleaningRota',
    'SweepingRota',
    'MemberSuggestions',
    'MemberSuggestionsAttachments',
    'InviteGames',
    'InviteGamesAttachments',
    'BankPayments',
    'InternalGames',
    'SocialEvents',
    'TeaRota',
  ],
  FRIENDLIES: [
    'Games',
    'Players',
  ],
  CONTACTS: [
    'clubs',
    'Contacts',
    'PetrolBands',
  ],
  COMPS: [
    'CompetitionsControl',
    'CompMensChampionship',
    'CompLadiesMaynard',
    'CompMensTwoWood',
    'CompLadiesTwoWood',
    'CompHandicap',
    'CompOldlands',
    'CompVeterans',
    'CompMarriedPairs',
    'CompDrawnPairs',
    'CompAustralianPairs',
    'CompDrawnTriples',
    'CompCentenary',
  ],
  ROWLAND: [
    'RowlandControl',
    'Rowland_edward-a',
    'Rowland_edward-b',
    'Rowland_gladys-a',
    'Rowland_gladys-b',
  ],
  LEAGUES: [
    'LeagueControl',
    'LeagueTeams',
    'LeagueSquad',
    'LeagueMatches',
    'LeagueAttachments',
    'LeagueSettings',
  ],
  CONFIG: [
    'Labels',
  ],
};

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: { client_email: SA_EMAIL, private_key: SA_KEY },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

async function listSheetTabs(sheetsClient: any, spreadsheetId: string): Promise<string[]> {
  try {
    const meta = await sheetsClient.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
    return (meta.data.sheets || []).map((s: any) => s.properties.title as string);
  } catch {
    return [];
  }
}

async function fetchSheet(sheetsClient: any, spreadsheetId: string, tab: string): Promise<{ headers: string[]; rows: string[][] } | null> {
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:AZ5`,
    });
    const values: string[][] = res.data.values || [];
    if (values.length === 0) return { headers: [], rows: [] };
    const headers = values[0].map((h: string) => String(h || ''));
    const rows = values.slice(1).map(r => r.map((c: string) => String(c || '')));
    return { headers, rows };
  } catch (err: any) {
    return null; // tab doesn't exist
  }
}

function sep(label: string) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${label}`);
  console.log('='.repeat(70));
}

function printSheet(spreadsheetKey: string, tab: string, result: { headers: string[]; rows: string[][] } | null) {
  const prefix = `[${spreadsheetKey}] ${tab}`;
  if (result === null) {
    console.log(`${prefix} — TAB NOT FOUND`);
    return;
  }
  if (result.headers.length === 0) {
    console.log(`${prefix} — EMPTY (no header row)`);
    return;
  }
  console.log(`\n--- ${prefix} (${result.headers.length} columns) ---`);
  result.headers.forEach((h, i) => {
    const colLetter = String.fromCharCode(65 + (i < 26 ? i : 25)); // rough
    const sampleVals = result.rows.map(r => r[i] || '').filter(Boolean).slice(0, 2);
    const sample = sampleVals.length ? `  e.g. ${sampleVals.join(' | ')}` : '';
    console.log(`  ${String(i + 1).padStart(3)}. ${h}${sample}`);
  });
}

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  for (const [key, spreadsheetId] of Object.entries(SPREADSHEETS)) {
    sep(`${key}  (${spreadsheetId})`);

    // List actual tabs present in this spreadsheet
    const actualTabs = await listSheetTabs(sheets, spreadsheetId);
    console.log(`\nActual tabs in spreadsheet (${actualTabs.length}): ${actualTabs.join(', ')}`);

    const expectedTabs = SHEET_TABS[key] || [];

    // Check for undocumented tabs
    const undocumented = actualTabs.filter(t => !expectedTabs.includes(t));
    if (undocumented.length) {
      console.log(`\n⚠  UNDOCUMENTED TABS: ${undocumented.join(', ')}`);
    }

    // Fetch all expected + undocumented tabs
    const tabsToFetch = [...new Set([...expectedTabs, ...undocumented])];

    for (const tab of tabsToFetch) {
      const result = await fetchSheet(sheets, spreadsheetId, tab);
      printSheet(key, tab, result);
      // Small delay to avoid quota
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('  DONE');
  console.log('='.repeat(70) + '\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
