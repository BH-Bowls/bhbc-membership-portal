// app/api/rowland/enter/status/route.ts
// GET ?token=xxx — resolve a Rowland entry access token to its team + payment status.
// Public, no auth — same "lazy token, resolved server-side per request" pattern as
// Friendly game tokens (see Specs/FRIENDLY_TOKEN_AUTH_SPEC.md).

import { NextRequest, NextResponse } from 'next/server';
import { resolveAccessToken } from '@/lib/rowland-entries-supabase';

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    const resolved = await resolveAccessToken(token);
    if (!resolved) {
      return NextResponse.json({ error: 'This link is no longer valid. Please contact BHBC.' }, { status: 404 });
    }

    return NextResponse.json({
      clubName: resolved.entry.clubName,
      trophy: resolved.team.trophy,
      teamNumber: resolved.team.teamNumber,
      contactName: resolved.team.contactName,
      contactPhone: resolved.team.contactPhone,
      contactEmail: resolved.team.contactEmail,
      amountDue: (resolved.entry.amountDuePence / 100).toFixed(2),
      amountReceived: (resolved.entry.amountReceivedPence / 100).toFixed(2),
      paymentStatus: resolved.entry.paymentStatus,
    });
  } catch (error) {
    console.error('[rowland/enter/status] GET error:', error);
    return NextResponse.json({ error: 'Failed to load status' }, { status: 500 });
  }
}
