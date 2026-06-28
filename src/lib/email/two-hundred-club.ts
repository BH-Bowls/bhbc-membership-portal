// src/lib/email/two-hundred-club.ts
// Emails for the 200 Club. Each prize winner gets their own short email when a
// draw is recorded.
//
// IMPORTANT: sends are SEQUENTIAL (await in a loop), never Promise.all — Gmail
// rate-limits/suspends on parallel SMTP connections (see specs/CLAUDE.md).

import { sendEmail } from './mailer';
import { getUserByUsername } from '../sheets';
import type { RecordedWinner } from '../two-hundred-club-sheets';

function gbp(n: number): string {
  return `£${Number(n).toLocaleString('en-GB')}`;
}

function ordinal(p: number): string {
  if (p === 1) return '1st';
  if (p === 2) return '2nd';
  if (p === 3) return '3rd';
  return `${p}th`;
}

/** Email each winner individually. Resolves each winner's email from their
 *  username; skips any winner without a username or email. Returns how many sent. */
export async function sendWinnerEmails(season: string, winners: RecordedWinner[]): Promise<{ sent: number }> {
  let sent = 0;
  for (const w of winners) {
    if (!w.username) continue;

    let user = null;
    try {
      user = await getUserByUsername(w.username);
    } catch {
      user = null;
    }
    if (!user) continue;

    const email = (user.emailAddress || '').trim();
    if (!email) continue;

    const name = w.member || user.firstName || 'Member';
    const subject = `200 Club draw — you've won ${gbp(w.amount)}!`;
    const text =
      `Hi ${name},\n\n` +
      `Great news — number ${w.number} has won ${ordinal(w.position)} prize (${gbp(w.amount)}) ` +
      `in the ${season} 200 Club draw on ${w.date}.\n\n` +
      `Your prize will be paid out by the club.\n\n` +
      `Burgess Hill Bowls Club`;
    const html =
      `<p>Hi ${name},</p>` +
      `<p>Great news — number <strong>${w.number}</strong> has won ` +
      `<strong>${ordinal(w.position)} prize (${gbp(w.amount)})</strong> in the ${season} ` +
      `200 Club draw on ${w.date}.</p>` +
      `<p>Your prize will be paid out by the club.</p>` +
      `<p>Burgess Hill Bowls Club</p>`;

    const res = await sendEmail(email, subject, text, html);
    if (res.success) sent++;
  }
  return { sent };
}
