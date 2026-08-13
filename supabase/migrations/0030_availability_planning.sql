-- 0030_availability_planning.sql
-- Full migration of the /availability planning layer (Groups, Group Members, Events,
-- Slots, Responses) from Google Sheets to Postgres. Supersedes the "stay on Sheets, do
-- NOT fork" recommendation in specs/MEMBER_AVAILABILITY_SPEC.md — user explicitly asked
-- for the whole planning layer, not just the member-availability substrate (0029).
--
-- ID strategy: availability_groups.id and availability_events.id are TEXT, preserving
-- the exact human-readable IDs already in use (AG-YYYY-NNN, AV-YYYY-NNN) — these are
-- embedded in already-sent email links for real, currently-open polls, so changing the
-- format would break outstanding invitations. Group members / slots / responses are
-- never exposed in a URL (the per-member token is what's shared, not the row id), so
-- those get ordinary UUIDs like everywhere else in this schema.
--
-- There is no invitees table — the roster is the group's members, exactly as the
-- Sheets version worked (see availability-groups-sheets.ts's own header comment). Each
-- group member carries its own response token.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists availability_groups (
  id                        text primary key,   -- e.g. "AG-2026-014"
  name                      text not null,
  description               text,
  created_by_username       text not null references users(username) on update cascade,
  allow_member_management   boolean not null default false,
  team_id                   text,                -- optional FK to teams — always blank today
  status                    text not null default 'active' check (status in ('active', 'archived')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz
);

alter table availability_groups enable row level security;

create table if not exists availability_group_members (
  id                  uuid primary key default gen_random_uuid(),
  group_id            text not null references availability_groups(id) on delete cascade,
  member_type         text not null check (member_type in ('member', 'visitor')),
  username            text references users(username) on update cascade,   -- blank for visitors
  visitor_name        text,
  visitor_email       text,
  added_by_username   text references users(username) on update cascade,
  token               text unique,   -- per-member response token, generated lazily on email send
  created_at          timestamptz not null default now()
);

alter table availability_group_members enable row level security;

create table if not exists availability_events (
  id                              text primary key,   -- e.g. "AV-2026-041"
  title                           text not null,
  description                     text,
  created_by_username             text not null references users(username) on update cascade,
  group_id                        text references availability_groups(id) on delete cascade,
  type                            text not null default 'general' check (type in ('general', 'fixture', 'signup')),
  slot_type                       text not null default 'datetime' check (slot_type in ('datetime', 'text')),
  status                          text not null default 'open' check (status in ('open', 'closed', 'concluded', 'archived')),
  show_responses_to_respondents   boolean not null default false,
  notify_creator_on_response      boolean not null default false,
  expires_at                      timestamptz,
  concluded_slot_id               uuid,    -- FK added below, once availability_slots exists
  conclusion_note                 text,
  concluded_at                    timestamptz,
  concluded_by_username           text references users(username) on update cascade,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz,
  is_match_finder                 boolean not null default false,
  offered_slot_ids                uuid[] not null default '{}'
);

alter table availability_events enable row level security;

create table if not exists availability_slots (
  id             uuid primary key default gen_random_uuid(),
  event_id       text not null references availability_events(id) on delete cascade,
  slot_datetime  timestamptz,   -- null for text-type slots
  slot_label     text,
  display_order  int not null default 0,
  created_at     timestamptz not null default now()
);

alter table availability_slots enable row level security;

-- Now that availability_slots exists, wire up the forward reference from events.
alter table availability_events
  add constraint availability_events_concluded_slot_id_fkey
  foreign key (concluded_slot_id) references availability_slots(id);

create table if not exists availability_responses (
  id                uuid primary key default gen_random_uuid(),
  event_id          text not null references availability_events(id) on delete cascade,
  slot_id           uuid not null references availability_slots(id) on delete cascade,
  respondent_type   text not null check (respondent_type in ('member', 'visitor')),
  username          text references users(username) on update cascade,   -- blank for visitors
  visitor_name      text,
  visitor_email     text,
  response          text not null check (response in ('yes', 'maybe', 'no')),
  responded_at      timestamptz not null default now(),
  updated_at        timestamptz
);

-- One response per member per slot, one per visitor-email per slot. Two partial unique
-- indexes rather than one composite constraint, since username/visitor_email are each
-- null on the other respondent type (NULLs never collide in a uniqueness check).
create unique index if not exists availability_responses_member_unique
  on availability_responses (event_id, slot_id, username)
  where respondent_type = 'member';

create unique index if not exists availability_responses_visitor_unique
  on availability_responses (event_id, slot_id, visitor_email)
  where respondent_type = 'visitor';

alter table availability_responses enable row level security;
