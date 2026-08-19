// app/api/admin/applications/[id]/reject/route.ts
// PATCH — decline a listed application, recording decision notes. Sends no email
// (the decision is communicated manually). Auth: Admin role required.
//
// Writes status 'Declined' (not 'Rejected') — the Postgres applications table's status
// CHECK constraint only allows Declined/Didn't Proceed as terminal non-approval states
// (see specs/Phase_0_1_Migration_Plan.md, Step 2); the live Sheets version's single
// 'Rejected' status was split into these two, Declined being the direct equivalent.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { clearDiaryCache } from '@/lib/home-cache';
import { getApplicationById, updateApplicationFields } from '@/lib/applications-supabase';

// PATCH handler — sets status -> Declined with notes
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admins may reject applications
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Invalid application id' }, { status: 400 });
    }

    const body = await request.json();

    // Confirm the application exists and is currently Listed
    const application = await getApplicationById(id);
    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    if (application.status !== 'Listed') {
      return NextResponse.json(
        { error: `Cannot decline an application with status "${application.status}"` },
        { status: 409 }
      );
    }

    // Decision notes are optional but recorded when supplied
    let notes = '';
    if (typeof body.notes === 'string') {
      notes = body.notes.trim();
    }

    await updateApplicationFields(id, {
      status: 'Declined',
      decisionNotes: notes,
    });

    // A declined application no longer counts as pending action
    clearDiaryCache(session.user.userName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH reject] Error:', error);
    return NextResponse.json({ error: 'Failed to decline application' }, { status: 500 });
  }
}
