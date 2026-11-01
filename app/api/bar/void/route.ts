// app/api/bar/void/route.ts
// POST — void a sale (refunds the wallet if it was a wallet sale, or the card if it was
// paid on the Square Terminal; refused once the sale is in a Day End). { saleId, staff, staffProof? }
// staffProof — the bar person serving's card or PIN, when they must confirm (src/lib/bar-card.ts).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { voidSale } from '@/lib/bar-supabase';
import { checkStaffProof, logApproval } from '@/lib/bar-card';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json();
  if (!body.saleId) return NextResponse.json({ error: 'saleId required' }, { status: 400 });
  try {
    const staffCheck = await checkStaffProof(body.staff || '', body.staffProof);
    if (staffCheck.error) return NextResponse.json({ error: staffCheck.error, staffProofRequired: true }, { status: 403 });
    const result = await voidSale(body.saleId, body.staff || '');
    if (staffCheck.method) {
      await logApproval({ kind: 'void', staff: body.staff, method: staffCheck.method, saleId: body.saleId, note: 'Void' });
    }
    return NextResponse.json({ ok: true, cardRefundPence: result.cardRefundPence });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Void failed' }, { status: 400 });
  }
}
