// GET /api/friendlies/game/[tabDate]/validate-token
// Public endpoint — validates a player token for a specific game.
// Returns { valid: false } on invalid/expired token; never returns 401 (avoids brute-force signal).
import { NextRequest, NextResponse } from 'next/server';
import { getGames, validateGameToken } from '@/lib/friendlies-sheets';

// In-memory rate limit: 30 requests per minute per IP
const requestTimes: Map<string, number[]> = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 30;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const times = (requestTimes.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_LIMIT) return true;
  times.push(now);
  requestTimes.set(ip, times);
  return false;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tabDate: string }> }
) {
  try {
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'token parameter required' }, { status: 400 });
    }

    const { tabDate } = await params;
    const tabName = decodeURIComponent(tabDate);

    // Verify the game exists
    const games = await getGames();
    let game = null;
    for (const g of games) {
      if (g.tabName === tabName) {
        game = g;
        break;
      }
    }
    if (!game) {
      return NextResponse.json({ valid: false });
    }

    const result = await validateGameToken(tabName, token);

    if (!result) {
      return NextResponse.json({ valid: false });
    }

    return NextResponse.json({
      valid: true,
      playerSelected: result.playerSelected,
      playerConfirmation: result.playerConfirmation,
      acknowledgedCancellation: result.acknowledgedCancellation,
      gameStatus: result.gameStatus,
      gameDate: result.gameDate,
    });
  } catch (error) {
    console.error('GET validate-token error:', error);
    return NextResponse.json({ valid: false });
  }
}
