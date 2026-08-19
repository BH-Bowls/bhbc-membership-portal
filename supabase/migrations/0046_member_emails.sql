-- 0046_member_emails.sql
-- Cut over the MemberEmails sheet (email send audit log) from Sheets to Postgres, and
-- broaden it to cover every email the app sends, not just the handful of flows that used
-- to call logMemberEmail() explicitly. Logging now happens centrally in mailer.ts (every
-- nodemailer transporter created via getEmailTransporter() has sendMail wrapped), so
-- Friendlies, Renewals, 200 Club, Availability, Applications, admin bulk email, and the
-- auth flows all land here automatically. user_name is nullable — it's a best-effort
-- reverse lookup of the recipient address against known members at log time, and stays
-- null for multi-recipient sends or addresses that aren't a member (e.g. club contacts).
-- No migration script for existing rows — this is an append-only audit log, not reference
-- data other features depend on, so old history stays in the sheet for record-keeping only.
--
-- member_profiles.member_email_sent_status (added 0010) is superseded by this log and no
-- longer written to — it was just a per-member "did the last email work" flag, and the
-- user confirmed it's not needed once a real send log exists.

create table if not exists member_emails (
  id             uuid primary key default gen_random_uuid(),
  user_name      text,
  email_address  text,
  template_name  text not null,
  subject        text not null,
  success        boolean not null,
  error_message  text,
  sent_by        text not null,
  attachments    text[] not null default '{}',
  sent_at        timestamptz not null default now()
);

create index if not exists member_emails_sent_at_idx on member_emails (sent_at desc);
create index if not exists member_emails_user_name_idx on member_emails (user_name);

alter table member_emails enable row level security;
