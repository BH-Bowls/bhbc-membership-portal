// app/api/competitions/[compId]/export-sheet/route.ts
// POST /api/competitions/[compId]/export-sheet
// Exports the bracket to a Google Sheet tab (Admin only).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompetitionById, getCompetitionMatches } from '@/lib/competitions-sheets';
import { getAllUsers } from '@/lib/sheets';
import { exportBracketToSheet } from '@/lib/sheet-export';
import type { CompMemberInfo } from '@/types/competitions';
import type { SheetExportConfig } from '@/lib/sheet-export';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role || 'Member';
    if (role !== 'Admin') {
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

    const result = await exportBracketToSheet(compId, comp, matches, memberInfo, config);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[POST /api/competitions/[compId]/export-sheet] Error:', error);
    return NextResponse.json({ error: 'Export failed', detail: String(error) }, { status: 500 });
  }
}
