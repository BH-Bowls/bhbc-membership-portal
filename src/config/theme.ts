// src/config/theme.ts
// Central theme configuration for the TDC Portal
// This is the single source of truth for all branding, colors, fonts, and component styling
// To rebrand this template, update the values in this file

export const theme = {
  // ============================================================================
  // Brand Configuration
  // ============================================================================
  // Update these values to rebrand the portal for a different organization
  brand: {
    name: 'Burgess Hill Bowls Club',
    shortName: 'BHBC',
    tagline: 'Member Portal',
    logo: {
      path: '/bhbc-Logo.png',
      alt: 'Burgess Hill Bowls Club Logo',
      height: 40, // pixels
    },
  },

  // ============================================================================
  // Color Palette
  // ============================================================================
  // Uses Tailwind color names - change these to customize the color scheme
  // Matches Burgess Hill Bowls Club website branding (blue theme)
  colors: {
    // Primary brand color (buttons, links, focus states)
    // Club blue: #588FB1 (closest Tailwind: blue-500)
    primary: {
      DEFAULT: 'blue-500',
      hover: 'blue-600',
      light: 'blue-100',
      text: 'blue-700',
    },

    // Secondary color (alternative buttons, borders)
    secondary: {
      DEFAULT: 'gray-300',
      hover: 'gray-400',
      light: 'gray-100',
      text: 'gray-700',
    },

    // Danger/destructive actions (delete, deactivate)
    danger: {
      DEFAULT: 'red-600',
      hover: 'red-900',
      light: 'red-50',
      text: 'red-800',
    },

    // Success states (confirmations, success messages)
    success: {
      DEFAULT: 'green-600',
      hover: 'green-700',
      light: 'green-50',
      text: 'green-800',
    },

    // Warning states (alerts, warnings)
    warning: {
      DEFAULT: 'yellow-500',
      hover: 'yellow-600',
      light: 'yellow-50',
      text: 'yellow-800',
    },

    // Neutral grays for text, borders, backgrounds
    neutral: {
      50: 'gray-50',
      100: 'gray-100',
      200: 'gray-200',
      300: 'gray-300',
      400: 'gray-400',
      500: 'gray-500',
      600: 'gray-600',
      700: 'gray-700',
      800: 'gray-800',
      900: 'gray-900',
    },
  },

  // ============================================================================
  // Typography
  // ============================================================================
  typography: {
    fontFamily: {
      sans: 'Arial, Helvetica, sans-serif',
      // Add custom fonts here if using web fonts
    },
    fontSize: {
      xs: '0.75rem',    // 12px
      sm: '0.875rem',   // 14px
      base: '1rem',     // 16px
      lg: '1.125rem',   // 18px
      xl: '1.25rem',    // 20px
      '2xl': '1.5rem',  // 24px
      '3xl': '1.875rem', // 30px
    },
  },

  // ============================================================================
  // Component Sizing and Styling Standards
  // ============================================================================
  components: {
    // Button component standards
    button: {
      sizes: {
        sm: {
          padding: 'px-3 py-1.5',
          fontSize: 'text-sm',
        },
        md: {
          padding: 'px-4 py-2',
          fontSize: 'text-sm',
        },
        lg: {
          padding: 'px-6 py-3',
          fontSize: 'text-base',
        },
      },
      borderRadius: 'rounded-md',
      fontWeight: 'font-medium',
    },

    // Input field standards
    input: {
      borderRadius: 'rounded-md',
      padding: 'px-3 py-2',
      fontSize: 'text-sm',
      borderWidth: 'border',
    },

    // Card/panel standards
    card: {
      borderRadius: 'rounded-lg',
      shadow: 'shadow',
      padding: {
        none: '',
        sm: 'p-4',
        md: 'p-6',
        lg: 'p-8',
      },
    },

    // Modal standards
    modal: {
      sizes: {
        sm: 'max-w-md',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
      },
      borderRadius: 'rounded-lg',
      shadow: 'shadow-xl',
      backdrop: 'bg-gray-500 bg-opacity-75',
    },

    // Badge standards
    badge: {
      sizes: {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
      borderRadius: 'rounded-full',
      fontWeight: 'font-medium',
    },

    // Alert/notification standards
    alert: {
      borderRadius: 'rounded-md',
      padding: 'p-4',
    },
  },

  // ============================================================================
  // Layout Standards
  // ============================================================================
  layout: {
    containerMaxWidth: 'max-w-7xl',
    navbarHeight: 'h-16',
    spacing: {
      page: 'py-8 px-4 sm:px-6 lg:px-8',
    },
  },

  // ============================================================================
  // Email Template Colors
  // ============================================================================
  // HTML emails can't use Tailwind classes, so we need hex values
  // These match the Burgess Hill Bowls Club website branding
  email: {
    headerColor: '#588FB1',       // Club primary blue (rgb 88,143,177)
    headerTextColor: '#ffffff',   // white
    bodyTextColor: '#1F2937',     // gray-800
    buttonColor: '#588FB1',       // Club primary blue
    buttonTextColor: '#ffffff',   // white
    buttonHoverColor: '#4A7A95',  // Darker club blue (hover state)
    backgroundColor: '#F9FAFB',   // gray-50
    borderColor: '#E5E7EB',       // gray-200
  },
} as const;

// Export type for TypeScript type checking
export type Theme = typeof theme;

// Export individual sections for convenience
export const {
  brand,
  colors,
  typography,
  components,
  layout,
  email,
} = theme;
