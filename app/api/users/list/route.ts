// app/api/users/list/route.ts
// API route to get list of all users for searchable selects

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers } from '@/lib/sheets';

// GET /api/users/list
// Returns list of all users with userName and fullKnownAs
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const users = await getAllUsers();

    // Map to simplified format for dropdowns
    const userList = users.map(user => ({
      userName: user.userName,
      fullName: user.fullName,
    }));

    return NextResponse.json({ users: userList });
  } catch (error) {
    console.error('[GET /api/users/list] Error fetching users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
