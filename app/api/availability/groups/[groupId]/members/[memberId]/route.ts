// app/api/availability/groups/[groupId]/members/[memberId]/route.ts
// API endpoint for removing a single member from an availability group

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getGroupById,
  removeGroupMember,
  canManageGroupMembers,
} from '@/lib/availability-groups-sheets';

// DELETE /api/availability/groups/[groupId]/members/[memberId]
// Remove a member from the group (does not cascade to past event invitees)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; memberId: string }> }
) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await the dynamic route params
    const { groupId, memberId } = await params;

    // Fetch the group to perform access check
    const group = await getGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';

    // Access check: only those who can manage members may remove them
    const canManage = await canManageGroupMembers(group, userName, userRole);
    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Remove the group member record (no cascade — past event invites remain)
    await removeGroupMember(memberId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/availability/groups/[groupId]/members/[memberId]] Error:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}
