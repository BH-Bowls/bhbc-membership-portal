// app/api/admin/members/bulk-include/route.ts
// PATCH — bulk-set the `include` (Y/N) flag for many members in one batch write.
// Body: { updates: [{ userName, include }] }. Auth: Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { bulkUpdateInclude } from '@/lib/members-admin';

// PATCH handler — applies the include changes
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const updates = body.updates;
    if (!Array.isArray(updates)) {
      return NextResponse.json({ error: 'updates must be an array' }, { status: 400 });
    }

    // Validate each entry has a username and a Y/N value
    const clean: { userName: string; include: string }[] = [];
    for (let i = 0; i < updates.length; i++) {
      const u = updates[i];
      if (!u || typeof u.userName !== 'string' || !u.userName) {
        continue;
      }
      clean.push({ userName: u.userName, include: u.include === 'Y' ? 'Y' : 'N' });
    }

    const result = await bulkUpdateInclude(clean);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, updated: result.updated });
  } catch (error) {
    console.error('[PATCH /api/admin/members/bulk-include] Error:', error);
    return NextResponse.json({ error: 'Failed to update include flags' }, { status: 500 });
  }
}
