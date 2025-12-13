# BHBC Members Portal - System-Wide Buddy/Access Control Specification

## Overview

Implement a consistent access control system across ALL features in the BHBC Members Portal. Different features have different access rules based on real-world club practices:

- **Profile & Renewals:** Buddy system (trusted family member can manage)
- **Friendlies:** Open access (any member can sign up any member - matches physical board practice)
- **Admin:** Full access to everything
- **Security-Sensitive Fields:** Self-only (password, email changes)

**Goal:** Match real-world club workflows while maintaining security.

---

## Access Control Matrix

| Feature | Self | Buddy | Any Member | Admin | Notes |
|---------|------|-------|------------|-------|-------|
| **Profile View** | ✅ | ✅ | ❌ | ✅ | Basic info only |
| **Profile Edit (General)** | ✅ | ✅ | ❌ | ✅ | Name, phone, address, etc. |
| **Profile Edit (Email)** | ✅ | ❌ | ❌ | ✅ | Security-sensitive |
| **Profile Edit (Username)** | ❌ | ❌ | ❌ | ✅ | Admin-only |
| **Password Reset** | ✅ | ❌ | ❌ | ✅ | Self or admin only |
| **Renewals View** | ✅ | ✅ | ❌ | ✅ | |
| **Renewals Edit** | ✅ | ✅ | ❌ | ✅ | Full access for buddy |
| **Payment Info (View)** | ✅ | ✅ | ❌ | ✅ | Read-only for buddy |
| **Payment Info (Edit)** | ❌ | ❌ | ❌ | ✅ | Admin-only |
| **Friendlies View** | ✅ | ✅ | ✅ | ✅ | All members can view |
| **Friendlies Signup** | ✅ | ✅ | ✅ | ✅ | **Any member can sign up any member** |
| **Friendlies History** | ✅ | ✅ | ✅ | ✅ | All members can view all history |

---

## Real-World Club Practices

### Current Physical Board System
```
Physical Board at Clubhouse:
┌────────────────────────────────┐
│ FRIENDLY vs. Brighton BC       │
│ Date: 15 Jan 2026              │
│                                │
│ Players:                       │
│ 1. Liam Dasey                 │
│ 2. John Smith                 │
│ 3. _______________ (anyone    │
│ 4. _______________ can write  │
│ 5. _______________ any name)  │
└────────────────────────────────┘
```

**Current Practice:** Anyone walking past can add anyone's name to the board.

**Digital Equivalent:** Any logged-in member can sign up any member for a friendly.

**Why:** This is how clubs work - members help each other, captain fills spots, people sign up absent friends, etc.

---

## Database Schema

### Users Sheet: buddy_user_name Column

**Column AV:** `buddy_user_name` (string)

**Purpose:** Designates a trusted person who can manage profile and renewals on behalf of this user.

```
Example:
user_name       | buddy_user_name | Relationship
----------------|-----------------|------------------
liam_dasey      | NULL            | No buddy
celia_dasey     | liam_dasey      | Liam is Celia's buddy
grandson_name   | liam_dasey      | Liam is grandson's buddy
elderly_member  | daughter_name   | Daughter manages parent
```

**Note:** Friendlies do NOT use buddy system - they use open access.

---

## Authorization Functions

### Core Authorization (src/lib/buddies-sheets.ts)

```typescript
/**
 * Core authorization logic - used across all features
 */

// Profile & Renewals: Buddy-based access
export async function canManageUser(
  currentUserName: string,
  currentUserRole: string,
  targetUserName: string
): Promise<boolean> {
  // 1. Can always manage self
  if (currentUserName === targetUserName) {
    return true;
  }
  
  // 2. Admins can manage anyone
  if (currentUserRole === 'A') {
    return true;
  }
  
  // 3. Can manage if you're listed as their buddy
  const targetUser = await getUserByUsername(targetUserName);
  if (targetUser?.buddyUserName === currentUserName) {
    return true;
  }
  
  return false;
}

// Friendlies: Open access (any member can manage any member)
export function canManageFriendlies(
  currentUserName: string | null
): boolean {
  // Simply check if logged in
  // Any authenticated user can sign up any member
  return !!currentUserName;
}

// Profile: Field-level restrictions
export function canEditProfileField(
  currentUserName: string,
  currentUserRole: string,
  targetUserName: string,
  fieldName: string
): boolean {
  // Password fields: self or admin only
  if (fieldName === 'password' || fieldName === 'passwordHash') {
    return currentUserName === targetUserName || currentUserRole === 'A';
  }
  
  // Email: self or admin only
  if (fieldName === 'emailAddress') {
    return currentUserName === targetUserName || currentUserRole === 'A';
  }
  
  // Username: admin only
  if (fieldName === 'userName') {
    return currentUserRole === 'A';
  }
  
  // All other fields: buddy system applies
  return canManageUser(currentUserName, currentUserRole, targetUserName);
}

// Renewals: Payment field restrictions
export function canEditPaymentFields(
  currentUserRole: string
): boolean {
  // Only admins can edit banking/date_received fields
  return currentUserRole === 'A';
}

// Get manageable users (for dropdowns)
export async function getManageableUsers(
  currentUserName: string,
  currentUserRole: string
): Promise<User[]> {
  const allUsers = await getAllUsers();
  
  // If admin, return all users
  if (currentUserRole === 'A') {
    return allUsers.sort((a, b) => 
      a.fullKnownAs.localeCompare(b.fullKnownAs)
    );
  }
  
  // For non-admins, return self + buddies
  const manageableUsers: User[] = [];
  
  // Add self
  const selfUser = allUsers.find(u => u.userName === currentUserName);
  if (selfUser) {
    manageableUsers.push(selfUser);
  }
  
  // Add users where current user is their buddy
  const buddies = allUsers.filter(u => 
    u.buddyUserName === currentUserName
  );
  manageableUsers.push(...buddies);
  
  return manageableUsers.sort((a, b) => 
    a.fullKnownAs.localeCompare(b.fullKnownAs)
  );
}

// Friendlies: Get all members (any can be signed up)
export async function getAllSignupableMembers(): Promise<User[]> {
  const allUsers = await getAllUsers();
  
  // Filter to active members only (not cancelled)
  return allUsers
    .filter(u => u.memberType !== 'Cancelled')
    .sort((a, b) => a.fullKnownAs.localeCompare(b.fullKnownAs));
}
```

---

## Feature Implementation

### 1. Profile System (Buddy-Based)

#### API: app/api/profile/route.ts

```typescript
// GET /api/profile?userName=target
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const targetUserName = searchParams.get('userName') || session.user.userName;

  // Check authorization
  const canManage = await canManageUser(
    session.user.userName,
    session.user.role,
    targetUserName
  );

  if (!canManage) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const profile = await getUserProfile(targetUserName);
  
  return NextResponse.json({
    profile,
    managedUser: {
      userName: targetUserName,
      isSelf: targetUserName === session.user.userName,
    },
  });
}

// PUT /api/profile
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const targetUserName = body.userName || session.user.userName;

  // Check authorization
  const canManage = await canManageUser(
    session.user.userName,
    session.user.role,
    targetUserName
  );

  if (!canManage) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Filter updates based on field-level permissions
  const allowedUpdates: any = {};
  
  for (const [field, value] of Object.entries(body.updates)) {
    if (canEditProfileField(
      session.user.userName,
      session.user.role,
      targetUserName,
      field
    )) {
      allowedUpdates[field] = value;
    } else {
      console.warn(`User ${session.user.userName} attempted to edit restricted field: ${field}`);
    }
  }

  const result = await updateUserProfile(targetUserName, allowedUpdates);
  
  return NextResponse.json({ success: true, profile: result });
}
```

#### Frontend: app/profile/page.tsx

```typescript
export default function ProfilePage() {
  const { data: session } = useSession();
  const [manageableUsers, setManageableUsers] = useState<User[]>([]);
  const [selectedUserName, setSelectedUserName] = useState<string>('');
  const [profile, setProfile] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Load manageable users
  useEffect(() => {
    loadManageableUsers();
  }, [session]);

  // Load profile when user changes
  useEffect(() => {
    if (selectedUserName) {
      loadProfile(selectedUserName);
    }
  }, [selectedUserName]);

  async function loadManageableUsers() {
    const response = await fetch('/api/profile/buddies');
    const data = await response.json();
    setManageableUsers(data.users);
    
    // Default to self
    const self = data.users.find((u: any) => u.isSelf);
    if (self) setSelectedUserName(self.userName);
  }

  async function loadProfile(userName: string) {
    const response = await fetch(`/api/profile?userName=${userName}`);
    const data = await response.json();
    setProfile(data.profile);
  }

  async function handleSave() {
    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: selectedUserName,
        updates: editedProfile,
      }),
    });
    
    if (response.ok) {
      setIsEditing(false);
      loadProfile(selectedUserName);
    }
  }

  const isSelf = selectedUserName === session?.user?.userName;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Member Profile</h1>

      {/* User Selector (if multiple users) */}
      {manageableUsers.length > 1 && (
        <UserSelector
          users={manageableUsers}
          selectedUserName={selectedUserName}
          onChange={setSelectedUserName}
          featureName="profile"
        />
      )}

      {/* Profile Form */}
      <div className="space-y-6">
        {/* Name fields - editable by buddy */}
        <ProfileField
          label="First Name"
          value={profile?.firstName}
          editable={isEditing}
          onChange={(v) => handleChange('firstName', v)}
        />

        {/* Email - NOT editable by buddy */}
        <ProfileField
          label="Email Address"
          value={profile?.emailAddress}
          editable={isEditing && isSelf}
          onChange={(v) => handleChange('emailAddress', v)}
          helpText={!isSelf && isEditing ? "Only the member or admin can change email" : ""}
        />

        {/* Rest of profile fields */}
      </div>
    </div>
  );
}
```

#### Restricted Fields in Profile

```typescript
// These fields are NOT editable by buddies (self or admin only)
const SELF_ONLY_FIELDS = [
  'emailAddress',    // Security: email is authentication identifier
  'userName',        // Security: username is authentication identifier (admin only)
  'passwordHash',    // Security: password changes require self or admin
  'role',           // Security: role changes are admin-only
];

// Show read-only or hide when buddy is editing
{!isSelf && SELF_ONLY_FIELDS.includes(fieldName) && (
  <p className="text-sm text-gray-500 italic">
    Only the member can change this field
  </p>
)}
```

---

### 2. Renewals System (Buddy-Based)

#### API: app/api/renewals/route.ts

```typescript
// GET /api/renewals?userName=target
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const targetUserName = searchParams.get('userName') || session.user.userName;

  // Check authorization (buddy-based)
  const canManage = await canManageUser(
    session.user.userName,
    session.user.role,
    targetUserName
  );

  if (!canManage) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const profile = await getUserProfile(targetUserName);
  const renewal = await getRenewalByUsername(targetUserName);
  const fees = calculateFees(profile, renewal);

  return NextResponse.json({
    profile,
    renewal,
    fees,
    eligibility: {
      canEnterCompetitions: profile.friendliesLastYear >= 8,
    },
    managedUser: {
      userName: targetUserName,
      isSelf: targetUserName === session.user.userName,
    },
  });
}

// PUT /api/renewals
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const targetUserName = body.userName || session.user.userName;

  // Check authorization
  const canManage = await canManageUser(
    session.user.userName,
    session.user.role,
    targetUserName
  );

  if (!canManage) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Filter payment fields (admin-only)
  const renewalUpdates = { ...body.renewal };
  
  if (!canEditPaymentFields(session.user.role)) {
    delete renewalUpdates.banking;
    delete renewalUpdates.dateReceived;
  }

  const result = await updateRenewal(targetUserName, renewalUpdates);
  
  if (result.success) {
    // Send email to target user
    await sendRenewalConfirmation(targetUserName, renewalUpdates, body.fees);
  }

  return NextResponse.json({ success: result.success, renewal: result.renewal });
}
```

#### Payment Fields (Admin-Only Edit, Buddy Can View)

```typescript
// In renewals form:

{/* Payment Information Section */}
<div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
  <h3 className="text-lg font-medium mb-4">Payment Information</h3>
  
  {/* Buddies can VIEW payment status */}
  {profile?.banking > 0 && (
    <div className="space-y-2">
      <p className="text-sm">
        <strong>Amount Received:</strong> £{profile.banking.toFixed(2)}
      </p>
      <p className="text-sm">
        <strong>Date Received:</strong> {formatDate(profile.dateReceived)}
      </p>
    </div>
  )}

  {/* Only admins can EDIT payment fields */}
  {session?.user?.role === 'A' && (
    <div className="mt-4 space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Amount Received (Admin)
        </label>
        <input
          type="number"
          step="0.01"
          value={renewal.banking || ''}
          onChange={(e) => handleChange('banking', parseFloat(e.target.value))}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Date Received (Admin)
        </label>
        <input
          type="date"
          value={renewal.dateReceived || ''}
          onChange={(e) => handleChange('dateReceived', e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
        />
      </div>
    </div>
  )}
  
  {/* Show message to non-admins */}
  {!session?.user?.role === 'A' && !profile?.banking && (
    <p className="text-sm text-gray-600 italic">
      Payment not yet recorded (admin will update)
    </p>
  )}
</div>
```

---

### 3. Friendlies System (Open Access)

**Key Difference:** Friendlies use OPEN access, not buddy system. Any logged-in member can sign up any member.

#### API: app/api/friendlies/route.ts

```typescript
// GET /api/friendlies
// Returns all upcoming friendlies with signup lists
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // No specific user authorization needed - logged in users can view all
  const friendlies = await getUpcomingFriendlies();
  
  return NextResponse.json({ friendlies });
}

// POST /api/friendlies/signup
// Sign up a member for a friendly
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { matchId, targetUserName } = body;

  // OPEN ACCESS: Any logged-in member can sign up any member
  // This matches the physical board where anyone can write any name
  const canSignup = canManageFriendlies(session.user.userName);
  
  if (!canSignup) {
    return NextResponse.json({ error: 'Must be logged in' }, { status: 401 });
  }

  // Verify target user exists and is active
  const targetUser = await getUserByUsername(targetUserName);
  if (!targetUser || targetUser.memberType === 'Cancelled') {
    return NextResponse.json({ error: 'Invalid member' }, { status: 400 });
  }

  // Add to signup list
  const result = await addFriendlySignup(matchId, targetUserName, session.user.userName);
  
  return NextResponse.json({ success: true, signup: result });
}

// DELETE /api/friendlies/signup
// Remove a member from a friendly
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { matchId, targetUserName } = body;

  // OPEN ACCESS: Anyone can remove anyone (same as crossing name off board)
  const result = await removeFriendlySignup(matchId, targetUserName);
  
  return NextResponse.json({ success: true });
}
```

#### Frontend: app/friendlies/page.tsx

```typescript
export default function FriendliesPage() {
  const { data: session } = useSession();
  const [friendlies, setFriendlies] = useState<Friendly[]>([]);
  const [allMembers, setAllMembers] = useState<User[]>([]);
  const [selectedMember, setSelectedMember] = useState<string>('');

  useEffect(() => {
    loadFriendlies();
    loadAllMembers();
  }, []);

  async function loadAllMembers() {
    // Get ALL active members (not just manageable ones)
    const response = await fetch('/api/members');
    const data = await response.json();
    setAllMembers(data.members.filter((m: User) => m.memberType !== 'Cancelled'));
  }

  async function handleSignup(matchId: string, userName: string) {
    const response = await fetch('/api/friendlies/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId,
        targetUserName: userName,
      }),
    });
    
    if (response.ok) {
      loadFriendlies(); // Refresh
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Friendly Matches</h1>

      {/* NO USER SELECTOR - everyone can sign up anyone */}
      
      {friendlies.map(friendly => (
        <div key={friendly.id} className="mb-6 p-4 border rounded-lg">
          <h3 className="text-xl font-bold">{friendly.opponent}</h3>
          <p className="text-gray-600">{formatDate(friendly.date)}</p>
          
          <div className="mt-4">
            <h4 className="font-medium mb-2">
              Players ({friendly.signups.length}/{friendly.spotsNeeded})
            </h4>
            
            {/* Current signups */}
            <ul className="space-y-2">
              {friendly.signups.map(signup => (
                <li key={signup.userName} className="flex items-center justify-between">
                  <span>{signup.fullKnownAs}</span>
                  <button
                    onClick={() => handleRemoveSignup(friendly.id, signup.userName)}
                    className="text-red-600 text-sm"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            {/* Add member dropdown - ANY member can be added */}
            {friendly.signups.length < friendly.spotsNeeded && (
              <div className="mt-4 flex gap-2">
                <select
                  value={selectedMember}
                  onChange={(e) => setSelectedMember(e.target.value)}
                  className="flex-1 rounded-md border-gray-300"
                >
                  <option value="">Select member to add...</option>
                  {allMembers
                    .filter(m => !friendly.signups.find(s => s.userName === m.userName))
                    .map(member => (
                      <option key={member.userName} value={member.userName}>
                        {member.fullKnownAs}
                      </option>
                    ))
                  }
                </select>
                <button
                  onClick={() => {
                    if (selectedMember) {
                      handleSignup(friendly.id, selectedMember);
                      setSelectedMember('');
                    }
                  }}
                  disabled={!selectedMember}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            )}

            {/* Quick add self button */}
            {!friendly.signups.find(s => s.userName === session?.user?.userName) && (
              <button
                onClick={() => handleSignup(friendly.id, session!.user.userName)}
                className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
              >
                + Add myself
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Shared Components

### UserSelector Component (Reusable)

**Create: src/components/UserSelector.tsx**

```typescript
'use client';

interface User {
  userName: string;
  fullKnownAs: string;
  isSelf: boolean;
}

interface UserSelectorProps {
  users: User[];
  selectedUserName: string;
  onChange: (userName: string) => void;
  featureName: string; // 'profile', 'renewals', etc.
  isAdmin?: boolean;
}

export function UserSelector({ 
  users, 
  selectedUserName, 
  onChange,
  featureName,
  isAdmin = false 
}: UserSelectorProps) {
  // Only show if multiple users
  if (users.length <= 1) {
    return null;
  }

  const [searchTerm, setSearchTerm] = useState('');
  const selectedUser = users.find(u => u.userName === selectedUserName);
  const isManagingOther = !selectedUser?.isSelf;

  // Filter users based on search (for admins with many users)
  const filteredUsers = isAdmin && searchTerm
    ? users.filter(u => 
        u.fullKnownAs.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.userName.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : users;

  return (
    <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Managing {featureName} for:
        {isAdmin && <span className="ml-2 text-xs text-gray-600">(Admin)</span>}
      </label>
      
      {/* Search box for admins */}
      {isAdmin && users.length > 10 && (
        <input
          type="text"
          placeholder="Search members..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="mb-2 block w-full max-w-md rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm px-3 py-2"
        />
      )}

      {/* User selector dropdown */}
      <select
        value={selectedUserName}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full max-w-md rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
      >
        {filteredUsers.map((user) => (
          <option key={user.userName} value={user.userName}>
            {user.fullKnownAs} {user.isSelf ? '(You)' : ''}
          </option>
        ))}
      </select>
      
      {/* Warning when managing someone else */}
      {isManagingOther && (
        <div className="mt-3 flex items-start">
          <svg className="h-5 w-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-blue-700">
            You are managing <strong>{selectedUser?.fullKnownAs}'s</strong> {featureName}.
            {featureName !== 'friendlies' && ' Changes will be saved to their account and emails sent to their address.'}
          </p>
        </div>
      )}
    </div>
  );
}
```

---

## API Endpoint: Get Manageable Users

**Create: app/api/buddies/route.ts** (shared endpoint)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getManageableUsers } from '@/lib/buddies-sheets';

/**
 * GET /api/buddies
 * Returns list of users current user can manage (via buddy system)
 * Used by Profile and Renewals
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const users = await getManageableUsers(
      session.user.userName,
      session.user.role
    );

    return NextResponse.json({
      users: users.map(u => ({
        userName: u.userName,
        fullKnownAs: u.fullKnownAs,
        emailAddress: u.emailAddress,
        memberType: u.memberType,
        isSelf: u.userName === session.user.userName,
      })),
      currentUserName: session.user.userName,
      isAdmin: session.user.role === 'A',
    });

  } catch (error) {
    console.error('Error fetching manageable users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch manageable users' },
      { status: 500 }
    );
  }
}
```

---

## File Structure

```
src/
├── lib/
│   ├── buddies-sheets.ts         ← NEW: Core authorization logic
│   ├── profile-sheets.ts         ← UPDATE: Use buddy auth
│   ├── renewals-sheets.ts        ← UPDATE: Use buddy auth
│   └── friendlies-sheets.ts      ← NEW: Open access (Day 6)
├── components/
│   └── UserSelector.tsx          ← NEW: Reusable dropdown
app/
├── api/
│   ├── buddies/
│   │   └── route.ts              ← NEW: Shared endpoint
│   ├── profile/
│   │   └── route.ts              ← UPDATE: Add buddy support
│   ├── renewals/
│   │   └── route.ts              ← UPDATE: Add buddy support
│   └── friendlies/
│       └── route.ts              ← NEW: Open access (Day 6)
├── profile/
│   └── page.tsx                  ← UPDATE: Add user selector
├── renewals/
│   └── page.tsx                  ← UPDATE: Add user selector
└── friendlies/
    └── page.tsx                  ← NEW: ALL members dropdown (Day 6)
```

---

## Security Matrix

### Field-Level Security

```typescript
// Profile fields
const SECURITY_MATRIX = {
  // Anyone (self/buddy/admin) can edit
  OPEN: [
    'title', 'firstName', 'lastName', 'knownAs',
    'landline', 'mobile',
    'address1', 'address2', 'address3', 'postCode',
    'lockerNo', 'ageDemographic',
    'socialEmails', 'handbookEntry',
    'drivingAwayMatches', 'drivingAdditionalInfo',
    'greenMaintenance', 'greenAdditionalInfo',
    'barDuty', 'barAdditionalInfo',
    'otherSkills',
  ],
  
  // Self or admin only
  RESTRICTED: [
    'emailAddress',   // Authentication identifier
    'passwordHash',   // Security
  ],
  
  // Admin only
  ADMIN_ONLY: [
    'userName',       // Primary key
    'role',          // Permissions
    'memberType',    // (optional - could be OPEN)
    'yearStarted',   // (optional - could be OPEN)
  ],
  
  // Read-only (system-managed)
  READ_ONLY: [
    'createdAt',
    'updatedAt',
    'lastLoginDate',
    'profileUpdatedDate',
  ],
};

// Renewals fields
const RENEWALS_SECURITY = {
  // Buddy can edit
  OPEN: [
    'renewingMembership',
    'number200ClubEntries', 'pref200Club',
    'cleaningDatesToAvoid', 'teaDatesToAvoid',
    'mensChampionship', 'ladiesMaynard', // ... all competition fields
  ],
  
  // Buddy can view, admin can edit
  PAYMENT: [
    'banking',
    'dateReceived',
  ],
  
  // System-calculated (read-only)
  CALCULATED: [
    'playingFees',
    'socialFees',
    'compsFee',
    'fee200Club',
    'totalPayment',
  ],
};
```

---

## Implementation Order

### Phase 1: Core Buddy System (1-2 hours)

```bash
# Step 1: Add database column (5 min)
# Manually add buddy_user_name to Users sheet (column AV)
# Set relationships: Celia → liam, Grandson → liam

# Step 2: Create core authorization (45 min)
claude-code "Create src/lib/buddies-sheets.ts with all authorization functions:
- canManageUser() for profile/renewals
- canManageFriendlies() for open access
- canEditProfileField() for field-level security
- canEditPaymentFields() for admin-only payment fields
- getManageableUsers() for buddy dropdowns
- getAllSignupableMembers() for friendlies

Also create the shared UserSelector component in src/components/UserSelector.tsx"

# Step 3: Create shared API endpoint (15 min)
claude-code "Create app/api/buddies/route.ts that returns manageable users for the current logged-in user"
```

### Phase 2: Add to Profile (30-45 min)

```bash
claude-code "Update profile system to use buddy authorization:

1. Update app/api/profile/route.ts:
   - GET: Accept ?userName parameter
   - PUT: Accept userName in body
   - Add canManageUser() authorization checks
   - Implement field-level restrictions (email = self only, etc.)

2. Update app/profile/page.tsx:
   - Load manageable users from /api/buddies
   - Add UserSelector component at top
   - Load different user's profile when dropdown changes
   - Disable email field if not self
   - Show warning when managing others
   - Include target userName in save request

Test with Liam → Celia profile switch"
```

### Phase 3: Add to Renewals (30-45 min)

```bash
claude-code "Update renewals system to use buddy authorization:

1. Update app/api/renewals/route.ts:
   - GET: Accept ?userName parameter
   - PUT: Accept userName in body
   - Add canManageUser() authorization checks
   - Implement payment field restrictions (admin-only edit)

2. Update app/renewals/page.tsx:
   - Load manageable users from /api/buddies
   - Add UserSelector component at top
   - Load different user's renewal when dropdown changes
   - Show payment fields as read-only for buddies
   - Show payment fields as editable for admins
   - Show warning when managing others
   - Include target userName in save request
   - Email goes to target user, not current user

Test with Liam → Celia renewal switch"
```

### Phase 4: Friendlies (Day 6 - Open Access)

```bash
# When building friendlies, implement open access from the start

claude-code "Build friendlies system with OPEN ACCESS (not buddy-based):

1. Any logged-in member can sign up any active member
2. Show ALL active members in dropdown (not just buddies)
3. Use canManageFriendlies() which just checks if logged in
4. No user selector at top - direct member selection per match
5. Quick 'Add myself' button
6. Anyone can remove any signup (matches physical board)

This is different from profile/renewals - more open access"
```

---

## Testing Checklist

### Setup
- [ ] Add buddy_user_name column to Users sheet (column AV)
- [ ] Set Celia's buddy_user_name = 'liam_dasey'
- [ ] Set Grandson's buddy_user_name = 'liam_dasey'
- [ ] Verify TypeScript User interface includes buddyUserName

### Core Authorization Tests
- [ ] canManageUser('liam', 'R', 'liam') → true (self)
- [ ] canManageUser('liam', 'R', 'celia') → true (buddy)
- [ ] canManageUser('liam', 'R', 'john') → false (not buddy)
- [ ] canManageUser('admin', 'A', 'anyone') → true (admin)
- [ ] canEditProfileField(liam, R, celia, 'firstName') → true
- [ ] canEditProfileField(liam, R, celia, 'emailAddress') → false
- [ ] canEditPaymentFields('R') → false
- [ ] canEditPaymentFields('A') → true

### Profile Tests
- [ ] Login as Liam → see [Liam (You), Celia, Grandson]
- [ ] Select Celia → loads Celia's profile
- [ ] Edit Celia's name → saves successfully
- [ ] Try to edit Celia's email → field disabled
- [ ] Switch back to Liam → loads Liam's profile
- [ ] Login as regular member → no dropdown shown
- [ ] Login as admin → dropdown shows all 205 members
- [ ] Admin can edit anyone's email

### Renewals Tests
- [ ] Login as Liam → see [Liam (You), Celia, Grandson]
- [ ] Select Celia → loads Celia's renewal
- [ ] Edit Celia's renewal → saves successfully
- [ ] Email sent to Celia's address (not Liam's)
- [ ] Payment fields show as read-only for Liam
- [ ] Login as admin → payment fields editable
- [ ] Switch between users → fees recalculate correctly

### Friendlies Tests (Day 6)
- [ ] Login as any member
- [ ] See all upcoming friendlies
- [ ] Can add ANY active member to match
- [ ] Can add self with quick button
- [ ] Can remove any signup
- [ ] No user selector at top (different from profile/renewals)

### Security Tests
- [ ] API blocks non-buddy access to profile
- [ ] API blocks non-buddy access to renewals
- [ ] Buddy cannot edit restricted profile fields
- [ ] Buddy cannot edit payment fields
- [ ] Admin can edit everything
- [ ] Friendlies allows any member (logged in check only)

### Integration Tests
- [ ] Complete flow: Login → Select family member → Edit profile → Save
- [ ] Complete flow: Login → Select family member → Edit renewal → Save → Email sent
- [ ] Email confirmations go to correct person
- [ ] Data persists correctly in Google Sheets
- [ ] Switching users preserves unsaved changes warning

---

## Claude Code Implementation Commands

### All-in-One Command

```bash
claude-code "Implement system-wide buddy/access control according to SYSTEM_WIDE_BUDDY_SPEC.md:

1. Create src/lib/buddies-sheets.ts with all authorization functions
2. Create src/components/UserSelector.tsx reusable component
3. Create app/api/buddies/route.ts shared endpoint
4. Update app/api/profile/route.ts to add userName parameter and buddy authorization
5. Update app/profile/page.tsx to add user selector dropdown
6. Update app/api/renewals/route.ts to add userName parameter and buddy authorization
7. Update app/renewals/page.tsx to add user selector dropdown

Key requirements:
- Profile/Renewals use buddy system (self + buddies + admin)
- Friendlies use open access (any member can sign up any member)
- Email field = self or admin only in profile
- Payment fields = view for buddy, edit for admin in renewals
- Consistent UserSelector component across features
- Backend always validates authorization

Build in phases, test after each phase."
```

### Phase-by-Phase Commands

```bash
# Phase 1: Core system
claude-code "Create src/lib/buddies-sheets.ts, src/components/UserSelector.tsx, and app/api/buddies/route.ts according to SYSTEM_WIDE_BUDDY_SPEC.md Phase 1"

# Phase 2: Profile
claude-code "Add buddy support to profile system according to SYSTEM_WIDE_BUDDY_SPEC.md Phase 2"

# Phase 3: Renewals
claude-code "Add buddy support to renewals system according to SYSTEM_WIDE_BUDDY_SPEC.md Phase 3"

# Phase 4: Test each feature
# Manual testing between phases
```

---

## Success Criteria

✅ **Profile System:**
- Buddy can edit most profile fields
- Buddy cannot edit email/password
- Admin can edit everything
- Visual indicator when managing others

✅ **Renewals System:**
- Buddy can edit all renewal fields
- Buddy can view payment info (read-only)
- Admin can edit payment info
- Email sent to target user
- Visual indicator when managing others

✅ **Friendlies System:** (Day 6)
- Any member can sign up any member
- No buddy restrictions
- Matches physical board practice
- Quick self-signup option

✅ **Consistent UX:**
- Same UserSelector component
- Same dropdown behavior
- Clear visual indicators
- Appropriate access controls per feature

✅ **Security:**
- Backend validates all authorization
- Field-level restrictions enforced
- Payment data protected
- Audit trail of who managed whom

---

## Future Enhancements

### Phase 2 Features
- [ ] Buddy request/approval system
- [ ] Multiple buddies per user
- [ ] Buddy permission levels (view/edit)
- [ ] Email notifications when buddy acts
- [ ] Audit log UI
- [ ] Bulk management (admin)

---

**Ready for Claude Code implementation!** 🚀

The spec now covers:
- ✅ Profile with buddy support + field restrictions
- ✅ Renewals with buddy support + payment restrictions  
- ✅ Friendlies with open access (matches physical board)
- ✅ Consistent authorization across features
- ✅ Reusable components
- ✅ Comprehensive testing plan
