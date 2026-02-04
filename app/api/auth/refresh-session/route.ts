// app/api/auth/refresh-session/route.ts
// API endpoint to refresh session data from the database
// Used when user data (like role) may have changed since login

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByUsername } from '@/lib/sheets';

export async function POST() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get fresh user data from database
    const user = await getUserByUsername(session.user.userName);

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Build display name
    const displayName = user.knownAs
      ? `${user.knownAs} ${user.lastName}`
      : `${user.firstName} ${user.lastName}`;

    // Return fresh user data that the client will use to update the session
    return NextResponse.json({
      success: true,
      userData: {
        role: user.role,
        name: displayName,
        email: user.emailAddress || '',
      },
      // Flag if data has changed (client can decide whether to refresh)
      hasChanges:
        user.role !== session.user.role ||
        displayName !== session.user.name ||
        (user.emailAddress || '') !== (session.user.email || ''),
    });

  } catch (error) {
    console.error('Error refreshing session:', error);
    return NextResponse.json(
      { error: 'Failed to refresh session' },
      { status: 500 }
    );
  }
}
