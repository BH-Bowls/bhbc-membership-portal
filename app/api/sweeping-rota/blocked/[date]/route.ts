// app/api/sweeping-rota/blocked/[date]/route.ts
// API route for admin to unblock a specific day

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { unblockSweepingDate } from '@/lib/sweeping-sheets';
import { hasRole } from '@/lib/role-utils';

interface RouteContext {
  params: Promise<{ date: string }>;
}

/**
 * DELETE /api/sweeping-rota/blocked/[date]
 * Unblock a specific date (admin only)
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Admin and SweepingAdmin only
    const canUnblock = hasRole(session.user.role, 'Admin', 'SweepingAdmin') || session.user.role === 'superadmin';
    if (!canUnblock) {
      return NextResponse.json({ error: 'Forbidden - Admin or SweepingAdmin only' }, { status: 403 });
    }

    const { date } = await context.params;

    // Decode the date parameter (it may be URL encoded)
    const decodedDate = decodeURIComponent(date);

    // Validate date format (DD/MM/YYYY)
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(decodedDate)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use DD/MM/YYYY' },
        { status: 400 }
      );
    }

    const result = await unblockSweepingDate(decodedDate);

    if (!result.success) {
      return NextResponse.json(
        { error: result.reason || 'Failed to unblock date' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/sweeping-rota/blocked/[date]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to unblock date' },
      { status: 500 }
    );
  }
}
