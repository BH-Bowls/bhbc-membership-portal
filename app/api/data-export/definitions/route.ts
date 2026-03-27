// app/api/data-export/definitions/route.ts
// GET: List all saved definitions (summary)
// POST: Save or update a definition (Admin only)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listDefinitions, saveDefinition } from '@/lib/data-export';
import { hasRole } from '@/lib/role-utils';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 }
      );
    }

    if (!hasRole(session.user?.role, 'Admin')) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const definitions = await listDefinitions();
    return NextResponse.json({ definitions });
  } catch (error) {
    console.error('Error listing definitions:', error);
    return NextResponse.json(
      { error: 'Failed to list definitions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 }
      );
    }

    if (!hasRole(session.user?.role, 'Admin')) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();

    if (!body.name || !body.definition) {
      return NextResponse.json(
        { error: 'name and definition are required' },
        { status: 400 }
      );
    }

    const result = await saveDefinition(body.name, body.definition, body.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error saving definition:', error);
    const message = error instanceof Error ? error.message : 'Failed to save definition';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
