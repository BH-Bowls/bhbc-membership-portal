-- 0093_bar_card_pin.sql
-- Membership card token + bar PIN (src/lib/bar-card.ts).
--
-- The membership card QR (My Account and printed card labels) used to carry just the
-- username, and picking a member on the till needed no proof — so anyone at the bar
-- could charge any member's account. Now:
--   * card_token — the QR code is BHBC1.<user id>.<card_token>, 32 random hex characters.
--     One per member; the phone QR and every printed card share it. Resetting it (My
--     Account or Admin Members) stops every old card working; an admin can restore a
--     found card by scanning it. No secrets involved, so a production restore to dev
--     keeps every card working there.
--   * bar_pin_hash / bar_pin_failures — a 4-digit PIN (bcrypt), the alternative to
--     scanning the card. 5 wrong in a row locks it until it's set again or cleared.
--   * config bar_account_proof — who must scan a card or enter a PIN to Pay by Account
--     or Top Up on the till: 'off' (no one), 'testing' (members with the Testing role),
--     'all'. Starts 'off', so members can set PINs before it's switched on.

-- Volatile default, so every existing member gets their own random token
alter table users add column if not exists card_token text not null
  default replace(gen_random_uuid()::text, '-', '');
alter table users alter column card_token set default replace(gen_random_uuid()::text, '-', '');
-- An earlier draft of this migration made 8-character tokens — replace any of those
update users set card_token = replace(gen_random_uuid()::text, '-', '') where length(card_token) <> 32;

alter table users add column if not exists bar_pin_hash text;
alter table users add column if not exists bar_pin_failures int not null default 0;

insert into config (key, value) values ('bar_account_proof', 'off')
on conflict (key) do nothing;
