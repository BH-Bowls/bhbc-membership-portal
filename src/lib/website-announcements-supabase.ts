// src/lib/website-announcements-supabase.ts
// CRUD for website.announcements — banners/cards shown on the public site's home page.
// Distinct from the portal's own `announcements` table (public schema, home-page
// banners for portal users) — src/lib/announcements-supabase.ts handles that one.

import { getWebsiteDb } from './website-db';

export type WebsiteAnnouncementType = 'open-day' | 'visiting-side' | 'event' | 'notice';

export interface WebsiteAnnouncement {
  id: string;
  title: string;
  body: string;
  type: WebsiteAnnouncementType;
  cta_label: string | null;
  cta_url: string | null;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  active: boolean;
}

interface AnnouncementInput {
  title: string;
  body: string;
  type: WebsiteAnnouncementType;
  cta_label: string | null;
  cta_url: string | null;
  start_date: string;
  end_date: string;
  active: boolean;
}

function mapRow(row: any): WebsiteAnnouncement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    cta_label: row.cta_label,
    cta_url: row.cta_url,
    start_date: row.start_date,
    end_date: row.end_date,
    active: row.active,
  };
}

// Read all announcements, ordered newest-start-date first — admin sees everything, active or not.
export async function getAllWebsiteAnnouncements(): Promise<WebsiteAnnouncement[]> {
  const db = getWebsiteDb();
  const { data, error } = await db.from('announcements').select('*').order('start_date', { ascending: false });
  if (error) throw new Error(`Failed to fetch website announcements: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function createWebsiteAnnouncement(input: AnnouncementInput): Promise<WebsiteAnnouncement> {
  const db = getWebsiteDb();
  const { data, error } = await db
    .from('announcements')
    .insert({
      title: input.title,
      body: input.body,
      type: input.type,
      cta_label: input.cta_label,
      cta_url: input.cta_url,
      start_date: input.start_date,
      end_date: input.end_date,
      active: input.active,
    })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create website announcement: ${error.message}`);
  return mapRow(data);
}

// Throws if the ID is not found.
export async function updateWebsiteAnnouncement(id: string, input: AnnouncementInput): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db
    .from('announcements')
    .update(
      {
        title: input.title,
        body: input.body,
        type: input.type,
        cta_label: input.cta_label,
        cta_url: input.cta_url,
        start_date: input.start_date,
        end_date: input.end_date,
        active: input.active,
        updated_at: new Date().toISOString(),
      },
      { count: 'exact' }
    )
    .eq('id', id);
  if (error) throw new Error(`Failed to update website announcement: ${error.message}`);
  if (!count) throw new Error(`Website announcement not found: ${id}`);
}

// Throws if the ID is not found.
export async function deleteWebsiteAnnouncement(id: string): Promise<void> {
  const db = getWebsiteDb();
  const { error, count } = await db.from('announcements').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(`Failed to delete website announcement: ${error.message}`);
  if (!count) throw new Error(`Website announcement not found: ${id}`);
}
