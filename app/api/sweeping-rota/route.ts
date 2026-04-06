// app/api/sweeping-rota/route.ts
// API route for sweeping rota - GET entries, POST add entries

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getSweepingRotaForDateRange,
  getSweepingRotaList,
  batchAddSweepingAssignments,
} from '@/lib/sweeping-sheets';
import { generatePatternDates, parseDate, formatDate } from '@/lib/sweeping-patterns';
import { AddEntriesRequest, AddEntriesResponse } from '@/lib/types/sweeping';
import { hasRole, isMember } from '@/lib/role-utils';

/**
 * GET /api/sweeping-rota
 * Returns sweeping rota entries for a date range
 * Query params: startDate, endDate (optional, defaults to current month)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    const searchParams = request.nextUrl.searchParams;
    let startDate = searchParams.get('startDate');
    let endDate = searchParams.get('endDate');

    // Default to current month if no dates provided
    if (!startDate || !endDate) {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      startDate = formatDate(firstDay);
      endDate = formatDate(lastDay);
    }

    const entries = await getSweepingRotaForDateRange(startDate, endDate);

    const isAdmin = session
      ? hasRole(session.user.role, 'Admin') || session.user.role === 'superadmin'
      : false;

    return NextResponse.json({
      entries,
      currentUser: session?.user?.userName ?? '',
      isAdmin,
    });
  } catch (error) {
    console.error('[GET /api/sweeping-rota] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sweeping rota' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sweeping-rota
 * Add sweeping assignments (ad-hoc dates or pattern)
 * Body: { dates: string[] } OR { pattern: PatternConfig }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: AddEntriesRequest = await request.json();

    // Validate request
    if (!body.dates && !body.pattern) {
      return NextResponse.json(
        { error: 'Must provide either dates array or pattern configuration' },
        { status: 400 }
      );
    }

    let datesToAdd: string[] = [];

    if (body.pattern) {
      // Generate dates from pattern
      datesToAdd = generatePatternDates(body.pattern);
    } else if (body.dates) {
      datesToAdd = body.dates;
    }

    // Filter out past dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    datesToAdd = datesToAdd.filter(dateStr => {
      const date = parseDate(dateStr);
      return date >= today;
    });

    if (datesToAdd.length === 0) {
      return NextResponse.json({
        success: true,
        addedCount: 0,
        skippedCount: 0,
        results: [],
        message: 'No valid future dates to add',
      });
    }

    // Determine which user to assign to
    let targetUserName = session.user.userName;

    // Non-members can specify a different user
    const isNonMember = !isMember(session.user.role);
    if (isNonMember && body.userName) {
      targetUserName = body.userName;
    }

    // Add assignments
    const result = await batchAddSweepingAssignments(datesToAdd, targetUserName);

    const response: AddEntriesResponse = {
      success: true,
      addedCount: result.added.length,
      skippedCount: result.skipped.length,
      results: [
        ...result.added.map(date => ({ date, status: 'added' as const })),
        ...result.skipped.map(({ date, reason }) => ({
          date,
          status: 'skipped' as const,
          reason,
        })),
      ],
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[POST /api/sweeping-rota] Error:', error);
    return NextResponse.json(
      { error: 'Failed to add sweeping assignments' },
      { status: 500 }
    );
  }
}
