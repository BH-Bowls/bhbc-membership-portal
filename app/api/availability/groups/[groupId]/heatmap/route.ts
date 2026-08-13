// app/api/availability/groups/[groupId]/heatmap/route.ts
// GET — read-only group availability heatmap. No poll/event required — reads the
// member-availability substrate directly over the group's roster.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGroupById, getGroupMembers } from '@/lib/availability-groups-supabase';
import { resolveAvailability, Session } from '@/lib/member-availability';
import { hasRole } from '@/lib/role-utils';

const DEFAULT_WEEKS_AHEAD = 4;
const SESSIONS: Session[] = ['morning', 'afternoon', 'evening'];

function formatUKDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { groupId } = await params;
    const group = await getGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const isCreator = group.createdByUsername === session.user.userName;
    const isAdmin = hasRole(session.user.role, 'Admin');
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const today = new Date();
    const endDateObj = new Date(today);
    endDateObj.setDate(endDateObj.getDate() + DEFAULT_WEEKS_AHEAD * 7);
    const startDate = formatUKDate(today);
    const endDate = formatUKDate(endDateObj);

    const members = await getGroupMembers(groupId);
    // Only member-type rows have a substrate presence — visitors have no username to key on.
    const usernames = members.filter((m) => m.memberType === 'member' && m.userName).map((m) => m.userName);

    const resolved = await resolveAvailability(usernames, startDate, endDate);

    const dates: string[] = [];
    const cursor = new Date(today);
    while (cursor <= endDateObj) {
      dates.push(formatUKDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const rows = dates.map((date) => {
      const cells: Record<Session, { free: number; busy: number; unknown: number }> = {
        morning: { free: 0, busy: 0, unknown: 0 },
        afternoon: { free: 0, busy: 0, unknown: 0 },
        evening: { free: 0, busy: 0, unknown: 0 },
      };
      for (const username of usernames) {
        const userMap = resolved.get(username);
        for (const s of SESSIONS) {
          const status = userMap ? userMap.get(`${date}:${s}`) : undefined;
          if (status === 'free') cells[s].free++;
          else if (status === 'busy_committed' || status === 'busy_personal') cells[s].busy++;
          else cells[s].unknown++;
        }
      }
      return { date, cells };
    });

    return NextResponse.json({ rows, totalMembers: usernames.length });
  } catch (error) {
    console.error('GET /api/availability/groups/[groupId]/heatmap error:', error);
    return NextResponse.json({ error: 'Failed to load heatmap' }, { status: 500 });
  }
}
