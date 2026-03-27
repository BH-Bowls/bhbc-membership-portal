// app/api/admin/impersonate/clubs/route.ts
// Returns the list of clubs available for impersonation (Admin + Rowland role only)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllClubsForImpersonation } from '@/lib/clubs-sheets';

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role;
    const roles = role.split(',').map((r: string) => r.trim());
    if (!roles.some((r: string) => r === 'Admin' || r === 'RowlandOrganiser' || r === 'superadmin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const clubs = await getAllClubsForImpersonation();

    return NextResponse.json({ clubs });
  } catch (error) {
    console.error('Error fetching clubs for impersonation:', error);
    return NextResponse.json({ error: 'Failed to fetch clubs' }, { status: 500 });
  }
}
