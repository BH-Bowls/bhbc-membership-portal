import { NextRequest, NextResponse } from 'next/server';
import { getGoogleDriveClient } from '@/lib/drive';

export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get('id');
  if (!fileId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    const drive = getGoogleDriveClient();
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' },
    );

    const contentType = (res.headers as Record<string, string>)['content-type'] || 'image/jpeg';
    const readable = res.data as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array));
    }

    return new NextResponse(Buffer.concat(chunks), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
  }
}
