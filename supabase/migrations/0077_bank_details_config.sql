-- 0077_bank_details_config.sql
-- Club bank details for payment instructions (renewals page + confirmation email,
-- membership application payment email, Rowland Cup entry page + email). Previously
-- hardcoded in each of those; now Admin-editable on /admin/config (General tab).
-- Seeded with the values that were hardcoded. Apply BEFORE deploying the code that
-- reads them, or payment instructions will show blank bank details.

insert into config (key, value) values
  ('bank_name', 'HSBC'),
  ('bank_sort_code', '40-15-16'),
  ('bank_account_number', '81554948'),
  ('bank_account_name', 'Burgess Hill Bowls Club')
on conflict (key) do nothing;
