// app/api/availability/groups/[groupId]/route.ts
// API endpoints for reading, updating, and deleting a single availability group

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getGroupById,
  getGroupDetail,
  updateGroup,
  deleteGroup,
  isGroupMember,
  canManageGroupMembers,
} from '@/lib/availability-groups-supabase';

// GET /api/availability/groups/[groupId]
// Returns full group detail for the group page
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

    // Await the dynamic route param (Next.js 15 requirement)
    const { groupId } = await params;

    // Fetch the group to check it exists
    const group = await getGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';

    // Access check: must be group creator, Admin, or group member
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = group.createdByUsername === userName;

    if (!isCreator && !isAdmin) {
      // Check if they are a group member
      const memberStatus = await isGroupMember(groupId, userName);
      if (!memberStatus) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Fetch full group detail including members and events
    const detail = await getGroupDetail(groupId, userName);
    if (!detail) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error('[GET /api/availability/groups/[groupId]] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch group' }, { status: 500 });
  }
}

// PUT /api/availability/groups/[groupId]
// Update group name, description, or allow_member_management
export async function PUT(
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

    // Fetch the group to check it exists and check creator
    const group = await getGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // Access check: only group creator or Admin can update
    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = group.createdByUsername === userName;

    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Group must not be archived to allow updates
    if (group.status === 'archived') {
      return NextResponse.json({ error: 'Cannot update an archived group' }, { status: 400 });
    }

    // Parse the update body
    const body = await request.json();

    // Build the updates object with only the provided fields
    const updates: { name?: string; description?: string; allowMemberManagement?: boolean } = {};

    if (body.name !== undefined) {
      // Validate name is not empty
      if (!body.name || body.name.trim() === '') {
        return NextResponse.json({ error: 'Group name cannot be empty' }, { status: 400 });
      }
      updates.name = body.name.trim();
    }

    if (body.description !== undefined) {
      updates.description = body.description;
    }

    if (body.allowMemberManagement !== undefined) {
      updates.allowMemberManagement = body.allowMemberManagement === true;
    }

    // Apply the updates to the group record
    await updateGroup(groupId, updates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/availability/groups/[groupId]] Error:', error);
    return NextResponse.json({ error: 'Failed to update group' }, { status: 500 });
  }
}

// DELETE /api/availability/groups/[groupId]
// Permanently delete a group and everything in it (events/slots/responses/members) —
// irreversible, the frontend must confirm with the user before calling this.
export async function DELETE(
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

    // Fetch the group to check it exists and check creator
    const group = await getGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // Access check: only group creator or Admin can delete
    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = group.createdByUsername === userName;

    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await deleteGroup(groupId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/availability/groups/[groupId]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
  }
}
