// app/api/guides/[slug]/route.ts
// Streams a duty-instruction PDF from the "Guides" subfolder of the Drive attachments
// root, inline so it opens in the browser. Slugs are whitelisted (no arbitrary file
// access). Served via the service account so the files need not be publicly shared.

import { NextRequest, NextResponse } from 'next/server';
import { findGuidePdf, getServiceAccountDriveClient } from '@/lib/drive';

// Slug → Drive file name (without extension) in the Guides folder.
const GUIDES: Record<string, string> = {
  'tea-duty': 'Tea Duty',
  'cleaning-duty': 'Cleaning Duty',
  'captain-home': 'Guidelines for Captain of the Day - HOME GAMES',
  'captain-away': 'Guidelines for Captain of the Day - AWAY GAMES',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const guideName = GUIDES[slug];
  if (!guideName) {
    return NextResponse.json({ error: 'Unknown guide' }, { status: 404 });
  }

  try {
    const guide = await findGuidePdf(guideName);
    if (!guide) {
      return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
    }

    const drive = getServiceAccountDriveClient();
    const res = await drive.files.get(
      { fileId: guide.fileId, alt: 'media' },
      { responseType: 'stream' },
    );
    const readable = res.data as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array));
    }

    // Ensure a .pdf filename for the inline disposition
    const fileName = /\.pdf$/i.test(guide.name) ? guide.name : `${guide.name}.pdf`;

    return new NextResponse(Buffer.concat(chunks), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error(`[guides] Failed to serve '${slug}':`, err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: 'Failed to load guide',
        // Surface the underlying cause in development only.
        ...(process.env.NODE_ENV !== 'production' ? { detail } : {}),
      },
      { status: 500 },
    );
  }
}
