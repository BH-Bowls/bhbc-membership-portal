// app/api/webhooks/square/route.ts
// POST — Square's webhook for Terminal checkouts (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §10).
// Public (no session — see proxy.ts); every request must carry a valid
// x-square-hmacsha256-signature for SQUARE_WEBHOOK_SIGNATURE_KEY, or it gets 403.
//
// The till polls too, so this is the safety net for a till that's closed or lost its
// connection mid-payment. It doesn't trust the event body: it looks the checkout up on
// Square and records it from our own square_checkouts row (once — see bar-square.ts).

import { NextRequest, NextResponse } from 'next/server';
import { verifySquareWebhook } from '@/lib/square';
import { refreshTerminalCheckout } from '@/lib/bar-square';

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (!verifySquareWebhook(body, request.headers.get('x-square-hmacsha256-signature'), request.url)) {
    console.error('Square webhook signature check failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  let event: any = {};
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const type = String(event.type || '');
  if (type !== 'terminal.checkout.updated' && type !== 'terminal.checkout.created') {
    return NextResponse.json({ received: true });
  }

  let checkoutId = '';
  if (event.data && event.data.object && event.data.object.checkout) {
    checkoutId = String(event.data.object.checkout.id || '');
  }
  if (!checkoutId && event.data) checkoutId = String(event.data.id || '');
  if (!checkoutId) return NextResponse.json({ received: true });

  try {
    const checkout = await refreshTerminalCheckout(checkoutId);
    console.log(`Square webhook ${type} ${checkoutId}: ${checkout.status}${checkout.recorded ? ', recorded' : ''}`);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Terminal payment not found') {
      // Not one of ours (e.g. taken on the Terminal's own keypad)
      return NextResponse.json({ received: true });
    }
    console.error(`Square webhook ${type} ${checkoutId} failed:`, message);
    // 500 makes Square retry
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
