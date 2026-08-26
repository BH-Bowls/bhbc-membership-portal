// app/api/bar/products/route.ts
// GET  — list products (active only, or all for committee via ?all=1)
// POST — create/update a product (Bar person / committee)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { getProducts, saveProduct, setProductActive } from '@/lib/bar-supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const includeInactive = req.nextUrl.searchParams.get('all') === '1' && isCommitteeMember(session.user.role);
  try {
    return NextResponse.json({ products: await getProducts(includeInactive) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load products' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  try {
    if (body.setActive !== undefined && body.id) {
      await setProductActive(body.id, !!body.setActive);
    } else {
      if (!body.name || !body.category || typeof body.pricePence !== 'number' || typeof body.nonMemberPricePence !== 'number') {
        return NextResponse.json({ error: 'name, category, pricePence and nonMemberPricePence are required' }, { status: 400 });
      }
      await saveProduct(
        {
          id: body.id, name: body.name, category: body.category,
          pricePence: Math.round(body.pricePence), nonMemberPricePence: Math.round(body.nonMemberPricePence),
          sortOrder: body.sortOrder, active: body.active,
        },
        session.user.userName,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save product' }, { status: 500 });
  }
}
