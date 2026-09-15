// src/lib/website-db.ts
// Supabase client scoped to the "website" schema — content for the public
// bhbc-website site (Committee, Coaches, Announcements, Honours, Rowland
// interest submissions). See bhbc-website/CLAUDE.md and
// supabase/migrations/0054_website_schema.sql.

import { getSupabaseClient } from './supabase';

export function getWebsiteDb() {
  return getSupabaseClient().schema('website');
}
