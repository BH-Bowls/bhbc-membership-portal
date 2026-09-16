// app/api/admin/website/documents/route.ts
// GET /api/admin/website/documents — every document category and its PDFs, for
// the admin upload/maintenance page.
// POST /api/admin/website/documents — confirms an upload completed (the browser PUTs
//   bytes straight to Drive, bypassing this server) and triggers a website revalidate.
// Auth: Admin, Captain, or GMC role required.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { listWebsiteDocumentCategories } from '@/lib/website-documents-drive';
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

    const categories = await listWebsiteDocumentCategories();
    return NextResponse.json({ categories });
  } catch (error) {
    console.error('[GET /api/admin/website/documents] Error:', error);
    return NextResponse.json({ error: 'Failed to load documents' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await revalidateWebsitePath('/documents');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/admin/website/documents] Error:', error);
    return NextResponse.json({ error: 'Failed to revalidate' }, { status: 500 });
  }
}
