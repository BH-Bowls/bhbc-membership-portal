# Navbar Action Buttons Specification V2

## Problem Statement

Current issues with action buttons across the portal:
- **Inconsistent placement**: Some buttons at top, some at bottom - requires scrolling on long forms
- **Loss of work**: Navigating away from forms loses all unsaved changes
- **Inconsistent hover behavior**: Some buttons show pointer cursor, some don't
- **No standard pattern**: Each page implements buttons differently

## Solution Overview

Create a unified navbar action button system that:
- **Replaces navigation items** with action buttons when in edit mode
- **Auto-saves drafts** to sessionStorage during editing
- **Warns on switch/logout** if unsaved changes exist
- **Keeps navigation accessible** (hamburger/profile menus remain active)
- **Provides consistent styling** across all buttons

---

## Core Principles

1. **Clean UI**: Action buttons replace nav items (not added alongside them)
2. **Accessible**: Hamburger and profile menus stay active
3. **Safe**: Auto-save drafts + warnings prevent data loss
4. **Simple**: One clear pattern for all forms
5. **Consistent**: Same behavior across Profile, Renewals, etc.

---

## UI Behavior

### Mobile

**View Mode (no buttons):**
```
[Logo] ........................ [☰]
```

**Edit Mode (with buttons):**
```
[Logo] .... [Save] [Cancel] .... [☰]
```
- Buttons appear in center space
- Hamburger menu remains active
- Single navbar row (no second bar)

### Desktop

**View Mode (no buttons):**
```
[Logo] [Home] [Profile] [Renewals] ... [👤]
```

**Edit Mode (with buttons):**
```
[Logo] [Save] [Cancel] .............. [👤]
```
- Action buttons **replace** Home/Profile/Renewals links
- Profile icon remains active
- Clean, focused UI

**No scroll-aware behavior** - keep it simple

---

## Navigation While Editing

### User Flow

1. User enters edit mode (nav items replaced with Save/Cancel)
2. User makes changes (auto-saved to sessionStorage)
3. User clicks hamburger or profile menu **→ Menu opens** ✓
4. User selects menu item (e.g., "Renewals", "Logout")
5. **Warning appears**: "You have unsaved changes. Leave without saving?"
   - [Stay] [Leave Anyway]
6. If **Stay** → menu closes, return to editing
7. If **Leave Anyway** → navigate away, changes lost (draft removed)

### What Triggers Warnings

**Show warning when:**
- Clicking navigation menu items (Home, Profile, Renewals, etc.)
- Clicking profile menu items (Profile, Change Password)
- Clicking "Return to Own Account"
- Clicking "Switch User"
- Clicking "Logout"

**No warning when:**
- Opening menus (hamburger/profile) - just browsing
- Clicking Save or Cancel (intentional actions)

---

## Auto-save System

### sessionStorage Keys

```
FormDraft-Profile-{userName}
FormDraft-Renewals-{userName}
FormDraft-ChangePassword-{userName}
```

### Save Draft (on every change)

```typescript
const saveDraft = (formName: string, userName: string, data: any) => {
  const key = `FormDraft-${formName}-${userName}`;
  sessionStorage.setItem(key, JSON.stringify({
    data,
    timestamp: Date.now()
  }));
};

// Example usage
useEffect(() => {
  if (isEditing && hasChanges) {
    saveDraft('Profile', session.user.userName, editedProfile);
  }
}, [editedProfile]);
```

### Restore Draft (on page load)

```typescript
const restoreDraft = (formName: string, userName: string) => {
  const key = `FormDraft-${formName}-${userName}`;
  const stored = sessionStorage.getItem(key);

  if (stored) {
    const { data, timestamp } = JSON.parse(stored);

    // Optional: Check if draft is too old (e.g., > 7 days)
    const isStale = Date.now() - timestamp > 7 * 24 * 60 * 60 * 1000;
    if (isStale) {
      sessionStorage.removeItem(key);
      return null;
    }

    return data;
  }

  return null;
};

// Example usage
useEffect(() => {
  const draft = restoreDraft('Profile', session.user.userName);
  if (draft) {
    setEditedProfile(draft);
    setIsEditing(true);
    // Optional: Show toast "Draft restored"
  }
}, []);
```

### Clear Draft (on save/cancel)

```typescript
const clearDraft = (formName: string, userName: string) => {
  const key = `FormDraft-${formName}-${userName}`;
  sessionStorage.removeItem(key);
};

// On successful save
const handleSave = async () => {
  const result = await saveProfile(editedProfile);
  if (result.success) {
    clearDraft('Profile', session.user.userName);
    setIsEditing(false);
  }
};

// On cancel
const handleCancel = () => {
  clearDraft('Profile', session.user.userName);
  setIsEditing(false);
  setEditedProfile(profile); // Reset to original
};
```

---

## Switch User / Logout Warning

### Simple Warning (No Save Option)

When user tries to switch users, switch back, or logout:

```typescript
const checkForUnsavedChanges = () => {
  // Check for any FormDraft keys
  const drafts = Object.keys(sessionStorage)
    .filter(key => key.startsWith('FormDraft-'));

  return drafts.length > 0;
};

const clearAllDrafts = () => {
  Object.keys(sessionStorage).forEach(key => {
    if (key.startsWith('FormDraft-')) {
      sessionStorage.removeItem(key);
    }
  });
};

// Before switch/logout
const handleSwitchUser = async (targetUser: string) => {
  if (checkForUnsavedChanges()) {
    const confirmed = window.confirm(
      'You have unsaved changes. Your work will be lost. Continue?'
    );

    if (!confirmed) {
      return; // Stay on current page
    }

    clearAllDrafts(); // Remove all drafts
  }

  // Proceed with switch
  await switchToUser(targetUser);
};
```

**Key Points:**
- Simple yes/no warning
- No "Save & Switch" option - keeps it simple
- User must manually save before switching if they want to keep changes
- All drafts cleared on proceed

---

## Navbar Component API

### Props Interface

```typescript
interface NavbarProps {
  userName?: string;
  userRole?: string;
  actionButtons?: {
    primary?: ActionButton;
    secondary?: ActionButton;
  };
}

interface ActionButton {
  label: string;              // Button text
  onClick: () => void;        // Click handler
  icon?: string;              // Optional icon (←, ✓, etc.)
  loading?: boolean;          // Show spinner during async operations
  disabled?: boolean;         // Disable button
  variant?: 'primary' | 'secondary' | 'danger';
}
```

### Usage Examples

**Profile - View Mode:**
```typescript
<Navbar
  userName={session.user.name}
  userRole={session.user.role}
  actionButtons={{
    primary: {
      label: 'Edit',
      onClick: handleEdit
    }
  }}
/>
```

**Profile - Edit Mode:**
```typescript
<Navbar
  userName={session.user.name}
  userRole={session.user.role}
  actionButtons={{
    primary: {
      label: 'Save',
      onClick: handleSave,
      loading: isSaving
    },
    secondary: {
      label: 'Cancel',
      onClick: handleCancel
    }
  }}
/>
```

**Renewals - View Mode:**
```typescript
<Navbar
  actionButtons={{
    primary: {
      label: 'Edit',
      onClick: handleEdit
    }
  }}
/>
```

**Renewals - Edit Mode:**
```typescript
<Navbar
  actionButtons={{
    primary: {
      label: 'Submit',
      onClick: handleSubmit,
      loading: isSubmitting
    },
    secondary: {
      label: 'Cancel',
      onClick: handleCancel
    }
  }}
/>
```

**Change Password:**
```typescript
<Navbar
  actionButtons={{
    primary: {
      label: 'Change Password',
      onClick: handleSubmit,
      loading: isSubmitting
    },
    secondary: {
      label: 'Cancel',
      onClick: () => router.push('/')
    }
  }}
/>
```

**No actions (default):**
```typescript
<Navbar
  userName={session.user.name}
  userRole={session.user.role}
/>
```

---

## Button Style Standards

### All Buttons Must Have

- ✅ `cursor: pointer` on hover (hand cursor)
- ✅ Consistent hover color change
- ✅ Smooth transitions (150-200ms)
- ✅ Consistent padding and sizing
- ✅ Disabled state styling
- ✅ Focus states for accessibility

### Button Variants

**Primary (Save, Submit, Edit):**
```css
background: bg-blue-500
text: text-white
hover: bg-blue-600
disabled: bg-gray-400 cursor-not-allowed
focus: ring-2 ring-blue-500 ring-offset-2
```

**Secondary (Cancel, Back):**
```css
background: bg-white
border: border-gray-300
text: text-gray-700
hover: bg-gray-50
focus: ring-2 ring-gray-500 ring-offset-2
```

**Danger (Delete, Remove):**
```css
background: bg-red-500
text: text-white
hover: bg-red-600
disabled: bg-gray-400 cursor-not-allowed
focus: ring-2 ring-red-500 ring-offset-2
```

### Loading State

```typescript
{loading ? (
  <>
    <svg className="animate-spin h-4 w-4 mr-2" /* spinner SVG */>
    {label}
  </>
) : (
  label
)}
```

- Show spinner icon
- Keep button enabled but non-interactive
- Maintain button width (prevent layout shift)

---

## Page-Specific Implementations

### Profile Page

**Current state:**
- Always shows all fields
- Edit/Save/Cancel buttons in page body (requires scrolling)

**New implementation:**

**View Mode:**
- Display all fields as read-only
- Navbar shows: `[Logo] [Edit] ... [👤]`

**Edit Mode:**
- Fields become editable
- Navbar shows: `[Logo] [Save] [Cancel] ... [👤]`
- Changes auto-saved to `FormDraft-Profile-{userName}`
- Navigate away → warning
- Return → draft restored

---

### Renewals Page

**Current state:**
- Always editable
- Submit/Cancel at bottom of page

**New implementation:**

**View Mode:**
- Display submitted renewal as read-only
- Navbar shows: `[Logo] [Edit] ... [👤]`
- Or: Show "No renewal submitted" with Edit button

**Edit Mode:**
- Form fields editable
- Navbar shows: `[Logo] [Submit] [Cancel] ... [👤]`
- Changes auto-saved to `FormDraft-Renewals-{userName}`
- Navigate away → warning
- Return → draft restored

**Note:** Renewals needs View/Edit modes added (doesn't currently have them)

---

### Change Password Page

**Current state:**
- Form at bottom of page
- Change Password/Cancel buttons at bottom

**New implementation:**
- Form fields in page body
- Navbar shows: `[Logo] [Change Password] [Cancel] ... [👤]`
- No auto-save (short form, sensitive data)
- Navigate away → warning if fields are filled

---

## Navigation Warning Implementation

### Intercept Navigation Clicks

```typescript
// In Navbar component
const handleNavClick = (e: React.MouseEvent, href: string) => {
  // If there are unsaved changes in any form
  if (hasUnsavedChanges()) {
    e.preventDefault();

    const confirmed = window.confirm(
      'You have unsaved changes. Leave without saving?'
    );

    if (confirmed) {
      // Clear the current form's draft
      clearCurrentDraft();
      // Proceed with navigation
      router.push(href);
    }
    // If not confirmed, do nothing (stay on page)
  }
  // If no unsaved changes, navigate normally
};

// Apply to all navigation links
<Link href="/profile" onClick={(e) => handleNavClick(e, '/profile')}>
  Profile
</Link>
```

### Track Unsaved Changes

```typescript
// In each form page
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

useEffect(() => {
  // Track if form has been modified
  const hasChanges = JSON.stringify(editedProfile) !== JSON.stringify(profile);
  setHasUnsavedChanges(hasChanges);
}, [editedProfile, profile]);

// Pass to Navbar or global context
<Navbar
  actionButtons={...}
  hasUnsavedChanges={hasUnsavedChanges}
/>
```

---

## Implementation Checklist

### Phase 1: Navbar Component
- [ ] Update Navbar to accept `actionButtons` prop
- [ ] Mobile: Show buttons in center when provided
- [ ] Desktop: Replace nav items with buttons when provided
- [ ] Keep hamburger and profile menus functional
- [ ] Add navigation warning system
- [ ] Standardize all button styles (cursor, hover, focus)
- [ ] Add loading state support
- [ ] Add icon support (optional)

### Phase 2: Auto-save System
- [ ] Create `saveDraft()` utility function
- [ ] Create `restoreDraft()` utility function
- [ ] Create `clearDraft()` utility function
- [ ] Create `checkForUnsavedChanges()` utility
- [ ] Create `clearAllDrafts()` utility
- [ ] Add switch/logout warning logic

### Phase 3: Profile Page
- [ ] Add View/Edit mode toggle (currently always editable)
- [ ] Move Edit button to Navbar
- [ ] Move Save/Cancel buttons to Navbar
- [ ] Add auto-save on field changes
- [ ] Add draft restoration on page load
- [ ] Remove old buttons from page body
- [ ] Test responsive behavior

### Phase 4: Renewals Page
- [ ] **Add View/Edit mode** (currently always editable)
- [ ] Create read-only view of submitted renewal
- [ ] Add Edit button to Navbar
- [ ] Move Submit/Cancel buttons to Navbar
- [ ] Add auto-save on field changes
- [ ] Add draft restoration on page load
- [ ] Remove old buttons from page body
- [ ] Test responsive behavior

### Phase 5: Change Password Page
- [ ] Move Change Password/Cancel buttons to Navbar
- [ ] Add unsaved changes tracking (if fields filled)
- [ ] Add navigation warning
- [ ] Remove old buttons from page body
- [ ] Test responsive behavior

### Phase 6: Testing & Polish
- [ ] Test all navigation warnings work correctly
- [ ] Test auto-save/restore on all forms
- [ ] Test switch user warning
- [ ] Test logout warning
- [ ] Verify all buttons have pointer cursor
- [ ] Verify all buttons have consistent hover
- [ ] Test mobile responsive behavior
- [ ] Test keyboard navigation (Tab, Enter, Esc)
- [ ] Test with screen readers
- [ ] Test draft expiration (stale drafts)

### Phase 7: Documentation
- [ ] Update component documentation
- [ ] Add usage examples
- [ ] Document auto-save behavior
- [ ] Update CODING_STANDARDS.md

---

## Technical Implementation Notes

### sessionStorage Key Naming

**Format:** `FormDraft-{FormName}-{userName}`

**Examples:**
- `FormDraft-Profile-john.smith`
- `FormDraft-Renewals-jane.doe`
- `FormDraft-ChangePassword-admin.user`

**Cleanup:**
- Remove on successful save
- Remove on cancel
- Remove all on switch/logout
- Optional: Remove stale drafts (> 7 days old)

### Warning Message Text

**Navigation warning:**
```
"You have unsaved changes. Leave without saving?"
[Stay] [Leave Anyway]
```

**Switch/Logout warning:**
```
"You have unsaved changes. Your work will be lost. Continue?"
[Stay] [Leave Anyway]
```

### Browser Navigation (Back Button)

**Optional enhancement:** Add `beforeunload` event

```typescript
useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [hasUnsavedChanges]);
```

---

## Migration Strategy

### Incremental Rollout

1. **Phase 1**: Update Navbar component (foundation)
2. **Phase 2**: Migrate Profile page (test pattern)
3. **Phase 3**: Migrate Renewals page (complex case)
4. **Phase 4**: Migrate Change Password (simple case)
5. **Phase 5**: Apply to any future forms

### Backwards Compatibility

- Old pages continue to work with current button placement
- Migrate one page at a time
- Test thoroughly before moving to next page

---

## Future Enhancements

- [ ] Visual indicator: "Draft saved" toast notification
- [ ] Show last auto-save timestamp
- [ ] List of pages with unsaved drafts in warning
- [ ] Keyboard shortcuts (Ctrl+S for Save, Esc for Cancel)
- [ ] Backend draft storage (if needed for persistence)
- [ ] Collaborative editing indicators
- [ ] Draft versioning/history

---

## Key Differences from V1

**V1 Approach:**
- Two sticky bars (navbar + action bar)
- Scroll-aware behavior on desktop
- Complex scroll handling

**V2 Approach (This Spec):**
- ✅ Single navbar (buttons replace nav items)
- ✅ Auto-save with warnings (better UX)
- ✅ Simpler implementation (no scroll detection)
- ✅ Keep navigation accessible (hamburger/profile active)
- ✅ Consistent across all forms
- ✅ View/Edit modes for all forms (including Renewals)

---

## Success Criteria

✅ All primary actions accessible without scrolling
✅ Navigation remains accessible during editing
✅ No unsaved changes lost accidentally
✅ Consistent button behavior across all pages
✅ Clean, uncluttered UI
✅ Mobile and desktop responsive
✅ All buttons have proper hover/focus states
✅ Keyboard accessible
✅ Screen reader compatible
