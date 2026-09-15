-- 0056_seed_rowland_winners.sql
-- Seeds the 3 seasons that were previously hardcoded in bhbc-website's
-- app/rowland/page.tsx, so the dynamic "Past Winners" section isn't empty
-- on first cutover.

insert into website.rowland_winners (year, edward_winner, gladys_winner) values
  (2026, 'Portslade', 'Southwick Park'),
  (2025, 'Preston', 'Shoreham'),
  (2024, 'Southwick', 'Horsham');
