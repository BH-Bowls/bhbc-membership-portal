// app/api/competitions/members/route.ts
// GET /api/competitions/members — return CompMemberInfo for all members
// Used by bracket views to look up names and handicaps

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getMemberInfoMap } from '@/lib/competitions-sheets';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const map = await getMemberInfoMap();
    // Convert Map to plain object for JSON serialisation
    const members = Object.fromEntries(map);
    return NextResponse.json({ members });
  } catch (error) {
    console.error('[GET /api/competitions/members] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch member info' }, { status: 500 });
  }
}
