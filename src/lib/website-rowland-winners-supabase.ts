// src/lib/website-rowland-winners-supabase.ts
// CRUD for website.rowland_winners — winning club per Rowland Cup draw, shown
// on the public site's /rowland "Past Winners" section. Primary key is `year`
// itself (one row per season). Photos for these years live in Google Drive
// (Rowland/<year>/), not in this table — see bhbc-website's lib/drive.ts
// listRowlandImages() and the Documents admin page for Drive uploads.

import { getWebsiteDb } from './website-db';

export interface WebsiteRowlandWinners {
  year: number;
  edward_winner: string | null;
  gladys_winner: string | null;
}

interface RowlandWinnersFields {
  edward_winner: string | null;
  gladys_winner: string | null;
}

function mapRow(row: any): WebsiteRowlandWinners {
  return {
    year: row.year,
    edward_winner: row.edward_winner,
    gladys_winner: row.gladys_winner,
  };
}

// Read all rows, newest year first.
export async function getAllRowlandWinners(): Promise<WebsiteRowlandWinners[]> {
  const db = getWebsiteDb();
  const { data, error } = await db.from('rowland_winners').select('*').order('year', { ascending: false });
  if (error) throw new Error(`Failed to fetch rowland_winners: ${error.message}`);
  return (data ?? []).map(mapRow);
}

// Throws if a row for this year already exists.
export async function createRowlandWinners(year: number, fields: RowlandWinnersFields): Promise<WebsiteRowlandWinners> {
  const db = getWebsiteDb();
  const { data, error } = await db
    .from('rowland_winners')
    .insert({ year, ...fields })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create rowland_winners row: ${error.message}`);
  return mapRow(data);
}

// Throws if the year is not found.
export async function updateRowlandWinners(year: number, fields: RowlandWinnersFields): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db
    .from('rowland_winners')
    .update({ ...fields, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('year', year);
  if (error) throw new Error(`Failed to update rowland_winners row: ${error.message}`);
  if (!count) throw new Error(`rowland_winners row not found for year: ${year}`);
}

// Throws if the year is not found.
export async function deleteRowlandWinners(year: number): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db.from('rowland_winners').delete({ count: 'exact' }).eq('year', year);
  if (error) throw new Error(`Failed to delete rowland_winners row: ${error.message}`);
  if (!count) throw new Error(`rowland_winners row not found for year: ${year}`);
}
