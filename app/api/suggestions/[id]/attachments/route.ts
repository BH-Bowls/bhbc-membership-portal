// app/api/suggestions/[id]/attachments/route.ts
// API routes for suggestion attachments - GET list + POST upload

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getAttachmentsBySuggestionId,
  createAttachment,
  validateAttachments,
} from '@/lib/attachments-sheets';
import { getSuggestionById } from '@/lib/suggestions-sheets';
import { uploadFileToCloudinary } from '@/lib/cloudinary';
import sharp from 'sharp';

/**
 * Compress an image buffer
 * - Resizes to max 2000px width/height while maintaining aspect ratio
 * - Compresses to WebP format with 85% quality
 * - Falls back to original if compression fails
 */
async function compressImage(
  buffer: Buffer,
  originalFileName: string,
  originalMimeType: string
): Promise<{ buffer: Buffer; fileName: string; mimeType: string; originalSize: number; compressedSize: number }> {
  const originalSize = buffer.length;

  try {
    // Only compress if it's an image
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!imageTypes.includes(originalMimeType)) {
      return {
        buffer,
        fileName: originalFileName,
        mimeType: originalMimeType,
        originalSize,
        compressedSize: originalSize,
      };
    }

    // Compress image
    const compressedBuffer = await sharp(buffer)
      .resize(2000, 2000, {
        fit: 'inside',
        withoutEnlargement: true, // Don't upscale small images
      })
      .webp({ quality: 85 })
      .toBuffer();

    // Use compressed version if it's smaller
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
    // Return original if compression fails
    return {
      buffer,
      fileName: originalFileName,
      mimeType: originalMimeType,
      originalSize,
      compressedSize: originalSize,
    };
  }
}

/**
 * GET /api/suggestions/[id]/attachments
 * Get all attachments for a suggestion
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: suggestionId } = await params;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has access to this suggestion
    const suggestion = await getSuggestionById(suggestionId);
    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    // Get attachments and validate Drive files still exist
    const attachments = await validateAttachments(suggestionId);

    return NextResponse.json({ attachments });
  } catch (error) {
    console.error(`[GET /api/suggestions/${suggestionId}/attachments] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch attachments' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/suggestions/[id]/attachments
 * Upload a new attachment (file or link)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: suggestionId } = await params;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userName = session.user.userName;
    const role = session.user.role || 'Member';
    const isCommittee = role !== 'Member' && role !== '';

    // Check if user has access to this suggestion
    const suggestion = await getSuggestionById(suggestionId);
    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    // Check permissions: suggestion owner (before acceptance), committee, or coordinator
    const isOwner = suggestion.createdByUsername === userName;
    const isCoordinator = suggestion.coordinatorUsername === userName;
    const canAddAttachment =
      isCommittee ||
      isCoordinator ||
      (isOwner && suggestion.committeeAcceptance !== 'Yes');

    if (!canAddAttachment) {
      return NextResponse.json(
        { error: 'Only the suggestion owner (before acceptance), committee members, and coordinators can add attachments' },
        { status: 403 }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const type = formData.get('type') as string;
    const description = formData.get('description') as string;
    const url = formData.get('url') as string | null;
    const file = formData.get('file') as File | null;

    if (!type || !description) {
      return NextResponse.json(
        { error: 'Type and description are required' },
        { status: 400 }
      );
    }

    // Validate attachment type
    if (!['link', 'image', 'document'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid attachment type' },
        { status: 400 }
      );
    }

    let attachmentData: any = {
      suggestionId,
      type,
      description,
      addedByUsername: userName,
    };

    // Handle external link
    if (type === 'link') {
      if (!url) {
        return NextResponse.json(
          { error: 'URL is required for link attachments' },
          { status: 400 }
        );
      }
      attachmentData.url = url;
    }
    // Handle file upload
    else if (file) {
      // Validate file
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (file.size > maxSize) {
        return NextResponse.json(
          { error: 'File size exceeds 50MB limit' },
          { status: 400 }
        );
      }

      // Validate file type for images
      if (type === 'image') {
        const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedImageTypes.includes(file.type)) {
          return NextResponse.json(
            { error: 'Invalid image type. Allowed: JPEG, PNG, GIF, WebP' },
            { status: 400 }
          );
        }
      }

      // Convert file to buffer
      const arrayBuffer = await file.arrayBuffer();
      let buffer: Buffer = Buffer.from(arrayBuffer);
      let finalFileName = file.name;
      let finalMimeType = file.type;
      let finalFileSize = file.size;

      // Compress image if it's an image type
      if (type === 'image') {
        const compressed = await compressImage(buffer, file.name, file.type);
        buffer = Buffer.from(compressed.buffer) as Buffer;
        finalFileName = compressed.fileName;
        finalMimeType = compressed.mimeType;
        finalFileSize = compressed.compressedSize;

        // Log compression stats
        const savings = ((1 - compressed.compressedSize / compressed.originalSize) * 100).toFixed(1);
        console.log(
          `[Image Compression] ${file.name}: ${(compressed.originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressed.compressedSize / 1024 / 1024).toFixed(2)}MB (${savings}% reduction)`
        );
      }

      // Upload to Cloudinary
      const cloudinaryFile = await uploadFileToCloudinary(
        suggestionId,
        buffer,
        finalFileName,
        finalMimeType
      );

      attachmentData.driveFileId = cloudinaryFile.publicId; // Store publicId in driveFileId field
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

    // Create attachment record
    const result = await createAttachment(attachmentData);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create attachment' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      attachmentId: result.attachmentId,
    });
  } catch (error) {
    console.error(`[POST /api/suggestions/${suggestionId}/attachments] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to upload attachment' },
      { status: 500 }
    );
  }
}
