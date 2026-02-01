// app/api/cleaning-rota/assignments/[userName]/route.ts
// API route to get all cleaning assignments for a specific user

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCleaningRotaList } from '@/lib/cleaning-sheets';
import { CleaningPosition } from '@/lib/types/cleaning';

interface CleaningAssignment {
  rowNumber: number;
  displayDate: string;
  position: CleaningPosition;
  positionLabel: string;
}

/**
 * GET /api/cleaning-rota/assignments/[userName]
 * Returns all cleaning assignments for the specified user
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userName: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userName } = await params;
    const decodedUserName = decodeURIComponent(userName);

    // Get all cleaning rota entries
    const entries = await getCleaningRotaList();

    // Find all assignments for this user
    const assignments: CleaningAssignment[] = [];

    const positionLabels: Record<CleaningPosition, string> = {
      lead: 'Lead',
      second: 'Second',
      third: 'Third',
      fourth: 'Fourth',
    };

    for (const entry of entries) {
      if (entry.lead === decodedUserName) {
        assignments.push({
          rowNumber: entry.rowNumber,
          displayDate: entry.displayDate,
          position: 'lead',
          positionLabel: positionLabels.lead,
        });
      }
      if (entry.second === decodedUserName) {
        assignments.push({
          rowNumber: entry.rowNumber,
          displayDate: entry.displayDate,
          position: 'second',
          positionLabel: positionLabels.second,
        });
      }
      if (entry.third === decodedUserName) {
        assignments.push({
          rowNumber: entry.rowNumber,
          displayDate: entry.displayDate,
          position: 'third',
          positionLabel: positionLabels.third,
        });
      }
      if (entry.fourth === decodedUserName) {
        assignments.push({
          rowNumber: entry.rowNumber,
          displayDate: entry.displayDate,
          position: 'fourth',
          positionLabel: positionLabels.fourth,
        });
      }
    }

    return NextResponse.json({
      userName: decodedUserName,
      assignments,
      count: assignments.length,
    });
  } catch (error) {
    console.error('[GET /api/cleaning-rota/assignments/[userName]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch assignments' },
      { status: 500 }
    );
  }
}
