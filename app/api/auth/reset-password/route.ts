// app/api/auth/reset-password/route.ts
// API endpoint for resetting password with token

import { NextRequest, NextResponse } from 'next/server';
import {
  validateResetToken,
  updatePasswordHash,
  clearResetToken,
} from '@/lib/sheets';
import bcrypt from 'bcryptjs';
import { sendTemplateEmail, isEmailConfigured } from '@/lib/email/mailer';

async function sendPasswordChangedEmail(
  email: string,
  name: string
): Promise<void> {
  try {
    if (!isEmailConfigured()) {
      console.error('SMTP not configured');
      return;
    }

    await sendTemplateEmail(
      email,
      'BHBC Password Changed Successfully',
      'password-changed',
      {
        memberName: name,
      }
    );
  } catch (error) {
    console.error('Error sending password changed email:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();

    // Validate inputs
    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Reset token is required' },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'New password is required' },
        { status: 400 }
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    // Validate token and get user
    const user = await validateResetToken(token);

    if (!user) {
      return NextResponse.json(
        {
          error:
            'Invalid or expired reset token. Please request a new password reset link.',
        },
        { status: 400 }
      );
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password in database
    await updatePasswordHash(user.userName, hashedPassword, false);

    // Clear reset token
    await clearResetToken(user.userName);

    // Send confirmation email
    if (user.emailAddress) {
      await sendPasswordChangedEmail(
        user.emailAddress,
        user.fullKnownAs || user.firstName || 'Member'
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Password has been reset successfully',
    });
  } catch (error) {
    console.error('Error in reset password:', error);
    return NextResponse.json(
      { error: 'Failed to reset password' },
      { status: 500 }
    );
  }
}
