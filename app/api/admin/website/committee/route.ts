// app/api/admin/website/committee/route.ts
// GET /api/admin/website/committee — all committee members (active and inactive) for the admin UI.
// POST /api/admin/website/committee — creates a new committee member.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllCommitteeMembers, createCommitteeMember } from '@/lib/website-committee-supabase';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const committee = await getAllCommitteeMembers();
    return NextResponse.json({ committee });
  } catch (error) {
    console.error('[GET /api/admin/website/committee] Error:', error);
    return NextResponse.json({ error: 'Failed to load committee' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { name, role, email, display_order, active } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!role || typeof role !== 'string' || role.trim() === '') {
      return NextResponse.json({ error: 'role is required' }, { status: 400 });
    }
    if (email !== null && email !== undefined && email !== '' && typeof email === 'string' && !email.includes('@')) {
      return NextResponse.json({ error: 'email must be a valid address' }, { status: 400 });
    }

    const member = await createCommitteeMember({
      name: name.trim(),
      role: role.trim(),
      email: typeof email === 'string' && email.trim() !== '' ? email.trim() : null,
      display_order: Number.isFinite(Number(display_order)) ? Number(display_order) : 0,
      active: active !== false,
    });

    return NextResponse.json({ success: true, member });
  } catch (error) {
    console.error('[POST /api/admin/website/committee] Error:', error);
    return NextResponse.json({ error: 'Failed to create committee member' }, { status: 500 });
  }
}
