import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { setMarkerStatus } from '@/lib/members-supabase';

/** DELETE /api/markers/[userName] — Captain or Admin only */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userName: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const role = session.user?.role ?? '';
    if (!hasRole(role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userName } = await params;
    const decoded = decodeURIComponent(userName);
    if (!decoded.trim()) {
      return NextResponse.json({ error: 'Invalid username' }, { status: 400 });
    }

    await setMarkerStatus(decoded, { isMarker: false, isWorker: false, workerAdditionalInfo: null });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/markers/[userName] error:', error);
    return NextResponse.json({ error: 'Failed to delete marker' }, { status: 500 });
  }
}
