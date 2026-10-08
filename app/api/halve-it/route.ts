// app/api/halve-it/route.ts
// Halve It darts league.
// GET — everything for one season: team, nights, scores, settings. The season is
//       ?season=YYYY, or the season of ?player=ID / ?night=ID, or the current one.
//       Draft nights are only included for the Darts role / Admin.

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/halveit-auth';
import { currentSeason, getNight, getPlayerSeason, getSeasonData } from '@/lib/halveit-supabase';

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if ('denied' in auth) return auth.denied;
  try {
    const params = request.nextUrl.searchParams;
    let season: number | null = null;
    if (params.get('season')) {
      season = parseInt(params.get('season') as string);
      if (!Number.isInteger(season)) return NextResponse.json({ error: 'Invalid season' }, { status: 400 });
    } else if (params.get('player')) {
      season = await getPlayerSeason(params.get('player') as string);
      if (season === null) return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    } else if (params.get('night')) {
      const night = await getNight(params.get('night') as string);
      if (!night || (night.status !== 'final' && !auth.canManage)) return NextResponse.json({ error: 'Night not found' }, { status: 404 });
      season = night.season;
    }
    const data = await getSeasonData(season ?? currentSeason(), auth.canManage);
    return NextResponse.json({ ...data, canManage: auth.canManage });
  } catch (error) {
    console.error('[GET /api/halve-it]', error);
    return NextResponse.json({ error: 'Failed to load Halve It' }, { status: 500 });
  }
}
