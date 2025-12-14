// app/api/auth/forgot-password/route.ts
// API endpoint for password reset requests

import { NextRequest, NextResponse } from 'next/server';
import {
  generatePasswordResetToken,
  countRecentResetRequests,
  getUserByUsername,
} from '@/lib/sheets';
import { sendTemplateEmail, isEmailConfigured } from '@/lib/email/mailer';

async function sendPasswordResetEmail(
  email: string,
  name: string,
  token: string,
  baseUrl: string
): Promise<boolean> {
  try {
    if (!isEmailConfigured()) {
      console.error('SMTP not configured');
      return false;
    }

    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    const result = await sendTemplateEmail(
      email,
      'BHBC Password Reset Request',
      'password-reset',
      {
        memberName: name,
        resetUrl: resetUrl,
      }
    );

    return result.success;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return false;
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
