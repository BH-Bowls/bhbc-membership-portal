// app/api/cleaning-rota/route.ts
// API route to get all cleaning rota entries

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCleaningRotaList } from '@/lib/cleaning-sheets';

/**
 * GET /api/cleaning-rota
 * Returns all cleaning rota entries
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entries = await getCleaningRotaList();

    return NextResponse.json({
      entries,
      currentUser: session.user.userName,
    });
  } catch (error) {
    console.error('[GET /api/cleaning-rota] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cleaning rota' },
      { status: 500 }
    );
  }
}
