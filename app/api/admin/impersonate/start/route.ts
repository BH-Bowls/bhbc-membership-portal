// app/api/admin/impersonate/start/route.ts
// API endpoint to start impersonating another user

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByUsername } from '@/lib/sheets';
import { canImpersonate } from '@/lib/buddies-sheets';
import { logImpersonationEvent } from '@/lib/sheets';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    // Get current session
    const session = await getServerSession(authOptions);

    // Auth check - must be logged in with a userName
    if (!session?.user?.userName || !session?.user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if already impersonating
    if (session.user.isImpersonating) {
      return NextResponse.json(
        { error: 'Already impersonating. Exit current session first.' },
        { status: 400 }
      );
    }

    // Get target user from request body
    const { targetUserName } = await request.json();

    if (!targetUserName) {
      return NextResponse.json(
        { error: 'Target userName required' },
        { status: 400 }
      );
    }

    // Fetch target user from database
    const targetUser = await getUserByUsername(targetUserName);

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Validate impersonation permission using buddy+admin rules
    const canImpersonateUser = await canImpersonate(
      session.user.userName,
      session.user.role,
      targetUserName
    );

    if (!canImpersonateUser) {
      return NextResponse.json(
        { error: 'You do not have permission to impersonate this user' },
        { status: 403 }
      );
    }

    // Generate unique session ID for audit trail
    const sessionId = uuidv4();

    // Log impersonation start event
    await logImpersonationEvent({
      sessionId,
      action: 'START',
      adminUserName: session.user.userName,
      adminName: session.user.name || '',
      adminRole: session.user.role,
      targetUserName: targetUser.userName,
      targetName: `${targetUser.firstName} ${targetUser.lastName}`.trim(),
      targetRole: targetUser.role,
      ipAddress: request.headers.get('x-forwarded-for') ||
                 request.headers.get('x-real-ip') ||
                 '',
      userAgent: request.headers.get('user-agent') || '',
    });

    // Return data for JWT update
    // This will be passed to the JWT callback via update()
    return NextResponse.json({
      success: true,
      action: 'START_IMPERSONATION',
      targetUser: {
        userName: targetUser.userName,
        email: targetUser.emailAddress,
        name: `${targetUser.firstName} ${targetUser.lastName}`.trim(),
        role: targetUser.role,
      },
      sessionId,
    });

  } catch (error) {
    console.error('Error starting impersonation:', error);
    return NextResponse.json(
      { error: 'Failed to start impersonation' },
      { status: 500 }
    );
  }
}
