-- 0099_blank_bar_cards.sql
-- Blank bar cards (src/lib/bar-card.ts). Cards are printed with no name: the QR is
-- BHBC2.<32 random hex characters>. At the till (or in Admin Members) a blank card is
-- assigned to a member — its token becomes their card_token, replacing the old one, so
-- their phone QR (BHBC1.<user id>.<token>) carries on working with the new token.
--
--   * card_token is now looked up on its own, so it must be unique.
--   * card_issued_at / card_issued_by — when the member's current card was assigned
--     and by whom (username). Only the latest assignment is kept; no card history.
--     Empty = no card issued yet. Resetting a card in My Account leaves them alone.

begin;

create unique index if not exists users_card_token_key on users (card_token);

alter table users add column if not exists card_issued_at timestamptz;
alter table users add column if not exists card_issued_by text;

commit;
