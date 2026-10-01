-- 0071_website_public_fixtures.sql
-- Public-safe view of the current season's friendlies and club events, for the
-- bhbc-website /fixtures, /join and /social pages.
--
-- The website used to read the Friendlies spreadsheet's "Games" tab, which stopped
-- being the source of truth when fixtures moved to Postgres (0023 onwards) — fixtures
-- created or updated since then never reached the public site. This view replaces
-- that read.
--
-- Deliberately exposes ONLY public-safe columns: no captain, tea rota, locks,
-- entered/selected counts, special instructions, pickup info or cancellation
-- reasons. League fixtures (BL, JSL, MSL, N/S A, N/S B) are filtered out here, so
-- they can never reach a public page even if the website code changed. The website
-- (lib/fixtures.ts) applies its own date/status filtering on top.
--
-- fixture_type is normalised to 'Friendly' or 'Event' — a null/blank type counts as
-- Friendly, matching the portal's own tea-rota query (fixtures-supabase.ts). For an
-- Event, or a reserve team with a custom name, the label lives in description
-- because club_name has a FK to club_profiles.
--
-- Read via the service_role key only, like the rest of the website schema.
-- security_invoker = true so the view runs with the caller's own privileges
-- (service_role) rather than the view owner's.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create or replace view website.public_fixtures
with (security_invoker = true)
as
select
  f.date,
  to_char(f.time, 'HH24:MI')                                    as time,
  case when f.fixture_type = 'Event' then 'Event' else 'Friendly' end as fixture_type,
  -- Opponent (friendlies) or event title: club + optional suffix, else description
  case
    when f.club_name is not null and f.club_name <> ''
      then f.club_name || coalesce(nullif(' ' || trim(f.club_suffix), ' '), '')
    else coalesce(f.description, '')
  end                                                            as label,
  f.home_away,
  coalesce(f.format, '')                                         as format,
  coalesce(f.ladies_men, '')                                     as ladies_men,
  coalesce(f.game_status, '')                                    as status,
  f.bhbc_score,
  f.opponent_score
from public.fixtures f
join public.seasons s on s.id = f.season_id
where s.is_active
  and f.date is not null
  and (f.fixture_type is null or f.fixture_type in ('', 'Friendly', 'Event'));

-- Read-only: default privileges on this schema grant ALL to service_role, so strip
-- that back to SELECT for the view.
revoke all on website.public_fixtures from public, anon, authenticated, service_role;
grant select on website.public_fixtures to service_role;
