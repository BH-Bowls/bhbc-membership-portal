-- 0012_games_core.sql
-- Phase 0/1 migration, Step 4a — seasons + games (core fixture rows)
-- Cross-checked against SCHEMA.md's full Games sheet column list from the start, per the
-- gap found and fixed in Step 1/2 (0010, 0011) — the plan's own SQL block for this table
-- explicitly signalled incompleteness (`-- dress, ladies_men, special_instructions etc.`).
--
-- "Season" doesn't exist as its own entity today — not even a plain string column — the
-- year is implicit purely in which spreadsheet/tab is active. seasons is genuinely new
-- structure, not a normalisation of an existing column. See
-- specs/Phase_0_1_Migration_Plan.md, Step 4, for the full reasoning.
--
-- Deliberately excluded, not oversights:
--   - tab_date: SCHEMA.md's own note says this doesn't appear as a real header in the
--     live sheet — it's derived from `date` at runtime, so there's nothing to migrate.
--   - Denormalised player counts (reserves is the exception, kept below to match the
--     plan's literal precedent of keeping entered/selected as stored columns) beyond
--     what's already here — see the note above the games table for the entered/selected
--     tension this doesn't fully resolve.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists seasons (
  id          uuid primary key default gen_random_uuid(),
  year        int not null unique,
  start_date  date not null,
  end_date    date not null,
  is_active   boolean not null default false   -- exactly one true at a time
);

alter table seasons enable row level security;

-- Note: entered/selected/reserves are kept as stored, denormalised counts here, matching
-- the plan's literal precedent (its SQL block already included entered/selected without
-- flagging removal) rather than computing them via a view against game_players (4b) —
-- even though SCHEMA.md's own §10.1 flags this denormalisation as a known weakness of the
-- current system. Not resolved here; worth revisiting once game_players has real data.
create table if not exists games (
  id                    uuid primary key default gen_random_uuid(),
  season_id             uuid not null references seasons(id),
  fixture_type          text not null,      -- 'Friendly','Event','BL','JSL','MSL','N/S A','N/S B'
  club_name             text references club_profiles(club_name),   -- null for internal Events
  date date, time time,
  home_away             text check (home_away in ('H','A')),
  format                text,               -- '3 Rinks','4 Triples' etc.
  ladies_men            text,               -- 'Ladies','Men','Mixed'
  dress                 text,               -- 'Whites','Greys' etc.
  league                text,               -- league name if applicable, distinct from fixture_type
  tab_name              text unique,        -- stable human-readable slug, no longer a sheet-tab
                                             -- identifier but kept — existing routes/URLs
                                             -- may still depend on it; revisit at cutover
  club_suffix           text,               -- e.g. 'A' -> "Henfield A"
  hard_block            boolean not null default false,

  game_status           text default '',    -- '', 'O','L','X','S','P','C','A' — live-season only
  include               text,               -- optional filtering flag
  max_capacity int, entered int default 0, selected int default 0, reserves int default 0,
  bhbc_score int, opponent_score int,
  reason text, who text,                    -- cancellation/abandonment reason + who cancelled
  special_instructions  text,
  pickup_info           text,               -- car-sharing pickup point for away games
  paired                boolean not null default false,

  captain_username      text references users(username) on update cascade,
  locked_by             text references users(username) on update cascade,
  locked_at             timestamptz,
  last_modified_by      text references users(username) on update cascade,
  tea_lead_username     text references users(username) on update cascade,
  tea_first_username    text references users(username) on update cascade,
  tea_second_username   text references users(username) on update cascade,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table games enable row level security;
