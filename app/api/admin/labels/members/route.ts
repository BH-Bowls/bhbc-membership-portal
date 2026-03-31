// app/api/admin/labels/members/route.ts
// GET → return members with fields needed for label printing

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllUsers } from '@/lib/sheets';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const users = await getAllUsers();
    const members = users
      .filter((u) => u.memberType && u.memberType !== 'Cancelled')
      .map((u) => ({
        fullName: u.fullName,
        address1: u.address1,
        address2: u.address2,
        address3: u.address3,
        postCode: u.postCode,
        memberType: u.memberType,
        include: u.include,
      }));

    return NextResponse.json({ members });
  } catch (error) {
    console.error('[GET /api/admin/labels/members]', error);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }
}
