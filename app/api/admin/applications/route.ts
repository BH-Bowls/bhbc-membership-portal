// app/api/admin/applications/route.ts
// GET /api/admin/applications — list all membership applications with their status.
// Auth: Admin role required.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllApplications } from '@/lib/applications-sheets';

// GET handler — returns every application in the sheet
export async function GET() {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admins may view the applications workflow
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Read all applications from the sheet
    const applications = await getAllApplications();

    return NextResponse.json({ applications });
  } catch (error) {
    console.error('[GET /api/admin/applications] Error:', error);
    return NextResponse.json({ error: 'Failed to load applications' }, { status: 500 });
  }
}
