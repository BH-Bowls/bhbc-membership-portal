// app/api/admin/leavers/[userName]/route.ts
// GET — full details of a single leaver for the read-only view. Auth: Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getLeaverByUserName } from '@/lib/leavers-sheets';

// GET handler — returns a single leaver's details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userName: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userName } = await params;
    const leaver = await getLeaverByUserName(userName);
    if (!leaver) {
      return NextResponse.json({ error: 'Leaver not found' }, { status: 404 });
    }

    return NextResponse.json({ leaver });
  } catch (error) {
    console.error('[GET /api/admin/leavers/[userName]] Error:', error);
    return NextResponse.json({ error: 'Failed to load leaver' }, { status: 500 });
  }
}
