// app/api/availability/groups/[groupId]/members/route.ts
// API endpoints for listing and adding members to an availability group

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getGroupById,
  getGroupMembers,
  addGroupMembers,
  isGroupMember,
  canManageGroupMembers,
} from '@/lib/availability-groups-sheets';
import { getGroupEvents, createInviteesFromGroupMembers } from '@/lib/availability-events-sheets';
import type { AddGroupMembersPayload } from '@/types/availability';

// GET /api/availability/groups/[groupId]/members
// Returns all members of a group
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await the dynamic route param
    const { groupId } = await params;

    // Fetch the group record
    const group = await getGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = group.createdByUsername === userName;

    // Access check: must be member, creator, or Admin
    if (!isCreator && !isAdmin) {
      const memberStatus = await isGroupMember(groupId, userName);
      if (!memberStatus) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Fetch and return the list of group members
    const members = await getGroupMembers(groupId);

    return NextResponse.json({ members });
  } catch (error) {
    console.error('[GET /api/availability/groups/[groupId]/members] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}

// POST /api/availability/groups/[groupId]/members
// Add new members (portal members and/or visitors) to a group
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await the dynamic route param
    const { groupId } = await params;

    // Fetch the group record
    const group = await getGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // Group must be active — cannot add members to an archived group
    if (group.status === 'archived') {
      return NextResponse.json({ error: 'Cannot add members to an archived group' }, { status: 400 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';

    // Access check: only those who can manage members may call this endpoint
    const canManage = await canManageGroupMembers(group, userName, userRole);
    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse the request body
    const body: AddGroupMembersPayload = await request.json();

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

    const memberUserNames = body.memberUserNames || [];
    const visitorMembers = body.visitorMembers || [];

    // Step 1: Add the new members to the group
    const newMembers = await addGroupMembers(groupId, userName, memberUserNames, visitorMembers);

    if (newMembers.length > 0) {
      // Step 2: Find all open, non-expired events for this group
      const allGroupEvents = await getGroupEvents(groupId, userName);

      // Filter to only open events that have not expired
      const now = new Date();
      const openEvents = [];
      for (let i = 0; i < allGroupEvents.length; i++) {
        const ev = allGroupEvents[i];
        if (ev.status === 'open') {
          const expiresAt = new Date(ev.expiresAt);
          if (expiresAt > now) {
            openEvents.push(ev);
          }
        }
      }

      // Step 3: For each open event, create invitee records for the new members
      for (let i = 0; i < openEvents.length; i++) {
        const ev = openEvents[i];
        try {
          // Create invitee records — returns the newly created invitees (including visitor tokens)
          const newInvitees = await createInviteesFromGroupMembers(
            ev.eventId,
            ev.expiresAt,
            newMembers
          );

          // Step 4: Send event invite emails to the new members for this open event
          if (newInvitees.length > 0) {
            try {
              const { sendEventInviteEmails } = await import('@/lib/email/availability');
              await sendEventInviteEmails(ev.eventId, ev.groupId, newInvitees, userName);
            } catch (emailError) {
              // Email failure must not block the response
              console.error(
                `[POST /api/availability/groups/[groupId]/members] Invite email failed for event ${ev.eventId}:`,
                emailError
              );
            }
          }
        } catch (inviteError) {
          // Log but continue — don't fail the whole request if one event's invitees fail
          console.error(
            `[POST /api/availability/groups/[groupId]/members] Failed to create invitees for event ${ev.eventId}:`,
            inviteError
          );
        }
      }

      // Step 5: Send group-added notification emails to new portal members (not visitors)
      const newMemberUserNames = [];
      for (let i = 0; i < newMembers.length; i++) {
        if (newMembers[i].memberType === 'member' && newMembers[i].userName) {
          newMemberUserNames.push(newMembers[i].userName);
        }
      }

      if (newMemberUserNames.length > 0) {
        try {
          const { sendGroupAddedEmail } = await import('@/lib/email/availability');
          await sendGroupAddedEmail(groupId, newMemberUserNames, userName);
        } catch (emailError) {
          console.error(
            '[POST /api/availability/groups/[groupId]/members] Group-added email failed:',
            emailError
          );
        }
      }
    }

    return NextResponse.json({ success: true, addedCount: newMembers.length });
  } catch (error) {
    console.error('[POST /api/availability/groups/[groupId]/members] Error:', error);
    return NextResponse.json({ error: 'Failed to add members' }, { status: 500 });
  }
}
