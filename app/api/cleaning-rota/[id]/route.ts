// app/api/cleaning-rota/[id]/route.ts
// API route to get or update a single cleaning rota entry

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCleaningRotaEntry, updateCleaningRotaAssignment } from '@/lib/cleaning-rota-supabase';

interface UpdateRequest {
  lead: string;
  second: string;
  third: string;
  fourth: string;
}

/**
 * GET /api/cleaning-rota/[id]
 * Returns a single cleaning rota entry
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const entry = await getCleaningRotaEntry(id);

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    return NextResponse.json({ entry });
  } catch (error) {
    console.error('[GET /api/cleaning-rota/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entry' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/cleaning-rota/[id]
 * Updates a single cleaning rota entry
 * Only committee members (non-Members) can update
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;

    const body: UpdateRequest = await request.json();
    const { lead, second, third, fourth } = body;

    await updateCleaningRotaAssignment(id, lead, second, third, fourth);

    const updatedEntry = await getCleaningRotaEntry(id);

    return NextResponse.json({
      success: true,
      entry: updatedEntry,
    });
  } catch (error) {
    console.error('[PUT /api/cleaning-rota/[id]] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update entry' },
      { status: 500 }
    );
  }
}
