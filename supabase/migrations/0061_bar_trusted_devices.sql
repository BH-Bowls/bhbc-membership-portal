-- 0061_bar_trusted_devices.sql
-- Admin-managed device allowlist for the bar till login (role 'Bar'). Pairing is
-- admin-mediated: the till generates its own id + a short pairing code on first run
-- (app/bar/page.tsx), registers itself as pending, and shows the code on screen; an
-- admin reads that code off the physical device and enters it on /admin/bar-devices
-- to approve — there is deliberately no self-approval path. Checked once, in
-- authorize() (src/lib/auth.ts), only for logins to the 'Bar' role; revocation takes
-- effect at the till's next login (bounded by its own 4h/24h session policy), not
-- instantly — an accepted tradeoff over building a "phone home" re-check.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists bar_trusted_devices (
  id           uuid primary key,        -- generated client-side by the till itself
  label        text,                    -- set on approval, e.g. "Clubhouse iPad"
  pairing_code text not null,
  approved     boolean not null default false,
  approved_at  timestamptz,
  approved_by  text,
  revoked_at   timestamptz,
  revoked_by   text,
  created_at   timestamptz not null default now()
);

alter table bar_trusted_devices enable row level security;
