// app/api/renewals/void/route.ts
// Void a whole submitted renewal (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §5).
//
// GET  ?userName=  — whether it can be voided (blocker message if not) and what's still
//                    attached to it (200 Club numbers, competitions) for the dialog.
// POST { userName, reason } — void it.
//
// Admin only, and never while impersonating: impersonation swaps the session role to the
// member's, and the void must be recorded against the real Admin.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getVoidBlocker, getRenewalAttachments, voidRenewal } from '@/lib/renewals-supabase';

async function getRealAdmin(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) return null;
  if (session.user.isImpersonating) return null;
  if (!hasRole(session.user.role, 'Admin')) return null;
  return session.user.userName;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getRealAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const userName = request.nextUrl.searchParams.get('userName');
    if (!userName) {
      return NextResponse.json({ error: 'userName is required' }, { status: 400 });
    }

    const [blocker, attachments] = await Promise.all([
      getVoidBlocker(userName),
      getRenewalAttachments(userName),
    ]);

    return NextResponse.json({ canVoid: blocker === null, blocker, attachments });
  } catch (error) {
    console.error('[GET /api/renewals/void] Error:', error);
    return NextResponse.json({ error: 'Failed to check renewal' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getRealAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const userName = typeof body.userName === 'string' ? body.userName : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!userName) {
      return NextResponse.json({ error: 'userName is required' }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: 'Please give a reason for voiding this renewal.' }, { status: 400 });
    }

    const result = await voidRenewal(userName, admin, reason);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/renewals/void] Error:', error);
    return NextResponse.json({ error: 'Failed to void renewal' }, { status: 500 });
  }
}
