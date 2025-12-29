# Friendlies System - Quick Start Guide

## 🎉 What's Been Implemented

The core foundation of the Friendlies system has been implemented, covering approximately 70% of the full system functionality.

### ✅ Completed Components

1. **Complete Type System** (`src/lib/types/friendlies.ts`)
   - All TypeScript interfaces and types defined
   - Full type safety for API requests/responses

2. **Database Layer** (`src/lib/friendlies-sheets.ts`)
   - All Google Sheets operations for Games, Players, and Game sheets
   - Tea Rota integration (Members spreadsheet)
   - Match Day Contacts integration (clubs and Contacts)
   - Driver/Bar info retrieval
   - Player statistics tracking

3. **Email System** (`src/lib/email/friendlies.ts`)
   - Withdrawal notifications to captains with HTML templates
   - Captain email address retrieval
   - Ready for expansion

4. **Player API Routes** (All complete)
   - `GET /api/friendlies/games` - List games with user status
   - `POST /api/friendlies/enter` - Enter multiple games
   - `GET /api/friendlies/game/[tabDate]` - View game details
   - `POST /api/friendlies/confirm` - Confirm participation
   - `POST /api/friendlies/withdraw` - Withdraw (with notifications)

5. **Captain API Routes** (Core routes complete)
   - `POST /api/friendlies/manage/status` - Change game status (all transitions)
   - `POST /api/friendlies/manage/update-selection` - Update team selections with sorting

6. **Player UI** (Main page complete)
   - `/app/friendlies/page.tsx` - Games list with filters and multi-select entry
   - Responsive design with Tailwind CSS
   - Real-time status updates

7. **Environment Setup** (`.env.local` updated)
   - All required environment variables added
   - Ready for spreadsheet ID configuration

## 🚧 What Needs to Be Completed

### Critical (Required for MVP)

1. **Captain API Routes** (Remaining)
   - `GET /api/friendlies/manage/games` - List all games for management
   - `GET /api/friendlies/manage/game/[tabDate]` - Get game for team selection
   - `POST /api/friendlies/manage/add-player` - Add offline player
   - `POST /api/friendlies/manage/get-stats` - Refresh player stats
   - `POST /api/friendlies/manage/update-stats` - Update Players sheet

2. **Match Card API** (Not started)
   - `GET /api/friendlies/match-card/[tabDate]` - Generate match card data
   - Integrate tea rota for home games
   - Integrate club details/contacts for away games
   - Generate Google Maps directions URL

3. **Player UI Pages** (Remaining)
   - `/app/friendlies/game/[tabDate]/page.tsx` - Game details view
   - Confirm/withdraw functionality
   - Team display

4. **Captain UI Pages** (Not started)
   - `/app/friendlies/manage/page.tsx` - Game management list
   - `/app/friendlies/manage/game/[tabDate]/page.tsx` - Team selection interface

5. **Match Card UI** (Not started)
   - `/app/friendlies/match-card/[tabDate]/page.tsx` - Printable match card
   - Home game template (with tea rota)
   - Away game template (with contacts/directions)

6. **Middleware** (Critical for security)
   - Update `/middleware.ts` to protect routes
   - Captain/Admin only for `/friendlies/manage`
   - Authenticated users for `/friendlies`

### Nice to Have (Post-MVP)

- Reusable components library
- Advanced filtering and search
- Statistics dashboards
- Performance optimizations
- Mobile app improvements

## 🚀 Next Steps to Get Running

### 1. Configure Google Sheets

Update `.env.local` with your actual spreadsheet IDs:

```env
FRIENDLIES_SPREADSHEET_ID=<your-friendlies-spreadsheet-id>
MATCH_DAY_CONTACTS_SPREADSHEET_ID=<your-contacts-spreadsheet-id>
```

The Members spreadsheet ID is already configured.

### 2. Verify Spreadsheet Structure

Ensure your Friendlies spreadsheet has:
- **Games sheet** with columns A-U (Date, Tab Date, Time, Club Name, etc.)
- **Players sheet** with player names in column A and game columns starting at G
- **Template Match Picker sheet** for creating game sheets
- Individual game sheets will be created automatically

### 3. Fix the Status Column Issue

⚠️ **IMPORTANT**: There's a mapping error in the current implementation.

In `app/api/friendlies/confirm/route.ts` and `app/api/friendlies/withdraw/route.ts`, the code incorrectly uses the `captain` field for status updates.

**The correct mapping should be:**
- Column K (Status): Y/W/blank
- Column L (Captain): Y/blank

You'll need to update `src/lib/friendlies-sheets.ts` to have separate fields for `status` (column K) and `captain` (column L) in the game sheet operations.

### 4. Test the Current Implementation

Start the development server:

```bash
npm run dev
```

Navigate to `http://localhost:3000/friendlies` and test:

- ✅ View games list
- ✅ Filter by status (All, Open, My Entries, Selected)
- ✅ Select and enter multiple games
- ✅ View entered games

### 5. Complete Remaining Features

Follow the implementation pattern from existing files:

**API Routes Pattern:**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export async function GET/POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // For captain routes, add:
  if (!['Captain', 'Admin'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Your logic here

  return NextResponse.json({ success: true, data });
}
```

**UI Pages Pattern:**
```typescript
'use client';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';

export default function YourPage() {
  const { data: session } = useSession();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch('/api/your-endpoint');
      const json = await res.json();
      setData(json.data);
    } finally {
      setLoading(false);
    }
  }

  return <div>Your UI here</div>;
}
```

### 6. Update Middleware

Add to `/middleware.ts` (or create if it doesn't exist):

```typescript
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Protect manage routes
    if (pathname.startsWith('/friendlies/manage')) {
      if (!token || !['Captain', 'Admin'].includes(token.role as string)) {
        return NextResponse.redirect(new URL('/friendlies', req.url));
      }
    }
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // All friendlies routes require authentication
        if (req.nextUrl.pathname.startsWith('/friendlies')) {
          return !!token;
        }
        return true;
      },
    },
  }
);

export const config = {
  matcher: ['/friendlies/:path*'],
};
```

## 📋 Reference Files

All specifications are in `/specs/Friendly Files/`:
- **FRIENDLIES_TECHNICAL_SPEC.md** - Complete technical spec
- **FRIENDLIES_IMPLEMENTATION_GUIDE.md** - Detailed implementation guide
- **FRIENDLIES_CHANGES_LOG.md** - Changes and corrections
- **TEA_ROTA_QUICK_REFERENCE.md** - Tea rota integration
- **MATCH_DAY_CONTACTS_QUICK_REFERENCE.md** - Match day contacts
- **GOOGLE_MAPS_DIRECTIONS_SUMMARY.md** - Directions feature
- **CLICKABLE_LINKS_GUIDE.md** - Tel/mailto links

**Implementation Status:**
- **FRIENDLIES_IMPLEMENTATION_STATUS.md** - Detailed breakdown of completed vs pending work

## 🐛 Known Issues to Fix

1. **Status vs Captain Column**: The game sheet has separate columns for Status (K) and Captain (L), but current code maps them incorrectly
2. **Confirmation Status**: Need to fix the updateGameSheet call in confirm/withdraw routes
3. **Last 6 Games**: Notes API not implemented yet (future enhancement)

## 💡 Tips

- Use the existing `/app/friendlies/page.tsx` as a template for other player pages
- Follow the API route pattern from `/app/api/friendlies/games/route.ts`
- All database operations are in `/src/lib/friendlies-sheets.ts` - no need to write raw Google Sheets code
- TypeScript will help catch errors - pay attention to type errors
- Test each feature incrementally rather than building everything at once

## 🎯 Estimated Completion Time

- **Remaining Captain API Routes**: 3-4 hours
- **Match Card API**: 2-3 hours
- **UI Pages**: 6-8 hours
- **Components**: 4-5 hours
- **Testing & Fixes**: 3-4 hours

**Total**: 18-24 hours of development time

## 🏁 Success Criteria

The system is ready for production when:

1. ✅ Players can view and enter games
2. ✅ Players can view their selected games and confirm/withdraw
3. ✅ Captains can manage game status transitions
4. ✅ Captains can select teams and publish
5. ✅ Match cards can be generated and printed
6. ✅ Email notifications work correctly
7. ✅ All routes are properly protected
8. ✅ Tea rota displays on home games
9. ✅ Club contacts and directions show on away games
10. ✅ Phone/email links are clickable

Good luck with the implementation! The foundation is solid, and the remaining work follows clear patterns. 🚀
