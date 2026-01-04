# Navbar Action Buttons Specification

## Problem Statement

Current issues with action buttons across the portal:
- **Inconsistent placement**: Some buttons at top, some at bottom - requires scrolling on long forms
- **Space concerns**: Two sticky bars (navbar + action buttons) consume too much vertical space
- **Inconsistent hover behavior**: Some buttons show pointer cursor, some don't
- **Lack of flexibility**: No standard way to add page-specific actions to navbar

## Solution Overview

Create a flexible navbar action button system that:
- Positions all primary actions (Edit, Save, Submit, etc.) in the navbar
- Provides consistent responsive behavior (mobile vs desktop)
- Supports 0, 1, or 2 action buttons
- Ensures consistent styling and hover behavior across all buttons

---

## Responsive Behavior

### Mobile
**Current navbar:**
```
[Logo] ........................ [☰]
```

**With action buttons:**
```
[Logo] .... [Primary] [Secondary] .... [☰]
```

- Buttons appear in center space
- Single navbar row (no second bar needed)
- Plenty of space for 1-2 buttons

### Desktop

**At top of page:**
```
┌─────────────────────────────────────────────┐
│ [Logo] [Home] [Profile] [Renewals] ... [👤]│ ← Main navbar (sticky)
├─────────────────────────────────────────────┤
│         [Primary Action] [Secondary]         │ ← Action bar (when present)
└─────────────────────────────────────────────┘
```

**When scrolled down:**
```
┌─────────────────────────────────────────────┐
│ [Logo] [Primary Action] [Secondary] ... [👤]│ ← Condensed sticky bar
└─────────────────────────────────────────────┘
                                               ↑ Main nav scrolled away
```

**When scrolling back up:**
- Main navbar slides back down
- Returns to two-bar layout

---

## API Design

### Navbar Component Props

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
  label: string;                    // Button text
  onClick: () => void;              // Click handler
  icon?: string;                    // Optional icon (←, ✓, 🖨️, etc.)
  loading?: boolean;                // Show spinner during async operations
  disabled?: boolean;               // Disable button
  variant?: 'primary' | 'secondary' | 'danger';  // Style variant
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

**Renewals Page:**
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
      onClick: () => router.push('/')
    }
  }}
/>
```

**View/Print Pages:**
```typescript
<Navbar
  actionButtons={{
    primary: {
      label: 'Print',
      icon: '🖨️',
      onClick: handlePrint
    },
    secondary: {
      label: 'Back',
      icon: '←',
      onClick: () => router.back()
    }
  }}
/>
```

**Pages with no actions:**
```typescript
<Navbar
  userName={session.user.name}
  userRole={session.user.role}
/>
```

---

## Button Style Standards

### All Buttons Must Have:
- ✅ `cursor: pointer` on hover (hand cursor)
- ✅ Consistent hover color change
- ✅ Smooth transitions (150-200ms)
- ✅ Consistent padding and sizing
- ✅ Disabled state styling

### Button Variants

**Primary (Save, Submit, Edit):**
- Background: Blue (`bg-blue-500`)
- Text: White
- Hover: Darker blue (`bg-blue-600`)
- Disabled: Gray (`bg-gray-400`)

**Secondary (Cancel, Back):**
- Background: White/transparent
- Border: Gray (`border-gray-300`)
- Text: Gray (`text-gray-700`)
- Hover: Light gray background (`bg-gray-50`)

**Danger (Delete, Remove):**
- Background: Red (`bg-red-500`)
- Text: White
- Hover: Darker red (`bg-red-600`)

### Loading State
- Show spinner icon
- Disable button interaction
- Keep button width stable (don't shift layout)

---

## Implementation Checklist

### Phase 1: Navbar Component Updates
- [ ] Add `actionButtons` prop to Navbar interface
- [ ] Implement mobile layout (center buttons)
- [ ] Implement desktop scroll-aware behavior
- [ ] Add condensed sticky mode for desktop
- [ ] Standardize button styles (cursor, hover, transitions)
- [ ] Add loading state support
- [ ] Add icon support

### Phase 2: Page Updates
- [ ] **Profile page**: Move Edit/Save/Cancel to navbar
- [ ] **Renewals page**: Move Submit/Cancel to navbar
- [ ] **Change Password page**: Move buttons to navbar
- [ ] Remove old button implementations from page bodies
- [ ] Test responsive behavior on all pages

### Phase 3: Testing & Polish
- [ ] Test scroll behavior on desktop (up/down)
- [ ] Test mobile layout on various screen sizes
- [ ] Verify all buttons have pointer cursor on hover
- [ ] Verify all buttons have consistent hover effects
- [ ] Test loading states (spinning, disabled)
- [ ] Test with/without icons
- [ ] Accessibility testing (keyboard navigation, screen readers)

### Phase 4: Documentation
- [ ] Update component documentation
- [ ] Add usage examples to component stories/docs
- [ ] Document button style standards in CODING_STANDARDS.md

---

## Pages to Update

1. **Profile** (`app/profile/page.tsx`)
   - View mode: Edit button
   - Edit mode: Save + Cancel buttons

2. **Renewals** (`app/renewals/page.tsx`)
   - Submit + Cancel buttons

3. **Change Password** (`app/change-password/page.tsx`)
   - Change Password + Cancel buttons

4. **Future pages**: Any page with primary actions should use navbar buttons

---

## Technical Notes

### Scroll Detection (Desktop)
- Use `window.addEventListener('scroll', handleScroll)`
- Track scroll direction (up/down)
- Add/remove condensed class based on scroll position
- Debounce scroll events for performance

### Responsive Breakpoint
- Use Tailwind's `md:` breakpoint (768px)
- Mobile: Single row with center buttons
- Desktop: Two-row or scroll-aware behavior

### Z-index Management
- Navbar: `z-50` (always on top)
- Ensure action buttons inherit proper z-index

---

## Future Enhancements

- [ ] Support for dropdown button menus
- [ ] Support for button groups (3+ buttons)
- [ ] Keyboard shortcuts (Ctrl+S for Save, Esc for Cancel)
- [ ] Toast notifications on action completion
- [ ] Undo functionality for destructive actions
