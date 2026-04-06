// app/api/competitions/route.ts
// GET /api/competitions — list all competitions

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllCompetitions } from '@/lib/competitions-sheets';

export async function GET(request: NextRequest) {
  try {
    const competitions = await getAllCompetitions();
    return NextResponse.json({ competitions });
  } catch (error) {
    console.error('[GET /api/competitions] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch competitions' }, { status: 500 });
  }
}
