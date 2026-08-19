// app/api/my-availability/overrides/[id]/route.ts
// DELETE — remove one of the caller's own overrides

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { removeOverride } from '@/lib/member-availability';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    await removeOverride(id, session.user.userName);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/my-availability/overrides/[id] error:', error);
    return NextResponse.json({ error: 'Failed to remove override' }, { status: 500 });
  }
}
