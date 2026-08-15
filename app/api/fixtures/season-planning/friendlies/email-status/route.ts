// app/api/fixtures/season-planning/friendlies/email-status/route.ts
// POST { ids, sent }: bulk-set a club's whole outreach group to Email Sent
// (sent: true) or back to Projected (sent: false). A deliberate, explicit
// action — never fired automatically just from opening the Gmail draft link.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { setFixturesEmailStatus } from '@/lib/season-planning-supabase';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { ids, sent } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }
    if (typeof sent !== 'boolean') {
      return NextResponse.json({ error: 'sent (boolean) is required' }, { status: 400 });
    }

    await setFixturesEmailStatus(ids, sent);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating email status:', error);
    return NextResponse.json({ error: 'Failed to update email status' }, { status: 500 });
  }
}
