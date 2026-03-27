// app/api/buddies/route.ts
// Shared endpoint for getting manageable users (buddy system)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getManageableUsers } from '@/lib/buddies-sheets';
import { hasRole } from '@/lib/role-utils';

/**
 * GET /api/buddies
 * Returns list of users current user can manage (via buddy system)
 * Used by Profile and Renewals
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const users = await getManageableUsers(
      session.user.userName,
      session.user.role
    );

    // Filter out users with empty userNames (defensive)
    const validUsers = users.filter((u) => u.userName && u.userName.trim() !== '');

    return NextResponse.json({
      users: validUsers.map((u) => ({
        userName: u.userName,
        fullKnownAs: u.fullKnownAs || `${u.firstName} ${u.lastName}`,
        emailAddress: u.emailAddress,
        memberType: u.memberType,
        isSelf: u.userName === session.user.userName,
      })),
      currentUserName: session.user.userName,
      isAdmin: hasRole(session.user.role, 'Admin'),
    });
  } catch (error) {
    console.error('Error fetching manageable users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch manageable users' },
      { status: 500 }
    );
  }
}
