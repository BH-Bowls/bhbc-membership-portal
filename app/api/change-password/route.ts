// app/api/change-password/route.ts
// API endpoint for users to change their password

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { changePassword } from '@/lib/auth-supabase';
import { sendTemplateEmail, isEmailConfigured, withEmailLogContext } from '@/lib/email/mailer';
import { getUserByUsername } from '@/lib/members-supabase';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Request body for change password endpoint
 */
interface ChangePasswordRequest {
  currentPassword?: string;  // Optional when admin is managing someone
  newPassword: string;
  forceChangeOnNextLogin?: boolean; // Admin can mark the new password as temporary
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
    const originalRole = session.user?.originalAdmin?.role ?? '';
    const originalRoles = originalRole.split(',').map((r: string) => r.trim());
    const isAdminManaging = session.user?.isImpersonating &&
                           originalRoles.some((r: string) => r === 'Admin' || r === 'RowlandOrganiser' || r === 'superadmin');

    // Parse request body
    const body = await request.json();
    const { currentPassword, newPassword, forceChangeOnNextLogin } = body as ChangePasswordRequest;

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

    // Admins setting a temporary password for someone else can use a short one;
    // everyone else (including a forced change on their own account) needs 8+.
    const minLength = isAdminManaging ? 1 : 8;
    if (newPassword.length < minLength) {
      return NextResponse.json(
        { error: `New password must be at least ${minLength} characters` },
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
    // isTempPassword: admin can mark the new password as temporary (force change on next login)
    const isTempPassword = isAdminManaging ? (forceChangeOnNextLogin ?? false) : false;
    const result = await changePassword(
      userName,
      newPassword,
      isAdminManaging ? undefined : currentPassword,
      isTempPassword
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

            await withEmailLogContext({ sentBy, userName }, () =>
              sendTemplateEmail(
                recipientEmail,
                subject,
                'password-changed',
                {
                  memberName,
                }
              )
            );
          }
        }
      } catch (emailError) {
        // Password was changed successfully, just email failed — the mailer's own
        // transporter wrapper already logged the failed attempt to member_emails.
        console.error('[change-password] Failed to send confirmation email:', emailError);
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
