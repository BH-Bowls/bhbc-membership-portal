// app/api/rowland/participants/route.ts
// GET — return all unique clubs across all active/in-progress Rowland comps
// Public (no auth) — the draw is already public

import { NextResponse } from 'next/server';
import { getAllRowlandComps, getRowlandMatches } from '@/lib/rowland-sheets';
import { rowlandTeamDisplayName } from '@/types/rowland';
import type { RowlandCompId } from '@/types/rowland';

export async function GET() {
  try {
    const comps = await getAllRowlandComps();
    const activeComps = comps.filter(
      (c) => c.status === 'In Progress' || c.status === 'Draw Done'
    );

    const clubMap = new Map<string, { clubId: string; clubName: string }>();

    await Promise.all(
      activeComps.map(async (comp) => {
        const matches = await getRowlandMatches(comp.compId as RowlandCompId);
        for (const m of matches) {
          if (m.homeTeam && m.homeTeam.clubId) {
            clubMap.set(m.homeTeam.clubId, {
              clubId: m.homeTeam.clubId,
              clubName: m.homeTeam.clubName,
            });
          }
          if (m.awayTeam && m.awayTeam.clubId) {
            clubMap.set(m.awayTeam.clubId, {
              clubId: m.awayTeam.clubId,
              clubName: m.awayTeam.clubName,
            });
          }
        }
      })
    );

    const clubs = Array.from(clubMap.values()).sort((a, b) =>
      a.clubName.localeCompare(b.clubName)
    );

    return NextResponse.json({ clubs });
  } catch (error) {
    console.error('[rowland/participants] GET error:', error);
    return NextResponse.json({ error: 'Failed to load participants' }, { status: 500 });
  }
}
