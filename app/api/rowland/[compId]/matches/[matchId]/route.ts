// app/api/rowland/[compId]/matches/[matchId]/route.ts
// PATCH — update players, score, status for a match

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getRowlandMatches,
  updateRowlandMatch,
  propagateRowlandWinnerForMatch,
} from '@/lib/rowland-sheets';
import { getEmailTransporter, isEmailConfigured } from '@/lib/email/mailer';
import type { RowlandCompId, RowlandMatch } from '@/types/rowland';
import { ROWLAND_COMP_NAMES, ROWLAND_ROUND_LABELS } from '@/types/rowland';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ compId: string; matchId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const BHBC_CLUB_ID = 'burgess.hill';

    const role = session.user.role;
    const roles = role ? role.split(',').map((r: string) => r.trim()) : [];
    const isClub = role === 'Club';
    const isRowlandPlayer = roles.includes('RowlandPlayer');
    // RowlandPlayer acts like a club (restricted to BHBC matches)
    const isCommittee = !isClub && !isRowlandPlayer && role !== 'Member' && role !== '';

    if (!isCommittee && !isClub && !isRowlandPlayer) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { compId, matchId } = await params;
    const body = await req.json();

    // Team assignment is committee-only
    if ((body.homeTeam !== undefined || body.awayTeam !== undefined) && !isCommittee) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // For clubs and RowlandPlayer, verify their club is a participant in the match
    if (isClub || isRowlandPlayer) {
      const clubId = isRowlandPlayer ? BHBC_CLUB_ID : session.user.clubId;
      const matches = await getRowlandMatches(compId as RowlandCompId);
      const match = matches.find((m) => m.matchId === matchId);
      if (!match) {
        return NextResponse.json({ error: 'Match not found' }, { status: 404 });
      }
      if (match.homeTeam?.clubId !== clubId && match.awayTeam?.clubId !== clubId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    await updateRowlandMatch(compId as RowlandCompId, matchId, body);

    // Propagate winner to the next round placeholder when a result is determined
    const shouldPropagate =
      body.status === 'Played' ||
      body.status === 'Walkover' ||
      body.status === 'Bye';

    if (shouldPropagate) {
      try {
        const allMatches = await getRowlandMatches(compId as RowlandCompId);
        const updatedMatch = allMatches.find((m) => m.matchId === matchId);
        if (updatedMatch) {
          await propagateRowlandWinnerForMatch(compId as RowlandCompId, updatedMatch);
        }
      } catch (err) {
        // Non-fatal: log but don't fail the request
        console.error('[rowland/propagate] Error:', err);
      }
    }

    // Send result notification email when a result is submitted
    if (shouldPropagate && (body.status === 'Played' || body.status === 'Walkover')) {
      try {
        const allMatchesForEmail = await getRowlandMatches(compId as RowlandCompId);
        const updatedMatchForEmail = allMatchesForEmail.find((m) => m.matchId === matchId);
        if (updatedMatchForEmail) {
          await sendRowlandResultEmail(compId, updatedMatchForEmail);
        }
      } catch (err) {
        console.error('[rowland/result-email] Error:', err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[rowland/matches/matchId] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update match' }, { status: 500 });
  }
}

async function sendRowlandResultEmail(compId: string, match: RowlandMatch): Promise<void> {
  if (!isEmailConfigured()) return;

  const compName = ROWLAND_COMP_NAMES[compId as RowlandCompId] ?? compId;
  const roundLabel = ROWLAND_ROUND_LABELS[match.round] ?? match.round;

  const homeName = match.homeTeam
    ? (match.homeTeam.teamLetter ? `${match.homeTeam.clubName} ${match.homeTeam.teamLetter}` : match.homeTeam.clubName)
    : 'TBD';
  const awayName = match.awayTeam
    ? (match.awayTeam.teamLetter ? `${match.awayTeam.clubName} ${match.awayTeam.teamLetter}` : match.awayTeam.clubName)
    : 'TBD';

  let resultLine: string;
  if (match.status === 'Walkover') {
    const winnerName = match.winnerSide === 1 ? homeName : awayName;
    resultLine = `${winnerName} advances by walkover`;
  } else {
    resultLine = `${homeName} ${match.homeScore ?? '?'} – ${match.awayScore ?? '?'} ${awayName}`;
  }

  const homePlayers = match.homePlayers.filter(Boolean);
  const awayPlayers = match.awayPlayers.filter(Boolean);

  const playersHtml = (homePlayers.length || awayPlayers.length)
    ? `<p style="margin:8px 0 4px;font-size:13px;color:#555;">
        <strong>${homeName}:</strong> ${homePlayers.length ? homePlayers.join(', ') : '—'}<br>
        <strong>${awayName}:</strong> ${awayPlayers.length ? awayPlayers.join(', ') : '—'}
       </p>`
    : '';

  const scoreSheetHtml = match.scoreSheetUrl
    ? `<p style="margin:12px 0 4px;font-size:13px;"><a href="${match.scoreSheetUrl}" style="color:#2563eb;">View score sheet image</a></p>`
    : '';

  const playedDateHtml = match.playedDate
    ? `<p style="margin:4px 0;font-size:13px;color:#555;">Played: ${match.playedDate}</p>`
    : '';

  const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
  <h2 style="font-size:18px;margin-bottom:4px;">Rowland Cup Result</h2>
  <p style="margin:0 0 12px;font-size:13px;color:#555;">${compName} — ${roundLabel}</p>
  <p style="font-size:16px;font-weight:bold;margin:0 0 8px;">${resultLine}</p>
  ${playedDateHtml}
  ${playersHtml}
  ${scoreSheetHtml}
</div>`;

  const transporter = getEmailTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: 'burgesshillbc@gmail.com',
    subject: `Rowland Cup Result: ${compName} ${roundLabel} — ${homeName} vs ${awayName}`,
    html,
  });
}
