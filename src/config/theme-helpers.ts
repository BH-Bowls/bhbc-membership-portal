// src/config/theme-helpers.ts
// Utility functions for working with the theme configuration
// IMPORTANT: Uses literal Tailwind classes due to JIT compiler limitations
// When changing colors, update both theme.ts AND the literal classes in this file

import { theme } from './theme';

/**
 * Get brand configuration
 */
export function getBrand() {
  return theme.brand;
}

/**
 * Get Tailwind classes for a button variant and size
 * IMPORTANT: Uses literal classes - update these when changing theme colors
 */
export function getButtonClasses(
  variant: 'primary' | 'secondary' | 'danger' | 'success' | 'text' = 'primary',
  size: 'sm' | 'md' | 'lg' = 'md',
  fullWidth = false
): string {
  const baseClasses = 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed rounded-md';

  let sizeClasses = '';
  switch (size) {
    case 'sm':
      sizeClasses = 'px-3 py-1.5 text-sm';
      break;
    case 'md':
      sizeClasses = 'px-4 py-2 text-sm';
      break;
    case 'lg':
      sizeClasses = 'px-6 py-3 text-base';
      break;
  }

  let variantClasses = '';
  switch (variant) {
    case 'primary':
      // Literal classes matching theme.colors.primary (teal)
      variantClasses = 'bg-blue-500 hover:bg-blue-600 text-white border border-transparent shadow-sm focus:ring-blue-500';
      break;
    case 'secondary':
      variantClasses = 'bg-orange-600 hover:bg-orange-700 text-white border border-transparent shadow-sm focus:ring-orange-600';
      break;
    case 'danger':
      variantClasses = 'bg-red-600 hover:bg-red-900 text-white border border-transparent shadow-sm focus:ring-red-600';
      break;
    case 'success':
      variantClasses = 'bg-green-600 hover:bg-green-700 text-white border border-transparent shadow-sm focus:ring-green-600';
      break;
    case 'text':
      variantClasses = 'text-blue-500 hover:text-blue-600 bg-transparent hover:bg-transparent border-none shadow-none';
      break;
  }

  const widthClass = fullWidth ? 'w-full' : '';

  return `${baseClasses} ${sizeClasses} ${variantClasses} ${widthClass}`.trim();
}

/**
 * Get Tailwind classes for input fields
 */
export function getInputClasses(hasError = false): string {
  const baseClasses = 'block w-full px-3 py-2 rounded-md text-sm border transition-colors focus:outline-none focus:ring-2';

  if (hasError) {
    return `${baseClasses} border-red-300 text-red-900 placeholder-red-300 focus:ring-red-500 focus:border-red-500`;
  }

  return `${baseClasses} border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500`;
}

/**
 * Get Tailwind classes for navigation items
 */
export function getNavItemClasses(isActive: boolean): string {
  const baseClasses = 'inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors';

  if (isActive) {
    // Literal classes matching theme.colors.primary (teal)
    return `${baseClasses} bg-blue-100 text-blue-700`;
  }

  return `${baseClasses} text-gray-700 hover:bg-gray-100 hover:text-gray-900`;
}

/**
 * Get Tailwind classes for links
 */
export function getLinkClasses(variant: 'primary' | 'secondary' = 'primary'): string {
  if (variant === 'primary') {
    // Literal classes matching theme.colors.primary (teal)
    return 'font-medium text-blue-500 hover:text-blue-600';
  }

  return 'font-medium text-orange-600 hover:text-orange-700';
}

/**
 * Get Tailwind classes for profile icon
 */
export function getProfileIconClasses(isImpersonating: boolean): string {
  const baseClasses = 'flex items-center justify-center h-10 w-10 rounded-full text-white font-medium transition-colors';

  if (isImpersonating) {
    return `${baseClasses} bg-orange-500 hover:bg-orange-600`;
  }

  // Literal classes matching theme.colors.primary (teal)
  return `${baseClasses} bg-blue-500 hover:bg-blue-600`;
}

/**
 * Get Tailwind classes for cards
 */
export function getCardClasses(padding: 'none' | 'sm' | 'md' | 'lg' = 'md'): string {
  const baseClasses = 'bg-white shadow rounded-lg';

  let paddingClass = '';
  switch (padding) {
    case 'none':
      paddingClass = '';
      break;
    case 'sm':
      paddingClass = 'p-4';
      break;
    case 'md':
      paddingClass = 'p-6';
      break;
    case 'lg':
      paddingClass = 'p-8';
      break;
  }

  return `${baseClasses} ${paddingClass}`.trim();
}

/**
 * Get Tailwind classes for badges
 */
export function getBadgeClasses(
  variant: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' = 'primary',
  size: 'sm' | 'md' | 'lg' = 'md'
): string {
  const baseClasses = 'inline-flex items-center rounded-full font-medium';

  let sizeClass = '';
  switch (size) {
    case 'sm':
      sizeClass = 'px-2 py-0.5 text-xs';
      break;
    case 'md':
      sizeClass = 'px-2.5 py-0.5 text-xs';
      break;
    case 'lg':
      sizeClass = 'px-3 py-1 text-sm';
      break;
  }

  let variantClass = '';
  switch (variant) {
    case 'primary':
      variantClass = 'bg-blue-100 text-blue-700';
      break;
    case 'secondary':
      variantClass = 'bg-orange-100 text-orange-800';
      break;
    case 'success':
      variantClass = 'bg-green-100 text-green-800';
      break;
    case 'danger':
      variantClass = 'bg-red-100 text-red-800';
      break;
    case 'warning':
      variantClass = 'bg-yellow-100 text-yellow-800';
      break;
  }

  return `${baseClasses} ${sizeClass} ${variantClass}`;
}

/**
 * Get Tailwind classes for alert messages
 */
export function getAlertClasses(variant: 'info' | 'success' | 'warning' | 'danger' = 'info'): string {
  const baseClasses = 'rounded-md p-4';

  switch (variant) {
    case 'info':
      return `${baseClasses} bg-blue-50 border border-blue-200 text-blue-700`;
    case 'success':
      return `${baseClasses} bg-green-50 border border-green-200 text-green-700`;
    case 'warning':
      return `${baseClasses} bg-yellow-50 border border-yellow-200 text-yellow-700`;
    case 'danger':
      return `${baseClasses} bg-red-50 border border-red-200 text-red-700`;
  }
}
