// app/api/profile/route.ts
// API route for getting and updating user profile with buddy authorization

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByUsername, updateUserProfile } from '@/lib/profile-sheets';
import { canManageUser, canEditProfileField } from '@/lib/buddies-sheets';

// GET /api/profile?userName=target
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get target user from query params (defaults to self)
    const { searchParams } = new URL(request.url);
    const targetUserName = searchParams.get('userName') || session.user.userName;

    // Check authorization (buddy system)
    const canManage = await canManageUser(
      session.user.userName,
      session.user.role,
      targetUserName
    );

    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const profile = await getUserByUsername(targetUserName);

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      profile,
      managedUser: {
        userName: targetUserName,
        isSelf: targetUserName === session.user.userName,
      },
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}

// PUT /api/profile
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const targetUserName = body.userName || session.user.userName;
    const updates = body.updates || body;

    // Check authorization (buddy system)
    const canManage = await canManageUser(
      session.user.userName,
      session.user.role,
      targetUserName
    );

    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Filter updates based on field-level permissions
    const allowedUpdates: any = {};

    for (const [field, value] of Object.entries(updates)) {
      // Skip userName if provided (it's the target identifier, not an update)
      if (field === 'userName') continue;

      const canEdit = canEditProfileField(
        session.user.userName,
        session.user.role,
        targetUserName,
        field
      );

      if (canEdit) {
        allowedUpdates[field] = value;
      } else {
        console.warn(
          `User ${session.user.userName} attempted to edit restricted field: ${field} for ${targetUserName}`
        );
      }
    }

    // Update profile with allowed fields only
    const result = await updateUserProfile(targetUserName, allowedUpdates);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to update profile' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
