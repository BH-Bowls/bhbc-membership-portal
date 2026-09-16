// app/api/admin/website/coaches/route.ts
// GET /api/admin/website/coaches — all coaches (active and inactive) for the admin UI.
// POST /api/admin/website/coaches — creates a new coach.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllCoaches, createCoach } from '@/lib/website-coaches-supabase';
import { revalidateWebsitePath } from '@/lib/revalidate-website';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const coaches = await getAllCoaches();
    return NextResponse.json({ coaches });
  } catch (error) {
    console.error('[GET /api/admin/website/coaches] Error:', error);
    return NextResponse.json({ error: 'Failed to load coaches' }, { status: 500 });
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
    const { name, qualification, bio, active } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!qualification || typeof qualification !== 'string' || qualification.trim() === '') {
      return NextResponse.json({ error: 'qualification is required' }, { status: 400 });
    }

    const coach = await createCoach({
      name: name.trim(),
      qualification: qualification.trim(),
      bio: typeof bio === 'string' && bio.trim() !== '' ? bio.trim() : null,
      active: active !== false,
    });

    await revalidateWebsitePath('/coaching');
    return NextResponse.json({ success: true, coach });
  } catch (error) {
    console.error('[POST /api/admin/website/coaches] Error:', error);
    return NextResponse.json({ error: 'Failed to create coach' }, { status: 500 });
  }
}
