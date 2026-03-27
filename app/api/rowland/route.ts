// app/api/rowland/route.ts
// GET all Rowland Cup competitions

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllRowlandComps } from '@/lib/rowland-sheets';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const comps = await getAllRowlandComps();
    return NextResponse.json({ comps });
  } catch (error) {
    console.error('[rowland] GET error:', error);
    return NextResponse.json({ error: 'Failed to load competitions' }, { status: 500 });
  }
}
