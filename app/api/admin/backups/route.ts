// app/api/admin/backups/route.ts
// Admin-only API that reports the health of the nightly database backups (see /admin/backups).
// Read-only: it lists the backup files in Google Drive and never changes them.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getBackupStatus } from '@/lib/backup-status';

export async function GET() {
  try {
    // 1. Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Backups are technical/dev-facing, so Admin only
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Read the backup files from Drive and check them
    const status = await getBackupStatus();

    // 4. Return the result
    return NextResponse.json({ success: true, data: status });

  } catch (error) {
    // Most likely the Google refresh token has lapsed. Log the detail server-side only.
    console.error('[GET /api/admin/backups] Error:', error);
    return NextResponse.json({ error: 'Failed to read the backups from Google Drive' }, { status: 500 });
  }
}
