import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getMarkers, setMarkerStatus, getUserByUsername } from '@/lib/members-supabase';

/** GET /api/markers — all authenticated users */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const markers = await getMarkers();
    return NextResponse.json({ markers });
  } catch (error) {
    console.error('GET /api/markers error:', error);
    return NextResponse.json({ error: 'Failed to load markers' }, { status: 500 });
  }
}

/** POST /api/markers — Captain or Admin only */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const role = session.user?.role ?? '';
    if (!hasRole(role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { username, isWorker } = body as { username?: string; isWorker?: boolean };

    if (!username?.trim()) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    const user = await getUserByUsername(username.trim());
    if (!user) {
      return NextResponse.json({ error: 'Member not found' }, { status: 400 });
    }

    if (user.isMarker) {
      return NextResponse.json({ error: 'Member is already in the markers list' }, { status: 400 });
    }

    await setMarkerStatus(user.userName, { isMarker: true, isWorker: !!isWorker });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/markers error:', error);
    return NextResponse.json({ error: 'Failed to add marker' }, { status: 500 });
  }
}
