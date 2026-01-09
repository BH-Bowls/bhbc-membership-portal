// app/api/auth/forgot-password/route.ts
// API endpoint for password reset requests

import { NextRequest, NextResponse } from 'next/server';
import {
  generatePasswordResetToken,
  countRecentResetRequests,
  getUserByUsername,
  updateEmailSentStatus,
  logMemberEmail,
} from '@/lib/sheets';
import { sendTemplateEmail, isEmailConfigured } from '@/lib/email/mailer';

async function sendPasswordResetEmail(
  email: string,
  name: string,
  userName: string,
  token: string,
  baseUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isEmailConfigured()) {
      const error = 'SMTP not configured';
      console.error(error);
      return { success: false, error };
    }

    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    const subject = 'BHBC Password Reset Request';

    const result = await sendTemplateEmail(
      email,
      subject,
      'password-reset',
      {
        memberName: name,
        resetUrl: resetUrl,
      }
    );

    // Log to MemberEmails sheet
    await logMemberEmail({
      userName,
      emailAddress: email,
      templateName: 'Password Reset',
      subject,
      success: result.success,
      errorMessage: result.error,
      sentBy: 'System',
      attachments: [],
    });

    // Update Member Email Sent Status in Members sheet
    await updateEmailSentStatus(userName, result.success, result.error);

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending password reset email:', error);

    // Log failed attempt to MemberEmails sheet
    await logMemberEmail({
      userName,
      emailAddress: email,
      templateName: 'Password Reset',
      subject: 'BHBC Password Reset Request',
      success: false,
      errorMessage: errorMsg,
      sentBy: 'System',
      attachments: [],
    });

    // Update Member Email Sent Status in Members sheet
    await updateEmailSentStatus(userName, false, errorMsg);

    return { success: false, error: errorMsg };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { identifier } = await request.json();

    if (!identifier || typeof identifier !== 'string') {
      return NextResponse.json(
        { error: 'Username or email is required' },
        { status: 400 }
      );
    }

    // Rate limiting: max 3 requests per hour
    const recentRequests = await countRecentResetRequests(identifier);
    if (recentRequests >= 3) {
      return NextResponse.json(
        {
          error:
            'Too many password reset requests. Please try again in an hour.',
        },
        { status: 429 }
      );
    }

    // Generate reset token (this also logs the request for rate limiting)
    const token = await generatePasswordResetToken(identifier);

    // Always return success to prevent username/email enumeration
    // But only send email if user exists
    if (token) {
      // Get user details for email
      let user = await getUserByUsername(identifier);
      const normalizedIdentifier = identifier.toLowerCase();

      // If not found by username, try finding by email
      if (!user) {
        const { getAllUsers } = await import('@/lib/sheets');
        const allUsers = await getAllUsers();
        user = allUsers.find(
          (u) => u.emailAddress?.toLowerCase() === normalizedIdentifier
        ) || null;
      }

      if (user && user.emailAddress) {
        // Get base URL from request
        const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;

        // Send reset email
        await sendPasswordResetEmail(
          user.emailAddress,
          user.fullKnownAs || user.firstName || 'Member',
          user.userName,
          token,
          baseUrl
        );
      }
    }

    // Always return success (don't reveal if user exists)
    return NextResponse.json({
      success: true,
      message: 'If an account exists, a password reset link has been sent.',
    });
  } catch (error) {
    console.error('Error in forgot password:', error);
    return NextResponse.json(
      { error: 'Failed to process password reset request' },
      { status: 500 }
    );
  }
}
