// app/api/unlock/route.ts
// POST — verify the public-access PIN and set the unlock cookie.
// Public (excluded from the middleware matcher) so visitors can unlock the site.

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const pin = process.env.PUBLIC_ACCESS_PIN;

  // Gate not configured — nothing to unlock, treat as success.
  if (!pin) {
    return NextResponse.json({ ok: true });
  }

  let submitted = '';
  try {
    const body = await req.json();
    submitted = typeof body?.pin === 'string' ? body.pin.trim() : '';
  } catch {
    submitted = '';
  }

  if (submitted !== pin) {
    return NextResponse.json({ ok: false, error: 'Incorrect PIN' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('public_access', pin, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
