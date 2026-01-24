// app/api/tea-rota/[rowNumber]/route.ts
// API route for updating tea rota assignments
// Only committee members (non-Members) can update

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateTeaRotaAssignment, getTeaRotaEntry } from '@/lib/friendlies-sheets';

interface UpdateRequest {
  teaLead: string;
  teaFirst: string;
  teaSecond: string;
}

/**
 * GET /api/tea-rota/[rowNumber]
 * Returns a single tea rota entry
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ rowNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rowNumber } = await params;
    const rowNum = parseInt(rowNumber);

    if (isNaN(rowNum)) {
      return NextResponse.json(
        { error: 'Invalid row number' },
        { status: 400 }
      );
    }

    const entry = await getTeaRotaEntry(rowNum);

    if (!entry) {
      return NextResponse.json(
        { error: 'Tea rota entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ entry });
  } catch (error) {
    console.error('[GET /api/tea-rota/[rowNumber]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tea rota entry' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/tea-rota/[rowNumber]
 * Updates tea rota assignments for a game
 * Only committee members (non-Members) can update
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ rowNumber: string }> }
) {
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

    const { rowNumber } = await params;
    const rowNum = parseInt(rowNumber);

    if (isNaN(rowNum)) {
      return NextResponse.json(
        { error: 'Invalid row number' },
        { status: 400 }
      );
    }

    const body: UpdateRequest = await request.json();
    const { teaLead, teaFirst, teaSecond } = body;

    // Validate that at least the fields are present (can be empty)
    if (teaLead === undefined || teaFirst === undefined || teaSecond === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: teaLead, teaFirst, teaSecond' },
        { status: 400 }
      );
    }

    // Update the tea assignments
    await updateTeaRotaAssignment(rowNum, teaLead, teaFirst, teaSecond);

    // Fetch the updated entry
    const updatedEntry = await getTeaRotaEntry(rowNum);

    return NextResponse.json({
      success: true,
      entry: updatedEntry,
    });
  } catch (error) {
    console.error('[PUT /api/tea-rota/[rowNumber]] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update tea rota' },
      { status: 500 }
    );
  }
}
