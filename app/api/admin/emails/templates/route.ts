// app/api/admin/emails/templates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getEmailTemplates, getAttachmentTemplates, getClubEmailTemplates } from '@/lib/email/template-reader';
import { hasRole } from '@/lib/role-utils';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized - Please log in' }, { status: 401 });
    }

    if (!hasRole(session.user?.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    const type = request.nextUrl.searchParams.get('type');

    if (type === 'club') {
      return NextResponse.json({
        emailTemplates: getClubEmailTemplates(),
        attachmentTemplates: [],
      });
    }

    return NextResponse.json({
      emailTemplates: getEmailTemplates(),
      attachmentTemplates: getAttachmentTemplates(),
    });
  } catch (error) {
    console.error('Error in GET /api/admin/emails/templates:', error);
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}
