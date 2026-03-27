// app/api/admin/emails/club-contacts/route.ts
// GET  → count of contacts with Include=Y that have email + Club ID
// POST { templateId } → send emails (SSE stream)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getClubContactsToEmail } from '@/lib/clubs-sheets';
import { getClubEmailTemplates } from '@/lib/email/template-reader';
import { sendClubContactEmail } from '@/lib/email/club-mailer';
import { getEmailTransporter } from '@/lib/email/mailer';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const contacts = await getClubContactsToEmail();
    const count = contacts.filter(c => c.canEmail).length;
    return NextResponse.json({ count });
  } catch (error) {
    console.error('[GET /api/admin/emails/club-contacts] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}

interface SendRequest {
  templateId: string;
}

type ProgressEventType = 'progress' | 'success' | 'error' | 'complete';
interface ProgressEvent {
  type: ProgressEventType;
  current?: number;
  total?: number;
  userName?: string;
  error?: string;
  sent?: number;
  succeeded?: number;
  failed?: number;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json() as SendRequest;
    const { templateId } = body;

    if (!templateId) {
      return NextResponse.json({ error: 'templateId is required' }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: ProgressEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        try {
          const contacts = await getClubContactsToEmail();
          const toSend = contacts.filter(c => c.canEmail);
          const total = toSend.length;

          if (total === 0) {
            sendEvent({ type: 'complete', sent: 0, succeeded: 0, failed: 0 });
            controller.close();
            return;
          }

          const templates = getClubEmailTemplates();
          const template = templates.find(t => t.id === templateId);
          if (!template) {
            sendEvent({ type: 'error', error: `Template not found: ${templateId}` });
            controller.close();
            return;
          }

          const transporter = getEmailTransporter(true);
          try {
            await transporter.verify();
          } catch (err) {
            sendEvent({ type: 'error', error: 'SMTP connection failed: ' + (err instanceof Error ? err.message : 'Unknown') });
            controller.close();
            return;
          }

          sendEvent({ type: 'progress', current: 0, total, userName: '' });

          let succeeded = 0;
          let failed = 0;

          for (let i = 0; i < toSend.length; i++) {
            const item = toSend[i];
            const displayName = item.contact.name || `${item.contact.firstName} ${item.contact.lastName}`.trim() || item.contact.clubName;

            sendEvent({ type: 'progress', current: i + 1, total, userName: `${displayName} (${item.contact.clubName})` });

            try {
              const result = await sendClubContactEmail(item, templateId, transporter);
              if (result.success) {
                succeeded++;
                sendEvent({ type: 'success', userName: displayName });
              } else {
                failed++;
                sendEvent({ type: 'error', userName: displayName, error: result.error || 'Unknown error' });
              }
            } catch (err) {
              failed++;
              sendEvent({ type: 'error', userName: displayName, error: err instanceof Error ? err.message : 'Unknown error' });
            }
          }

          sendEvent({ type: 'complete', sent: total, succeeded, failed });
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[POST /api/admin/emails/club-contacts] Error:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
