// app/api/data-export/export/route.ts
// POST: Execute a report definition (full result set, not just the 10-row preview)
// and return it as a downloadable .xlsx file (Admin only).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { executeReport, buildWorkbook } from '@/lib/data-export';
import { ReportDefinition } from '@/lib/types/data-export';
import { hasRole } from '@/lib/role-utils';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized - Please log in' }, { status: 401 });
    }

    if (!hasRole(session.user?.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
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

    const { headers, rows } = await executeReport(definition);
    const buffer = await buildWorkbook(headers, rows, definition.name || 'Report');

    const filename = `${(definition.name || 'data-export').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'data-export'}.xlsx`;

    // Uint8Array is a valid runtime BodyInit; cast needed due to a lib.dom.d.ts /
    // Node type-parameter mismatch (ArrayBufferLike vs ArrayBuffer) between TS versions.
    return new NextResponse(buffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error exporting report:', error);
    const message = error instanceof Error ? error.message : 'Failed to export report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
