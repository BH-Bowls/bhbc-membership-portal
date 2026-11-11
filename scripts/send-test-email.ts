// scripts/send-test-email.ts
// Sends one test email through the Gmail API (src/lib/email/gmail-api.ts), covering what
// the portal's emails use: a From name and subject with non-ASCII ("–", "—", "£"), plain
// text + HTML, and an .ics calendar invite attached.
//
//   npx dotenv -e .env.dev.local -- npx tsx scripts/send-test-email.ts you@example.com
//   (add "rowland" after the address to send as the Rowland Cup account instead)

import { createGmailApiTransport } from '../src/lib/email/gmail-api';
import { testEmail } from './lib/test-email';

async function main() {
  const to = process.argv[2];
  const asRowland = process.argv[3] === 'rowland';
  if (!to) {
    console.error('Usage: send-test-email.ts <to-address> [rowland]');
    process.exit(1);
  }
  const token = asRowland ? process.env.ROWLAND_GMAIL_REFRESH_TOKEN : process.env.GMAIL_REFRESH_TOKEN;
  const from = asRowland ? process.env.ROWLAND_EMAIL : process.env.SMTP_USER;
  if (!token || !from) {
    console.error(asRowland ? 'ROWLAND_EMAIL and ROWLAND_GMAIL_REFRESH_TOKEN must be set.' : 'SMTP_USER and GMAIL_REFRESH_TOKEN must be set.');
    process.exit(1);
  }

  const transport = createGmailApiTransport(token);
  const info = await transport.sendMail(testEmail(from, to, 'Node'));
  console.log(`Sent from ${from} to ${to} — Gmail message id ${info.messageId}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
