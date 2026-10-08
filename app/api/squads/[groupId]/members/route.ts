// app/api/squads/[groupId]/members/route.ts
// POST { action: 'join' | 'leave', username? }
//   Without username: the caller joins/leaves themselves (league squads are self-entry).
//   With a username: a squad manager (or Captain/Admin) adds/removes someone else.
// Leaving clears the leaver's tea slots and picks on upcoming fixtures, and the managers
// are emailed about any that now need someone else.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import {
  getSquadGroup,
  canManageSquad,
  getSquadManagers,
  joinSquad,
  leaveSquad,
  checkSquadEligibility,
} from '@/lib/squads-supabase';
import { appendManageLog } from '@/lib/fixture-groups-supabase';
import { sendSquadLeaverEmail } from '@/lib/email/squads';

export async function POST(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { groupId } = await params;
    const group = await getSquadGroup(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Squad not found' }, { status: 404 });
    }

    const body = await request.json();
    const action = body.action;
    const caller = session.user.userName;
    const target = typeof body.username === 'string' && body.username ? body.username : caller;
    const onBehalf = target !== caller;
    const isManager = await canManageSquad(groupId, caller, session.user.role);

    if (onBehalf && !isManager) {
      return NextResponse.json({ error: 'Only the squad managers can change other members' }, { status: 403 });
    }
    if (!onBehalf && group.entryMode !== 'self' && !isManager) {
      return NextResponse.json({ error: 'The squad manager picks this squad' }, { status: 403 });
    }

    if (action === 'join') {
      const problem = await checkSquadEligibility(groupId, target);
      if (problem && !(onBehalf && body.confirm === true)) {
        // Players are refused; a manager is asked to confirm first
        return NextResponse.json(
          onBehalf
            ? { success: false, needsConfirmation: true, message: `${target} is ${problem}. Add anyway?` }
            : { error: `You are ${problem}` },
          { status: onBehalf ? 200 : 400 }
        );
      }
      const result = await joinSquad(groupId, target, caller, onBehalf);
      await appendManageLog({ username: caller, action: onBehalf ? 'squad-add' : 'squad-join', groupId, details: { player: target, result } });
      return NextResponse.json({ success: true, result });
    }

    if (action === 'leave') {
      const { clearedTeas, droppedPicks } = await leaveSquad(groupId, target, caller);
      await appendManageLog({
        username: caller,
        action: onBehalf ? 'squad-remove' : 'squad-leave',
        groupId,
        details: { player: target, clearedTeas: clearedTeas.length, droppedPicks: droppedPicks.length },
      });
      try {
        const managers = await getSquadManagers(groupId);
        const appUrl = await getAppUrl();
        await sendSquadLeaverEmail(group.label, target, clearedTeas, droppedPicks, managers.filter(m => m !== caller), appUrl, groupId);
      } catch (emailError) {
        console.error('[squads] leaver email failed:', emailError);
      }
      return NextResponse.json({ success: true, clearedTeas: clearedTeas.length, droppedPicks: droppedPicks.length });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[POST /api/squads/[groupId]/members] Error:', error);
    return NextResponse.json({ error: 'Failed to update squad' }, { status: 500 });
  }
}
