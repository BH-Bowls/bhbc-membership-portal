// app/api/tea-rota/batch/route.ts
// API route for batch updating tea rota assignments
// Saves multiple rows in a single Google Sheets API call

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { batchUpdateTeaRotaAssignments } from '@/lib/friendlies-sheets';

interface BatchUpdateRequest {
  updates: {
    rowNumber: number;
    teaLead: string;
    teaFirst: string;
    teaSecond: string;
  }[];
}

/**
 * PUT /api/tea-rota/batch
 * Batch updates tea rota assignments
 * Only committee members (non-Members) can update
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is committee (non-Member)
    const userRole = session.user.role || 'Member';
    if (userRole === 'Member') {
      return NextResponse.json(
        { error: 'Only committee members can edit tea rota' },
        { status: 403 }
      );
    }

    const body: BatchUpdateRequest = await request.json();
    const { updates } = body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      );
    }

    // Validate each update
    for (const update of updates) {
      if (!update.rowNumber) {
        return NextResponse.json(
          { error: 'Missing rowNumber in update' },
          { status: 400 }
        );
      }
    }

    // Perform batch update
    await batchUpdateTeaRotaAssignments(updates);

    return NextResponse.json({
      success: true,
      updatedCount: updates.length,
    });
  } catch (error) {
    console.error('[PUT /api/tea-rota/batch] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update tea rota' },
      { status: 500 }
    );
  }
}
