-- 0050_drop_member_email_sent_status.sql
-- member_email_sent_status (added in 0010) was superseded by the member_emails audit
-- log (0046) — nothing in the live app has written to it since, it was just a
-- per-member "did the last email work" flag, and a real send log replaced the need
-- for it entirely. renewal_email_sent_status is a separate, still-live column
-- (Renewals emails) — not touched here.

alter table member_profiles drop column if exists member_email_sent_status;
