-- 0097_competition_years.sql
-- Keep every year of Competitions and the Rowland Cup, the same way fixtures are kept:
-- all years side by side in the same tables, each row tagged with its year, and the
-- year pointing at the seasons table. /competitions and /rowland then get a year picker
-- like /fixtures.
--
-- Until now each table held one year only: competitions/rowland_comps had one row per
-- competition, and saving a new draw deleted the previous year's matches.
--
--   competitions          primary key comp_id         -> (comp_id, year); year -> seasons(year)
--   competition_matches   + year; match_id unique     -> (year, match_id) unique;
--                         comp_id -> competitions     -> (comp_id, year) -> competitions
--   rowland_comps         season text                 -> year int -> seasons(year);
--                         primary key comp_id         -> (comp_id, year)
--   rowland_matches       + year; same changes as competition_matches
--
-- match_id (e.g. "mens-championship-r1-3", "edward-a-R1-3") is the bracket's business key
-- and is the same every year, so it's now unique within a year rather than overall.
--
-- Existing rows keep their year: competitions already had one; Rowland's text season
-- (e.g. '2026') becomes the number, and anything that isn't a plain 4-digit year takes
-- the active season's year. Every year used must already be in seasons.
--
-- All in one transaction: if any step fails, nothing changes.
-- Apply BEFORE deploying the code that uses it.

begin;

-- ── Competitions ────────────────────────────────────────────────────────────

alter table competition_matches add column if not exists year int;
update competition_matches m set year = c.year
  from competitions c
  where c.comp_id = m.comp_id and m.year is null;
alter table competition_matches alter column year set not null;

alter table competition_matches drop constraint if exists competition_matches_comp_id_fkey;
alter table competition_matches drop constraint if exists competition_matches_match_id_key;

alter table competitions drop constraint competitions_pkey;
alter table competitions add constraint competitions_pkey primary key (comp_id, year);
alter table competitions add constraint competitions_year_fkey foreign key (year) references seasons (year);

alter table competition_matches add constraint competition_matches_comp_year_fkey
  foreign key (comp_id, year) references competitions (comp_id, year) on delete cascade;
alter table competition_matches add constraint competition_matches_year_match_id_key unique (year, match_id);

drop index if exists competition_matches_comp_id_idx;
create index if not exists competition_matches_comp_year_idx on competition_matches (comp_id, year);

-- ── Rowland Cup ─────────────────────────────────────────────────────────────

alter table rowland_comps add column if not exists year int;
update rowland_comps set year = case
    when trim(season) ~ '^[0-9]{4}$' then trim(season)::int
    else (select s.year from seasons s where s.is_active)
  end
  where year is null;
alter table rowland_comps alter column year set not null;
alter table rowland_comps drop column season;

alter table rowland_matches add column if not exists year int;
update rowland_matches m set year = c.year
  from rowland_comps c
  where c.comp_id = m.comp_id and m.year is null;
alter table rowland_matches alter column year set not null;

alter table rowland_matches drop constraint if exists rowland_matches_comp_id_fkey;
alter table rowland_matches drop constraint if exists rowland_matches_match_id_key;

alter table rowland_comps drop constraint rowland_comps_pkey;
alter table rowland_comps add constraint rowland_comps_pkey primary key (comp_id, year);
alter table rowland_comps add constraint rowland_comps_year_fkey foreign key (year) references seasons (year);

alter table rowland_matches add constraint rowland_matches_comp_year_fkey
  foreign key (comp_id, year) references rowland_comps (comp_id, year) on delete cascade;
alter table rowland_matches add constraint rowland_matches_year_match_id_key unique (year, match_id);

drop index if exists rowland_matches_comp_id_idx;
create index if not exists rowland_matches_comp_year_idx on rowland_matches (comp_id, year);

commit;
