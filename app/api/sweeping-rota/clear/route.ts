// app/api/sweeping-rota/clear/route.ts
// API route for non-members to clear days (remove assignments or unblock)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { batchClearSweepingEntries } from '@/lib/sweeping-sheets';
import { generatePatternDates, parseDate } from '@/lib/sweeping-patterns';
import { ClearDaysRequest, ClearDaysResponse } from '@/lib/types/sweeping';

/**
 * POST /api/sweeping-rota/clear
 * Clear days (non-members only)
 * Body: { dates: string[] } OR { pattern: PatternConfig }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: ClearDaysRequest = await request.json();

    // Validate request
    if (!body.dates && !body.pattern) {
      return NextResponse.json(
        { error: 'Must provide either dates array or pattern configuration' },
        { status: 400 }
      );
    }

    let datesToClear: string[] = [];

    if (body.pattern) {
      // Generate dates from pattern
      datesToClear = generatePatternDates(body.pattern);
    } else if (body.dates) {
      datesToClear = body.dates;
    }

    // Filter out past dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    datesToClear = datesToClear.filter(dateStr => {
      const date = parseDate(dateStr);
      return date >= today;
    });

    if (datesToClear.length === 0) {
      return NextResponse.json({
        success: true,
        clearedCount: 0,
        skippedCount: 0,
        results: [],
        message: 'No valid future dates to clear',
      });
    }

    // Clear dates
    const result = await batchClearSweepingEntries(datesToClear);

    const response: ClearDaysResponse = {
      success: true,
      clearedCount: result.cleared.length,
      skippedCount: result.skipped.length,
      results: [
        ...result.cleared.map(date => ({ date, status: 'cleared' as const })),
        ...result.skipped.map(({ date, reason }) => ({
          date,
          status: 'skipped' as const,
          reason,
        })),
      ],
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[POST /api/sweeping-rota/clear] Error:', error);
    return NextResponse.json(
      { error: 'Failed to clear dates' },
      { status: 500 }
    );
  }
}
