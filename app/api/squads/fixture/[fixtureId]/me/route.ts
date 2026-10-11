// app/api/squads/fixture/[fixtureId]/me/route.ts
// POST — a squad member's own actions on one fixture:
//   { action: 'unavailable' }  "Can't make this one" (an availability override)
//   { action: 'available' }    undo that
//   { action: 'withdraw' }     picked for a published fixture but can't play — the
//                              managers are emailed to find a replacement

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import {
  getSquadDetail,
  getSquadManagers,
  setSquadFixtureUnavailable,
  withdrawFromSquadFixture,
} from '@/lib/squads-supabase';
import { appendManageLog } from '@/lib/fixture-groups-supabase';
import { getSupabaseClient } from '@/lib/supabase';
import { sendSquadDropOutEmail } from '@/lib/email/squads';
import { clearDiaryCache } from '@/lib/home-cache';

export async function POST(request: NextRequest, { params }: { params: Promise<{ fixtureId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { fixtureId } = await params;
    const me = session.user.userName;

    const { data: fxRow, error } = await getSupabaseClient().from('fixtures').select('group_id').eq('id', fixtureId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!fxRow || !fxRow.group_id) {
      return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
    }
    const detail = await getSquadDetail(fxRow.group_id, me, session.user.role);
    if (!detail) {
      return NextResponse.json({ error: 'Squad not found' }, { status: 404 });
    }
    if (!detail.myEntry || detail.myEntry.status !== 'entered') {
      return NextResponse.json({ error: 'You are not in this squad' }, { status: 403 });
    }
    let fixture = null;
    for (const f of detail.fixtures) {
      if (f.id === fixtureId) fixture = f;
    }
    if (!fixture) {
      return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
    }

    const body = await request.json();
    const label = `${fixture.fixtureType} v ${fixture.opponent}`;

    if (body.action === 'unavailable' || body.action === 'available') {
      await setSquadFixtureUnavailable({ date: fixture.date, time: fixture.time, label }, me, body.action === 'unavailable');
      return NextResponse.json({ success: true });
    }

    if (body.action === 'withdraw') {
      const withdrawn = await withdrawFromSquadFixture(fixtureId, me, me);
      if (!withdrawn) {
        return NextResponse.json({ error: 'You are not picked for this fixture' }, { status: 400 });
      }
      await appendManageLog({ username: me, action: 'squad-drop-out', fixtureId, groupId: detail.group.id, details: { player: me } });
      clearDiaryCache(me);
      try {
        const managers = await getSquadManagers(detail.group.id);
        const appUrl = await getAppUrl();
        await sendSquadDropOutEmail(
          {
            id: fixture.id,
            tabName: fixture.tabName,
            squadLabel: detail.group.label,
            fixtureType: fixture.fixtureType,
            date: fixture.date,
            time: fixture.time,
            opponent: fixture.opponent,
            homeAway: fixture.homeAway,
            format: fixture.format,
          },
          me,
          managers,
          appUrl
        );
      } catch (emailError) {
        console.error('[squads] drop-out email failed:', emailError);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[POST /api/squads/fixture/me] Error:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
