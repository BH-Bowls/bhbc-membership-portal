// app/api/bar/purchase/route.ts
// POST — charge a basket to a member's wallet. { userName, items:[{productId,qty}], staff, proof? }
// proof — card scan or PIN token, when the member needs one (src/lib/bar-card.ts).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { walletPurchase, type BasketItem } from '@/lib/bar-supabase';
import { checkAccountProof } from '@/lib/bar-card';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const items: BasketItem[] = Array.isArray(body.items) ? body.items : [];
  if (!body.userName || items.length === 0) {
    return NextResponse.json({ error: 'userName and a non-empty basket are required' }, { status: 400 });
  }
  try {
    const proofError = await checkAccountProof(body.userName, body.proof);
    if (proofError) return NextResponse.json({ error: proofError, proofRequired: true }, { status: 403 });
    const result = await walletPurchase(body.userName, items, body.staff || '');
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Purchase failed' }, { status: 400 });
  }
}
