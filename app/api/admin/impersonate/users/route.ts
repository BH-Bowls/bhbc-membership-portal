// app/api/admin/impersonate/users/route.ts
// API endpoint to get list of users that current user can impersonate

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getImpersonatableUsers } from '@/lib/buddies-sheets';

/**
 * GET /api/admin/impersonate/users
 * Returns list of users current user can impersonate
 * - Admins: All users except themselves
 * - Members: Users who list them as buddy
 */
export async function GET(request: NextRequest) {
  try {
    // Get current session
    const session = await getServerSession(authOptions);

    console.log('🔍 Impersonate Users API - Session:', {
      exists: !!session,
      userName: session?.user?.userName,
      role: session?.user?.role,
    });

    if (!session?.user?.userName || !session?.user?.role) {
      console.error('❌ Unauthorized - missing session or user data');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ Impersonate Users API - User:', session.user.userName, 'Role:', session.user.role);

    // Get impersonatable users based on buddy+admin rules
    const users = await getImpersonatableUsers(
      session.user.userName,
      session.user.role
    );

    // Map to response format
    const impersonatableUsers = users.map(user => ({
      userName: user.userName,
      name: `${user.firstName} ${user.lastName}`.trim(),
      fullKnownAs: user.fullKnownAs || `${user.firstName} ${user.lastName}`.trim(),
      role: user.role,
      emailAddress: user.emailAddress,
      lastLoginDate: user.lastLoginDate,
    }));

    return NextResponse.json({
      users: impersonatableUsers,
      count: impersonatableUsers.length,
    });

  } catch (error) {
    console.error('Error fetching impersonatable users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
