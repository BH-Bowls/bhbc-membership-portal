// app/api/admin/members/route.ts
// GET  /api/admin/members — list active members (lookup / archive list).
// POST /api/admin/members — manually create a new member.
// Auth: Admin role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllUsers } from '@/lib/sheets';
import { createMember } from '@/lib/members-admin';
import { sendWelcomeEmail } from '@/lib/email/application-mailer';

// GET handler — returns a trimmed list of active members
export async function GET() {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admins may view the member list for archiving
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Read all active members and surface only the fields the archive list needs
    const users = await getAllUsers();
    const members = users.map((user) => {
      return {
        userName: user.userName,
        firstName: user.firstName,
        lastName: user.lastName,
        knownAs: user.knownAs || '',
        memberType: user.memberType,
        yearStarted: user.yearStarted,
        emailAddress: user.emailAddress || '',
        // Extra fields for the email-inclusion page filters
        include: user.include || '',
        ageDemographic: user.ageDemographic || '',
        honorary: user.honorary || '',
        role: user.role || '',
        gmc: user.gmc || '',
      };
    });

    return NextResponse.json({ members });
  } catch (error) {
    console.error('[GET /api/admin/members] Error:', error);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }
}

// Valid gender and membership type values for create
const VALID_GENDERS = ['M', 'F'];
const VALID_MEMBER_TYPES = ['Playing', 'Social'];
const VALID_AGE_DEMOGRAPHICS = ['U18', '18-24', '25-59', '60+', '80+'];

// POST handler — creates a new member; optionally emails their login details
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();

    // Validate the required fields
    const errors: string[] = [];
    if (!body.firstName || !String(body.firstName).trim()) errors.push('First name is required');
    if (!body.lastName || !String(body.lastName).trim()) errors.push('Last name is required');
    if (!VALID_GENDERS.includes(body.gender)) errors.push('Gender must be M or F');
    if (!VALID_MEMBER_TYPES.includes(body.memberType)) errors.push('Member type must be Playing or Social');
    if (!VALID_AGE_DEMOGRAPHICS.includes(body.ageDemographic)) errors.push('A valid age demographic is required');

    // An email address is required only when a welcome email is requested
    const sendEmail = body.sendWelcomeEmail === true;
    if (sendEmail && (!body.emailAddress || !String(body.emailAddress).trim())) {
      errors.push('An email address is required to send the welcome email');
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(', ') }, { status: 400 });
    }

    // Create the member via the shared creation path
    const result = await createMember({
      firstName: String(body.firstName).trim(),
      lastName: String(body.lastName).trim(),
      knownAs: body.knownAs ? String(body.knownAs).trim() : '',
      gender: body.gender,
      memberType: body.memberType,
      emailAddress: body.emailAddress ? String(body.emailAddress).trim() : '',
      landline: body.landline ? String(body.landline).trim() : '',
      mobile: body.mobile ? String(body.mobile).trim() : '',
      address1: body.address1 ? String(body.address1).trim() : '',
      address2: body.address2 ? String(body.address2).trim() : '',
      address3: body.address3 ? String(body.address3).trim() : '',
      postCode: body.postCode ? String(body.postCode).trim() : '',
      ageDemographic: body.ageDemographic,
      dob: body.dob ? String(body.dob).trim() : '',
    });

    if (!result.success || !result.userName || !result.tempPassword) {
      return NextResponse.json({ error: result.error || 'Failed to create member' }, { status: 500 });
    }

    // Optionally email the new member their login details
    let emailSent = false;
    let emailError: string | undefined;
    if (sendEmail) {
      const greeting = body.knownAs ? String(body.knownAs).trim() : String(body.firstName).trim();
      const emailResult = await sendWelcomeEmail(
        String(body.emailAddress).trim(),
        greeting,
        result.userName,
        result.tempPassword
      );
      emailSent = emailResult.success;
      emailError = emailResult.error;
    }

    // Return the credentials so the admin can note/pass them on
    return NextResponse.json({
      success: true,
      userName: result.userName,
      tempPassword: result.tempPassword,
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error('[POST /api/admin/members] Error:', error);
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 });
  }
}
