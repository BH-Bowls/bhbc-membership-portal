// app/api/profile/route.ts
// API route for getting and updating user profile with buddy authorization

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByUsername, updateUserProfile } from '@/lib/profile-sheets';
import { canManageUser, canEditProfileField } from '@/lib/buddies-sheets';

// GET /api/profile
// Now works with JWT impersonation - session.user.userName is automatically correct
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Use session.user.userName directly (works with impersonation)
    const targetUserName = session.user.userName;

    const profile = await getUserByUsername(targetUserName);

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    // Lookup buddy name if buddy user ID is set
    let buddyName = null;
    if (profile.buddyUserName) {
      const buddyProfile = await getUserByUsername(profile.buddyUserName);
      if (buddyProfile) {
        buddyName = buddyProfile.fullName;
      }
    }

    return NextResponse.json({
      profile,
      buddyName,
    });
  } catch (error) {
    console.error('[GET /api/profile] Error fetching profile:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch profile',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// PUT /api/profile
export async function PUT(request: NextRequest) {
  // Track what we've updated for error reporting
  let profileUpdated = false;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const updates = body.updates || body;

    // Use session.user.userName directly (works with impersonation)
    const targetUserName = session.user.userName;

    // Filter updates based on field-level permissions
    const allowedUpdates: Partial<typeof updates> = {};

    for (const [field, value] of Object.entries(updates)) {
      // Skip userName if provided (it's the target identifier, not an update)
      if (field === 'userName') continue;

      const canEdit = await canEditProfileField(
        session.user.userName,
        session.user.role,
        targetUserName,
        field
      );

      if (canEdit) {
        allowedUpdates[field] = value;
      } else {
        console.warn(
          `[PUT /api/profile] User ${session.user.userName} attempted to edit restricted field: ${field} for ${targetUserName}`
        );
      }
    }

    // Update profile with allowed fields only
    const result = await updateUserProfile(targetUserName, allowedUpdates);

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error || 'Failed to update profile',
          profileUpdated: false,
        },
        { status: 400 }
      );
    }

    // Track that profile update succeeded
    profileUpdated = true;

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
    });
  } catch (error) {
    console.error('[PUT /api/profile] Error updating profile:', error);

    // Provide detailed error information including what was successfully updated
    return NextResponse.json(
      {
        error: 'Failed to update profile',
        details: error instanceof Error ? error.message : 'Unknown error',
        profileUpdated,
        message: profileUpdated
          ? 'Profile update partially completed but encountered an error'
          : 'Failed to update profile',
      },
      { status: profileUpdated ? 207 : 500 } // 207 Multi-Status for partial success
    );
  }
}
