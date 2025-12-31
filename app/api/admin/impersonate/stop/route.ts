// app/api/admin/impersonate/stop/route.ts
// API endpoint to stop impersonating and return to original admin

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { logImpersonationEvent } from '@/lib/sheets';

export async function POST(request: NextRequest) {
  try {
    // Get current session
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Must be currently impersonating to stop
    if (!session.user.isImpersonating || !session.user.originalAdmin) {
      return NextResponse.json(
        { error: 'Not currently impersonating' },
        { status: 400 }
      );
    }

    const { sessionId } = await request.json();

    // Log stop event
    await logImpersonationEvent({
      sessionId: sessionId || 'unknown',
      action: 'STOP',
      adminUserName: session.user.originalAdmin.userName,
      adminName: session.user.originalAdmin.name,
      adminRole: session.user.originalAdmin.role,
      targetUserName: session.user.userName,
      targetName: session.user.name || '',
      targetRole: session.user.role,
      ipAddress: request.headers.get('x-forwarded-for') ||
                 request.headers.get('x-real-ip') ||
                 '',
      userAgent: request.headers.get('user-agent') || '',
    });

    // Return data for JWT update
    return NextResponse.json({
      success: true,
      action: 'STOP_IMPERSONATION',
    });

  } catch (error) {
    console.error('Error stopping impersonation:', error);
    return NextResponse.json(
      { error: 'Failed to stop impersonation' },
      { status: 500 }
    );
  }
}
