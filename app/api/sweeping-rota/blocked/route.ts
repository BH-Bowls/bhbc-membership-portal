// app/api/sweeping-rota/blocked/route.ts
// API route for admin to block days (greenkeeper days)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { batchBlockSweepingDates } from '@/lib/sweeping-sheets';
import { generatePatternDates, parseDate } from '@/lib/sweeping-patterns';
import { BlockDaysRequest, BlockDaysResponse } from '@/lib/types/sweeping';

/**
 * POST /api/sweeping-rota/blocked
 * Block days (admin only)
 * Body: { dates: string[] } OR { pattern: PatternConfig }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Non-members only (Admin, superadmin, Kiosk, etc.)
    if (session.user.role === 'Member') {
      return NextResponse.json({ error: 'Forbidden - Non-members only' }, { status: 403 });
    }

    const body: BlockDaysRequest = await request.json();

    // Validate request
    if (!body.dates && !body.pattern) {
      return NextResponse.json(
        { error: 'Must provide either dates array or pattern configuration' },
        { status: 400 }
      );
    }

    let datesToBlock: string[] = [];

    if (body.pattern) {
      // Generate dates from pattern
      datesToBlock = generatePatternDates(body.pattern);
    } else if (body.dates) {
      datesToBlock = body.dates;
    }

    // Filter out past dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    datesToBlock = datesToBlock.filter(dateStr => {
      const date = parseDate(dateStr);
      return date >= today;
    });

    if (datesToBlock.length === 0) {
      return NextResponse.json({
        success: true,
        blockedCount: 0,
        skippedCount: 0,
        results: [],
        message: 'No valid future dates to block',
      });
    }

    // Block dates
    const result = await batchBlockSweepingDates(datesToBlock);

    const response: BlockDaysResponse = {
      success: true,
      blockedCount: result.blocked.length,
      skippedCount: result.skipped.length,
      results: [
        ...result.blocked.map(date => ({ date, status: 'blocked' as const })),
        ...result.skipped.map(({ date, reason }) => ({
          date,
          status: 'skipped' as const,
          reason,
        })),
      ],
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[POST /api/sweeping-rota/blocked] Error:', error);
    return NextResponse.json(
      { error: 'Failed to block dates' },
      { status: 500 }
    );
  }
}
