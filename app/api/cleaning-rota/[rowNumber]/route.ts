// app/api/cleaning-rota/[rowNumber]/route.ts
// API route to get or update a single cleaning rota entry

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCleaningRotaEntry, updateCleaningRotaAssignment } from '@/lib/cleaning-sheets';

interface UpdateRequest {
  lead: string;
  second: string;
  third: string;
  fourth: string;
}

/**
 * GET /api/cleaning-rota/[rowNumber]
 * Returns a single cleaning rota entry
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
    const rowNum = parseInt(rowNumber, 10);

    if (isNaN(rowNum)) {
      return NextResponse.json({ error: 'Invalid row number' }, { status: 400 });
    }

    const entry = await getCleaningRotaEntry(rowNum);

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    return NextResponse.json({ entry });
  } catch (error) {
    console.error('[GET /api/cleaning-rota/[rowNumber]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entry' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/cleaning-rota/[rowNumber]
 * Updates a single cleaning rota entry
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
        { error: 'Only committee members can edit cleaning rota' },
        { status: 403 }
      );
    }

    const { rowNumber } = await params;
    const rowNum = parseInt(rowNumber, 10);

    if (isNaN(rowNum)) {
      return NextResponse.json({ error: 'Invalid row number' }, { status: 400 });
    }

    const body: UpdateRequest = await request.json();
    const { lead, second, third, fourth } = body;

    await updateCleaningRotaAssignment(rowNum, lead, second, third, fourth);

    const updatedEntry = await getCleaningRotaEntry(rowNum);

    return NextResponse.json({
      success: true,
      entry: updatedEntry,
    });
  } catch (error) {
    console.error('[PUT /api/cleaning-rota/[rowNumber]] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update entry' },
      { status: 500 }
    );
  }
}
