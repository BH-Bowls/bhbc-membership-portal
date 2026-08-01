// app/api/diary/route.ts
// GET /api/diary — returns upcoming diary items for the logged-in member.
// Auth: session required. Uses per-user diary cache (48-hour TTL).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDiaryCache, setDiaryCache } from '@/lib/home-cache';
import { getDiaryItems, getTodayIso } from '@/lib/diary-sheets';
import type { DiaryItem, DiaryResponse } from '@/types/diary';

// Drop items whose date is before today. The per-user diary is cached for up to 48h,
// so a cached list can still contain an item that has since passed — filtering here
// guarantees passed items never show, whatever the cache age. Undated "pinned" items
// (e.g. the admin applications banner) carry today's date, so they survive.
function keepUpcoming(items: DiaryItem[], todayStr: string): DiaryItem[] {
  return items.filter((item) => !item.date || item.date >= todayStr);
}

// GET handler — returns diary items for the current user
export async function GET() {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userName = session.user.userName;
    const todayStr = getTodayIso();

    // Check the per-user diary cache — avoids multiple Sheets calls per home page load
    const cached = getDiaryCache(userName);
    if (cached !== null) {
      // Filter at serve time so a passed item can't linger in a still-valid cache
      const response: DiaryResponse = { items: keepUpcoming(cached, todayStr) };
      return NextResponse.json(response);
    }

    // Cache miss — aggregate diary items from all data sources
    const items = await getDiaryItems(userName);

    // Store result in the per-user cache for the next 48 hours
    setDiaryCache(userName, items);

    // Return the assembled diary items (filtered to upcoming, matching the cache path)
    const response: DiaryResponse = { items: keepUpcoming(items, todayStr) };
    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/diary] Error:', error);
    return NextResponse.json({ error: 'Failed to load diary' }, { status: 500 });
  }
}
