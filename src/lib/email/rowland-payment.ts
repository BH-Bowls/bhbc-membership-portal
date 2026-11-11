// src/lib/email/rowland-payment.ts
// "Payment received" email for a Rowland Cup entry, sent once the club's entry fee is
// paid in full — whether by a bank payment matched in /banking or cash recorded in
// Rowland Admin. One email per contact address, listing the teams they look after.
// Sent from the Rowland Cup account when it's set up (getRowlandEmailSender).

import { readFileSync } from 'fs';
import { join } from 'path';
import Handlebars from 'handlebars';
import { getRowlandEmailSender } from './mailer';
import { processEmailTemplate } from './template-processor';
import { getEntryContacts } from '../rowland-entries-supabase';

/** Returns how many emails were sent. Never throws — a failed email mustn't undo a payment. */
export async function sendRowlandPaymentReceivedEmail(entryId: string): Promise<number> {
  try {
    const sender = getRowlandEmailSender();
    if (!sender) return 0;
    const found = await getEntryContacts(entryId);
    if (!found || found.contacts.length === 0) return 0;

    const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', 'rowland-payment-received.html');
    const template = Handlebars.compile(readFileSync(templatePath, 'utf-8'));

    let sent = 0;
    for (const contact of found.contacts) {
      const teams = [];
      for (const team of contact.teams) {
        teams.push({ trophyLabel: team.trophy === 'edward' ? 'Edward' : 'Gladys', teamNumber: team.teamNumber });
      }
      const html = template({
        contactName: contact.name,
        clubName: found.entry.clubName,
        season: found.entry.season,
        teams,
        amountReceived: (found.entry.amountReceivedPence / 100).toFixed(2),
        contactEmail: sender.address,
      });
      await sender.transporter.sendMail({
        from: sender.from,
        to: contact.email,
        subject: `Rowland Cup Payment Received — ${found.entry.clubName}`,
        html: processEmailTemplate(html),
      });
      sent++;
    }
    console.log(`[rowland-payment] Payment received email(s) sent for ${found.entry.clubName}: ${sent}`);
    return sent;
  } catch (error) {
    console.error('[rowland-payment] Error sending payment received email:', error);
    return 0;
  }
}
