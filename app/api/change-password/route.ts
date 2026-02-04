// app/api/change-password/route.ts
// API endpoint for users to change their password

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { changePassword } from '@/lib/auth-sheets';
import { sendTemplateEmail, isEmailConfigured } from '@/lib/email/mailer';
import { getUserByUsername, updateEmailSentStatus, logMemberEmail } from '@/lib/sheets';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Request body for change password endpoint
 */
interface ChangePasswordRequest {
  currentPassword?: string;  // Optional when admin is managing someone
  newPassword: string;
}

// ============================================================================
// API Handler
// ============================================================================

/**
 * POST /api/change-password
 * Change password for logged-in user
 *
 * Authorization: Any authenticated user
 * Admin impersonation: Admins can set passwords without knowing the old password
 * Request Body: { currentPassword?: string, newPassword: string }
 * Response: { success: boolean, error?: string }
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

    // Get username from session
    const userName = session.user?.userName;
    if (!userName) {
      return NextResponse.json(
        { error: 'Invalid session - Username not found' },
        { status: 400 }
      );
    }

    // Check if admin is managing another user
    const isAdminManaging = session.user?.isImpersonating &&
                           session.user?.originalAdmin?.role === 'Admin';

    // Parse request body
    const body = await request.json();
    const { currentPassword, newPassword } = body as ChangePasswordRequest;

    // Validate current password (only required if NOT admin managing someone)
    if (!isAdminManaging) {
      if (!currentPassword || typeof currentPassword !== 'string') {
        return NextResponse.json(
          { error: 'Current password is required' },
          { status: 400 }
        );
      }
    }

    // Validate new password
    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json(
        { error: 'New password is required' },
        { status: 400 }
      );
    }

    // Validate new password strength (skip for admin managing another user)
    if (!isAdminManaging && newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Check that new password is different from current (if current password provided)
    if (currentPassword && currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'New password must be different from current password' },
        { status: 400 }
      );
    }

    // Change password using auth-sheets function
    // If admin managing someone, don't pass currentPassword (skips verification)
    // Otherwise, pass currentPassword for verification
    const result = await changePassword(
      userName,
      newPassword,
      isAdminManaging ? undefined : currentPassword
    );

    // Check if password change was successful
    if (result.success) {
      // Send password changed confirmation email
      try {
        // Get user details for email
        const user = await getUserByUsername(userName);

        if (isEmailConfigured() && user) {
          let recipientEmail = user.emailAddress;
          let memberName = user.fullKnownAs || user.firstName || 'Member';

          // If user has no email, send to the person managing (admin) if available
          if (!recipientEmail && isAdminManaging && session.user?.originalAdmin?.userName) {
            const manager = await getUserByUsername(session.user.originalAdmin.userName);
            if (manager?.emailAddress) {
              recipientEmail = manager.emailAddress;
              // Note in template that this is being sent to the manager
              memberName = `${memberName} (sent to manager: ${manager.fullKnownAs || manager.firstName})`;
            }
          }

          // If still no email and user has a designated buddy, try sending to buddy
          if (!recipientEmail && user.buddyUserName) {
            const buddy = await getUserByUsername(user.buddyUserName);
            if (buddy?.emailAddress) {
              recipientEmail = buddy.emailAddress;
              // Note in template that this is for their buddy
              memberName = `${memberName} (sent to buddy: ${buddy.fullKnownAs || buddy.firstName})`;
            }
          }

          if (recipientEmail) {
            const subject = 'BHBC Password Changed Successfully';
            const sentBy = isAdminManaging
              ? (session.user?.originalAdmin?.userName || 'Admin')
              : userName;

            const emailResult = await sendTemplateEmail(
              recipientEmail,
              subject,
              'password-changed',
              {
                memberName,
              }
            );

            // Log to MemberEmails sheet
            await logMemberEmail({
              userName,
              emailAddress: recipientEmail,
              templateName: 'Password Changed',
              subject,
              success: emailResult.success,
              errorMessage: emailResult.error,
              sentBy,
              attachments: [],
            });

            // Update Member Email Sent Status in Members sheet
            await updateEmailSentStatus(userName, emailResult.success, emailResult.error);
          }
        }
      } catch (emailError) {
        // Log email error but don't fail the request
        const errorMsg = emailError instanceof Error ? emailError.message : 'Unknown error';
        console.error('[change-password] Failed to send confirmation email:', emailError);

        // Log failed attempt to MemberEmails sheet
        await logMemberEmail({
          userName,
          emailAddress: null,
          templateName: 'Password Changed',
          subject: 'BHBC Password Changed Successfully',
          success: false,
          errorMessage: errorMsg,
          sentBy: isAdminManaging
            ? (session.user?.originalAdmin?.userName || 'Admin')
            : userName,
          attachments: [],
        });

        // Update Member Email Sent Status in Members sheet
        await updateEmailSentStatus(userName, false, errorMsg);

        // Password was changed successfully, just email failed
      }

      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: result.error || 'Failed to change password' },
        { status: 400 }
      );
    }
  } catch (error) {
    // Log error for debugging
    console.error('[change-password] Error processing request:', error);

    // Return error response
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
