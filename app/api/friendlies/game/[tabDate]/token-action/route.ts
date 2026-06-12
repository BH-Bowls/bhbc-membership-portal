// POST /api/friendlies/game/[tabDate]/token-action
// Public endpoint — performs confirm, withdraw, or acknowledge actions via email link token.
import { NextRequest, NextResponse } from 'next/server';
import { getGames, validateGameToken, updateGameSheet, acknowledgeGameCancellation } from '@/lib/friendlies-sheets';
import { sendWithdrawalEmail } from '@/lib/email/friendlies';

// In-memory rate limit: 10 requests per 5 minutes per IP
const RATE_LIMIT_MINUTES = 5;
const RATE_LIMIT_COUNT = 10;
const requestCounts: Map<string, { count: number; windowStart: number }> = new Map();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = RATE_LIMIT_MINUTES * 60 * 1000;
  const entry = requestCounts.get(ip);
  if (!entry || now - entry.windowStart > windowMs) {
    requestCounts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT_COUNT) return true;
  entry.count++;
  return false;
}

// Which actions are valid for a given game status + player situation
function isActionAllowed(
  action: string,
  gameStatus: string,
  playerSelected: string,
  playerConfirmation: string,
  acknowledgedCancellation: string
): boolean {
  if (action === 'confirm') {
    return gameStatus === 'S'
      && ['Y', 'R', 'T'].includes(playerSelected)
      && playerConfirmation !== 'Y';
  }
  if (action === 'withdraw') {
    return gameStatus === 'S'
      && ['Y', 'R', 'T'].includes(playerSelected)
      && playerConfirmation === 'Y';
  }
  if (action === 'acknowledge') {
    return gameStatus === 'C' && acknowledgedCancellation !== 'Y';
  }
  return false;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tabDate: string }> }
) {
  try {
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();
    const token: string = body.token || '';
    const action: string = body.action || '';

    if (!token) {
      return NextResponse.json({ error: 'token required' }, { status: 400 });
    }
    if (!['confirm', 'withdraw', 'acknowledge'].includes(action)) {
      return NextResponse.json({ error: 'action must be confirm, withdraw, or acknowledge' }, { status: 400 });
    }

    const { tabDate } = await params;
    const tabName = decodeURIComponent(tabDate);

    // Verify game exists
    const games = await getGames();
    let game = null;
    for (const g of games) {
      if (g.tabName === tabName) {
        game = g;
        break;
      }
    }
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const tokenData = await validateGameToken(tabName, token);
    if (!tokenData) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
    }

    if (!isActionAllowed(action, tokenData.gameStatus, tokenData.playerSelected, tokenData.playerConfirmation, tokenData.acknowledgedCancellation)) {
      return NextResponse.json({ error: 'Action not permitted for current game or player status' }, { status: 400 });
    }

    const appUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    if (action === 'confirm') {
      await updateGameSheet(tabName, [{ rowNumber: tokenData.rowNumber, status: 'Y' }]);
    } else if (action === 'withdraw') {
      await updateGameSheet(tabName, [{ rowNumber: tokenData.rowNumber, status: 'W' }]);
      try {
        await sendWithdrawalEmail(
          tokenData.userName,
          game,
          {
            selected: tokenData.playerSelected,
            team: tokenData.playerTeam,
            position: tokenData.playerPosition,
          },
          appUrl,
          true
        );
      } catch (emailError) {
        console.error('token-action: withdrawal notification email failed:', emailError);
      }
    } else if (action === 'acknowledge') {
      await acknowledgeGameCancellation(tabName, tokenData.userName);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST token-action error:', error);
    return NextResponse.json({ error: 'Failed to perform action' }, { status: 500 });
  }
}
