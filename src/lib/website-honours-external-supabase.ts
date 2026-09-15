// src/lib/website-honours-external-supabase.ts
// CRUD for website.honours_external — county/national/other external competition
// results shown in the expandable year card on the public site's /honours page.
// Multiple rows per year are expected (unlike honours_internal, one row per year).

import { getWebsiteDb } from './website-db';

export interface WebsiteHonoursExternal {
  id: string;
  year: number;
  competition: string;
  detail: string | null;
}

interface HonoursExternalInput {
  year: number;
  competition: string;
  detail: string | null;
}

function mapRow(row: any): WebsiteHonoursExternal {
  return {
    id: row.id,
    year: row.year,
    competition: row.competition,
    detail: row.detail,
  };
}

// Read all rows, newest year first.
export async function getAllHonoursExternal(): Promise<WebsiteHonoursExternal[]> {
  const db = getWebsiteDb();
  const { data, error } = await db.from('honours_external').select('*').order('year', { ascending: false });
  if (error) throw new Error(`Failed to fetch honours_external: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function createHonoursExternal(input: HonoursExternalInput): Promise<WebsiteHonoursExternal> {
  const db = getWebsiteDb();
  const { data, error } = await db
    .from('honours_external')
    .insert({ year: input.year, competition: input.competition, detail: input.detail })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create honours_external row: ${error.message}`);
  return mapRow(data);
}

// Throws if the ID is not found.
export async function updateHonoursExternal(id: string, input: HonoursExternalInput): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db
    .from('honours_external')
    .update({ year: input.year, competition: input.competition, detail: input.detail }, { count: 'exact' })
    .eq('id', id);
  if (error) throw new Error(`Failed to update honours_external row: ${error.message}`);
  if (!count) throw new Error(`honours_external row not found: ${id}`);
}

// Throws if the ID is not found.
export async function deleteHonoursExternal(id: string): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db.from('honours_external').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(`Failed to delete honours_external row: ${error.message}`);
  if (!count) throw new Error(`honours_external row not found: ${id}`);
}
