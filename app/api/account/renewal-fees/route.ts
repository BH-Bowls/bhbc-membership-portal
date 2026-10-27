// app/api/account/renewal-fees/route.ts
// GET — the My Account membership fee card (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §7):
// this season's renewal state and amount outstanding for the logged-in member and
// anyone who has them as their buddy, plus the bank details and payment reference to
// show for a bank transfer.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers } from '@/lib/members-supabase';
import { getRenewalFeeStatuses, getCurrentSeasonYear, getPaymentReference } from '@/lib/renewals-supabase';
import { getBankDetails } from '@/lib/bank-details';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const myUserName = session.user.userName;

  try {
    const allUsers = await getAllUsers();

    // Self first, then the members they manage as a buddy (by name)
    const members: Array<{ userName: string; fullName: string; isSelf: boolean }> = [];
    const managed: Array<{ userName: string; fullName: string; isSelf: boolean }> = [];
    for (const u of allUsers) {
      if (!u.userName) continue;
      if (u.userName.toLowerCase() === myUserName.toLowerCase()) {
        members.push({ userName: u.userName, fullName: u.fullName || u.userName, isSelf: true });
      } else if (u.buddyUserName && u.buddyUserName.toLowerCase() === myUserName.toLowerCase()) {
        managed.push({ userName: u.userName, fullName: u.fullName || u.userName, isSelf: false });
      }
    }
    managed.sort((a, b) => a.fullName.localeCompare(b.fullName));
    for (const m of managed) {
      members.push(m);
    }

    const userNames: string[] = [];
    for (const m of members) {
      userNames.push(m.userName);
    }
    const [statuses, bankDetails] = await Promise.all([
      getRenewalFeeStatuses(userNames),
      getBankDetails(),
    ]);

    const items = [];
    for (let i = 0; i < members.length; i++) {
      items.push({
        userName: members[i].userName,
        fullName: members[i].fullName,
        isSelf: members[i].isSelf,
        state: statuses[i].state,
        totalFee: statuses[i].totalFee,
        outstanding: statuses[i].outstanding,
        paymentReference: getPaymentReference(members[i].userName),
      });
    }

    return NextResponse.json({
      seasonYear: getCurrentSeasonYear(),
      bankDetails: bankDetails,
      items: items,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load membership fees';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
