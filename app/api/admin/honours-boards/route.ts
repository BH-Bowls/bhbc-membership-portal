// app/api/admin/honours-boards/route.ts
// Printed honours board layouts.
// GET  → all boards in display order, plus the shared year and row settings and the saved print
//        style (Admin, Captain, GMC — the roles that edit honours, so they can print the
//        boards too)
// POST → add a board (Admin only)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getConfig } from '@/lib/config-supabase';
import { createHonoursBoard, getHonoursBoards } from '@/lib/honours-boards-supabase';
import { LINE_SPACING_KEY, START_YEAR_KEY, YEARS_PER_SET_KEY, parseLineSpacing } from '@/types/honours-boards';
import type { HonoursBoardInput } from '@/types/honours-boards';
import { STYLE_KEY, parseBoardStyle } from '@/types/honours-board-style';

async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user?.role, 'Admin', 'Captain', 'GMC')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const [boards, config] = await Promise.all([getHonoursBoards(), getConfig()]);
    return NextResponse.json({
      boards,
      startYear: Number(config[START_YEAR_KEY]),
      yearsPerSet: Number(config[YEARS_PER_SET_KEY]),
      lineSpacing: parseLineSpacing(config[LINE_SPACING_KEY]),
      // Nothing saved yet (or a damaged value) gives the default look
      style: parseBoardStyle(config[STYLE_KEY]),
    });
  } catch (error) {
    console.error('[GET /api/admin/honours-boards]', error);
    return NextResponse.json({ error: 'Failed to load honours boards' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = (await request.json()) as HonoursBoardInput;
    const result = await createHonoursBoard(body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ board: result.board });
  } catch (error) {
    console.error('[POST /api/admin/honours-boards]', error);
    return NextResponse.json({ error: 'Failed to add honours board' }, { status: 500 });
  }
}
