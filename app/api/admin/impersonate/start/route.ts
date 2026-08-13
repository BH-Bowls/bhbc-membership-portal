// app/api/admin/impersonate/start/route.ts
// API endpoint to start impersonating another user or club

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByUsername, logImpersonationEvent } from '@/lib/members-supabase';
import { canImpersonate } from '@/lib/buddies-supabase';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName || !session?.user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (session.user.isImpersonating) {
      return NextResponse.json(
        { error: 'Already impersonating. Exit current session first.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { targetUserName } = body as { targetUserName?: string };

    if (!targetUserName) {
      return NextResponse.json({ error: 'Target userName required' }, { status: 400 });
    }

    const targetUser = await getUserByUsername(targetUserName);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

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

    const sessionId = uuidv4();

    await logImpersonationEvent({
      sessionId,
      action: 'START',
      adminUserName: session.user.userName,
      adminName: session.user.name || '',
      adminRole: session.user.role,
      targetUserName: targetUser.userName,
      targetName: targetUser.fullName,
      targetRole: targetUser.role,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '',
      userAgent: request.headers.get('user-agent') || '',
    });

    return NextResponse.json({
      success: true,
      action: 'START_IMPERSONATION',
      targetUser: {
        userName: targetUser.userName,
        email: targetUser.emailAddress,
        name: targetUser.fullName,
        role: targetUser.role,
      },
      sessionId,
    });

  } catch (error) {
    console.error('Error starting impersonation:', error);
    return NextResponse.json({ error: 'Failed to start impersonation' }, { status: 500 });
  }
}
