// app/api/competitions/[compId]/export-excel/route.ts
// POST /api/competitions/[compId]/export-excel
// Exports the bracket as a downloadable .xlsx file (Admin only).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompetitionById, getCompetitionMatches } from '@/lib/competitions-supabase';
import { hasRole } from '@/lib/role-utils';
import { getAllUsers } from '@/lib/members-supabase';
import { buildBracketWorkbook } from '@/lib/bracket-excel-export';
import type { CompMemberInfo } from '@/types/competitions';
import type { SheetExportConfig } from '@/lib/bracket-excel-export';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Admin only — multi-role aware (an exact compare here denied "Admin,Captain")
    const role = session.user.role || 'Member';
    if (!hasRole(role, 'Admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { compId } = await params;

    const comp = await getCompetitionById(compId);
    if (!comp) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }

    const body = await request.json();
    const config: SheetExportConfig = body.config;
    if (!config || typeof config.rowsPerSlot !== 'number') {
      return NextResponse.json({ error: 'config is required' }, { status: 400 });
    }

    const [matches, allUsers] = await Promise.all([
      getCompetitionMatches(compId),
      getAllUsers(),
    ]);

    const memberInfo = new Map<string, CompMemberInfo>();
    for (const user of allUsers) {
      memberInfo.set(user.userName, {
        username: user.userName,
        fullName: user.fullName,
        handicap: user.handicap ?? null,
        memberType: user.memberType,
      });
    }

    const buffer = await buildBracketWorkbook(comp, matches, memberInfo, config);
    const filename = `${comp.displayName.replace(/[^a-z0-9-_ ]/gi, '').trim() || compId}.xlsx`;

    // Uint8Array is a valid runtime BodyInit; cast needed due to a lib.dom.d.ts /
    // Node type-parameter mismatch (ArrayBufferLike vs ArrayBuffer), not a real issue.
    return new NextResponse(buffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[POST /api/competitions/[compId]/export-excel] Error:', error);
    return NextResponse.json({ error: 'Export failed', detail: String(error) }, { status: 500 });
  }
}
