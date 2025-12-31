// src/lib/email/template-processor.ts
// Email template processor - replaces placeholders with theme values
// Email templates can't import React components, so we use string replacement

import { theme } from '@/config/theme';

/**
 * Process an email template HTML string by replacing placeholders with theme values
 *
 * Available placeholders:
 * - {{BRAND_NAME}} - Full brand name (e.g., "Burgess Hill Bowls Club")
 * - {{BRAND_SHORT_NAME}} - Short brand name (e.g., "BHBC")
 * - {{HEADER_COLOR}} - Email header color from theme
 * - {{BUTTON_COLOR}} - Email button color from theme
 * - {{LINK_COLOR}} - Email link color (same as button color)
 * - {{PRIMARY_COLOR}} - Primary brand color for text and borders
 *
 * @param html - The HTML template string with placeholders
 * @returns The processed HTML with placeholders replaced
 */
export function processEmailTemplate(html: string): string {
  return html
    .replace(/\{\{BRAND_NAME\}\}/g, theme.brand.name)
    .replace(/\{\{BRAND_SHORT_NAME\}\}/g, theme.brand.shortName)
    .replace(/\{\{HEADER_COLOR\}\}/g, theme.email.headerColor)
    .replace(/\{\{BUTTON_COLOR\}\}/g, theme.email.buttonColor)
    .replace(/\{\{LINK_COLOR\}\}/g, theme.email.buttonColor)  // Links use same color as buttons
    .replace(/\{\{PRIMARY_COLOR\}\}/g, theme.email.headerColor); // Primary color for text and borders
}

/**
 * Process an email template with additional custom replacements
 *
 * @param html - The HTML template string
 * @param replacements - Object with custom key-value pairs to replace
 * @returns The processed HTML
 *
 * @example
 * processEmailTemplateWithReplacements(html, {
 *   '{{USER_NAME}}': 'John Doe',
 *   '{{RESET_LINK}}': 'https://...'
 * })
 */
export function processEmailTemplateWithReplacements(
  html: string,
  replacements: Record<string, string>
): string {
  // First process theme placeholders
  let processed = processEmailTemplate(html);

  // Then process custom replacements
  for (const [key, value] of Object.entries(replacements)) {
    processed = processed.replace(new RegExp(key, 'g'), value);
  }

  return processed;
}
