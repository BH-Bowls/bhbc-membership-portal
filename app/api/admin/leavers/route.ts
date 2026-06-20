// app/api/admin/leavers/route.ts
// GET /api/admin/leavers — list all leavers for the reinstate page.
// Auth: Admin role required.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllLeavers } from '@/lib/leavers-sheets';

// GET handler — returns every leaver in the Leavers sheet
export async function GET() {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admins may view leavers
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Read all leavers from the sheet
    const leavers = await getAllLeavers();

    return NextResponse.json({ leavers });
  } catch (error) {
    console.error('[GET /api/admin/leavers] Error:', error);
    return NextResponse.json({ error: 'Failed to load leavers' }, { status: 500 });
  }
}
