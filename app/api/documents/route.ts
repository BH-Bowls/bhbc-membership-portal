import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listPortalDocuments } from '@/lib/drive';

/** GET /api/documents — all authenticated users */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const folders = await listPortalDocuments();
    return NextResponse.json({ folders });
  } catch (error) {
    console.error('GET /api/documents error:', error);
    return NextResponse.json({ error: 'Failed to load documents' }, { status: 500 });
  }
}
