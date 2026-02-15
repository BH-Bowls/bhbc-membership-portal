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

    // Generate a clean filename, keeping the extension for raw resources
    // (Cloudinary only auto-appends extensions for image/video, not raw)
    const ext = fileName.match(/\.[^/.]+$/)?.[0] || '';
    const baseName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    const cleanFileName = resourceType === 'raw' ? `${baseName}${ext}` : baseName;

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
    // Try to delete as image first
    const imageResult = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    if (imageResult?.result === 'ok') return;

    // If not found as image, try as raw resource (documents, PDFs, etc.)
    const rawResult = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    if (rawResult?.result === 'ok') return;

    // Neither worked — file may already be deleted
    console.log(`[deleteFileFromCloudinary] File ${publicId} not found (already deleted)`);
  } catch (error: any) {
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
 * Build a signed Cloudinary download-API URL.
 * Endpoint: https://api.cloudinary.com/v1_1/{cloud}/{resourceType}/download
 */
function buildDownloadUrl(
  publicId: string,
  format: string,
  resourceType: string
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const params: Record<string, string> = {
    public_id: publicId,
    timestamp: String(timestamp),
    type: 'upload',
  };
  if (format) params.format = format;

  const signature = cloudinary.utils.api_sign_request(params, getApiSecret());

  const qs = new URLSearchParams({
    ...params,
    api_key: getApiKey(),
    signature: signature as string,
  });

  return `https://api.cloudinary.com/v1_1/${getCloudName()}/${resourceType}/download?${qs}`;
}

/**
 * Fetch a file from Cloudinary by publicId and return the buffer + metadata.
 * Uses the authenticated download API endpoint which bypasses CDN restrictions
 * that cause 401 on raw resources.
 *
 * Tries multiple URL forms because raw public_ids include the file extension
 * while image public_ids do not.
 */
export async function fetchFileFromCloudinary(
  publicId: string,
  resourceType: 'image' | 'raw' = 'raw'
): Promise<{ buffer: Buffer; contentType: string }> {
  configureCloudinary();

  // Build a list of download URLs to try in order.
  const attempts: string[] = [];

  // Attempt 1 — full public_id as-is (correct for raw where ext is part of id)
  attempts.push(buildDownloadUrl(publicId, '', resourceType));

  // Attempt 2 — split extension into format param (correct for some SDK uploads)
  if (resourceType === 'raw') {
    const extMatch = publicId.match(/\.([^/.]+)$/);
    if (extMatch) {
      const format = extMatch[1];
      const cleanId = publicId.slice(0, -extMatch[0].length);
      attempts.push(buildDownloadUrl(cleanId, format, resourceType));
    }
  }

  for (const downloadUrl of attempts) {
    console.log(`[fetchFileFromCloudinary] Trying: ${downloadUrl}`);
    const response = await fetch(downloadUrl);

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const contentType =
        response.headers.get('content-type') || 'application/octet-stream';
      return { buffer: Buffer.from(arrayBuffer), contentType };
    }

    console.log(`[fetchFileFromCloudinary] Got ${response.status}, trying next…`);
  }

  throw new Error(
    `Failed to fetch file from Cloudinary – all attempts failed for ${publicId}`
  );
}

