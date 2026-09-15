// src/lib/website-committee-supabase.ts
// CRUD for website.committee — committee list shown on the public site's /about page.

import { getWebsiteDb } from './website-db';

export interface WebsiteCommitteeMember {
  id: string;
  name: string;
  role: string;
  email: string | null;
  display_order: number;
  active: boolean;
}

interface CommitteeMemberInput {
  name: string;
  role: string;
  email: string | null;
  display_order: number;
  active: boolean;
}

function mapRow(row: any): WebsiteCommitteeMember {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    display_order: row.display_order,
    active: row.active,
  };
}

// Read all committee members, active and inactive, ordered by display_order — admin sees everything.
export async function getAllCommitteeMembers(): Promise<WebsiteCommitteeMember[]> {
  const db = getWebsiteDb();
  const { data, error } = await db.from('committee').select('*').order('display_order', { ascending: true });
  if (error) throw new Error(`Failed to fetch committee: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function createCommitteeMember(input: CommitteeMemberInput): Promise<WebsiteCommitteeMember> {
  const db = getWebsiteDb();
  const { data, error } = await db
    .from('committee')
    .insert({
      name: input.name,
      role: input.role,
      email: input.email,
      display_order: input.display_order,
      active: input.active,
    })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create committee member: ${error.message}`);
  return mapRow(data);
}

// Throws if the ID is not found.
export async function updateCommitteeMember(id: string, input: CommitteeMemberInput): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db
    .from('committee')
    .update(
      {
        name: input.name,
        role: input.role,
        email: input.email,
        display_order: input.display_order,
        active: input.active,
        updated_at: new Date().toISOString(),
      },
      { count: 'exact' }
    )
    .eq('id', id);
  if (error) throw new Error(`Failed to update committee member: ${error.message}`);
  if (!count) throw new Error(`Committee member not found: ${id}`);
}

// Throws if the ID is not found.
export async function deleteCommitteeMember(id: string): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db.from('committee').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(`Failed to delete committee member: ${error.message}`);
  if (!count) throw new Error(`Committee member not found: ${id}`);
}
