-- 0017_users_updated_at.sql
-- Phase 0/1 migration, Step 1 fix — updated_at column
-- Found while building the Postgres-backed auth data layer: the live User TypeScript
-- interface (src/lib/sheets.ts) requires updatedAt (matches SCHEMA.md's Members
-- updated_at), but users never got this column. Same gap-class as 0011.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table users
  add column updated_at timestamptz not null default now();
