// app/api/availability/guest/[eventId]/route.ts
// Public API endpoint for visitors to load their availability event detail using a token
// Rate limit: 30 requests per minute per IP. No authentication required.

import { NextRequest, NextResponse } from 'next/server';
import { getEventDetailForVisitor } from '@/lib/availability-events-sheets';

// In-memory rate limit store — keyed by IP address.
// Stores timestamps of all requests within the rate limit window.
// Resets on server restart (by design — persistent store not needed at this traffic level).
const requestLog: Map<string, number[]> = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30;

// GET /api/availability/guest/[eventId]
// Returns event detail for a visitor. Query param: token (required).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  // Rate limiting by IP — 30 requests per minute
  const ip = request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip')
    || 'unknown';

  const now = Date.now();

  // Get existing request timestamps for this IP
  let timestamps = requestLog.get(ip);
  if (!timestamps) {
    timestamps = [];
  }

  // Remove timestamps outside the rate limit window
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recentTimestamps = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] > windowStart) {
      recentTimestamps.push(timestamps[i]);
    }
  }

  // Check if the rate limit has been exceeded
  if (recentTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429 }
    );
  }

  // Record this request timestamp
  recentTimestamps.push(now);
  requestLog.set(ip, recentTimestamps);

  try {
    // Await the dynamic route param
    const { eventId } = await params;

    // Extract the token from the query string
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    // Token is required to access guest events
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Validate the token and fetch event detail for this visitor
    const detail = await getEventDetailForVisitor(eventId, token);

    // Return 404 if token is invalid, expired, or event not found
    if (!detail) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Return the event detail — exclude raw token and inviteeId for security
    return NextResponse.json({
      event: detail.event,
      slots: detail.slots,
      invitee: { visitorName: detail.invitee.visitorName },
      myResponses: detail.myResponses,
      allResponses: detail.allResponses,
      concludedSlot: detail.concludedSlot,
    });
  } catch (error) {
    console.error('[GET /api/availability/guest/[eventId]] Error:', error);
    return NextResponse.json({ error: 'Failed to load event' }, { status: 500 });
  }
}
