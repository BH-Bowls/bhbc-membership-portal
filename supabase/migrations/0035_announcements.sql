-- 0035_announcements.sql
-- Cut over the HomeAnnouncements sheet (Portal Config spreadsheet) to Postgres.

create table if not exists announcements (
  id         uuid primary key default gen_random_uuid(),
  message    text not null,
  expires_at timestamptz not null,
  created_by text not null references users(username),
  created_at timestamptz not null default now(),
  updated_by text references users(username),
  updated_at timestamptz
);

create index if not exists announcements_expires_at_idx on announcements (expires_at);

alter table announcements enable row level security;
