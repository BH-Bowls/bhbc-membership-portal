# Theme System Implementation Guide

## Overview

This guide explains how to implement the centralized theme system from TDC Portal into the Bowls Club project. The theme system provides a single source of truth for all branding, colors, and styling, making it easy to rebrand the portal.

## What This System Does

- **Centralized branding** - Brand name, logo, colors in one file
- **Email template theming** - Automatic variable replacement in HTML emails
- **Component consistency** - Standard sizes, colors, spacing
- **Easy rebranding** - Change theme config and helper functions to rebrand entire portal

## Important: Understanding Tailwind JIT Limitation

**CRITICAL**: Tailwind's JIT (Just-In-Time) compiler only includes classes that it can detect at build time. This means:

- **Dynamic class construction DOES NOT WORK**: `bg-${colorVariable}` will NOT be compiled
- **Literal classes DO WORK**: `bg-teal-700` will be compiled
- **Theme helpers use literal classes**: The helper functions return hardcoded Tailwind classes that match the theme configuration

**Example of what doesn't work**:
```typescript
// This will NOT work - JIT can't detect dynamic classes
const color = 'teal-700';
className={`bg-${color}`}  // ❌ bg-teal-700 won't be included
```

**How the theme system solves this**:
```typescript
// theme-helpers.ts uses literal classes based on theme config
export function getProfileIconClasses(isImpersonating: boolean): string {
  if (isImpersonating) {
    return 'flex ... bg-orange-500 hover:bg-orange-600';  // ✅ Literal classes
  } else {
    return 'flex ... bg-teal-700 hover:bg-teal-800';  // ✅ Literal classes
  }
}
```

**What this means for rebranding**:
- Update `theme.ts` color configuration (e.g., change 'teal-700' to 'blue-700')
- Update `theme-helpers.ts` functions to use matching literal classes
- Both files must stay in sync

## Files to Copy

Copy these files from TDC Portal to Bowls Club:

### 1. Theme Configuration Files
```
Source: TDC-portal/src/config/
Destination: bowls-club/src/config/

Files:
- theme.ts
- theme-helpers.ts
```

### 2. Email Template Processor
```
Source: TDC-portal/src/lib/email/template-processor.ts
Destination: bowls-club/src/lib/email/template-processor.ts

This is a NEW FILE - create the directory if needed
```

## Implementation Steps

### Step 1: Copy Files

1. Copy the three files listed above into your Bowls Club project
2. Ensure directory structure matches (create `src/config/` if needed)

### Step 2: Update Theme Configuration

**File**: `src/config/theme.ts`

Update the brand section for Bowls Club:

```typescript
brand: {
  name: 'Your Bowls Club Name',
  shortName: 'YBC',  // Your initials
  tagline: 'Member Portal',
  logo: {
    path: '/bowls-club-logo.png',  // Your logo filename
    alt: 'Your Bowls Club Logo',
    height: 40,
  },
},
```

Update colors to match your branding:

```typescript
colors: {
  primary: {
    DEFAULT: 'green-600',  // Change to your club colors
    hover: 'green-700',
    light: 'green-100',
    text: 'green-800',
  },
  // ... adjust other colors as needed
},
```

Update email colors (must use hex values):

```typescript
email: {
  headerColor: '#16A34A',       // green-600 or your brand color
  headerTextColor: '#ffffff',
  bodyTextColor: '#1F2937',
  buttonColor: '#16A34A',       // Match primary color
  buttonTextColor: '#ffffff',
  buttonHoverColor: '#15803D',  // Match hover color
  backgroundColor: '#F9FAFB',
  borderColor: '#E5E7EB',
},
```

### Step 3: Update Mailer to Use Template Processor

**File**: `src/lib/email/mailer.ts` (or wherever your email sending logic lives)

Import the template processor:

```typescript
import { processEmailTemplate } from './template-processor';
```

Update your email sending functions to process templates:

**Before**:
```typescript
export async function sendPasswordResetEmail(to: string, tempPassword: string) {
  const template = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/email/templates/password-reset.html'),
    'utf-8'
  );

  const html = template
    .replace(/\{\{TEMP_PASSWORD\}\}/g, tempPassword)
    .replace(/\{\{USER_EMAIL\}\}/g, to);

  await sendEmail({ to, subject: 'Password Reset', html });
}
```

**After**:
```typescript
export async function sendPasswordResetEmail(to: string, tempPassword: string) {
  const template = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/email/templates/password-reset.html'),
    'utf-8'
  );

  // Process template with theme branding + custom variables
  const html = processEmailTemplate(template, {
    TEMP_PASSWORD: tempPassword,
    USER_EMAIL: to,
  });

  await sendEmail({ to, subject: 'Password Reset', html });
}
```

**The key change**: Use `processEmailTemplate(template, variables)` instead of manual string replacement. This automatically applies theme branding.

### Step 4: Update Email Templates

Update your HTML email templates to use theme placeholders:

**Common replacements**:

1. **Brand name**:
   ```html
   <!-- Before -->
   <h1>Bowls Club Portal</h1>

   <!-- After -->
   <h1>{{BRAND_NAME}}</h1>
   ```

2. **Header colors**:
   ```html
   <!-- Before -->
   <div style="background-color: #1E40AF; color: white;">

   <!-- After -->
   <div style="background-color: {{HEADER_COLOR}}; color: {{HEADER_TEXT_COLOR}};">
   ```

3. **Button colors**:
   ```html
   <!-- Before -->
   <a href="..." style="background-color: #1E40AF; color: white;">

   <!-- After -->
   <a href="..." style="background-color: {{BUTTON_COLOR}}; color: {{BUTTON_TEXT_COLOR}};">
   ```

4. **Text colors**:
   ```html
   <!-- Before -->
   <p style="color: #1F2937;">

   <!-- After -->
   <p style="color: {{BODY_TEXT_COLOR}};">
   ```

**Available theme variables**:
- `{{BRAND_NAME}}` - Full organization name
- `{{BRAND_SHORT_NAME}}` - Short name/initials
- `{{HEADER_COLOR}}` - Email header background color (hex)
- `{{HEADER_TEXT_COLOR}}` - Header text color (hex)
- `{{BODY_TEXT_COLOR}}` - Body text color (hex)
- `{{BUTTON_COLOR}}` - Button background color (hex)
- `{{BUTTON_TEXT_COLOR}}` - Button text color (hex)
- `{{BUTTON_HOVER_COLOR}}` - Button hover color (hex)
- `{{BACKGROUND_COLOR}}` - Page background color (hex)
- `{{BORDER_COLOR}}` - Border color (hex)

### Step 5: Update Components to Use Theme

Update components that have hardcoded colors or branding:

**Example 1 - Navbar Branding**:

```typescript
// Add import at top
import { getBrand } from '@/config/theme-helpers';

// Inside component
const brand = getBrand();

// Use brand values
<img
  src={brand.logo.path}
  alt={brand.logo.alt}
  style={{ height: `${brand.logo.height}px`, width: 'auto' }}
/>
```

**Example 2 - Navigation Items**:

```typescript
import { getNavItemClasses } from '@/config/theme-helpers';

// Instead of hardcoded classes:
className={`px-3 py-2 ${isActive ? 'bg-indigo-100 text-indigo-900' : 'text-gray-700'}`}

// Use helper:
className={getNavItemClasses(isActive)}
```

**Example 3 - Profile Icon**:

```typescript
import { getProfileIconClasses } from '@/config/theme-helpers';

// Instead of hardcoded classes:
className={`rounded-full ${isImpersonating ? 'bg-orange-500' : 'bg-indigo-700'}`}

// Use helper:
className={getProfileIconClasses(isImpersonating)}
```

**Example 4 - Links**:

```typescript
import { getLinkClasses } from '@/config/theme-helpers';

// Instead of hardcoded classes:
<a href="/forgot-password" className="text-indigo-600 hover:text-indigo-500">

// Use helper:
<a href="/forgot-password" className={getLinkClasses('primary')}>
```

**Example 5 - Buttons**:

```typescript
import { getButtonClasses } from '@/config/theme-helpers';

// Instead of hardcoded classes:
className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2"

// Use helper:
className={getButtonClasses('primary', 'md')}
```

**Available Helper Functions**:
- `getBrand()` - Returns brand configuration
- `getButtonClasses(variant, size, fullWidth?)` - Button styling
- `getInputClasses(hasError?)` - Input field styling
- `getNavItemClasses(isActive)` - Navigation item styling
- `getLinkClasses(variant)` - Link styling
- `getProfileIconClasses(isImpersonating)` - Profile icon styling
- `getCardClasses(padding)` - Card/panel styling
- `getBadgeClasses(variant, size)` - Badge styling
- `getAlertClasses(variant)` - Alert message styling

### Step 6: Replace Logo File

1. Add your club's logo to `public/` directory
2. Update `theme.ts` to reference your logo filename:
   ```typescript
   logo: {
     path: '/your-logo.png',  // Match actual filename
     alt: 'Your Bowls Club Logo',
     height: 40,
   }
   ```

### Step 7: Update Site Metadata

**File**: `app/layout.tsx`

Update title and description:

```typescript
export const metadata: Metadata = {
  title: 'Your Bowls Club Portal',
  description: 'Member portal for Your Bowls Club',
};
```

## Testing Checklist

After implementation, test:

- [ ] Logo appears correctly in navbar
- [ ] Brand name shows correctly throughout UI
- [ ] Colors match your theme configuration
- [ ] Email templates render with correct branding
- [ ] Password reset email uses theme colors
- [ ] Welcome email uses theme colors
- [ ] Buttons use theme colors consistently
- [ ] No hardcoded "Tapestry Day Club" or "TDC" references remain

## Email Template Processing Flow

Understanding how it works:

1. **Load template** from file system
2. **Process with `processEmailTemplate()`**:
   - Replaces theme variables (`{{BRAND_NAME}}`, `{{BUTTON_COLOR}}`, etc.)
   - Replaces custom variables (user-specific data)
3. **Send email** with processed HTML

**Example**:
```typescript
// Template file contains:
// <h1>{{BRAND_NAME}}</h1>
// <p>Hi {{USER_NAME}},</p>
// <a style="background: {{BUTTON_COLOR}}">Click Here</a>

const template = fs.readFileSync('template.html', 'utf-8');

const html = processEmailTemplate(template, {
  USER_NAME: 'John Smith',
});

// Result:
// <h1>Your Bowls Club Name</h1>
// <p>Hi John Smith,</p>
// <a style="background: #16A34A">Click Here</a>
```

## Migration Strategy

### Option 1: All at Once
1. Copy all files
2. Update all templates
3. Update all components
4. Test thoroughly
5. Deploy

### Option 2: Incremental
1. Copy files and update theme config
2. Update email system first (template processor + templates)
3. Test emails
4. Gradually update components to use theme helpers
5. Test after each component update

**Recommendation**: Option 2 (Incremental) is safer for production systems.

## Benefits After Implementation

- **Easy rebranding** - Change colors in one file, updates everywhere
- **Consistent styling** - All components use same color palette
- **Maintainable emails** - No hardcoded colors in templates
- **Template reusability** - Same template works for different organizations
- **Type safety** - TypeScript ensures theme values are used correctly

## Common Pitfalls

### 1. Dynamic Class Construction (Most Common!)
**Problem**: Colors don't appear, Tailwind classes missing from build

**Example**:
```typescript
// ❌ This doesn't work - JIT can't detect dynamic classes
const color = theme.colors.primary.DEFAULT;  // 'teal-700'
className={`bg-${color}`}  // bg-teal-700 won't be compiled
```

**Solution**: Always use literal classes in helper functions:
```typescript
// ✅ This works - literal classes
export function getButtonClasses(): string {
  return 'bg-teal-700 hover:bg-teal-800';  // Hardcoded classes
}
```

### 2. Forgetting to Update Both Files When Changing Colors
**Problem**: Changed color in `theme.ts` but component still shows old color

**Solution**:
1. Update color value in `theme.ts`
2. Update literal classes in `theme-helpers.ts`
3. Update hex values in `theme.email` section
All three must match!

### 3. Forgetting to Process Email Templates
**Problem**: Email template has `{{BRAND_NAME}}` but shows literally in email

**Solution**: Ensure you're calling `processEmailTemplate()` before sending:
```typescript
const html = processEmailTemplate(template, customVars);
```

### 4. Using Tailwind Classes in Emails
**Problem**: Emails don't support Tailwind CSS

**Solution**: Always use inline styles with hex colors from `theme.email`:
```html
<div style="background-color: {{HEADER_COLOR}};">
```

### 5. Mixing Hardcoded and Theme Values
**Problem**: Some buttons use theme, others have hardcoded colors

**Solution**: Systematically update all components to use theme helpers.

### 6. Wrong Logo Path
**Problem**: Logo doesn't appear

**Solution**:
- Verify file exists in `public/` directory
- Check `theme.logo.path` matches exact filename (case-sensitive)
- Ensure path starts with `/` (e.g., `/logo.png`)

### 7. Not Importing Helper Functions
**Problem**: Component has hardcoded colors instead of using theme

**Solution**: Always import helpers at the top of component:
```typescript
import { getNavItemClasses, getLinkClasses } from '@/config/theme-helpers';
```

## Customization After Implementation

### Changing Brand Colors

**IMPORTANT**: Due to Tailwind JIT limitations, you must update BOTH files:

**Step 1 - Update theme.ts**:

```typescript
// Change from teal to blue
colors: {
  primary: {
    DEFAULT: 'blue-600',      // Was 'teal-700'
    hover: 'blue-700',         // Was 'teal-800'
    light: 'blue-100',         // Was 'teal-100'
    text: 'blue-900',          // Was 'teal-900'
  },
}
```

**Step 2 - Update theme-helpers.ts**:

Find all functions that use the old color and replace with literal new color:

```typescript
export function getNavItemClasses(isActive: boolean): string {
  const baseClasses = 'inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors';

  if (isActive) {
    // Update these literal classes to match theme.ts
    return `${baseClasses} bg-blue-100 text-blue-900`;  // Was bg-teal-100 text-teal-900
  } else {
    return `${baseClasses} text-gray-700 hover:bg-gray-100 hover:text-gray-900`;
  }
}

export function getProfileIconClasses(isImpersonating: boolean): string {
  const baseClasses = 'flex items-center justify-center h-10 w-10 rounded-full text-white font-medium transition-colors';

  if (isImpersonating) {
    return `${baseClasses} bg-orange-500 hover:bg-orange-600`;
  } else {
    // Update these literal classes
    return `${baseClasses} bg-blue-600 hover:bg-blue-700`;  // Was bg-teal-700 hover:bg-teal-800
  }
}

export function getLinkClasses(variant: 'primary' | 'secondary' = 'primary'): string {
  if (variant === 'primary') {
    // Update these literal classes
    return 'font-medium text-blue-600 hover:text-blue-500';  // Was text-teal-700 hover:text-teal-600
  } else {
    return 'font-medium text-orange-600 hover:text-orange-700';
  }
}
```

**Step 3 - Update email colors** (theme.ts):

```typescript
email: {
  headerColor: '#2563EB',       // blue-600 hex value
  buttonColor: '#2563EB',
  buttonHoverColor: '#1D4ED8',  // blue-700 hex value
  // ... other colors
}
```

**Tip**: Use a Tailwind color reference to find hex values for email templates.

### Adding New Colors

To add a new color scheme:

**Step 1 - Add to theme.ts**:

```typescript
colors: {
  // Existing colors...

  // Add custom color
  accent: {
    DEFAULT: 'purple-600',
    hover: 'purple-700',
    light: 'purple-100',
    text: 'purple-800',
  },
}
```

**Step 2 - Create helper functions** in theme-helpers.ts:

```typescript
export function getAccentButtonClasses(): string {
  // Return literal classes matching your accent color
  return 'px-4 py-2 rounded-md bg-purple-600 hover:bg-purple-700 text-white';
}
```

### Adding New Email Variables

Edit `src/lib/email/template-processor.ts`:

```typescript
export function processEmailTemplate(
  template: string,
  customVariables: Record<string, string> = {}
): string {
  let processed = template;

  // Existing theme replacements...

  // Add new variable
  const newVar = 'Some computed value';
  processed = processed.replace(/\{\{NEW_VAR\}\}/g, newVar);

  return processed;
}
```

### Adding Component Styles

Edit `src/config/theme.ts` under `components`:

```typescript
components: {
  // Add new component standard
  table: {
    headerBg: 'gray-50',
    borderColor: 'gray-200',
    hoverBg: 'gray-100',
  },
}
```

## Support

If you encounter issues:

1. Check that all three files were copied correctly
2. Verify theme.ts has been updated for your club
3. Ensure email templates use `{{PLACEHOLDER}}` format (double braces)
4. Check browser console for errors
5. Verify logo file exists in `public/` directory

## Summary

**What to copy**:
1. `src/config/theme.ts` - Theme configuration (brand, colors, components)
2. `src/config/theme-helpers.ts` - Helper functions that return literal Tailwind classes
3. `src/lib/email/template-processor.ts` - Email template variable replacement

**What to update**:
1. Theme brand/color configuration in `theme.ts`
2. Literal classes in `theme-helpers.ts` to match theme colors
3. Email hex values in `theme.ts` email section
4. Email mailer to use `processEmailTemplate()`
5. Email templates to use theme placeholders (`{{BRAND_NAME}}`, etc.)
6. Components to import and use theme helpers
7. Logo file in `public/` directory
8. Site metadata in `app/layout.tsx`

**Critical reminder**:
- `theme.ts` stores color names as strings (e.g., 'teal-700')
- `theme-helpers.ts` must use literal classes (e.g., `bg-teal-700`)
- Both files must stay in sync when changing colors
- Never use dynamic class construction (`bg-${variable}`)

**Time estimate**: 2-3 hours for full implementation

Once complete, you'll have a fully branded, maintainable theme system. To rebrand, update `theme.ts` color values, update matching literal classes in `theme-helpers.ts`, and update hex values in the email section.
