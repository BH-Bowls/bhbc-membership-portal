// app/api/diary/route.ts
// GET /api/diary — returns upcoming diary items for the logged-in member.
// Auth: session required. Uses per-user diary cache (48-hour TTL).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDiaryCache, setDiaryCache } from '@/lib/home-cache';
import { getDiaryItems } from '@/lib/diary-sheets';
import type { DiaryResponse } from '@/types/diary';

// GET handler — returns diary items for the current user
export async function GET() {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userName = session.user.userName;

    // Check the per-user diary cache — avoids multiple Sheets calls per home page load
    const cached = getDiaryCache(userName);
    if (cached !== null) {
      // Return cached diary items immediately
      const response: DiaryResponse = { items: cached };
      return NextResponse.json(response);
    }

    // Cache miss — aggregate diary items from all data sources
    const items = await getDiaryItems(userName);

    // Store result in the per-user cache for the next 48 hours
    setDiaryCache(userName, items);

    // Return the assembled diary items
    const response: DiaryResponse = { items };
    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/diary] Error:', error);
    return NextResponse.json({ error: 'Failed to load diary' }, { status: 500 });
  }
}
