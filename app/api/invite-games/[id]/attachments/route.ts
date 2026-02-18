// app/api/invite-games/[id]/attachments/route.ts
// API routes for invite game attachments — GET list + POST upload

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getAttachmentsByInviteGameId,
  createInviteGameAttachment,
  validateInviteGameAttachments,
} from '@/lib/invite-games-attachments-sheets';
import { getInviteGameById } from '@/lib/invite-games-sheets';
import { uploadFileToCloudinary } from '@/lib/cloudinary';
import sharp from 'sharp';

/**
 * Compress an image buffer to WebP, falling back to original on failure.
 */
async function compressImage(
  buffer: Buffer,
  originalFileName: string,
  originalMimeType: string
): Promise<{ buffer: Buffer; fileName: string; mimeType: string; originalSize: number; compressedSize: number }> {
  const originalSize = buffer.length;

  try {
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!imageTypes.includes(originalMimeType)) {
      return { buffer, fileName: originalFileName, mimeType: originalMimeType, originalSize, compressedSize: originalSize };
    }

    const compressedBuffer = await sharp(buffer)
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    const shouldUseCompressed = compressedBuffer.length < buffer.length;
    return {
      buffer: shouldUseCompressed ? compressedBuffer : buffer,
      fileName: shouldUseCompressed
        ? originalFileName.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '.webp')
        : originalFileName,
      mimeType: shouldUseCompressed ? 'image/webp' : originalMimeType,
      originalSize,
      compressedSize: shouldUseCompressed ? compressedBuffer.length : originalSize,
    };
  } catch (error) {
    console.error('[compressImage] Compression failed, using original:', error);
    return { buffer, fileName: originalFileName, mimeType: originalMimeType, originalSize, compressedSize: originalSize };
  }
}

/**
 * GET /api/invite-games/[id]/attachments
 * Get all attachments for an invite game
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inviteGameId } = await params;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const game = await getInviteGameById(inviteGameId);
    if (!game) {
      return NextResponse.json({ error: 'Invite game not found' }, { status: 404 });
    }

    const attachments = await validateInviteGameAttachments(inviteGameId);
    return NextResponse.json({ attachments });
  } catch (error) {
    console.error(`[GET /api/invite-games/${inviteGameId}/attachments] Error:`, error);
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 });
  }
}

/**
 * POST /api/invite-games/[id]/attachments
 * Upload a new attachment (committee only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inviteGameId } = await params;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role || 'Member';
    const isCommittee = role !== 'Member' && role !== '';

    if (!isCommittee) {
      return NextResponse.json(
        { error: 'Only committee members can add attachments to invite games' },
        { status: 403 }
      );
    }

    const game = await getInviteGameById(inviteGameId);
    if (!game) {
      return NextResponse.json({ error: 'Invite game not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const type = formData.get('type') as string;
    const description = formData.get('description') as string;
    const url = formData.get('url') as string | null;
    const file = formData.get('file') as File | null;

    if (!type || !description) {
      return NextResponse.json({ error: 'Type and description are required' }, { status: 400 });
    }

    if (!['link', 'image', 'document'].includes(type)) {
      return NextResponse.json({ error: 'Invalid attachment type' }, { status: 400 });
    }

    let attachmentData: any = {
      inviteGameId,
      type,
      description,
      addedByUsername: session.user.userName,
    };

    if (type === 'link') {
      if (!url) {
        return NextResponse.json({ error: 'URL is required for link attachments' }, { status: 400 });
      }
      attachmentData.url = url;
    } else if (file) {
      const maxSize = 50 * 1024 * 1024;
      if (file.size > maxSize) {
        return NextResponse.json({ error: 'File size exceeds 50MB limit' }, { status: 400 });
      }

      if (type === 'image') {
        const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedImageTypes.includes(file.type)) {
          return NextResponse.json(
            { error: 'Invalid image type. Allowed: JPEG, PNG, GIF, WebP' },
            { status: 400 }
          );
        }
      }

      const arrayBuffer = await file.arrayBuffer();
      let buffer: Buffer = Buffer.from(arrayBuffer);
      let finalFileName = file.name;
      let finalMimeType = file.type;
      let finalFileSize = file.size;

      if (type === 'image') {
        const compressed = await compressImage(buffer, file.name, file.type);
        buffer = Buffer.from(compressed.buffer) as Buffer;
        finalFileName = compressed.fileName;
        finalMimeType = compressed.mimeType;
        finalFileSize = compressed.compressedSize;

        const savings = ((1 - compressed.compressedSize / compressed.originalSize) * 100).toFixed(1);
        console.log(
          `[Image Compression] ${file.name}: ${(compressed.originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressed.compressedSize / 1024 / 1024).toFixed(2)}MB (${savings}% reduction)`
        );
      }

      const cloudinaryFile = await uploadFileToCloudinary(
        inviteGameId,
        buffer,
        finalFileName,
        finalMimeType,
        'bhbc-invite-games'
      );

      attachmentData.driveFileId = cloudinaryFile.publicId;
      attachmentData.url = cloudinaryFile.secureUrl;
      attachmentData.fileName = finalFileName;
      attachmentData.mimeType = finalMimeType;
      attachmentData.fileSize = finalFileSize;
    } else {
      return NextResponse.json(
        { error: 'File is required for image/document attachments' },
        { status: 400 }
      );
    }

    const result = await createInviteGameAttachment(attachmentData);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create attachment' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, attachmentId: result.attachmentId });
  } catch (error) {
    console.error(`[POST /api/invite-games/${inviteGameId}/attachments] Error:`, error);
    return NextResponse.json({ error: 'Failed to upload attachment' }, { status: 500 });
  }
}
