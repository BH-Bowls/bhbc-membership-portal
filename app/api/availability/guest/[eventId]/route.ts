// app/api/availability/guest/[eventId]/route.ts
// Public API endpoint for visitors to view an event using their token link
// No authentication required — access is controlled by token validity

import { NextRequest, NextResponse } from 'next/server';
import { getEventDetailForVisitor } from '@/lib/availability-sheets';

// In-memory rate limiting: 30 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || record.resetAt < now) {
    // Start a fresh window for this IP
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count += 1;
  return true;
}

// GET /api/availability/guest/[eventId]?token=<token>
// Returns event detail for a visitor using their unique token
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  // Apply rate limiting
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { eventId } = await params;

    // Token is required
    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Fetch event detail for this visitor token
    const detail = await getEventDetailForVisitor(eventId, token);
    if (!detail) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 });
    }

    // Return safe response — do not include the token or inviteeId
    return NextResponse.json({
      event: detail.event,
      slots: detail.slots,
      invitee: {
        visitorName: detail.invitee.visitorName,
      },
      myResponses: detail.myResponses,
      allResponses: detail.allResponses,
      concludedSlot: detail.concludedSlot,
    });
  } catch (error) {
    console.error('[GET /api/availability/guest/[eventId]] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 });
  }
}
