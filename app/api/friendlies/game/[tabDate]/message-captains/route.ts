// app/api/friendlies/game/[tabDate]/message-captains/route.ts
// Send a message from a member to all Captain/Admin role users

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCaptainEmails } from '@/lib/email/friendlies';
import { sendEmail } from '@/lib/email/mailer';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tabDate: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: { message?: string; clubName?: string; gameDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { message, clubName, gameDate } = body;

  if (!message?.trim()) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
  }

  const senderName = session.user.name || (session.user as any).userName || 'A member';
  const senderEmail = session.user.email || '';
  const gameName = [clubName, gameDate].filter(Boolean).join(' ');
  const subject = `Message regarding ${gameName}`;

  const escapedMessage = message.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

  const text = `Message from: ${senderName}
Email: ${senderEmail}

${message.trim()}

---
Burgess Hill Bowls Club`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #0066cc; color: #ffffff; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .header h2 { margin: 0; color: #ffffff; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .message-box { background-color: #ffffff; padding: 15px; margin: 15px 0; border-left: 4px solid #0066cc; }
    .footer { text-align: center; padding: 15px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h2>Message from a Member</h2></div>
    <div class="content">
      <p><strong>From:</strong> ${senderName}</p>
      <p><strong>Email:</strong> <a href="mailto:${senderEmail}">${senderEmail}</a></p>
      <p><strong>Regarding:</strong> ${gameName}</p>
      <div class="message-box">
        <p>${escapedMessage}</p>
      </div>
    </div>
    <div class="footer"><p>Burgess Hill Bowls Club - Friendlies Management System</p></div>
  </div>
</body>
</html>`;

  const captainEmails = await getCaptainEmails();
  if (captainEmails.length === 0) {
    console.warn('[message-captains] No captain emails found');
    return NextResponse.json({ error: 'No captain contacts found. Please contact the club directly.' }, { status: 500 });
  }

  await sendEmail(captainEmails.join(', '), subject, text, html);

  console.log(`[message-captains] Message from ${senderName} sent to ${captainEmails.length} captain(s) regarding ${gameName}`);
  return NextResponse.json({ ok: true });
}
