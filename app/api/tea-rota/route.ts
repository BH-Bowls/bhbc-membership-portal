// app/api/tea-rota/route.ts
// API route for tea rota - returns all home games with tea assignments
// All logged-in members can access this

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTeaRotaList } from '@/lib/friendlies-sheets';

/**
 * GET /api/tea-rota
 * Returns list of home games with tea rota assignments
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const entries = await getTeaRotaList({ includeCancelled: true });

    return NextResponse.json({
      entries,
      total: entries.length,
      currentUser: session?.user?.userName ?? '',
    });
  } catch (error) {
    console.error('[GET /api/tea-rota] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tea rota' },
      { status: 500 }
    );
  }
}
