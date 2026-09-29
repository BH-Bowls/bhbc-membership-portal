-- 0069_lockers.sql
-- Locker Register: the master record of every changing-room locker, its key(s) and
-- who has it. Replaces member_profiles.locker_no (a free-text field members and
-- admins could edit, which had drifted out of date) — that column is dropped in
-- 0070 once the code no longer reads it. A member's locker is now shown read-only
-- on their profile, derived from this table, and only changed in the Locker
-- Register (/admin/lockers).
--
-- status:
--   member   — allocated to a member (username required, enforced by the API)
--   club     — a club locker (captain, secretary, bowls for sale, etc. — the role
--              goes in notes); may optionally be allocated to a member
--   occupied — in use but not by a known member (who, if known, goes in notes);
--              may optionally be allocated to a member
--   empty    — unallocated
--
-- Key numbers are deliberately not unique — several locks share a key number.
-- keys_count null = unknown (the spreadsheet's "-").
--
-- Seeded from specs/Locker Key Numbers (1).xlsx (Mens + Ladies sheets), with typos
-- corrected, the "Corner" column folded into notes, and names matched to members
-- by username. If a seeded username doesn't exist on the target database, that
-- locker falls back to 'occupied' with the username kept in notes, so the seed
-- never fails.
--
-- Apply BEFORE deploying the code that uses it: getAllUsers() embeds lockers to
-- derive each member's locker, so every members read fails until this table exists.
-- (0070, dropping the old column, goes the other way — after the deploy.)
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table lockers (
  id             uuid primary key default gen_random_uuid(),
  room           text not null check (room in ('Mens', 'Ladies')),
  locker_number  integer not null check (locker_number > 0),
  key_number     text,
  keys_count     integer check (keys_count >= 0),
  status         text not null default 'empty' check (status in ('member', 'club', 'occupied', 'empty')),
  username       text references users(username) on update cascade on delete set null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (room, locker_number),
  constraint lockers_empty_unallocated check (status <> 'empty' or username is null)
);

create index lockers_username_idx on lockers (username);

alter table lockers enable row level security;

insert into lockers (room, locker_number, key_number, keys_count, status, username, notes)
select
  v.room,
  v.locker_number,
  v.key_number,
  v.keys_count,
  case when v.status = 'member' and u.username is null then 'occupied' else v.status end,
  u.username,
  case when v.status = 'member' and u.username is null then concat_ws('; ', v.username, v.notes) else v.notes end
from (values
  ('Mens', 1, 'ZA 0412', 1::integer, 'member', 'kevin.lane'::text, null::text),
  ('Mens', 2, 'ZA 0413', 0, 'member', 'dean.monnery', null),
  ('Mens', 3, 'ZA 0414', 1, 'occupied', null, 'Brian Sansom / new note'),
  ('Mens', 4, 'ZA 0640', 2, 'member', 'david.rutter', null),
  ('Mens', 5, 'ZA 0632', 1, 'member', 'gary.foley', null),
  ('Mens', 6, 'ZA 0648', 2, 'member', 'les.finnimore', null),
  ('Mens', 7, 'ZA 0646', 1, 'member', 'terry.bull', null),
  ('Mens', 8, 'ZA 0631', 0, 'member', 'robert.ransom', null),
  ('Mens', 9, 'ZA 1005', 1, 'member', 'frank.leach', null),
  ('Mens', 10, 'ZA 0641', 0, 'member', 'mike.betsworth', null),
  ('Mens', 11, 'ZA 0621', 1, 'occupied', null, null),
  ('Mens', 12, 'ZA 0630', 2, 'empty', null, null),
  ('Mens', 13, 'ZA 0636', 1, 'club', null, 'Club Secretary; Malcolm''s stuff'),
  ('Mens', 14, 'ZA 0624', 1, 'club', null, 'Club Captain; Corner'),
  ('Mens', 15, 'ZA 0618', 1, 'club', null, 'Club Treasurer; Bowls for sale; Corner'),
  ('Mens', 16, 'ZA 0416', 0, 'member', 'alan.thompson', null),
  ('Mens', 17, 'ZA 0460', 2, 'member', 'richard.clapham', null),
  ('Mens', 18, 'ZA 1060', 1, 'member', 'mark.gill', null),
  ('Mens', 19, 'ZA 0614', 2, 'member', 'graham.cubitt', null),
  ('Mens', 20, 'ZA 0615', null, 'member', 'jon.gardner', null),
  ('Mens', 21, 'ZA 0642', 1, 'member', 'geoff.harris', null),
  ('Mens', 22, 'ZA 0635', 1, 'empty', null, null),
  ('Mens', 23, 'ZA 0644', 2, 'member', 'john.ferris', null),
  ('Mens', 24, 'ZA 0608', 1, 'member', 'chris.wilkins', null),
  ('Mens', 25, 'ZA 0613', 1, 'member', 'simon.mander', null),
  ('Mens', 26, 'ZA 0625', null, 'member', 'dennis.rigby', null),
  ('Mens', 27, 'ZA 0620', null, 'member', 'frank.tyreman', null),
  ('Mens', 28, 'ZA 0628', 2, 'occupied', null, 'David Payne'),
  ('Mens', 29, 'ZA 0617', 1, 'member', 'jim.wakefield', 'Corner'),
  ('Mens', 30, 'ZA 0612', 1, 'club', null, 'Bowls for sale; Corner'),
  ('Mens', 31, 'ZA 0410', 1, 'occupied', null, 'Dan Dempsey ???'),
  ('Mens', 32, 'ZA 0405', 0, 'member', 'neil.mann', null),
  ('Mens', 33, 'ZA 0638', 1, 'member', 'mick.christian', null),
  ('Mens', 34, 'ZA 0627', 1, 'member', 'jeremy.hall', null),
  ('Mens', 35, 'ZA 0607', 1, 'member', 'stan.mears', null),
  ('Mens', 36, 'ZA 0643', 0, 'member', 'liam.dasey', null),
  ('Mens', 37, 'ZA 0679', 1, 'member', 'reg.walker', null),
  ('Mens', 38, 'ZA 0649', 1, 'empty', null, null),
  ('Mens', 39, 'ZA 0605', 1, 'member', 'richard.cooke', null),
  ('Mens', 40, 'ZA 0606', 1, 'occupied', null, 'Tony Smith ???'),
  ('Mens', 41, 'ZA 0610', 1, 'member', 'nigel.croucher', null),
  ('Mens', 42, 'ZA 0622', 1, 'occupied', null, 'Keith Paddon ??'),
  ('Mens', 43, 'ZA 0627', null, 'member', 'matthew.tibbs', null),
  ('Mens', 44, 'ZA 0611', 1, 'member', 'ray.laughton', 'Corner'),
  ('Mens', 45, 'ZA 0626', 1, 'member', 'grant.wells', 'Corner'),
  ('Mens', 46, 'ZA 0408', 1, 'club', null, null),
  ('Mens', 47, 'ZA 0404', 1, 'member', 'oscar.john', null),
  ('Mens', 48, 'ZA 0636', 2, 'member', 'tony.salter', null),
  ('Mens', 49, 'ZA 0647', 2, 'member', 'daniel.appleton', null),
  ('Mens', 50, 'ZA 0637', 1, 'member', 'pete.dean', null),
  ('Mens', 51, 'ZA 0645', 0, 'member', 'paul.burrows', null),
  ('Mens', 52, 'ZA 0639', 2, 'member', 'chris.neville', null),
  ('Mens', 53, 'ZA 0634', 1, 'member', 'mick.barnes', null),
  ('Mens', 54, 'ZA 0602', null, 'member', 'david.saunders', null),
  ('Mens', 55, 'ZA 0619', 1, 'member', 'brian.ashton', null),
  ('Mens', 56, 'ZA 0601', 1, 'member', 'brian.risby', null),
  ('Mens', 57, 'ZA 0601', 0, 'member', 'ray.smith', null),
  ('Mens', 58, 'ZA 0623', 1, 'member', 'julian.thorpe', null),
  ('Mens', 59, 'ZA 0629', 1, 'member', 'wayne.monnery', 'Corner'),
  ('Mens', 60, 'ZA 0604', 1, 'member', 'colin.bailey', 'Corner'),

  ('Ladies', 1, 'ZA 0661', 1, 'member', 'trudee.ricketts', null),
  ('Ladies', 2, 'ZA 1641', 2, 'member', 'jackie.christian', null),
  ('Ladies', 3, 'ZA 1636', 1, 'club', null, 'Books'),
  ('Ladies', 4, 'ZA 1637', 1, 'club', null, 'Christmas lights'),
  ('Ladies', 5, 'ZA 1647', null, 'member', 'sally.ingarfield', null),
  ('Ladies', 6, 'ZA 1642', 2, 'member', 'valerie.dickens', null),
  ('Ladies', 7, 'ZA 0638', null, 'member', 'anne.barnes', null),
  ('Ladies', 8, 'ZA 1639', 1, 'member', 'diane.cubitt', null),
  ('Ladies', 9, 'ZA 1646', 1, 'member', 'sam.smith', null),
  ('Ladies', 10, 'ZA 0674', 1, 'member', 'eileen.rutter', null),
  ('Ladies', 11, 'ZA 0662', 2, 'member', 'freya.mander', null),
  ('Ladies', 12, 'ZA 1644', 1, 'member', 'dawn.barnsley', null),
  ('Ladies', 13, 'ZA 1640', 2, 'member', 'ruth.saunders', null),
  ('Ladies', 14, 'ZA 0663', 1, 'member', 'andrea.crickmore', null),
  ('Ladies', 15, 'ZA 0677', 0, 'member', 'debbie.mann', null),
  ('Ladies', 16, 'ZA 0670', 1, 'occupied', null, null),
  ('Ladies', 17, 'ZA 0688', 2, 'empty', null, 'Broken mechanism'),
  ('Ladies', 18, 'ZA 0664', 1, 'member', 'jane.mackenzie', null),
  ('Ladies', 19, 'ZA 0686', 0, 'member', 'carol.masters', null),
  ('Ladies', 20, 'ZA 0689', 1, 'member', 'tracy.mcbride', null),
  ('Ladies', 21, 'ZA 0680', 1, 'member', 'doreen.marsh', null),
  ('Ladies', 22, 'ZA 0678', 1, 'member', 'chris.salter', null),
  ('Ladies', 23, 'ZA 0687', 1, 'member', 'lynda.pollard', null),
  ('Ladies', 24, 'ZA 0679', 1, 'member', 'penny.perryman', null),
  ('Ladies', 25, 'ZA 0682', 1, 'member', 'louise.hall', null),
  ('Ladies', 26, 'ZA 0670', 2, 'club', null, 'Club Captain'),
  ('Ladies', 27, 'ZA 0675', 1, 'club', null, 'Club Secretary'),
  ('Ladies', 28, 'ZA 0671', 2, 'member', 'sue.simmonds', null),
  ('Ladies', 29, 'ZA 0663', null, 'empty', null, null),
  ('Ladies', 30, 'ZA 0673', 1, 'member', 'margaret.negus', null),
  ('Ladies', 31, 'ZA 0668', 2, 'member', 'joan.betsworth', null),
  ('Ladies', 32, 'ZA 0565', 2, 'member', 'sandra.smith', null),
  ('Ladies', 33, 'ZA 0672', 2, 'member', 'hazel.campbell', null),
  ('Ladies', 34, 'ZA 1620', 2, 'member', 'veronica.freer.ash', null),
  ('Ladies', 35, 'ZA 0678', null, 'member', 'catherine.thorpe', null),
  ('Ladies', 36, 'ZA 0680', 1, 'member', 'jacqui.roberts', null),
  ('Ladies', 37, 'ZA 0616', 1, 'member', 'heather.pearce', null),
  ('Ladies', 38, 'ZA 0659', 2, 'member', 'mo.holt', null),
  ('Ladies', 39, 'ZA 0665', 2, 'member', 'sharon.monnery', null),
  ('Ladies', 40, 'ZA 0677', 1, 'occupied', null, null),
  ('Ladies', 41, 'ZA 1633', 0, 'member', 'celia.dasey', null),
  ('Ladies', 42, 'ZA 1631', 1, 'member', 'wendy.dann', null),
  ('Ladies', 43, 'ZA 1632', 2, 'member', 'jan.harris', null)
) as v(room, locker_number, key_number, keys_count, status, username, notes)
left join users u on lower(u.username) = lower(v.username);
