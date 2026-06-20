// app/api/admin/members/route.ts
// GET /api/admin/members — list active members for the archive page.
// Auth: Admin role required.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllUsers } from '@/lib/sheets';

// GET handler — returns a trimmed list of active members
export async function GET() {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admins may view the member list for archiving
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Read all active members and surface only the fields the archive list needs
    const users = await getAllUsers();
    const members = users.map((user) => {
      return {
        userName: user.userName,
        firstName: user.firstName,
        lastName: user.lastName,
        knownAs: user.knownAs || '',
        memberType: user.memberType,
        yearStarted: user.yearStarted,
        emailAddress: user.emailAddress || '',
      };
    });

    return NextResponse.json({ members });
  } catch (error) {
    console.error('[GET /api/admin/members] Error:', error);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }
}
