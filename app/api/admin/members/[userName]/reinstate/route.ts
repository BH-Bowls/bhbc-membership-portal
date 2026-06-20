// app/api/admin/members/[userName]/reinstate/route.ts
// POST — reinstate a leaver: move their row from the Leavers sheet back to Members
// (dropping the left_* columns) and delete it from Leavers. Auth: Admin role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { reinstateMember } from '@/lib/leavers-sheets';

// POST handler — reinstates the leaver identified in the route
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userName: string }> }
) {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admins may reinstate leavers
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // The username to reinstate comes from the route segment
    const { userName } = await params;
    if (!userName) {
      return NextResponse.json({ error: 'userName is required' }, { status: 400 });
    }

    // Move the leaver back into the Members sheet
    const result = await reinstateMember(userName);
    if (!result.success) {
      // "Leaver not found" is a 404; anything else is a server error
      const status = result.error === 'Leaver not found' ? 404 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST reinstate] Error:', error);
    return NextResponse.json({ error: 'Failed to reinstate member' }, { status: 500 });
  }
}
