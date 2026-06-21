// app/api/admin/members/[userName]/route.ts
// GET  — full member detail for the admin view/edit page.
// PUT  — amend a member's fields (admin only). Reuses updateUserProfile, which
//        whitelists editable fields (user_name, password and computed columns are
//        never writable). Admin-only fields are permitted because this route is
//        Admin-guarded.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getUserByUsername, updateUserProfile } from '@/lib/profile-sheets';
import type { User } from '@/lib/sheets';

// GET handler — returns a single member's details (without secret auth fields)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userName: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userName } = await params;
    const user = await getUserByUsername(userName);
    if (!user) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Strip secret auth fields before returning to the client
    const member: Partial<User> = { ...user };
    delete member.passwordHash;
    delete member.resetToken;
    delete member.resetTokenExpires;

    return NextResponse.json({ member });
  } catch (error) {
    console.error('[GET /api/admin/members/[userName]] Error:', error);
    return NextResponse.json({ error: 'Failed to load member' }, { status: 500 });
  }
}

// PUT handler — amends a member's fields
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userName: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userName } = await params;
    const body = await request.json();
    const updates = body.updates || body;

    // user_name is the identifier, never an editable field
    if ('userName' in updates) {
      delete updates.userName;
    }

    // updateUserProfile whitelists fields and validates; computed columns,
    // password and user_name are never written.
    const result = await updateUserProfile(userName, updates);
    if (!result.success) {
      const status = result.error === 'User not found' ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/admin/members/[userName]] Error:', error);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}
