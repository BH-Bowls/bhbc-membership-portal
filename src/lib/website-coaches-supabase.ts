// src/lib/website-coaches-supabase.ts
// CRUD for website.coaches — coaches shown on the public site's /coaching page.

import { getWebsiteDb } from './website-db';

export interface WebsiteCoach {
  id: string;
  name: string;
  qualification: string;
  bio: string | null;
  active: boolean;
}

interface CoachInput {
  name: string;
  qualification: string;
  bio: string | null;
  active: boolean;
}

function mapRow(row: any): WebsiteCoach {
  return {
    id: row.id,
    name: row.name,
    qualification: row.qualification,
    bio: row.bio,
    active: row.active,
  };
}

// Read all coaches, active and inactive, ordered by name — admin sees everything.
export async function getAllCoaches(): Promise<WebsiteCoach[]> {
  const db = getWebsiteDb();
  const { data, error } = await db.from('coaches').select('*').order('name', { ascending: true });
  if (error) throw new Error(`Failed to fetch coaches: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function createCoach(input: CoachInput): Promise<WebsiteCoach> {
  const db = getWebsiteDb();
  const { data, error } = await db
    .from('coaches')
    .insert({ name: input.name, qualification: input.qualification, bio: input.bio, active: input.active })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create coach: ${error.message}`);
  return mapRow(data);
}

// Throws if the ID is not found.
export async function updateCoach(id: string, input: CoachInput): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db
    .from('coaches')
    .update(
      { name: input.name, qualification: input.qualification, bio: input.bio, active: input.active, updated_at: new Date().toISOString() },
      { count: 'exact' }
    )
    .eq('id', id);
  if (error) throw new Error(`Failed to update coach: ${error.message}`);
  if (!count) throw new Error(`Coach not found: ${id}`);
}

// Throws if the ID is not found.
export async function deleteCoach(id: string): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db.from('coaches').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(`Failed to delete coach: ${error.message}`);
  if (!count) throw new Error(`Coach not found: ${id}`);
}
