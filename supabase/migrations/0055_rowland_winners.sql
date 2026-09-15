-- 0055_rowland_winners.sql
-- One row per season, the winning club for each of the two Rowland Cup draws
-- (Edward and Gladys) — shown on the public bhbc-website's /rowland "Past
-- Winners" section. Photos live in Google Drive
-- (WEBSITE_DOCUMENTS_FOLDER_ID/Rowland/<year>/), not in this table — see
-- bhbc-website's lib/drive.ts listRowlandImages().

create table website.rowland_winners (
  year           integer primary key,
  edward_winner  text,
  gladys_winner  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

alter table website.rowland_winners enable row level security;

grant all on website.rowland_winners to service_role;
