// app/api/bar/cards/assign/route.ts
// POST { userName, code, staff, proof } — give a member a blank bar card at the till
// (src/lib/bar-card.ts). Their previous card stops working; their phone QR switches to
// the new card's code. proof is the member's phone QR / current card / PIN, or the bar
// person serving (staff) approving with their own (serverApproval) — always needed,
// whatever the bar_account_proof setting. Records when, and that staff did it.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { assignCard, checkCardAssignProof } from '@/lib/bar-card';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const userName = typeof body.userName === 'string' ? body.userName : '';
  const code = typeof body.code === 'string' ? body.code : '';
  const staff = typeof body.staff === 'string' ? body.staff : '';
  if (!userName || !code) return NextResponse.json({ error: 'userName and code are required' }, { status: 400 });
  if (!staff) return NextResponse.json({ error: 'Select who’s serving first.' }, { status: 400 });

  try {
    const proofError = await checkCardAssignProof(userName, body.proof, staff);
    if (proofError) return NextResponse.json({ error: proofError, proofRequired: true }, { status: 403 });
    const issued = await assignCard(userName, code, staff);
    return NextResponse.json({ ok: true, cardIssuedAt: issued.issuedAt, cardIssuedBy: issued.issuedBy });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to assign the card' }, { status: 400 });
  }
}
