// app/api/bar/products/route.ts
// GET  — list products (active only, or all for committee via ?all=1)
// POST — create/update a product (Bar person / committee)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { getProducts, saveProduct, setProductActive } from '@/lib/bar-supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const includeInactive = req.nextUrl.searchParams.get('all') === '1' && canUseBarTill(session.user.role);
  try {
    return NextResponse.json({ products: await getProducts(includeInactive) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load products' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  try {
    if (body.setActive !== undefined && body.id) {
      await setProductActive(body.id, !!body.setActive);
    } else {
      if (!body.name || !body.category) {
        return NextResponse.json({ error: 'name and category are required' }, { status: 400 });
      }
      const hasBase = typeof body.basePricePence === 'number';
      const hasSplit = typeof body.pricePence === 'number' && typeof body.nonMemberPricePence === 'number';
      if (!body.id && !hasBase && !hasSplit && !body.variablePrice) {
        return NextResponse.json({ error: 'A price is required' }, { status: 400 });
      }
      if (body.memberDiscountOverridePercent !== undefined && body.memberDiscountOverridePercent !== null) {
        if (typeof body.memberDiscountOverridePercent !== 'number' || body.memberDiscountOverridePercent < 0 || body.memberDiscountOverridePercent > 100) {
          return NextResponse.json({ error: 'memberDiscountOverridePercent must be between 0 and 100' }, { status: 400 });
        }
      }
      await saveProduct(
        {
          id: body.id, name: body.name, category: body.category,
          basePricePence: hasBase ? Math.round(body.basePricePence) : undefined,
          pricePence: typeof body.pricePence === 'number' ? Math.round(body.pricePence) : undefined,
          nonMemberPricePence: typeof body.nonMemberPricePence === 'number' ? Math.round(body.nonMemberPricePence) : undefined,
          memberDiscountOverridePercent: body.memberDiscountOverridePercent === undefined ? undefined : body.memberDiscountOverridePercent,
          nominalCode: body.nominalCode === undefined ? undefined : body.nominalCode,
          variablePrice: body.variablePrice === undefined ? undefined : !!body.variablePrice,
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
