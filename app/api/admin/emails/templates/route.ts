// app/api/admin/emails/templates/route.ts
// API endpoint to get available email and attachment templates

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getEmailTemplates, getAttachmentTemplates } from '@/lib/email/template-reader';

/**
 * GET /api/admin/emails/templates
 * Get list of available email templates and attachment templates
 *
 * Authorization: Admin only
 * Response: { emailTemplates: EmailTemplate[], attachmentTemplates: AttachmentTemplate[] }
 */
export async function GET() {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 }
      );
    }

    // Verify user is admin
    if (session.user?.role !== 'Admin') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    // Get all email templates
    const emailTemplates = getEmailTemplates();

    // Get all attachment templates
    const attachmentTemplates = getAttachmentTemplates();

    // Return template lists
    return NextResponse.json({
      emailTemplates,
      attachmentTemplates,
    });
  } catch (error) {
    console.error('Error in GET /api/admin/emails/templates:', error);
    return NextResponse.json(
      { error: 'Failed to load templates' },
      { status: 500 }
    );
  }
}
