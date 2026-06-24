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

  const secure = process.env.NODE_ENV === 'production';
  const maxAge = 60 * 60 * 24 * 30; // 30 days
  const res = NextResponse.json({ ok: true });
  // The gate cookie — httpOnly so JS can't read the PIN.
  res.cookies.set('public_access', pin, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge });
  // A readable marker (no PIN) so the Navbar can show "Members Area Active".
  res.cookies.set('members_area', '1', { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge });
  return res;
}

// DELETE — leave the members area (clear both cookies). Re-gates the visitor.
export async function DELETE() {
  const secure = process.env.NODE_ENV === 'production';
  const res = NextResponse.json({ ok: true });
  res.cookies.set('public_access', '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
  res.cookies.set('members_area', '', { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
