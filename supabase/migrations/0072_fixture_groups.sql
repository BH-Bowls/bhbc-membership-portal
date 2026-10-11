-- 0072_fixture_groups.sql
-- Fixture groups: the friendlies roster moves off Google Sheets (the Players EAV tab,
-- per-game tabs, _SelectionCache, ManageLog) into Postgres. See
-- specs/FIXTURE_GROUPS_SPEC.md for the full design.
--
--   fixture_groups      the thing people enter. 'occasion' = one friendly playing
--                       occasion (one fixture, or several linked/reserve games on the
--                       same date); 'squad' = a season-long league / Club Team squad.
--   fixture_entries     a member's place in a group (the pool / the squad).
--   fixture_selections  an entry picked for one fixture (team/position/driving).
--                       A friendly reserve is simply an entry with no selection.
--
-- Additive only. 0073 later drops fixtures.paired / is_reserve / entered / selected /
-- reserves once nothing reads them. Apply BEFORE deploying the code that uses it.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

-- game_players (0013) was schema-only and never read or written by any code.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'game_players') then
    if exists (select 1 from game_players limit 1) then
      raise exception 'game_players has rows — investigate before dropping';
    end if;
    drop table game_players;
  end if;
end $$;

-- ============================================================================
-- GROUPS
-- ============================================================================

create table fixture_groups (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references seasons(id),
  kind         text not null check (kind in ('occasion', 'squad')),
  entry_mode   text not null default 'self' check (entry_mode in ('self', 'manager')),
  label        text not null,              -- 'Buxted', 'Arundel + Adastra', 'MSL 2027'
  squad_type   text check (squad_type in ('league', 'club_team')),
  league_type  text,                       -- 'MSL','BL','JSL','N/S A','N/S B' (league squads)
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_by   text not null references users(username) on update cascade,
  created_at   timestamptz not null default now(),
  constraint fixture_groups_squad_type check ((kind = 'squad') = (squad_type is not null))
);

create index fixture_groups_season_idx on fixture_groups (season_id);

create table fixture_group_managers (
  group_id  uuid not null references fixture_groups(id) on delete cascade,
  username  text not null references users(username) on update cascade,
  added_by  text references users(username) on update cascade,
  added_at  timestamptz not null default now(),
  primary key (group_id, username)
);

alter table fixtures
  add column group_id   uuid references fixture_groups(id),
  add column reserve_of uuid references fixtures(id),
  add column result     text check (result in ('W', 'L', 'D'));

create index fixtures_group_idx on fixtures (group_id);

-- ============================================================================
-- ENTRIES
-- ============================================================================

create table fixture_entries (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references fixture_groups(id) on delete cascade,
  username              text not null references users(username) on update cascade,
  entry_source          text not null check (entry_source in ('self', 'buddy', 'manager')),
  entered_by            text references users(username) on update cascade,   -- null only for imported rows where unknown
  entered_at            timestamptz not null default now(),
  status                text not null default 'entered' check (status in ('entered', 'withdrawn')),
  withdrawn_by          text references users(username) on update cascade,
  withdrawn_at          timestamptz,
  preferred_fixture_id  uuid references fixtures(id) on delete set null,
  preference            text check (preference in ('preferred', 'only')),
  car_number            text,      -- 'O' = own transport; player's offer at entry (away games)
  -- Occasions (friendlies): confirmation is per entry, because reserves confirm too and a
  -- reserve has no selection row. Squad fixtures confirm per selection instead.
  confirmed_at          timestamptz,
  cancellation_acknowledged_at timestamptz,
  -- 64 hex chars from two v4 UUIDs (~244 random bits) — magic-link token, created with the row
  token                 text not null unique
                        default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  unique (group_id, username),
  constraint fixture_entries_preference check ((preferred_fixture_id is null) = (preference is null)),
  constraint fixture_entries_withdrawn check ((status = 'withdrawn') = (withdrawn_at is not null))
);

create index fixture_entries_username_idx on fixture_entries (username);

-- ============================================================================
-- SELECTIONS
-- ============================================================================

create table fixture_selections (
  id             uuid primary key default gen_random_uuid(),
  fixture_id     uuid not null references fixtures(id) on delete cascade,
  entry_id       uuid not null references fixture_entries(id) on delete cascade,
  selection      text not null check (selection in ('Y', 'O')),   -- O = playing for the opposition
  team           smallint,
  position       text check (position in ('S', '1', '2', '3')),
  driving        text check (driving = 'Y'),          -- 'Y' = driving to this away game
  car_number     text,
  confirmed_at   timestamptz,   -- squads only (friendlies confirm on the entry)
  withdrawn_by   text references users(username) on update cascade,   -- squads: dropped out of this one fixture
  withdrawn_at   timestamptz,
  selected_at    timestamptz not null default now(),
  -- true for occasion groups: a friendly entry may hold at most one selection across
  -- the whole occasion (enforced by the partial unique index below, so two captains
  -- picking the same reserve for linked games can't both succeed).
  one_per_entry  boolean not null default false,
  unique (fixture_id, entry_id)
);

create index fixture_selections_entry_idx on fixture_selections (entry_id);
create unique index fixture_selections_one_per_entry_idx on fixture_selections (entry_id) where one_per_entry;

-- ============================================================================
-- AUDIT LOG (replaces the ManageLog sheet tab)
-- ============================================================================

create table friendlies_manage_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  username    text references users(username) on update cascade,
  action      text not null,
  group_id    uuid references fixture_groups(id) on delete set null,
  fixture_id  uuid references fixtures(id) on delete set null,
  tab_name    text,              -- kept for readability / imported rows
  old_status  text,
  new_status  text,
  details     jsonb
);

create index friendlies_manage_log_fixture_idx on friendlies_manage_log (fixture_id);

-- ============================================================================
-- LIVE COUNTS (replace the hand-maintained fixtures.entered/selected/reserves)
-- ============================================================================
-- entered  = active (non-withdrawn) entries in the fixture's group
-- selected = active entries playing ('Y') in this fixture
-- reserves = active entries in an occasion group with no selection anywhere in it

create view fixture_live_counts as
select
  f.id as fixture_id,
  (select count(*) from fixture_entries e
     where e.group_id = f.group_id and e.status = 'entered')::int as entered,
  (select count(*) from fixture_selections s
     join fixture_entries e on e.id = s.entry_id
     where s.fixture_id = f.id and s.selection = 'Y'
       and e.status = 'entered' and s.withdrawn_at is null)::int as selected,
  (select count(*) from fixture_entries e
     join fixture_groups g on g.id = e.group_id
     where e.group_id = f.group_id and g.kind = 'occasion' and e.status = 'entered'
       and not exists (
         select 1 from fixture_selections s
         join fixtures f2 on f2.id = s.fixture_id
         where s.entry_id = e.id and f2.group_id = f.group_id
       ))::int as reserves
from fixtures f
where f.group_id is not null;

-- ============================================================================
-- ENTER RPC — every way of creating an entry goes through here
-- ============================================================================
-- Locks the group row so concurrent entries can't overshoot capacity. Capacity =
-- sum of max_capacity over the group's non-reserve fixtures (0/null = unlimited).
-- Eligibility checks (open, gender, teas) are done by the caller first; this only
-- guarantees uniqueness + capacity atomically.
-- Returns one row per username: result = 'entered' | 'already' | 'full'.

create or replace function fixture_group_enter(
  p_group_id             uuid,
  p_usernames            text[],
  p_entry_source         text,
  p_entered_by           text,
  p_enforce_capacity     boolean,
  p_preferred_fixture_id uuid default null,
  p_preference           text default null,
  p_car_number           text default null
)
returns table (username text, result text)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_capacity int;
  v_count    int;
  v_user     text;
  v_source   text;
begin
  perform 1 from fixture_groups where id = p_group_id for update;
  if not found then
    raise exception 'Fixture group not found: %', p_group_id;
  end if;

  select coalesce(sum(coalesce(max_capacity, 0)), 0) into v_capacity
    from fixtures where group_id = p_group_id and reserve_of is null;

  foreach v_user in array p_usernames loop
    if exists (select 1 from fixture_entries e where e.group_id = p_group_id and e.username = v_user) then
      username := v_user; result := 'already'; return next;
      continue;
    end if;

    if p_enforce_capacity and v_capacity > 0 then
      select count(*) into v_count from fixture_entries e
        where e.group_id = p_group_id and e.status = 'entered';
      if v_count >= v_capacity then
        username := v_user; result := 'full'; return next;
        continue;
      end if;
    end if;

    -- The first username is the caller; any further ones on a self entry are buddies.
    v_source := p_entry_source;
    if p_entry_source = 'self' and v_user <> p_entered_by then
      v_source := 'buddy';
    end if;

    insert into fixture_entries (group_id, username, entry_source, entered_by,
                                 preferred_fixture_id, preference, car_number)
    values (p_group_id, v_user, v_source, p_entered_by,
            p_preferred_fixture_id, p_preference, p_car_number);
    username := v_user; result := 'entered'; return next;
  end loop;
end;
$$;

-- ============================================================================
-- AVAILABILITY PLANNER LINK (Club Teams "Ask squad" — phase 4, schema now)
-- ============================================================================

alter table availability_groups
  add column fixture_group_id uuid unique references fixture_groups(id) on delete set null;

alter table availability_group_members
  add column active boolean not null default true;

-- ============================================================================
-- RLS (service-role client only, like every other table)
-- ============================================================================

alter table fixture_groups          enable row level security;
alter table fixture_group_managers  enable row level security;
alter table fixture_entries         enable row level security;
alter table fixture_selections      enable row level security;
alter table friendlies_manage_log   enable row level security;
