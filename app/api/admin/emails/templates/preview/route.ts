// app/api/admin/emails/templates/preview/route.ts
// GET — return raw template HTML for in-browser preview (Admin only)
// ?id=templateId&type=club|member

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getEmailTemplateContent, getClubEmailTemplateContent } from '@/lib/email/template-reader';
import { hasRole } from '@/lib/role-utils';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  if (!hasRole(session.user?.role, 'Admin')) return new NextResponse('Forbidden', { status: 403 });

  const id = request.nextUrl.searchParams.get('id');
  const type = request.nextUrl.searchParams.get('type');

  if (!id) return new NextResponse('Missing template id', { status: 400 });

  const content = type === 'club'
    ? getClubEmailTemplateContent(id)
    : getEmailTemplateContent(id);

  if (!content) return new NextResponse('Template not found', { status: 404 });

  return new NextResponse(content, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
