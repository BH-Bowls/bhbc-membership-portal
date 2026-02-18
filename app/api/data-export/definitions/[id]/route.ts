// app/api/data-export/definitions/[id]/route.ts
// GET: Load a full definition by ID
// DELETE: Remove a definition (Admin only)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefinition, deleteDefinition } from '@/lib/data-export';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 }
      );
    }

    if (session.user?.role !== 'Admin') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const definition = await getDefinition(id);

    if (!definition) {
      return NextResponse.json(
        { error: 'Definition not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(definition);
  } catch (error) {
    console.error('Error getting definition:', error);
    return NextResponse.json(
      { error: 'Failed to get definition' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 }
      );
    }

    if (session.user?.role !== 'Admin') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const deleted = await deleteDefinition(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Definition not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting definition:', error);
    return NextResponse.json(
      { error: 'Failed to delete definition' },
      { status: 500 }
    );
  }
}
