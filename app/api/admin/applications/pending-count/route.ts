// app/api/admin/applications/pending-count/route.ts
// GET /api/admin/applications/pending-count — number of applications needing action.
// Used by the /admin/members hub badge. Auth: Admin role required.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getPendingApplicationsCount } from '@/lib/applications-sheets';

// GET handler — returns { count } of applications awaiting admin action
export async function GET() {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admins may see the pending count
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Count applications that are Submitted, or Listed with the objection period passed
    const count = await getPendingApplicationsCount();

    return NextResponse.json({ count });
  } catch (error) {
    console.error('[GET /api/admin/applications/pending-count] Error:', error);
    return NextResponse.json({ error: 'Failed to load pending count' }, { status: 500 });
  }
}
