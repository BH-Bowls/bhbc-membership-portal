import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { deleteMarker } from '@/lib/markers-sheets';

/** DELETE /api/markers/[rowNumber] — Captain or Admin only */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ rowNumber: string }> }
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

    const { rowNumber: rowNumberStr } = await params;
    const rowNumber = parseInt(rowNumberStr, 10);
    if (isNaN(rowNumber) || rowNumber < 2) {
      return NextResponse.json({ error: 'Invalid row number' }, { status: 400 });
    }

    await deleteMarker(rowNumber);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/markers/[rowNumber] error:', error);
    return NextResponse.json({ error: 'Failed to delete marker' }, { status: 500 });
  }
}
