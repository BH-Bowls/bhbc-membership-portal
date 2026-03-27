// app/api/data-export/schemas/route.ts
// GET: Returns all sheet schemas with their columns (Admin only)

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllSheetSchemas } from '@/lib/data-export';
import { hasRole } from '@/lib/role-utils';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 }
      );
    }

    if (!hasRole(session.user?.role, 'Admin')) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const schemas = await getAllSheetSchemas();
    return NextResponse.json({ schemas });
  } catch (error) {
    console.error('Error fetching schemas:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sheet schemas' },
      { status: 500 }
    );
  }
}
