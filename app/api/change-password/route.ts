// app/api/change-password/route.ts
// API endpoint for users to change their password

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { changePassword } from '@/lib/auth-sheets';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Request body for change password endpoint
 */
interface ChangePasswordRequest {
  currentPassword: string;
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
 * Request Body: { currentPassword: string, newPassword: string }
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

    // Parse request body
    const body = await request.json();
    const { currentPassword, newPassword } = body as ChangePasswordRequest;

    // Validate request body
    if (!currentPassword || typeof currentPassword !== 'string') {
      return NextResponse.json(
        { error: 'Current password is required' },
        { status: 400 }
      );
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json(
        { error: 'New password is required' },
        { status: 400 }
      );
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Check that new password is different from current
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'New password must be different from current password' },
        { status: 400 }
      );
    }

    // Change password using auth-sheets function
    // This will verify current password and update to new password
    const result = await changePassword(userName, newPassword, currentPassword);

    // Check if password change was successful
    if (result.success) {
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
