// app/api/bar/categories/route.ts
// GET  — list product categories (active only, or all for committee via ?all=1)
// POST — create/update a category, or toggle active (Bar person / committee) — see
// the "Manage Categories" section on the Products screen (app/bar/page.tsx).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { getCategories, saveCategory, setCategoryActive } from '@/lib/bar-supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const includeInactive = req.nextUrl.searchParams.get('all') === '1' && canUseBarTill(session.user.role);
  try {
    return NextResponse.json({ categories: await getCategories(includeInactive) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load categories' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  try {
    if (body.setActive !== undefined && body.key) {
      await setCategoryActive(body.key, !!body.setActive);
    } else {
      if (!body.key || !body.label || !body.colorKey) {
        return NextResponse.json({ error: 'key, label and colorKey are required' }, { status: 400 });
      }
      await saveCategory({
        key: body.key, label: body.label, colorKey: body.colorKey,
        nominalCode: body.nominalCode === undefined ? undefined : body.nominalCode,
        sortOrder: body.sortOrder, active: body.active, isNew: !!body.isNew,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save category' }, { status: 500 });
  }
}
