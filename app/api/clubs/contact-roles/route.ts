// app/api/clubs/contact-roles/route.ts
// GET — return distinct contact roles across all clubs (for dropdown population)

import { NextResponse } from 'next/server';
import { getDistinctContactRoles } from '@/lib/clubs-sheets';

export async function GET() {
  try {
    const roles = await getDistinctContactRoles();
    return NextResponse.json({ roles });
  } catch (err) {
    console.error('[GET /api/clubs/contact-roles] Error:', err);
    return NextResponse.json({ roles: [] });
  }
}
