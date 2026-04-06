// app/api/clubs/route.ts
// API route for listing all clubs - GET
// All logged-in users can access this endpoint

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getClubs } from '@/lib/clubs-sheets';

/**
 * GET /api/clubs
 * Returns list of all clubs
 * Authorization: Any logged-in user
 */
export async function GET(request: NextRequest) {
  try {
    const clubs = await getClubs();

    return NextResponse.json({
      clubs,
      total: clubs.length,
    });
  } catch (error) {
    console.error('[GET /api/clubs] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch clubs' },
      { status: 500 }
    );
  }
}
