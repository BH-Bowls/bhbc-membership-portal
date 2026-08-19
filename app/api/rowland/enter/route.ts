// app/api/rowland/enter/route.ts
// GET  — form setup data (club list, fee, deadline). Public.
// POST — submit a club's team entries. Public, no auth — same honeypot + IP rate
// limiting pattern as /api/apply.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember, hasRole } from '@/lib/role-utils';
import { getClubs } from '@/lib/clubs-supabase';
import {
  submitRowlandEntry,
  getRowlandEntryFeePence,
  getRowlandEntryDeadline,
  getRowlandEntrySeason,
  createAccessToken,
  type TeamEntryInput,
  type RowlandTrophy,
} from '@/lib/rowland-entries-supabase';
import { isEmailConfigured, getEmailTransporter } from '@/lib/email/mailer';
import { formatOrdinalDate } from '@/lib/date-utils';
import { processEmailTemplate } from '@/lib/email/template-processor';
import { readFileSync } from 'fs';
import { join } from 'path';
import Handlebars from 'handlebars';
import { getAppUrl } from '@/lib/app-url';

// Rate limiting - simple in-memory store, same pattern as /api/apply
const submissionTimes: Map<string, number> = new Map();
const RATE_LIMIT_MINUTES = 5;

// Same club contact address application-mailer.ts uses for "questions about this" lines.
const CLUB_EMAIL = 'burgesshillbc@gmail.com';

interface EnterRequestBody {
  clubName: string;
  edwardTeams: number;
  gladysTeams: number;
  teams: {
    trophy: RowlandTrophy;
    teamNumber: 1 | 2;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
  }[];
  consentToPublish: boolean;
  // Honeypot field - should be empty
  website?: string;
}

export async function GET() {
  try {
    const [clubs, feePence, deadline] = await Promise.all([
      getClubs(),
      getRowlandEntryFeePence(),
      getRowlandEntryDeadline(),
    ]);

    return NextResponse.json({
      clubs: clubs.map((c) => c.clubName),
      feePerTeam: feePence / 100,
      deadline,
    });
  } catch (error) {
    console.error('[rowland/enter] GET error:', error);
    return NextResponse.json({ error: 'Failed to load entry form data' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const data: EnterRequestBody = await request.json();

    // Honeypot check - if website field is filled, it's likely a bot
    if (data.website) {
      console.log('[rowland/enter] Honeypot triggered - rejecting submission');
      return NextResponse.json({ success: true });
    }

    // Rate limiting by IP — skipped for a logged-in committee session, since the
    // 5-minute cooldown exists to slow down anonymous abuse, not to get in the way of
    // an admin entering several clubs' details back-to-back (e.g. phoned in) from the
    // same office IP.
    const session = await getServerSession(authOptions);
    const isCommitteeSession = !!session?.user?.userName &&
      (isCommitteeMember(session.user.role) || hasRole(session.user.role, 'RowlandOrganiser'));

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const lastSubmission = submissionTimes.get(ip);
    const now = Date.now();
    if (!isCommitteeSession && lastSubmission && (now - lastSubmission) < RATE_LIMIT_MINUTES * 60 * 1000) {
      return NextResponse.json(
        { error: 'Please wait a few minutes before submitting another entry' },
        { status: 429 }
      );
    }

    // Validate required fields
    const errors: string[] = [];
    if (!data.clubName?.trim()) errors.push('Club is required');
    if (!Array.isArray(data.teams) || data.teams.length === 0) {
      errors.push('At least one team is required');
    }
    if (!data.consentToPublish) {
      errors.push('You must agree to your contact details being shared with opponent clubs');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const team of data.teams || []) {
      const label = `${team.trophy === 'edward' ? 'Edward' : 'Gladys'} team ${team.teamNumber}`;
      if (!team.contactName?.trim()) errors.push(`${label}: contact name is required`);
      if (!team.contactPhone?.trim()) errors.push(`${label}: contact phone is required`);
      if (!team.contactEmail?.trim()) errors.push(`${label}: contact email is required`);
      if (team.contactEmail && !emailRegex.test(team.contactEmail)) {
        errors.push(`${label}: please enter a valid email address`);
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(', ') }, { status: 400 });
    }

    // Confirm the club is real — the form only ever offers clubs from the directory,
    // but never trust that client-side restriction alone.
    const clubs = await getClubs();
    const club = clubs.find((c) => c.clubName === data.clubName);
    if (!club) {
      return NextResponse.json({ error: 'Please select a club from the list' }, { status: 400 });
    }

    const season = await getRowlandEntrySeason();
    const teamsInput: TeamEntryInput[] = data.teams.map((t) => ({
      trophy: t.trophy,
      teamNumber: t.teamNumber,
      contactName: t.contactName.trim(),
      contactPhone: t.contactPhone.trim(),
      contactEmail: t.contactEmail.trim(),
    }));

    const result = await submitRowlandEntry({
      clubName: data.clubName,
      season,
      consentToPublish: data.consentToPublish,
      teams: teamsInput,
    });

    console.log(`[rowland/enter] Entry saved for ${data.clubName} (${teamsInput.length} team(s))`);

    // Update rate limit tracker
    submissionTimes.set(ip, now);

    // Create an access token per team, and send one confirmation email per unique
    // contact address, listing every team that address is the contact for.
    if (isEmailConfigured()) {
      try {
        const deadline = await getRowlandEntryDeadline();
        const expiresAt = new Date(deadline || Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        const appUrl = await getAppUrl();

        const teamsWithTokens = await Promise.all(
          result.teams.map(async (team) => ({
            team,
            token: await createAccessToken(team.id, expiresAt),
          }))
        );

        const byEmail = new Map<string, typeof teamsWithTokens>();
        for (const entry of teamsWithTokens) {
          const key = entry.team.contactEmail.toLowerCase();
          const existing = byEmail.get(key) || [];
          existing.push(entry);
          byEmail.set(key, existing);
        }

        const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', 'rowland-entry-confirmation.html');
        const templateSource = readFileSync(templatePath, 'utf-8');
        const template = Handlebars.compile(templateSource);
        const transporter = getEmailTransporter();

        for (const [email, entries] of byEmail) {
          const teamLines = entries.map(({ team, token }) => ({
            trophyLabel: team.trophy === 'edward' ? 'Edward' : 'Gladys',
            teamNumber: team.teamNumber,
            statusUrl: `${appUrl}/rowland/enter/status?token=${token}`,
          }));

          const html = template({
            contactName: entries[0].team.contactName,
            clubName: data.clubName,
            teams: teamLines,
            amountDue: (result.amountDuePence / 100).toFixed(2),
            paymentReference: result.paymentReference,
            deadline: deadline ? formatOrdinalDate(deadline) : '',
            contactEmail: CLUB_EMAIL,
          });
          const processedHtml = processEmailTemplate(html);

          await transporter.sendMail({
            from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
            to: email,
            subject: `Rowland Cup Entry — ${data.clubName}`,
            html: processedHtml,
          });
        }

        console.log(`[rowland/enter] Confirmation email(s) sent for ${data.clubName}`);
      } catch (emailErr) {
        // Log but don't fail the submission — the entry itself already saved successfully.
        console.error('[rowland/enter] Error sending confirmation email:', emailErr);
      }
    }

    return NextResponse.json({
      success: true,
      amountDue: (result.amountDuePence / 100).toFixed(2),
      paymentReference: result.paymentReference,
    });
  } catch (error) {
    console.error('[rowland/enter] POST error:', error);
    return NextResponse.json({ error: 'Failed to submit entry. Please try again.' }, { status: 500 });
  }
}
