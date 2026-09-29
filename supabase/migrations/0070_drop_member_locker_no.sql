-- 0070_drop_member_locker_no.sql
-- member_profiles.locker_no is superseded by the lockers table (0069) — a member's
-- locker is now derived from there and only changed in the Locker Register.
--
-- Apply AFTER the code that stops reading/writing locker_no is deployed: the
-- previous build selects member_profiles(*) (harmless) but its profile save
-- writes locker_no, which would fail once the column is gone.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table member_profiles drop column locker_no;
