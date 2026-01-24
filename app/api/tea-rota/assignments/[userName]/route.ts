// app/api/tea-rota/assignments/[userName]/route.ts
// API route to get all tea assignments for a specific user
// Used when swapping to see which assignments the other user has

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTeaRotaList } from '@/lib/friendlies-sheets';

interface TeaAssignment {
  rowNumber: number;
  displayDate: string;
  time: string;
  clubName: string;
  position: 'teaLead' | 'teaFirst' | 'teaSecond';
  positionLabel: string;
}

/**
 * GET /api/tea-rota/assignments/[userName]
 * Returns all tea assignments for the specified user
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

    // Get all tea rota entries
    const entries = await getTeaRotaList();

    // Find all assignments for this user
    const assignments: TeaAssignment[] = [];

    const positionLabels: Record<string, string> = {
      teaLead: 'Tea Lead',
      teaFirst: 'Tea First',
      teaSecond: 'Tea Second',
    };

    for (const entry of entries) {
      if (entry.teaLead === decodedUserName) {
        assignments.push({
          rowNumber: entry.rowNumber,
          displayDate: entry.displayDate,
          time: entry.time,
          clubName: entry.clubName,
          position: 'teaLead',
          positionLabel: positionLabels.teaLead,
        });
      }
      if (entry.teaFirst === decodedUserName) {
        assignments.push({
          rowNumber: entry.rowNumber,
          displayDate: entry.displayDate,
          time: entry.time,
          clubName: entry.clubName,
          position: 'teaFirst',
          positionLabel: positionLabels.teaFirst,
        });
      }
      if (entry.teaSecond === decodedUserName) {
        assignments.push({
          rowNumber: entry.rowNumber,
          displayDate: entry.displayDate,
          time: entry.time,
          clubName: entry.clubName,
          position: 'teaSecond',
          positionLabel: positionLabels.teaSecond,
        });
      }
    }

    return NextResponse.json({
      userName: decodedUserName,
      assignments,
      count: assignments.length,
    });
  } catch (error) {
    console.error('[GET /api/tea-rota/assignments/[userName]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch assignments' },
      { status: 500 }
    );
  }
}
