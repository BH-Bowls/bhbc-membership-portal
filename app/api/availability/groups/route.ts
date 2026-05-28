// app/api/availability/groups/route.ts
// API endpoints for listing and creating availability groups

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGroups, createGroup, addGroupMembers } from '@/lib/availability-groups-sheets';
import type { CreateGroupPayload } from '@/types/availability';

// GET /api/availability/groups
// Returns all groups visible to the calling user (creator + member)
export async function GET(request: NextRequest) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all groups visible to this user
    const groups = await getGroups(session.user.userName);

    return NextResponse.json({ groups });
  } catch (error) {
    console.error('[GET /api/availability/groups] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
  }
}

// POST /api/availability/groups
// Create a new group and optionally add initial members
export async function POST(request: NextRequest) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse the request body
    const body: CreateGroupPayload = await request.json();

    // Validate required fields
    if (!body.name || body.name.trim() === '') {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
    }

    // Validate visitor members — each must have both name and email
    if (body.visitorMembers) {
      for (let i = 0; i < body.visitorMembers.length; i++) {
        const v = body.visitorMembers[i];
        if (!v.visitorName || v.visitorName.trim() === '') {
          return NextResponse.json(
            { error: `Visitor at index ${i} is missing a name` },
            { status: 400 }
          );
        }
        if (!v.visitorEmail || v.visitorEmail.trim() === '') {
          return NextResponse.json(
            { error: `Visitor at index ${i} is missing an email address` },
            { status: 400 }
          );
        }
      }
    }

    // Step 1: Create the group record
    const groupId = await createGroup({
      name: body.name.trim(),
      description: body.description ? body.description.trim() : '',
      createdByUsername: session.user.userName,
      allowMemberManagement: body.allowMemberManagement === true,
    });

    // Step 2: Add initial members — always include the creator, dedup if already listed
    const creatorUserName = session.user.userName;
    const requestedMembers: string[] = body.memberUserNames || [];
    const otherMembers = requestedMembers.filter((u) => u !== creatorUserName);
    const memberUserNames = [creatorUserName, ...otherMembers];
    const visitorMembers = body.visitorMembers || [];

    // Add all members (creator first, so they always appear in the group)
    await addGroupMembers(groupId, creatorUserName, memberUserNames, visitorMembers);

    // Step 3: Send group-added notification to the OTHER new portal members (not the creator)
    if (otherMembers.length > 0) {
      try {
        const { sendGroupAddedEmail } = await import('@/lib/email/availability');
        await sendGroupAddedEmail(groupId, otherMembers, creatorUserName);
      } catch (emailError) {
        // Email failure should not block the group creation — log and continue
        console.error('[POST /api/availability/groups] Email send failed:', emailError);
      }
    }

    return NextResponse.json({ success: true, groupId });
  } catch (error) {
    console.error('[POST /api/availability/groups] Error:', error);
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
  }
}
