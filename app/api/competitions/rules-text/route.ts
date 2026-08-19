// app/api/competitions/rules-text/route.ts
// GET (public) — returns the three shared rules-text blocks (General Rules,
//                Standard Scoring Procedure, Marker Responsibilities)
// PUT (Committee) — updates them
// (Replaces the old /api/competitions/message endpoint — the message field is now
//  the "General Rules" body.)

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { getCompetitionRulesText, setCompetitionRulesText, getAllCompetitions } from '@/lib/competitions-supabase';
import type { Competition } from '@/types/competitions';

// GET returns everything the public rules page needs — the three shared blocks plus
// each competition's own rules — so the page needs only this one (PIN-exempt) endpoint
// and no broader competition data is exposed.
export async function GET() {
  try {
    const [rulesText, competitions] = await Promise.all([
      getCompetitionRulesText(),
      getAllCompetitions(),
    ]);
    const comps = competitions.map((c: Competition) => ({
      compId: c.compId,
      displayName: c.displayName,
      compType: c.compType,
      compDescription: c.compDescription || '',
      extraDescription: c.extraDescription || '',
      markersNotes: c.markersNotes || '',
    }));
    return NextResponse.json({ ...rulesText, competitions: comps });
  } catch (err) {
    console.error('GET /api/competitions/rules-text error:', err);
    return NextResponse.json({ error: 'Failed to load rules text' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user?.role ?? '';
  if (!isCommitteeMember(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

  try {
    await setCompetitionRulesText({
      generalRules: asStr(body.generalRules),
      scoringProcedure: asStr(body.scoringProcedure),
      markerResponsibilities: asStr(body.markerResponsibilities),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/competitions/rules-text error:', err);
    return NextResponse.json({ error: 'Failed to save rules text' }, { status: 500 });
  }
}
