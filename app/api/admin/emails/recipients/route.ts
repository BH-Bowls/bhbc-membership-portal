// app/api/admin/emails/recipients/route.ts
// API endpoint to get count of email recipients (members with Include="Y")

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers } from '@/lib/sheets';

/**
 * GET /api/admin/emails/recipients
 * Get count of members who will receive emails (Include="Y")
 *
 * Authorization: Admin only
 * Response: { count: number, members: Array<{userName: string, fullName: string, email: string}> }
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

    // Get all users from Members sheet
    const allUsers = await getAllUsers();

    // Filter users with Include="Y"
    const recipients = allUsers.filter((user) => user.include === 'Y');

    // Build simplified recipient list for display
    const recipientList = recipients.map((user) => ({
      userName: user.userName || '',
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      email: user.emailAddress || '',
    }));

    // Return count and list
    return NextResponse.json({
      count: recipients.length,
      members: recipientList,
    });
  } catch (error) {
    console.error('Error in GET /api/admin/emails/recipients:', error);
    return NextResponse.json(
      { error: 'Failed to load recipients' },
      { status: 500 }
    );
  }
}
