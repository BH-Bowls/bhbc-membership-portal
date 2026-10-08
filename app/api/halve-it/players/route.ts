// app/api/halve-it/players/route.ts
// Halve It team (Darts role / Admin).
// GET  — members who can be added to a team (name + username).
// POST — add a member to a season's team.

import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/halveit-auth';
import { getAllUsers } from '@/lib/members-supabase';
import { addPlayer } from '@/lib/halveit-supabase';

export async function GET() {
  const denied = await requireManager();
  if (denied) return denied;
  try {
    const users = await getAllUsers();
    const members = users
      .filter((u) => u.memberType) // skip shared accounts (Kiosk/Captain)
      .map((u) => ({ value: u.userName, label: `${u.knownAs || u.firstName} ${u.lastName}`.trim() }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return NextResponse.json({ members });
  } catch (error) {
    console.error('[GET /api/halve-it/players]', error);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireManager();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { season: number; userName: string };
    if (!Number.isInteger(body.season) || !body.userName) return NextResponse.json({ error: 'Season and member are required' }, { status: 400 });
    const result = await addPlayer(body.season, body.userName);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ player: result.player });
  } catch (error) {
    console.error('[POST /api/halve-it/players]', error);
    return NextResponse.json({ error: 'Failed to add player' }, { status: 500 });
  }
}
