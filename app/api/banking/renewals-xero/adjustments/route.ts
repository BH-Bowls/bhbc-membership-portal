// app/api/banking/renewals-xero/adjustments/route.ts
// POST { userName, kind: 'charge'|'credit'|'refund', feeType?, refundVia?, amount, reason }
// — the treasurer's financial corrections after submit (spec §6.7). The member's form
// stays locked; these change what they owe and go in the next Xero export.

import { NextRequest, NextResponse } from 'next/server';
import { recordAdjustment, getMemberAccount, type AdjustmentKind, type FeeType } from '@/lib/renewals-xero';
import { getRenewalsXeroUser } from '../guard';

const KINDS = ['charge', 'credit', 'refund'];
const FEE_TYPES = ['playing', 'social', 'competitions', '200_club'];

export async function POST(request: NextRequest) {
  const user = await getRenewalsXeroUser();
  if (!user) return NextResponse.json({ error: 'Admin or Treasurer access required' }, { status: 403 });
  try {
    const body = await request.json();
    const userName = typeof body.userName === 'string' ? body.userName : '';
    let kind: AdjustmentKind | null = null;
    if (typeof body.kind === 'string' && KINDS.includes(body.kind)) kind = body.kind as AdjustmentKind;
    if (!userName || !kind) {
      return NextResponse.json({ error: 'Choose a member and the kind of adjustment' }, { status: 400 });
    }
    let feeType: FeeType | null = null;
    if (typeof body.feeType === 'string' && FEE_TYPES.includes(body.feeType)) feeType = body.feeType as FeeType;
    let refundVia: 'bank' | 'stripe' | null = null;
    if (body.refundVia === 'bank' || body.refundVia === 'stripe') refundVia = body.refundVia;

    await recordAdjustment({
      userName,
      kind,
      feeType,
      refundVia,
      amount: Number(body.amount),
      reason: typeof body.reason === 'string' ? body.reason : '',
      createdBy: user,
    });
    return NextResponse.json({ success: true, account: await getMemberAccount(userName) });
  } catch (error) {
    console.error('[POST /api/banking/renewals-xero/adjustments] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to record adjustment' }, { status: 400 });
  }
}
