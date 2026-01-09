# Full User Impersonation System - Technical Specification

## Document Information
- **Source Project**: TDC Portal (Tapestry Day Club)
- **Target Project**: Bowls Club Portal
- **Created**: 2025-12-30
- **Version**: 1.0

---

## Executive Summary

This specification describes a complete user impersonation system that allows administrators to "switch user" and view/interact with the portal as if they were logged in as another user. This extends the existing buddy system (which only works in Profile and Renewals pages) to work system-wide across all pages and features.

### Key Features
- **System-wide impersonation** - Works across entire application, not just specific pages
- **Role-based permissions** - Super Admins can impersonate anyone; Admins can only impersonate lower-privilege roles
- **Visual indicators** - Orange profile icon, impersonation badges, clear UI feedback
- **Exit impersonation** - Easy way to return to original admin account
- **Full audit logging** - All impersonation sessions logged to Google Sheets
- **Security** - Server-side validation, no client-side bypass possible
- **Seamless UX** - Users see exactly what the impersonated user would see

---

## Architecture Overview

### Current State (Bowls Club)
The existing buddy system:
- Implemented in **Profile** and **Renewals** pages only
- Allows admins to impersonate anyone
- Allows spouses to view each other's data
- Limited to specific page-level implementations

### Target State (Full Impersonation)
The new system will:
- Work **system-wide** across all pages and API endpoints
- Store impersonation state in **JWT token** (no database sessions needed)
- Preserve original admin identity while switching to impersonated user
- Automatically show/hide UI elements based on impersonated user's role
- Log all impersonation activity for security auditing

### Design Decision: JWT-Based Impersonation

**Why JWT?** Both projects use NextAuth.js with JWT strategy (no database sessions). All session data is stored in encrypted client-side cookies.

**Approach**: Extend the JWT token to store both:
1. **Current user** - The person being impersonated (or the original user if not impersonating)
2. **Original admin** - The real logged-in admin (only present when impersonating)

This allows the server to know:
- Who the current request is "acting as" (for permissions, data filtering, etc.)
- Who the real admin is (for audit logging, security checks, impersonation controls)

---

## JWT Token Structure

### Extended JWT Interface

```typescript
interface JWT {
  // Existing fields
  role: string;
  name: string;
  email: string;
  loginTime: number;

  // NEW - Impersonation tracking
  isImpersonating?: boolean;
  originalAdmin?: {
    email: string;
    name: string;
    role: string;
  };
  impersonationStartTime?: number;
  impersonationSessionId?: string; // UUID for audit trail
}
```

### Extended Session Interface

```typescript
interface Session {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role: string;

    // NEW - Impersonation fields
    isImpersonating?: boolean;
    originalAdmin?: {
      email: string;
      name: string;
      role: string;
    };
  };
}
```

### How It Works

1. **Normal login** (not impersonating):
   ```json
   {
     "email": "admin@bowls.com",
     "name": "Admin User",
     "role": "Super Admin",
     "isImpersonating": false
   }
   ```

2. **While impersonating**:
   ```json
   {
     "email": "member@bowls.com",      // Current = impersonated user
     "name": "Member Name",
     "role": "Member",
     "isImpersonating": true,
     "originalAdmin": {                  // Real admin identity preserved
       "email": "admin@bowls.com",
       "name": "Admin User",
       "role": "Super Admin"
     },
     "impersonationSessionId": "uuid-here"
   }
   ```

---

## Database Changes

### New Google Sheets Tab: ImpersonationLog

Create a new sheet to track all impersonation activity:

**Sheet Name**: `ImpersonationLog`

**Columns** (in order):
1. **ID** - Sequential number
2. **Session ID** - UUID identifying this impersonation session
3. **Action** - "START" or "STOP"
4. **Admin Email** - Email of the admin doing the impersonating
5. **Admin Name** - Full name of the admin
6. **Admin Role** - Role of the admin (Super Admin, Admin, etc.)
7. **Target Email** - Email of user being impersonated (blank for STOP)
8. **Target Name** - Full name of user being impersonated (blank for STOP)
9. **Target Role** - Role of user being impersonated (blank for STOP)
10. **IP Address** - IP address of the admin's request
11. **User Agent** - Browser/device information
12. **Timestamp** - ISO 8601 timestamp

**Example Data**:
```
1 | abc-123 | START | admin@bowls.com | Admin User | Super Admin | member@bowls.com | John Member | Member | 192.168.1.5 | Mozilla/5.0... | 2025-12-30T10:00:00Z
2 | abc-123 | STOP  | admin@bowls.com | Admin User | Super Admin | member@bowls.com | John Member | Member | 192.168.1.5 | Mozilla/5.0... | 2025-12-30T10:15:00Z
```

### Updates to LoginAttempts Sheet (Bonus Fix)

While implementing impersonation, we also fixed login attempt logging to capture:
- **User Name** - Full name (not email) of the user attempting login
- **IP Address** - Actual IP address from request headers
- **User Agent** - Browser information from request headers

These were previously empty or incorrect.

---

## Implementation Steps

### Phase 1: Type Definitions & Infrastructure

#### 1.1 Update TypeScript Definitions

**File**: `src/types/next-auth.d.ts` (or wherever NextAuth types are extended)

```typescript
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth/jwt' {
  interface JWT {
    role: string;
    name: string;
    email: string;
    loginTime: number;

    // Impersonation fields
    isImpersonating?: boolean;
    originalAdmin?: {
      email: string;
      name: string;
      role: string;
    };
    impersonationStartTime?: number;
    impersonationSessionId?: string;
  }
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      role: string;

      // Impersonation fields
      isImpersonating?: boolean;
      originalAdmin?: {
        email: string;
        name: string;
        role: string;
      };
    };
  }
}
```

#### 1.2 Install Dependencies

```bash
npm install uuid
npm install --save-dev @types/uuid
```

#### 1.3 Add Role Validation Functions

**File**: `src/lib/auth-sheets.ts` (or equivalent auth utilities file)

Add these two functions for role-based permission checks:

```typescript
/**
 * Check if a user can impersonate another user based on role hierarchy
 * Super Admins can impersonate anyone (including other Super Admins)
 * Admins can only impersonate Member, Captain, Treasurer roles
 * All other roles cannot impersonate
 */
export function canImpersonate(
  impersonatorRole: string,
  targetRole: string
): boolean {
  // Super Admins can impersonate anyone
  if (impersonatorRole === 'Super Admin') {
    return true;
  }

  // Admins can impersonate these roles only
  if (impersonatorRole === 'Admin') {
    // ADJUST THESE ROLES to match your Bowls Club roles
    const allowedTargetRoles = ['Member', 'Captain', 'Treasurer'];
    return allowedTargetRoles.includes(targetRole);
  }

  // No other roles can impersonate
  return false;
}

/**
 * Get list of roles that a user can impersonate
 * Returns array of role names based on the impersonator's role
 * Used for filtering user lists in impersonation UI
 */
export function getImpersonatableRoles(impersonatorRole: string): string[] {
  // Super Admins can impersonate anyone
  if (impersonatorRole === 'Super Admin') {
    // ADJUST THESE ROLES to match ALL roles in your Bowls Club system
    return ['Super Admin', 'Admin', 'Member', 'Captain', 'Treasurer'];
  }

  // Admins can impersonate lower privilege roles only
  if (impersonatorRole === 'Admin') {
    // ADJUST THESE ROLES to match your Bowls Club roles
    return ['Member', 'Captain', 'Treasurer'];
  }

  // No other roles can impersonate
  return [];
}
```

**IMPORTANT**: Adjust the role names (`'Member'`, `'Captain'`, etc.) to match the actual role names used in your Bowls Club system.

#### 1.4 Add Audit Logging Function

**File**: `src/lib/sheets.ts` (or equivalent Google Sheets utilities file)

```typescript
/**
 * Log an impersonation event to the ImpersonationLog sheet
 * Records all start/stop impersonation actions for security auditing
 */
export async function logImpersonationEvent(event: {
  sessionId: string;
  action: 'START' | 'STOP';
  adminEmail: string;
  adminName: string;
  adminRole: string;
  targetEmail?: string | null;
  targetName?: string | null;
  targetRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    const sheets = getGoogleSheetsClient();

    // Get next ID by counting rows
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'ImpersonationLog!A:A',
    });

    const nextId = (response.data.values?.length || 1);
    const now = new Date().toISOString();

    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'ImpersonationLog!A:L',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          nextId,
          event.sessionId,
          event.action,
          event.adminEmail,
          event.adminName,
          event.adminRole,
          event.targetEmail || '',
          event.targetName || '',
          event.targetRole || '',
          event.ipAddress || '',
          event.userAgent || '',
          now
        ]]
      }
    });
  } catch (error) {
    console.error('Error logging impersonation event:', error);
    // Don't throw - logging failure shouldn't break impersonation
  }
}
```

---

### Phase 2: NextAuth Configuration

#### 2.1 Update JWT Callback

**File**: `src/lib/auth.ts` (or wherever NextAuth authOptions are configured)

**Locate**: The `jwt` callback in your NextAuth configuration

**Modify**: Update the callback to handle impersonation state changes:

```typescript
async jwt({ token, user, trigger, session }) {
  // Initial sign-in - set up token with user data
  if (user) {
    token.role = user.role;
    token.name = user.name;
    token.email = user.email;
    token.loginTime = Date.now();

    // Initialize impersonation fields (not impersonating at login)
    token.isImpersonating = false;
    token.originalAdmin = undefined;
    token.impersonationStartTime = undefined;
    token.impersonationSessionId = undefined;
  }

  // Handle session updates triggered by API endpoints
  if (trigger === 'update' && session) {
    // Start impersonation
    if (session.action === 'START_IMPERSONATION') {
      // Store original admin info before switching
      token.originalAdmin = {
        email: token.email as string,
        name: token.name as string,
        role: token.role as string,
      };

      // Switch to impersonated user
      token.email = session.targetUser.email;
      token.name = session.targetUser.name;
      token.role = session.targetUser.role;
      token.isImpersonating = true;
      token.impersonationStartTime = Date.now();
      token.impersonationSessionId = session.sessionId;
    }

    // Stop impersonation
    if (session.action === 'STOP_IMPERSONATION') {
      // Restore original admin info
      if (token.originalAdmin) {
        token.email = token.originalAdmin.email;
        token.name = token.originalAdmin.name;
        token.role = token.originalAdmin.role;
      }

      // Clear impersonation fields
      token.isImpersonating = false;
      token.originalAdmin = undefined;
      token.impersonationStartTime = undefined;
      token.impersonationSessionId = undefined;
    }
  }

  return token;
}
```

**Key Concepts**:
- `trigger === 'update'` - Fired when `update()` is called from client-side code
- `session.action` - Custom field we use to indicate START or STOP
- We preserve original admin in `token.originalAdmin` before switching

#### 2.2 Update Session Callback

**File**: `src/lib/auth.ts` (same file as above)

**Locate**: The `session` callback in your NextAuth configuration

**Modify**: Add impersonation fields to the session object sent to client:

```typescript
async session({ session, token }) {
  // Existing session expiration check (keep your existing code)
  const threeMonthsInMs = 90 * 24 * 60 * 60 * 1000;
  const loginTime = token.loginTime as number;

  if (loginTime) {
    const currentTime = Date.now();
    const timeSinceLogin = currentTime - loginTime;

    if (timeSinceLogin > threeMonthsInMs) {
      throw new Error('Session expired');
    }
  }

  // Add user fields to session (existing code)
  if (session.user) {
    session.user.role = token.role as string;
    session.user.name = token.name as string;
    session.user.email = token.email as string;

    // NEW: Add impersonation fields to session
    session.user.isImpersonating = token.isImpersonating || false;
    if (token.originalAdmin) {
      session.user.originalAdmin = token.originalAdmin;
    }
  }

  return session;
}
```

---

### Phase 3: API Endpoints

Create three new API endpoints for impersonation control.

#### 3.1 Start Impersonation Endpoint

**File**: `app/api/admin/impersonate/start/route.ts` (NEW FILE)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByEmail } from '@/lib/sheets';
import { canImpersonate } from '@/lib/auth-sheets';
import { logImpersonationEvent } from '@/lib/sheets';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    // Get current session
    const session = await getServerSession(authOptions);

    // Auth check - must be logged in with a role
    if (!session?.user?.email || !session?.user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins can impersonate
    const isAdmin = session.user.role === 'Super Admin' || session.user.role === 'Admin';
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    // Check if already impersonating
    if (session.user.isImpersonating) {
      return NextResponse.json(
        { error: 'Already impersonating. Exit current session first.' },
        { status: 400 }
      );
    }

    // Get target user from request body
    const { targetEmail } = await request.json();

    if (!targetEmail) {
      return NextResponse.json(
        { error: 'Target email required' },
        { status: 400 }
      );
    }

    // Fetch target user from database
    const targetUser = await getUserByEmail(targetEmail);

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (!targetUser.active) {
      return NextResponse.json(
        { error: 'Cannot impersonate inactive user' },
        { status: 400 }
      );
    }

    // Validate role hierarchy - can this admin impersonate this role?
    if (!canImpersonate(session.user.role, targetUser.role)) {
      return NextResponse.json(
        { error: `Cannot impersonate users with role: ${targetUser.role}` },
        { status: 403 }
      );
    }

    // Prevent self-impersonation
    if (targetEmail.toLowerCase() === session.user.email.toLowerCase()) {
      return NextResponse.json(
        { error: 'Cannot impersonate yourself' },
        { status: 400 }
      );
    }

    // Generate unique session ID for audit trail
    const sessionId = uuidv4();

    // Log impersonation start event
    await logImpersonationEvent({
      sessionId,
      action: 'START',
      adminEmail: session.user.email,
      adminName: session.user.name || '',
      adminRole: session.user.role,
      targetEmail: targetUser.emailAddress,
      targetName: `${targetUser.firstName} ${targetUser.lastName}`,
      targetRole: targetUser.role,
      ipAddress: request.headers.get('x-forwarded-for') ||
                 request.headers.get('x-real-ip') ||
                 '',
      userAgent: request.headers.get('user-agent') || '',
    });

    // Return data for JWT update
    // This will be passed to the JWT callback via update()
    return NextResponse.json({
      success: true,
      action: 'START_IMPERSONATION',
      targetUser: {
        email: targetUser.emailAddress,
        name: `${targetUser.firstName} ${targetUser.lastName}`.trim(),
        role: targetUser.role,
      },
      sessionId,
    });

  } catch (error) {
    console.error('Error starting impersonation:', error);
    return NextResponse.json(
      { error: 'Failed to start impersonation' },
      { status: 500 }
    );
  }
}
```

#### 3.2 Stop Impersonation Endpoint

**File**: `app/api/admin/impersonate/stop/route.ts` (NEW FILE)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { logImpersonationEvent } from '@/lib/sheets';

export async function POST(request: NextRequest) {
  try {
    // Get current session
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Must be currently impersonating to stop
    if (!session.user.isImpersonating || !session.user.originalAdmin) {
      return NextResponse.json(
        { error: 'Not currently impersonating' },
        { status: 400 }
      );
    }

    const { sessionId } = await request.json();

    // Log stop event
    await logImpersonationEvent({
      sessionId: sessionId || 'unknown',
      action: 'STOP',
      adminEmail: session.user.originalAdmin.email,
      adminName: session.user.originalAdmin.name,
      adminRole: session.user.originalAdmin.role,
      targetEmail: session.user.email,
      targetName: session.user.name || '',
      targetRole: session.user.role,
      ipAddress: request.headers.get('x-forwarded-for') ||
                 request.headers.get('x-real-ip') ||
                 '',
      userAgent: request.headers.get('user-agent') || '',
    });

    // Return data for JWT update
    return NextResponse.json({
      success: true,
      action: 'STOP_IMPERSONATION',
    });

  } catch (error) {
    console.error('Error stopping impersonation:', error);
    return NextResponse.json(
      { error: 'Failed to stop impersonation' },
      { status: 500 }
    );
  }
}
```

#### 3.3 Get Impersonatable Users Endpoint

**File**: `app/api/admin/impersonate/users/route.ts` (NEW FILE)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers } from '@/lib/sheets';
import { getImpersonatableRoles } from '@/lib/auth-sheets';

export async function GET(request: NextRequest) {
  try {
    // Get current session
    const session = await getServerSession(authOptions);

    if (!session?.user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Authorization check
    const isAdmin = session.user.role === 'Super Admin' || session.user.role === 'Admin';
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    // Get allowed target roles based on admin's role
    const allowedRoles = getImpersonatableRoles(session.user.role);

    // Get all users from database
    const allUsers = await getAllUsers();

    // Filter to active users with allowed roles (exclude self)
    const impersonatableUsers = allUsers
      .filter(user =>
        user.active &&
        allowedRoles.includes(user.role) &&
        user.emailAddress.toLowerCase() !== session.user.email?.toLowerCase()
      )
      .map(user => ({
        email: user.emailAddress,
        name: `${user.firstName} ${user.lastName}`.trim(),
        role: user.role,
        lastLoginDate: user.lastLoginDate,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      users: impersonatableUsers,
      count: impersonatableUsers.length,
    });

  } catch (error) {
    console.error('Error fetching impersonatable users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
```

---

### Phase 4: Client-Side Components

#### 4.1 Create Custom Hook

**File**: `src/hooks/useImpersonation.ts` (NEW FILE)

```typescript
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export function useImpersonation() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startImpersonation = async (targetEmail: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/impersonate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start impersonation');
      }

      // CRITICAL: Trigger NextAuth session update
      // This calls the JWT callback with trigger='update' and session=data
      await update(data);

      // Force page reload to reflect new session
      router.refresh();
      window.location.reload();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsLoading(false);
    }
  };

  const stopImpersonation = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/impersonate/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'stored-in-jwt' }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to stop impersonation');
      }

      // Trigger NextAuth session update to clear impersonation
      await update(data);

      // Force page reload to reflect restored session
      router.refresh();
      window.location.reload();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsLoading(false);
    }
  };

  return {
    isImpersonating: session?.user?.isImpersonating || false,
    originalAdmin: session?.user?.originalAdmin,
    startImpersonation,
    stopImpersonation,
    isLoading,
    error,
  };
}
```

**CRITICAL NOTE**: The `await update(data)` call is what triggers NextAuth's JWT callback to update the token. Without this, impersonation won't work.

#### 4.2 Create Impersonation Modal

**File**: `src/components/ImpersonationModal.tsx` (NEW FILE)

This modal displays a searchable list of users that can be impersonated.

```typescript
'use client';

import { useState, useEffect } from 'react';
// ADJUST IMPORTS to match your UI component library
import { Modal, Input, Alert } from '@/components/ui';

interface User {
  email: string;
  name: string;
  role: string;
  lastLoginDate: string | null;
}

interface ImpersonationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImpersonate: (email: string) => void;
}

export function ImpersonationModal({
  isOpen,
  onClose,
  onImpersonate
}: ImpersonationModalProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Load users when modal opens
  useEffect(() => {
    if (isOpen) {
      loadUsers();
      setSearchTerm(''); // Reset search
    }
  }, [isOpen]);

  // Filter users based on search term
  useEffect(() => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const filtered = users.filter(user =>
        user.name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        user.role.toLowerCase().includes(term)
      );
      setFilteredUsers(filtered);
    } else {
      setFilteredUsers(users);
    }
  }, [searchTerm, users]);

  const loadUsers = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/admin/impersonate/users');

      if (!response.ok) {
        throw new Error('Failed to load users');
      }

      const data = await response.json();
      setUsers(data.users || []);
      setFilteredUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImpersonate = (email: string) => {
    onImpersonate(email);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Switch User" size="lg">
      <div className="space-y-4">
        {error && <Alert variant="error" message={error} />}

        <Input
          type="text"
          placeholder="Search by name, email, or role..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        {isLoading ? (
          <div className="text-center py-8 text-gray-500">
            Loading users...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchTerm ? 'No users found' : 'No users available to impersonate'}
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-2">
            {filteredUsers.map(user => (
              <div
                key={user.email}
                className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => handleImpersonate(user.email)}
              >
                <div className="font-medium text-gray-900">{user.name}</div>
                <div className="text-sm text-gray-600">{user.email}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded">
                    {user.role}
                  </span>
                  {user.lastLoginDate && (
                    <span className="text-xs text-gray-500">
                      Last login: {new Date(user.lastLoginDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
```

**IMPORTANT**: Adjust the imports and UI component usage to match your Bowls Club project's component library.

#### 4.3 Update Navbar Component

**File**: `src/components/Navbar.tsx` (or your main navigation component)

Add impersonation controls to the user profile dropdown menu.

**Step 1: Add imports**

```typescript
import { useImpersonation } from '@/hooks/useImpersonation';
import { ImpersonationModal } from '@/components/ImpersonationModal';
```

**Step 2: Add state and hook**

```typescript
// Inside your Navbar component
const [impersonationModalOpen, setImpersonationModalOpen] = useState(false);
const {
  isImpersonating,
  originalAdmin,
  startImpersonation,
  stopImpersonation
} = useImpersonation();

// Create TWO separate admin checks:
// 1. Real admin (for impersonation controls) - checks original admin's role
const isRealAdmin = originalAdmin
  ? (originalAdmin.role === 'Admin' || originalAdmin.role === 'Super Admin')
  : (userRole === 'Admin' || userRole === 'Super Admin');

// 2. Current user admin (for navigation) - checks current/impersonated user's role
const isCurrentUserAdmin = userRole === 'Admin' || userRole === 'Super Admin';
```

**Step 3: Update profile icon color**

```typescript
{/* Profile Icon Button */}
<button
  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
  className={`flex items-center justify-center h-10 w-10 rounded-full text-white font-medium transition-colors ${
    isImpersonating
      ? 'bg-orange-500 hover:bg-orange-600'  // Orange when impersonating
      : 'bg-indigo-600 hover:bg-indigo-700'  // Indigo normally
  }`}
  title={isImpersonating ? `Impersonating ${userName}` : userName || 'User Profile'}
>
  {getUserInitials(userName)}
</button>
```

**Step 4: Update navigation items**

Use `isCurrentUserAdmin` for showing admin menu items (not `isRealAdmin`):

```typescript
// In your navigation items array
...(isCurrentUserAdmin ? [{
  name: 'Admin',
  // ... admin menu items
}] : []),
```

This ensures the Admin menu is HIDDEN when impersonating a non-admin user.

**Step 5: Add impersonation controls to dropdown**

```typescript
{profileMenuOpen && (
  <div className="profile-dropdown">
    {/* User name header */}
    {userName && (
      <div className="px-4 py-2 text-sm font-medium text-gray-900 border-b border-gray-200">
        {userName}
        {isImpersonating && (
          <div className="text-xs text-orange-600 font-normal mt-1">
            Impersonating
          </div>
        )}
      </div>
    )}

    {/* Show original admin when impersonating */}
    {isImpersonating && originalAdmin && (
      <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-200">
        Logged in as: {originalAdmin.name}
      </div>
    )}

    {/* Impersonation controls - MOVED to appear right after name */}
    {isRealAdmin && (
      <>
        {isImpersonating ? (
          <button
            onClick={() => {
              stopImpersonation();
              setProfileMenuOpen(false);
            }}
            className="block w-full text-left px-4 py-2 text-sm text-orange-700 hover:bg-orange-50 border-b border-gray-200"
          >
            Exit Impersonation
          </button>
        ) : (
          <button
            onClick={() => {
              setImpersonationModalOpen(true);
              setProfileMenuOpen(false);
            }}
            className="block w-full text-left px-4 py-2 text-sm text-indigo-700 hover:bg-indigo-50 border-b border-gray-200"
          >
            Switch User
          </button>
        )}
      </>
    )}

    {/* Profile link */}
    <Link href="/profile" onClick={() => setProfileMenuOpen(false)}>
      Profile
    </Link>

    {/* Change Password link */}
    <Link href="/change-password" onClick={() => setProfileMenuOpen(false)}>
      Change Password
    </Link>

    {/* Logout button */}
    <button onClick={handleSignOut}>Logout</button>
  </div>
)}

{/* Impersonation Modal - outside dropdown */}
<ImpersonationModal
  isOpen={impersonationModalOpen}
  onClose={() => setImpersonationModalOpen(false)}
  onImpersonate={startImpersonation}
/>
```

**Key UI/UX Points**:
- **Orange icon** = impersonating (immediate visual indicator)
- **"Exit Impersonation"** appears right after the "Logged in as:" line
- **"Switch User"** appears in same place when not impersonating
- Admin menu items are hidden when impersonating non-admin

---

## Security Considerations

### Server-Side Validation

**CRITICAL**: All impersonation checks MUST happen server-side. Never trust client-side state.

```typescript
// ✅ GOOD - Server-side check
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  // Check the current session role (which reflects impersonation)
  if (session.user.role !== 'Admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ... proceed with admin operation
}

// ❌ BAD - Client-side only check
function AdminPage() {
  const { data: session } = useSession();

  if (session.user.role !== 'Admin') {
    return <div>Access denied</div>;
  }

  // This is NOT secure - still render admin page on client
}
```

### Role Hierarchy

The `canImpersonate()` function enforces role hierarchy:
- **Super Admins** can impersonate ANYONE (including other Super Admins)
- **Admins** can ONLY impersonate lower-privilege roles (Members, Captains, etc.)
- **No other roles** can impersonate

This is validated server-side in the `/api/admin/impersonate/start` endpoint.

### Audit Trail

Every impersonation session generates TWO log entries:
1. **START** - When impersonation begins
2. **STOP** - When impersonation ends

Each entry includes:
- Session ID (UUID) - Links START and STOP together
- Admin identity (email, name, role)
- Target user identity (email, name, role)
- IP address and user agent
- Timestamp

This creates a complete audit trail for security reviews.

### Session Security

- **JWT is encrypted** by NextAuth - stored in httpOnly cookie
- **Cannot be modified client-side** - all changes go through server
- **Impersonation state is server-side** - client can't fake it
- **Session expiration still enforced** - 90-day absolute limit (adjust as needed)

### Prevention of Nested Impersonation

The start endpoint checks:
```typescript
if (session.user.isImpersonating) {
  return NextResponse.json(
    { error: 'Already impersonating. Exit current session first.' },
    { status: 400 }
  );
}
```

This prevents "impersonate while impersonating" which would create confusion and security risks.

### Self-Impersonation Prevention

```typescript
if (targetEmail.toLowerCase() === session.user.email.toLowerCase()) {
  return NextResponse.json(
    { error: 'Cannot impersonate yourself' },
    { status: 400 }
  );
}
```

Prevents pointless self-impersonation.

---

## Testing Checklist

### Unit Tests (Role Validation)

- [ ] `canImpersonate('Super Admin', 'Super Admin')` returns `true`
- [ ] `canImpersonate('Super Admin', 'Admin')` returns `true`
- [ ] `canImpersonate('Super Admin', 'Member')` returns `true`
- [ ] `canImpersonate('Admin', 'Super Admin')` returns `false`
- [ ] `canImpersonate('Admin', 'Admin')` returns `false`
- [ ] `canImpersonate('Admin', 'Member')` returns `true`
- [ ] `canImpersonate('Member', 'Admin')` returns `false`
- [ ] `getImpersonatableRoles('Super Admin')` returns all roles
- [ ] `getImpersonatableRoles('Admin')` returns only lower-privilege roles
- [ ] `getImpersonatableRoles('Member')` returns empty array

### Integration Tests (API Endpoints)

- [ ] Start impersonation succeeds for Super Admin → any user
- [ ] Start impersonation succeeds for Admin → Member
- [ ] Start impersonation fails for Admin → Super Admin (403 error)
- [ ] Start impersonation fails for Member → any user (403 error)
- [ ] Start impersonation fails when already impersonating (400 error)
- [ ] Start impersonation fails for inactive users (400 error)
- [ ] Start impersonation fails for self (400 error)
- [ ] Stop impersonation succeeds when impersonating
- [ ] Stop impersonation fails when not impersonating (400 error)
- [ ] Get users endpoint returns only impersonatable users for role
- [ ] Get users endpoint excludes self from list
- [ ] Get users endpoint excludes inactive users

### Manual UI Testing

- [ ] "Switch User" button appears in dropdown for admins
- [ ] "Switch User" button does NOT appear for non-admins
- [ ] Modal opens when clicking "Switch User"
- [ ] Modal shows filterable user list
- [ ] Search filters by name, email, and role
- [ ] Clicking user starts impersonation
- [ ] Profile icon turns orange when impersonating
- [ ] Dropdown shows "Impersonating" label
- [ ] Dropdown shows "Logged in as: [Admin Name]"
- [ ] "Exit Impersonation" button appears when impersonating
- [ ] "Exit Impersonation" button does NOT appear when not impersonating
- [ ] Admin menu items disappear when impersonating non-admin
- [ ] Page reload maintains impersonation state
- [ ] Multiple browser tabs sync correctly
- [ ] Clicking "Exit Impersonation" returns to admin account
- [ ] Profile icon returns to indigo after exiting

### Security Testing

- [ ] Cannot access `/api/admin/impersonate/start` as non-admin (403)
- [ ] Cannot access `/api/admin/impersonate/users` as non-admin (403)
- [ ] Cannot impersonate Super Admin as regular Admin (403)
- [ ] Cannot start nested impersonation (400)
- [ ] Cannot impersonate inactive user (400)
- [ ] Cannot impersonate self (400)
- [ ] Server-side permission checks still work while impersonating
- [ ] Impersonated user sees only their own data
- [ ] ImpersonationLog entries created for START and STOP
- [ ] IP address and user agent captured in log
- [ ] Session expiration still enforced during impersonation

### Data Integrity Testing

- [ ] Impersonating user A, then user B (without exiting) is blocked
- [ ] Exiting impersonation returns to correct original admin
- [ ] User data shown matches impersonated user
- [ ] Profile changes made while impersonating affect impersonated user
- [ ] Admin data is NOT affected by actions while impersonating
- [ ] Logging out while impersonating ends session completely
- [ ] Browser back button doesn't break impersonation state

---

## Common Issues & Solutions

### Issue 1: Impersonation Doesn't Work - API Returns 200 But Nothing Changes

**Symptom**: You click a user to impersonate, the API call succeeds (200 response), but you're still logged in as yourself.

**Cause**: The `await update(data)` call is missing or not awaiting in `useImpersonation` hook.

**Solution**: Ensure this line is present and AWAITED:
```typescript
await update(data); // This triggers the JWT callback
```

### Issue 2: "User Not Found" When Logging In

**Symptom**: Can impersonate users but can't login as them. LoginAttempts shows "User not found".

**Cause**: Email address in Google Sheets has extra whitespace (leading/trailing spaces).

**Solution**:
1. Open Google Sheets Users tab
2. Click on the email cell
3. Check for spaces before or after the email
4. Re-type the email cleanly: `user@example.com`

This is especially common when manually creating test users.

### Issue 3: Admin Menu Still Shows When Impersonating Non-Admin

**Symptom**: You impersonate a Member and still see Admin menu items.

**Cause**: Navigation is using `isRealAdmin` instead of `isCurrentUserAdmin`.

**Solution**: Update navigation items to use `isCurrentUserAdmin`:
```typescript
...(isCurrentUserAdmin ? [{ name: 'Admin', ... }] : []),
```

### Issue 4: "Exit Impersonation" Button Doesn't Appear

**Symptom**: You're impersonating (orange icon, "Impersonating" label shows) but no "Exit Impersonation" button.

**Cause**: Dropdown is checking `isCurrentUserAdmin` instead of `isRealAdmin` for showing impersonation controls.

**Solution**: Impersonation controls should check `isRealAdmin`:
```typescript
{isRealAdmin && (
  // ... impersonation buttons
)}
```

### Issue 5: IP Address Shows "::1" in LoginAttempts

**Symptom**: IP address column shows `::1` instead of real IP.

**Cause**: This is NORMAL for localhost development. `::1` is IPv6 loopback (like `127.0.0.1`).

**Solution**: No fix needed. Real IPs will appear when:
- Deployed to production
- Accessed from another device on network
- Behind reverse proxy (nginx, Cloudflare)

### Issue 6: Middleware Blocks Impersonation

**Symptom**: Getting 403 or redirect errors when trying to access pages while impersonating.

**Cause**: Middleware is checking user role before session update completes.

**Solution**: Ensure middleware gets session via `getServerSession(authOptions)` which will include impersonation state. Don't cache the session - get it fresh on each request.

---

## Migration from Existing Buddy System

### Current Buddy System (Bowls Club)

The existing system likely has:
- Page-level checks (Profile, Renewals)
- Session storage or local state for buddy mode
- Manual switching logic in specific components

### Migration Strategy

1. **Keep existing buddy logic temporarily** - Don't remove it yet
2. **Implement new system alongside** - Add all new files/endpoints
3. **Test new system thoroughly** - Verify it works for all use cases
4. **Migrate page by page** - Replace buddy logic with impersonation
5. **Remove old buddy code** - Once confident new system works

### Converting Buddy Checks to Impersonation

**Old (Page-Level):**
```typescript
// In Profile page
const buddyEmail = getBuddyFromSession();
const displayUser = buddyEmail ? await getUserByEmail(buddyEmail) : currentUser;
```

**New (Automatic):**
```typescript
// Everywhere automatically
const session = await getServerSession(authOptions);
// session.user.email is ALREADY the impersonated user's email
// No manual buddy logic needed!
```

### Data Access Pattern

**Old:**
```typescript
// Had to manually check if buddying
if (isBuddying) {
  return getBuddyData();
} else {
  return getCurrentUserData();
}
```

**New:**
```typescript
// Just use session email - it's already correct
const session = await getServerSession(authOptions);
return getUserData(session.user.email);
```

The beauty of JWT-based impersonation is that `session.user` automatically reflects the impersonated user, so you don't need conditional logic throughout your app.

---

## Performance Considerations

### JWT Token Size

Each impersonation adds ~150 bytes to JWT token:
- `originalAdmin` object (~100 bytes)
- `impersonationSessionId` UUID (~36 bytes)
- Boolean flags (~10 bytes)

This is negligible - NextAuth JWTs can easily handle this.

### Session Updates

`await update(data)` triggers:
1. JWT callback execution (fast - just object manipulation)
2. Cookie update (fast - client-side)
3. Page reload (necessary for full state refresh)

Total time: ~200-500ms (mostly page reload)

### Database Queries

Each impersonation START/STOP makes:
- 1 read (get target user)
- 1 write (log impersonation event)

This is minimal overhead and doesn't affect performance.

### Caching Considerations

**IMPORTANT**: Do not cache `getServerSession()` results across requests. Always fetch fresh:

```typescript
// ✅ GOOD - Fresh session each request
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  // ...
}

// ❌ BAD - Cached session might be stale
const session = await getServerSession(authOptions); // Outside request handler
export async function GET(request: NextRequest) {
  // Using stale session
}
```

---

## Deployment Checklist

- [ ] Create `ImpersonationLog` sheet in Google Sheets (production)
- [ ] Verify role names match between code and database
- [ ] Test with production-like data (multiple roles)
- [ ] Verify IP addresses log correctly in production (not ::1)
- [ ] Test across different browsers (Chrome, Firefox, Safari)
- [ ] Test on mobile devices
- [ ] Verify session persistence across page reloads
- [ ] Verify session expiration still works
- [ ] Check ImpersonationLog for proper logging
- [ ] Review LoginAttempts for proper user names/IPs
- [ ] Document feature for administrators
- [ ] Train admins on how to use impersonation
- [ ] Set up monitoring for impersonation abuse

---

## Future Enhancements (Optional)

### 1. Impersonation Time Limits

Add automatic timeout after X hours of impersonation:

```typescript
// In JWT callback
if (token.isImpersonating && token.impersonationStartTime) {
  const now = Date.now();
  const duration = now - token.impersonationStartTime;
  const oneHour = 60 * 60 * 1000;

  if (duration > oneHour) {
    // Auto-exit impersonation after 1 hour
    token.isImpersonating = false;
    token.originalAdmin = undefined;
    // ... clear other fields
  }
}
```

### 2. Impersonation Banner

Show a persistent banner at top of page when impersonating:

```typescript
{isImpersonating && (
  <div className="bg-orange-500 text-white px-4 py-2 text-center">
    ⚠️ You are viewing as {userName}
    <button onClick={stopImpersonation} className="ml-4 underline">
      Exit Impersonation
    </button>
  </div>
)}
```

### 3. Recent Impersonations List

Track recently impersonated users for quick re-access:

```typescript
// Store in localStorage
const recentImpersonations = JSON.parse(
  localStorage.getItem('recentImpersonations') || '[]'
);

// Show in modal as "Recent" section
<div className="border-t pt-4">
  <h3>Recently Impersonated</h3>
  {recentImpersonations.map(user => (
    <div onClick={() => handleImpersonate(user.email)}>
      {user.name}
    </div>
  ))}
</div>
```

### 4. Impersonation Reason Tracking

Add optional "reason" field when starting impersonation:

```typescript
// In start endpoint
const { targetEmail, reason } = await request.json();

// Log to ImpersonationLog sheet
await logImpersonationEvent({
  // ... existing fields
  reason: reason || 'Not specified',
});
```

### 5. Impersonation Notifications

Email admins when they're impersonated:

```typescript
// In start endpoint, after logging
if (targetUser.emailAddress !== session.user.email) {
  await sendEmail({
    to: targetUser.emailAddress,
    subject: 'Your account is being viewed by an administrator',
    body: `${session.user.name} is currently viewing your account.`,
  });
}
```

---

## Support & Troubleshooting

### Debug Mode

Add this to your `.env.local` for debugging:

```bash
NEXTAUTH_DEBUG=true
```

This will log all NextAuth JWT/session operations to console.

### Checking Current Session State

Add this temporarily to any page to inspect session:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function DebugPage() {
  const session = await getServerSession(authOptions);

  return (
    <pre>{JSON.stringify(session, null, 2)}</pre>
  );
}
```

### Verifying JWT Contents

The JWT token is encrypted, but you can decode it server-side:

```typescript
import { getToken } from 'next-auth/jwt';

const token = await getToken({ req });
console.log('JWT contents:', token);
```

---

## Glossary

- **Impersonation** - Admin viewing portal as another user
- **Impersonator** - The admin doing the impersonating
- **Target User** - The user being impersonated
- **Original Admin** - The real identity of the impersonator (preserved in JWT)
- **Session ID** - UUID tracking a single impersonation session (links START/STOP logs)
- **JWT** - JSON Web Token - encrypted cookie storing session data
- **NextAuth** - Authentication library for Next.js
- **Role Hierarchy** - Permission levels (Super Admin > Admin > Member)
- **Audit Trail** - Log of all impersonation events in ImpersonationLog sheet

---

## References

- NextAuth.js Documentation: https://next-auth.js.org/
- JWT RFC: https://datatracker.ietf.org/doc/html/rfc7519
- UUID Specification: https://datatracker.ietf.org/doc/html/rfc4122
- Google Sheets API: https://developers.google.com/sheets/api

---

## Appendix: Complete File List

### New Files Created
1. `app/api/admin/impersonate/start/route.ts` - Start impersonation endpoint
2. `app/api/admin/impersonate/stop/route.ts` - Stop impersonation endpoint
3. `app/api/admin/impersonate/users/route.ts` - Get users endpoint
4. `src/hooks/useImpersonation.ts` - React hook for impersonation
5. `src/components/ImpersonationModal.tsx` - User selection modal

### Modified Files
1. `src/types/next-auth.d.ts` - Extended JWT and Session interfaces
2. `src/lib/auth.ts` - Updated JWT and session callbacks
3. `src/lib/auth-sheets.ts` - Added canImpersonate() and getImpersonatableRoles()
4. `src/lib/sheets.ts` - Added logImpersonationEvent()
5. `src/components/Navbar.tsx` - Added impersonation UI controls

### Database Changes
1. New Google Sheet: `ImpersonationLog` (12 columns)

---

## End of Specification

This specification provides everything needed to implement full user impersonation in the Bowls Club portal. Follow the implementation steps in order, test thoroughly using the checklist, and refer to troubleshooting sections for common issues.

**Estimated Implementation Time**: 4-6 hours for experienced developer

**Questions?** Refer back to this spec or consult the TDC Portal codebase for working examples.
