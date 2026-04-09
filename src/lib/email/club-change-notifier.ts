// src/lib/email/club-change-notifier.ts
// Sends a notification email to the club liaison when club details or contacts change.

import { sendEmail } from './mailer';

const NOTIFY_ADDRESS = 'burgesshillbv@gmail.com';

export type ClubChangeEvent =
  | { type: 'club_updated'; clubName: string; changes: Record<string, { from: string | null; to: string | null }> }
  | { type: 'contact_added'; clubName: string; contact: Record<string, string> }
  | { type: 'contact_updated'; clubName: string; changes: Record<string, { from: string | null; to: string | null }> }
  | { type: 'contact_deleted'; clubName: string; contact: Record<string, string> };

function changedByLine(actor: { name: string; userName: string; role: string }): string {
  return `Changed by: ${actor.name} (${actor.userName}, role: ${actor.role})`;
}

function formatChanges(changes: Record<string, { from: string | null; to: string | null }>): string {
  return Object.entries(changes)
    .map(([field, { from, to }]) => `  ${field}: "${from ?? ''}" → "${to ?? ''}"`)
    .join('\n');
}

function formatContact(c: Record<string, string>): string {
  return Object.entries(c)
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
}

export async function sendClubChangeNotification(
  event: ClubChangeEvent,
  actor: { name: string; userName: string; role: string },
): Promise<void> {
  let subject: string;
  let body: string;
  const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });

  switch (event.type) {
    case 'club_updated':
      subject = `Club Updated: ${event.clubName}`;
      body = [
        `Club record updated: ${event.clubName}`,
        `Time: ${timestamp}`,
        changedByLine(actor),
        '',
        'Changes:',
        formatChanges(event.changes),
      ].join('\n');
      break;

    case 'contact_added':
      subject = `Contact Added: ${event.clubName}`;
      body = [
        `New contact added to ${event.clubName}`,
        `Time: ${timestamp}`,
        changedByLine(actor),
        '',
        'New contact:',
        formatContact(event.contact),
      ].join('\n');
      break;

    case 'contact_updated':
      subject = `Contact Updated: ${event.clubName}`;
      body = [
        `Contact updated for ${event.clubName}`,
        `Time: ${timestamp}`,
        changedByLine(actor),
        '',
        'Changes:',
        formatChanges(event.changes),
      ].join('\n');
      break;

    case 'contact_deleted':
      subject = `Contact Deleted: ${event.clubName}`;
      body = [
        `Contact removed from ${event.clubName}`,
        `Time: ${timestamp}`,
        changedByLine(actor),
        '',
        'Deleted contact:',
        formatContact(event.contact),
      ].join('\n');
      break;
  }

  // Fire-and-forget — notification failure must not block the main operation
  sendEmail(NOTIFY_ADDRESS, subject, body).catch((err) =>
    console.error('[club-change-notifier] Failed to send notification:', err)
  );
}
