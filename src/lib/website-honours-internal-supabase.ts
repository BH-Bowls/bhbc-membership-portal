// src/lib/website-honours-internal-supabase.ts
// CRUD for website.honours_internal — one row per season year, the club's own
// competition record shown on the public site's /honours page. Primary key is
// `year` itself (not a generated id) — one row per year, so year IS the identity.
//
// Column names match the site's current competition terminology, not the legacy
// names on the physical honours boards this data was transcribed from (e.g.
// mens_maynard -> mixed_handicap) — see bhbc-website's specs/HONOURS_DELTA_SPEC.md
// and supabase/migrations/0054_website_schema.sql for the full rename mapping.

import { getWebsiteDb } from './website-db';

export interface WebsiteHonoursInternal {
  year: number;
  president: string | null;
  mens_captain: string | null;
  ladies_captain: string | null;
  mens_championship: string | null;
  mixed_handicap: string | null;
  mens_two_woods: string | null;
  ladies_maynard: string | null;
  ladies_two_woods: string | null;
  drawn_pairs: string | null;
  drawn_triples: string | null;
  oldland: string | null;
  veterans_cup: string | null;
  married_pairs: string | null;
  australian_pairs: string | null;
  centenary_cup: string | null;
}

// Every column except year — used for both create and update payloads
type HonoursInternalFields = Omit<WebsiteHonoursInternal, 'year'>;

function mapRow(row: any): WebsiteHonoursInternal {
  return {
    year: row.year,
    president: row.president,
    mens_captain: row.mens_captain,
    ladies_captain: row.ladies_captain,
    mens_championship: row.mens_championship,
    mixed_handicap: row.mixed_handicap,
    mens_two_woods: row.mens_two_woods,
    ladies_maynard: row.ladies_maynard,
    ladies_two_woods: row.ladies_two_woods,
    drawn_pairs: row.drawn_pairs,
    drawn_triples: row.drawn_triples,
    oldland: row.oldland,
    veterans_cup: row.veterans_cup,
    married_pairs: row.married_pairs,
    australian_pairs: row.australian_pairs,
    centenary_cup: row.centenary_cup,
  };
}

// Read all rows, newest year first.
export async function getAllHonoursInternal(): Promise<WebsiteHonoursInternal[]> {
  const db = getWebsiteDb();
  const { data, error } = await db.from('honours_internal').select('*').order('year', { ascending: false });
  if (error) throw new Error(`Failed to fetch honours_internal: ${error.message}`);
  return (data ?? []).map(mapRow);
}

// Throws if a row for this year already exists.
export async function createHonoursInternal(year: number, fields: HonoursInternalFields): Promise<WebsiteHonoursInternal> {
  const db = getWebsiteDb();
  const { data, error } = await db
    .from('honours_internal')
    .insert({ year, ...fields })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create honours_internal row: ${error.message}`);
  return mapRow(data);
}

// Throws if the year is not found.
export async function updateHonoursInternal(year: number, fields: HonoursInternalFields): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db
    .from('honours_internal')
    .update({ ...fields, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('year', year);
  if (error) throw new Error(`Failed to update honours_internal row: ${error.message}`);
  if (!count) throw new Error(`honours_internal row not found for year: ${year}`);
}

// Throws if the year is not found.
export async function deleteHonoursInternal(year: number): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db.from('honours_internal').delete({ count: 'exact' }).eq('year', year);
  if (error) throw new Error(`Failed to delete honours_internal row: ${error.message}`);
  if (!count) throw new Error(`honours_internal row not found for year: ${year}`);
}
