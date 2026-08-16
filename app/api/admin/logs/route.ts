// app/api/admin/logs/route.ts
// Admin-only viewer for the four audit-log tables (see /admin/logs).
// GET    — returns the most recent rows (capped) + real total count for each log.
// DELETE ?type=login_attempts|password_reset_requests|impersonation_log|member_emails —
//   clears that one log entirely (e.g. an end-of-season reset).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getLoginAttempts,
  clearLoginAttempts,
  getPasswordResetRequests,
  clearPasswordResetRequests,
  getImpersonationLog,
  clearImpersonationLog,
} from '@/lib/members-supabase';
import { getMemberEmailLog, clearMemberEmailLog } from '@/lib/email-log-supabase';

const LOG_TYPES = ['login_attempts', 'password_reset_requests', 'impersonation_log', 'member_emails'] as const;
type LogType = (typeof LOG_TYPES)[number];

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = session && session.user ? session.user.role : '';
  if (!session || !hasRole(role, 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [loginAttempts, passwordResetRequests, impersonationLog, memberEmails] = await Promise.all([
      getLoginAttempts(),
      getPasswordResetRequests(),
      getImpersonationLog(),
      getMemberEmailLog(),
    ]);
    return NextResponse.json({ loginAttempts, passwordResetRequests, impersonationLog, memberEmails });
  } catch (error) {
    console.error('[GET /api/admin/logs] Error:', error);
    return NextResponse.json({ error: 'Failed to load logs' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = session && session.user ? session.user.role : '';
  if (!session || !hasRole(role, 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const type = request.nextUrl.searchParams.get('type') as LogType | null;
  if (!type || !LOG_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of: ${LOG_TYPES.join(', ')}` }, { status: 400 });
  }

  try {
    if (type === 'login_attempts') await clearLoginAttempts();
    else if (type === 'password_reset_requests') await clearPasswordResetRequests();
    else if (type === 'impersonation_log') await clearImpersonationLog();
    else await clearMemberEmailLog();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[DELETE /api/admin/logs?type=${type}] Error:`, error);
    return NextResponse.json({ error: 'Failed to clear log' }, { status: 500 });
  }
}
