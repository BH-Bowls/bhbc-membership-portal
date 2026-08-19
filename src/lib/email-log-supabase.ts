// src/lib/email-log-supabase.ts
// Postgres-backed audit log of every email the app sends (supabase/migrations/0046).
// Written from mailer.ts's transporter wrapper — see withEmailLogContext there for how
// sentBy/templateName get attached. Kept in its own file (rather than members-supabase.ts)
// so mailer.ts, a low-level module, doesn't need to pull in the full members data layer.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';

export interface LogEmailSendEntry {
  to: string;
  subject: string;
  success: boolean;
  errorMessage?: string | null;
  sentBy?: string;
  templateName?: string;
  userName?: string;
  attachments?: string[];
}

/**
 * Best-effort match of a single recipient address to a known member username — only
 * used as a fallback when the caller didn't already know who the email was for (see
 * LogEmailSendEntry.userName). Ambiguous whenever more than one account shares an
 * address (family/buddy accounts, or several test accounts routed to one real inbox),
 * so it's a last resort, not the primary source of truth.
 */
async function resolveUserName(to: string): Promise<string | null> {
  const recipients = to.split(',').map((s) => s.trim()).filter(Boolean);
  if (recipients.length !== 1) return null; // multi-recipient sends aren't about one member

  try {
    const users = await getAllUsers();
    const match = users.find(
      (u) => u.emailAddress && u.emailAddress.toLowerCase() === recipients[0].toLowerCase()
    );
    return match ? match.userName : null;
  } catch {
    return null;
  }
}

/** Record one email send attempt. Never throws — a logging failure must not break email. */
export async function logEmailSend(entry: LogEmailSendEntry): Promise<void> {
  try {
    const userName = entry.userName || (await resolveUserName(entry.to));
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('member_emails').insert({
      user_name: userName,
      email_address: entry.to,
      template_name: entry.templateName || 'direct',
      subject: entry.subject,
      success: entry.success,
      error_message: entry.errorMessage || null,
      sent_by: entry.sentBy || 'system',
      attachments: entry.attachments || [],
    });
    if (error) console.error('Error logging email send:', error.message);
  } catch (error) {
    console.error('Error logging email send:', error);
  }
}

/** Most recent email sends, newest first — for the admin Logs viewer. */
export async function getMemberEmailLog(limit = 500): Promise<{
  rows: {
    id: string;
    userName: string | null;
    fullName: string | null;
    emailAddress: string | null;
    templateName: string;
    subject: string;
    success: boolean;
    errorMessage: string | null;
    sentBy: string;
    attachments: string[];
    sentAt: string;
  }[];
  total: number;
}> {
  const supabase = getSupabaseClient();
  const [{ data, error }, { count, error: countError }, users] = await Promise.all([
    supabase.from('member_emails').select('*').order('sent_at', { ascending: false }).limit(limit),
    supabase.from('member_emails').select('id', { count: 'exact', head: true }),
    getAllUsers(),
  ]);
  if (error) throw new Error(`Failed to fetch member email log: ${error.message}`);
  if (countError) throw new Error(`Failed to count member email log: ${countError.message}`);

  const nameByUserName = new Map(users.map((u) => [u.userName.toLowerCase(), u.fullName]));

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      userName: row.user_name,
      fullName: row.user_name ? nameByUserName.get(String(row.user_name).toLowerCase()) ?? null : null,
      emailAddress: row.email_address,
      templateName: row.template_name,
      subject: row.subject,
      success: row.success,
      errorMessage: row.error_message,
      sentBy: row.sent_by,
      attachments: row.attachments ?? [],
      sentAt: row.sent_at,
    })),
    total: count ?? 0,
  };
}

/** Delete all member email log rows — an admin clearing the log down. */
export async function clearMemberEmailLog(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('member_emails').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(`Failed to clear member email log: ${error.message}`);
}
