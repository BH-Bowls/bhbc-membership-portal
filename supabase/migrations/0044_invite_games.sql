-- 0044_invite_games.sql
-- Cut over Invite Games from Google Sheets to Postgres: InviteGames +
-- InviteGamesAttachments sheets -> two tables here.
--
-- invite_game_id/attachment_id keep their existing human-readable business keys
-- (IG-YYYY-NNN / IGA-NNNNNN, per-prefix max+1 counters) rather than uuids — same
-- precedent as suggestions/competitions/200-club.

create table if not exists invite_games (
  invite_game_id      text primary key,
  title                text not null,
  description          text not null default '',
  closing_date         date,
  game_date            date,
  created_by_username  text not null references users(username),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  updated_by_username  text references users(username)
);

-- Same shape as suggestion_attachments (0037) / league_attachments (0038).
create table if not exists invite_game_attachments (
  attachment_id       text primary key,
  invite_game_id       text not null references invite_games(invite_game_id) on delete cascade,
  type                 text not null check (type in ('link', 'image', 'document')),
  drive_file_id         text,
  url                  text not null,
  description          text not null,
  file_name             text,
  mime_type             text,
  file_size             bigint,
  display_order         int not null default 0,
  added_at              timestamptz not null default now(),
  added_by_username     text not null references users(username),
  is_deleted            boolean not null default false
);

create index if not exists invite_game_attachments_invite_game_id_idx on invite_game_attachments (invite_game_id);

alter table invite_games enable row level security;
alter table invite_game_attachments enable row level security;
