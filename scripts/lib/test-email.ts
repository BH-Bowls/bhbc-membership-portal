// scripts/lib/test-email.ts
// The test email scripts/send-test-email.ts sends — and the Cloudflare Worker test sends
// the same one, so the two can be compared side by side in the inbox.

import type { MailOptions } from '../../src/lib/email/gmail-api';

export function testEmail(fromAddress: string, to: string, sentFrom: string): MailOptions {
  const when = new Date();
  const stamp = when.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const start = new Date(when.getTime() + 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const end = new Date(when.getTime() + 27 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BHBC//Gmail API test//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:gmail-api-test-${stamp}@bhbc`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    'SUMMARY:Gmail API test event',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return {
    from: `"Burgess Hill Bowls Club – test" <${fromAddress}>`,
    to: to,
    subject: `Gmail API test from ${sentFrom} — £1.80 ✓`,
    text: `Test email sent through the Gmail API from ${sentFrom} at ${when.toISOString()}.\nIt should have an .ics invite attached.`,
    html: `<p>Test email sent through the <strong>Gmail API</strong> from <strong>${sentFrom}</strong> at ${when.toISOString()}.</p>`
      + `<p>Non-ASCII check: £1.80 — café ✓</p><p>It should have an .ics invite attached.</p>`,
    headers: { 'List-Unsubscribe': `<mailto:${fromAddress}?subject=Unsubscribe>` },
    attachments: [{ filename: 'test-event.ics', content: ics, contentType: 'text/calendar; method=PUBLISH' }],
  };
}
