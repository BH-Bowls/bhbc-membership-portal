// src/lib/bank-details.ts
// Club bank details shown in payment instructions (pages + emails). Stored in the
// config table (see 0077_bank_details_config.sql), editable on /admin/config.

import { getConfig } from './config-supabase';

export interface BankDetails {
  bankName: string;
  bankSortCode: string;
  bankAccountNumber: string;
  bankAccountName: string;
}

/** Field names match the email template placeholders ({{bankName}} etc.), so the
 * result can be spread straight into a template's variables. */
export async function getBankDetails(): Promise<BankDetails> {
  const config = await getConfig();
  return {
    bankName: config.bank_name || '',
    bankSortCode: config.bank_sort_code || '',
    bankAccountNumber: config.bank_account_number || '',
    bankAccountName: config.bank_account_name || '',
  };
}
