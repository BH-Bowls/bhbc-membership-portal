// app/api/banking/renewals/route.ts
// Get renewals with outstanding > 0

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRenewalsWithOutstanding } from '@/lib/banking-sheets';
import { hasRole } from '@/lib/role-utils';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Check authorization: Admin OR Treasurer
    if (!hasRole(session?.user?.role, 'Admin', 'Treasurer')) {
      return NextResponse.json(
        { error: 'Forbidden - Admin or Treasurer access required' },
        { status: 403 }
      );
    }

    const renewals = await getRenewalsWithOutstanding();

    return NextResponse.json({ renewals });
  } catch (error) {
    console.error('Error getting renewals:', error);
    return NextResponse.json(
      { error: 'Failed to get renewals' },
      { status: 500 }
    );
  }
}
