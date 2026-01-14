// src/lib/cloudinary.ts
// Cloudinary operations for Member Suggestion Attachments

import { v2 as cloudinary } from 'cloudinary';

// ============================================================================
// ENVIRONMENT VARIABLES
// ============================================================================

function getCloudName(): string {
  const name = process.env.CLOUDINARY_CLOUD_NAME;
  if (!name) {
    throw new Error('CLOUDINARY_CLOUD_NAME is not set. Add it to .env.local');
  }
  return name;
}

function getApiKey(): string {
  const key = process.env.CLOUDINARY_API_KEY;
  if (!key) {
    throw new Error('CLOUDINARY_API_KEY is not set. Add it to .env.local');
  }
  return key;
}

function getApiSecret(): string {
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!secret) {
    throw new Error('CLOUDINARY_API_SECRET is not set. Add it to .env.local');
  }
  return secret;
}

// ============================================================================
// CLOUDINARY CLIENT
// ============================================================================

function configureCloudinary() {
  cloudinary.config({
    cloud_name: getCloudName(),
    api_key: getApiKey(),
    api_secret: getApiSecret(),
    secure: true,
  });
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Upload a file to Cloudinary in a suggestion-specific folder
 * Folder structure: bhbc-suggestions/{suggestionId}/filename
 */
export async function uploadFileToCloudinary(
  suggestionId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<{
  publicId: string;
  url: string;
  secureUrl: string;
  thumbnailUrl: string;
  format: string;
  bytes: number;
}> {
  configureCloudinary();

  try {
    // Determine resource type based on MIME type
    let resourceType: 'image' | 'video' | 'raw' = 'raw';
    if (mimeType.startsWith('image/')) {
      resourceType = 'image';
    } else if (mimeType.startsWith('video/')) {
      resourceType = 'video';
    }

    // Build folder path: bhbc-suggestions/2026-001
    const folder = `bhbc-suggestions/${suggestionId}`;

    // Generate a clean filename (remove extension, Cloudinary adds it back)
    const cleanFileName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');

    // Upload to Cloudinary
    return new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: folder,
          public_id: cleanFileName,
          resource_type: resourceType,
          use_filename: true,
          unique_filename: true,
          overwrite: false,
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            // Generate thumbnail URL for images
            let thumbnailUrl = result.secure_url;
            if (resourceType === 'image') {
              // Create thumbnail transformation: 200px width, auto quality
              thumbnailUrl = cloudinary.url(result.public_id, {
                width: 200,
                crop: 'fit',
                quality: 'auto',
                fetch_format: 'auto',
              });
            }

            resolve({
              publicId: result.public_id,
              url: result.url,
              secureUrl: result.secure_url,
              thumbnailUrl: thumbnailUrl,
              format: result.format || '',
              bytes: result.bytes || 0,
            });
          } else {
            reject(new Error('Upload failed with no result'));
          }
        }
      ).end(fileBuffer);
    });
  } catch (error) {
    console.error(`[uploadFileToCloudinary] Error uploading ${fileName}:`, error);
    throw new Error(`Failed to upload file: ${fileName}`);
  }
}

/**
 * Delete a file from Cloudinary
 */
export async function deleteFileFromCloudinary(publicId: string): Promise<void> {
  configureCloudinary();

  try {
    // Determine resource type from public_id
    // Images are in bhbc-suggestions folder, others might be 'raw'
    let resourceType: 'image' | 'video' | 'raw' = 'image';

    // Try to delete as image first, then raw if it fails
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      return;
    } catch (imageError) {
      // If not found as image, try as raw resource
      await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
      return;
    }
  } catch (error: any) {
    // If file not found, consider it already deleted
    if (error?.http_code === 404) {
      console.log(`[deleteFileFromCloudinary] File ${publicId} not found (already deleted)`);
      return;
    }
    console.error(`[deleteFileFromCloudinary] Error deleting ${publicId}:`, error);
    throw new Error(`Failed to delete file: ${publicId}`);
  }
}

/**
 * Check if a file exists in Cloudinary
 */
export async function checkFileExists(publicId: string): Promise<boolean> {
  configureCloudinary();

  try {
    // Try as image first
    try {
      await cloudinary.api.resource(publicId, { resource_type: 'image' });
      return true;
    } catch (imageError) {
      // Try as raw resource
      await cloudinary.api.resource(publicId, { resource_type: 'raw' });
      return true;
    }
  } catch (error: any) {
    if (error?.http_code === 404 || error?.error?.http_code === 404) {
      return false;
    }
    console.error(`[checkFileExists] Error checking ${publicId}:`, error);
    return false;
  }
}

/**
 * Get file metadata from Cloudinary
 */
export async function getFileMetadata(publicId: string): Promise<{
  publicId: string;
  format: string;
  bytes: number;
  url: string;
  secureUrl: string;
} | null> {
  configureCloudinary();

  try {
    // Try as image first
    let resource;
    try {
      resource = await cloudinary.api.resource(publicId, { resource_type: 'image' });
    } catch (imageError) {
      // Try as raw resource
      resource = await cloudinary.api.resource(publicId, { resource_type: 'raw' });
    }

    return {
      publicId: resource.public_id,
      format: resource.format,
      bytes: resource.bytes,
      url: resource.url,
      secureUrl: resource.secure_url,
    };
  } catch (error: any) {
    if (error?.http_code === 404 || error?.error?.http_code === 404) {
      return null;
    }
    console.error(`[getFileMetadata] Error getting metadata for ${publicId}:`, error);
    return null;
  }
}

/**
 * Get thumbnail URL for an image file
 */
export function getThumbnailUrl(publicId: string, size: number = 200): string {
  configureCloudinary();

  return cloudinary.url(publicId, {
    width: size,
    crop: 'fit',
    quality: 'auto',
    fetch_format: 'auto',
  });
}
