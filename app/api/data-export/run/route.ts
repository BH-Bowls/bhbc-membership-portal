// app/api/data-export/run/route.ts
// POST: Execute a report definition, write results to ReportOutput tab (Admin only)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { executeReport } from '@/lib/data-export';
import { ReportDefinition } from '@/lib/types/data-export';

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const definition: ReportDefinition = body.definition;

    const hasColumns =
      (definition.columnOrder && definition.columnOrder.length > 0) ||
      definition.selectedColumns?.length > 0;
    if (!definition || !definition.primarySheet || !hasColumns) {
      return NextResponse.json(
        { error: 'Invalid report definition: primarySheet and selectedColumns are required' },
        { status: 400 }
      );
    }

    const result = await executeReport(definition);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error executing report:', error);
    const message = error instanceof Error ? error.message : 'Failed to execute report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
