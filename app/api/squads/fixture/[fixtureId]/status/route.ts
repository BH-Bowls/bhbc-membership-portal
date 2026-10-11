// app/api/squads/fixture/[fixtureId]/status/route.ts
// POST — a squad's organisers record the outcome of a league / Club Team fixture from
// the squad page (picking and publishing the team are on the friendlies selection page):
//   { action: 'result', result: 'W'|'L'|'D', bhbc_score?, opponent_score? }
//   { action: 'cancel', reason? }
//   { action: 'reinstate' }   undo a result/cancel (back to published)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getFixtureSquad, canManageSquad, setSquadFixtureStatus, type SquadFixtureAction } from '@/lib/squads-supabase';
import { appendManageLog } from '@/lib/fixture-groups-supabase';
import { clearAllDiaryCaches } from '@/lib/home-cache';

const ACTIONS: SquadFixtureAction[] = ['result', 'cancel', 'reinstate'];

function toScore(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(String(value), 10);
  return isNaN(n) ? null : n;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ fixtureId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { fixtureId } = await params;
    const squad = await getFixtureSquad(fixtureId);
    if (!squad) {
      return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
    }
    if (!(await canManageSquad(squad.groupId, session.user.userName, session.user.role))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const action = body.action as SquadFixtureAction;
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    let newStatus: string;
    try {
      newStatus = await setSquadFixtureStatus(fixtureId, action, session.user.userName, {
        result: body.result,
        bhbcScore: toScore(body.bhbc_score),
        opponentScore: toScore(body.opponent_score),
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
    } catch (statusError) {
      return NextResponse.json({ error: statusError instanceof Error ? statusError.message : 'Failed' }, { status: 400 });
    }
    await appendManageLog({ username: session.user.userName, action: `squad-${action}`, fixtureId, groupId: squad.groupId, newStatus });
    // Played / cancelled changes what members' diaries show
    clearAllDiaryCaches();
    return NextResponse.json({ success: true, newStatus });
  } catch (error) {
    console.error('[POST /api/squads/fixture/status] Error:', error);
    return NextResponse.json({ error: 'Failed to update fixture' }, { status: 500 });
  }
}
