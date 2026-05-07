// app/api/admin/emails/send/route.ts
// API endpoint to send emails to members using selected template and attachments

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers, updateEmailSentStatus, logMemberEmail } from '@/lib/sheets';
import { sendMemberEmail } from '@/lib/email/member-mailer';
import { getEmailTemplates } from '@/lib/email/template-reader';
import { getEmailTransporter } from '@/lib/email/mailer';
import { hasRole } from '@/lib/role-utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Request body for send emails endpoint
 */
interface SendEmailsRequest {
  templateId: string;              // Email template ID
  attachmentIds: string[];         // Array of attachment template IDs
}

/**
 * Progress event types for Server-Sent Events
 */
type ProgressEventType = 'progress' | 'success' | 'error' | 'complete';

/**
 * Progress event data structure
 */
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

// ============================================================================
// API Handler
// ============================================================================

/**
 * POST /api/admin/emails/send
 * Send emails to all members with include="Y" using selected template
 *
 * Authorization: Admin only
 * Request Body: { templateId: string, attachmentIds: string[] }
 * Response: Server-Sent Events stream with progress updates
 */
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Check if session exists
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 }
      );
    }

    // Check authorization: Admin only
    if (!hasRole(session.user?.role, 'Admin')) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { templateId, attachmentIds } = body as SendEmailsRequest;

    // Validate request body
    if (!templateId || typeof templateId !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request - templateId is required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(attachmentIds)) {
      return NextResponse.json(
        { error: 'Invalid request - attachmentIds must be an array' },
        { status: 400 }
      );
    }

    // Create Server-Sent Events response
    // This allows us to send progress updates as emails are sent
    const encoder = new TextEncoder();

    // Create readable stream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        // Helper function to send SSE event
        const sendEvent = (event: ProgressEvent) => {
          // Format event as SSE data
          const data = `data: ${JSON.stringify(event)}\n\n`;

          // Encode and enqueue to stream
          controller.enqueue(encoder.encode(data));
        };

        try {
          // Fetch all members from Members sheet
          const allMembers = await getAllUsers();

          // Filter for members with include="Y"
          // Only these members should receive emails
          const membersToEmail = [];
          for (const member of allMembers) {
            // Check if include field is "Y" (case-insensitive)
            if (member.include && member.include.toUpperCase() === 'Y') {
              membersToEmail.push(member);
            }
          }

          // Get template information for logging
          const templates = getEmailTemplates();
          const template = templates.find(t => t.id === templateId);
          const templateName = template?.name || templateId;
          const templateSubject = template?.subject || 'Message from Burgess Hill Bowls Club';

          // Get attachment names for logging
          const attachmentNames = attachmentIds.length > 0 ? attachmentIds : [];

          // Get admin username for logging
          const adminUserName = session.user?.userName || 'Unknown';

          // Get total count for progress tracking
          const total = membersToEmail.length;

          // Check if any members found
          if (total === 0) {
            // Send complete event with zero count
            sendEvent({
              type: 'complete',
              sent: 0,
              succeeded: 0,
              failed: 0,
            });

            // Close stream
            controller.close();
            return;
          }

          // Counters for summary
          let succeeded = 0;
          let failed = 0;

          // Create persistent transporter for bulk sending
          // This keeps one SMTP connection open for all sends (maxConnections: 1)
          // Prevents "Too many login attempts" errors from Gmail
          // We send sequentially and await each send before proceeding
          const transporter = getEmailTransporter(true);

          // Verify SMTP connection before starting
          try {
            await transporter.verify();
            console.log('[send-emails] SMTP connection verified successfully');
          } catch (verifyError) {
            console.error('[send-emails] SMTP verification failed:', verifyError);
            sendEvent({
              type: 'error',
              error: 'SMTP connection failed: ' + (verifyError instanceof Error ? verifyError.message : 'Unknown error'),
            });
            controller.close();
            return;
          }

          // Send initial progress event to set total count
          sendEvent({
            type: 'progress',
            current: 0,
            total,
            userName: '',
          });

          try {
            // Loop through each member and send email
            // Process sequentially to avoid overwhelming email server
            for (let i = 0; i < membersToEmail.length; i++) {
              const member = membersToEmail[i];

              // Get user name for progress display
              const userName = `${member.firstName} ${member.lastName}`.trim() || member.userName || 'Unknown';

              // Send progress event
              sendEvent({
                type: 'progress',
                current: i + 1,
                total,
                userName,
              });

              try {
                // Send email to this member using selected template and attachments
                // WAIT for completion before proceeding to next member
                // Pass transporter to reuse connection (prevents rate limiting)
                const result = await sendMemberEmail(member, templateId, attachmentIds, transporter);

              // Check if email send was successful
              if (result.success) {
                succeeded++;

                await Promise.all([
                  logMemberEmail({
                    userName: member.userName,
                    emailAddress: member.emailAddress,
                    templateName,
                    subject: templateSubject,
                    success: true,
                    sentBy: adminUserName,
                    attachments: attachmentNames,
                  }),
                  updateEmailSentStatus(member.userName, true),
                ]);

                sendEvent({ type: 'success', userName });
              } else {
                failed++;

                await Promise.all([
                  logMemberEmail({
                    userName: member.userName,
                    emailAddress: member.emailAddress,
                    templateName,
                    subject: templateSubject,
                    success: false,
                    errorMessage: result.error,
                    sentBy: adminUserName,
                    attachments: attachmentNames,
                  }),
                  updateEmailSentStatus(member.userName, false, result.error),
                ]);

                sendEvent({ type: 'error', userName, error: result.error || 'Unknown error' });
              }
            } catch (error) {
              failed++;

              const errorMsg = error instanceof Error ? error.message : 'Unknown error';

              await Promise.all([
                logMemberEmail({
                  userName: member.userName,
                  emailAddress: member.emailAddress,
                  templateName,
                  subject: templateSubject,
                  success: false,
                  errorMessage: errorMsg,
                  sentBy: adminUserName,
                  attachments: attachmentNames,
                }),
                updateEmailSentStatus(member.userName, false, errorMsg),
              ]);

              // Send error event
              sendEvent({
                type: 'error',
                userName,
                error: errorMsg,
              });

              // Log error for debugging
              console.error(`[send-emails] Error sending to ${userName}:`, error);
            }
          }

            // Send completion event with summary
            sendEvent({
              type: 'complete',
              sent: total,
              succeeded,
              failed,
            });
          } finally {
            // Close transporter to release SMTP connections
            // transporter.close() waits for pending messages to be sent
            console.log('[send-emails] Closing transporter (waiting for pending messages)...');
            transporter.close();
            console.log('[send-emails] Transporter closed');
          }

          // Close stream
          controller.close();
        } catch (error) {
          // Log error for debugging
          console.error('[send-emails] Error in stream:', error);

          // Send error event
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          sendEvent({
            type: 'error',
            error: errorMsg,
          });

          // Close stream
          controller.close();
        }
      },
    });

    // Return SSE response
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    // Log error for debugging
    console.error('[send-emails] Error processing request:', error);

    // Return error response
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
