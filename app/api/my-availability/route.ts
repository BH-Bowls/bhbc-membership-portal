// app/api/my-availability/route.ts
// GET — the caller's own standard week + upcoming overrides + duties band + max games per day

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getStandardWeek, getOverrides, getCommitments } from '@/lib/member-availability';
import { getUserByUsername } from '@/lib/members-supabase';

const DUTIES_WEEKS_AHEAD = 8;

function formatDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userName = session.user.userName;

    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + DUTIES_WEEKS_AHEAD * 7);

    const [standardWeek, overrides, commitments, user] = await Promise.all([
      getStandardWeek(userName),
      getOverrides(userName, formatDate(today), formatDate(endDate)),
      getCommitments([userName], formatDate(today), formatDate(endDate)),
      getUserByUsername(userName),
    ]);

    const duties = commitments.filter((c) => c.source === 'rota');

    return NextResponse.json({
      standardWeek,
      overrides,
      duties,
      maxGamesPerDay: user?.maxGamesPerDay ?? 2,
    });
  } catch (error) {
    console.error('GET /api/my-availability error:', error);
    return NextResponse.json({ error: 'Failed to load availability' }, { status: 500 });
  }
}
