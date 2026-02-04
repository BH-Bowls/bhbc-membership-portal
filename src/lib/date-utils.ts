// src/lib/date-utils.ts
// Date utility functions for handling UK date formats

// Month name to number mapping
const monthNames: Record<string, number> = {
  'january': 0, 'jan': 0,
  'february': 1, 'feb': 1,
  'march': 2, 'mar': 2,
  'april': 3, 'apr': 3,
  'may': 4,
  'june': 5, 'jun': 5,
  'july': 6, 'jul': 6,
  'august': 7, 'aug': 7,
  'september': 8, 'sep': 8, 'sept': 8,
  'october': 9, 'oct': 9,
  'november': 10, 'nov': 10,
  'december': 11, 'dec': 11,
};

/**
 * Parse a date string in various formats to a Date object
 * Supports:
 * - UK format: DD/MM/YYYY (e.g., "29/04/2026")
 * - Formatted: "Wed, 29 April" or "Wed, 29 April 2026"
 * - ISO format: YYYY-MM-DD
 * @param dateStr - Date string to parse
 * @returns Parsed Date object
 */
export function parseUKDate(dateStr: string): Date {
  if (!dateStr) return new Date();

  const trimmed = dateStr.trim();

  // Check if it's UK format (DD/MM/YYYY)
  const ukMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const [, day, month, year] = ukMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  // Check for formatted date like "Wed, 29 April" or "Wed, 29 April 2026"
  // Pattern: optional weekday, day, month name, optional year
  const formattedMatch = trimmed.match(/^(?:\w+,?\s+)?(\d{1,2})\s+(\w+)(?:\s+(\d{2,4}))?$/i);
  if (formattedMatch) {
    const [, dayStr, monthStr, yearStr] = formattedMatch;
    const day = parseInt(dayStr);
    const monthLower = monthStr.toLowerCase();
    const month = monthNames[monthLower];

    if (month !== undefined) {
      // If no year specified, use current year
      let year = yearStr ? parseInt(yearStr) : new Date().getFullYear();
      // Handle 2-digit years
      if (year < 100) {
        year += 2000;
      }
      return new Date(year, month, day);
    }
  }

  // Check for ISO format (YYYY-MM-DD)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  // Try standard parsing as fallback
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  // Return current date if all else fails
  console.warn(`Could not parse date: "${dateStr}"`);
  return new Date();
}

/**
 * Parse a normalized DD/MM/YYYY date string to a Date object
 * Use this in backend code where dates have already been normalized
 * This is simpler and faster than parseUKDate since the format is known
 * @param dateStr - Date string in DD/MM/YYYY format
 * @returns Parsed Date object, or invalid Date if parsing fails
 */
export function parseNormalizedDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);

  const parts = dateStr.split('/');
  if (parts.length !== 3) return new Date(NaN);

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // Months are 0-indexed
  const year = parseInt(parts[2], 10);

  return new Date(year, month, day);
}

/**
 * Normalize a date string to UK format (DD/MM/YYYY)
 * Use this when reading dates from Google Sheets to store in a consistent format
 * @param dateStr - Date string in any supported format
 * @returns Date string in DD/MM/YYYY format, or empty string if invalid
 */
export function normalizeToUKDate(dateStr: string): string {
  if (!dateStr) return '';

  const trimmed = dateStr.trim();

  // If already in UK format (DD/MM/YYYY), return as-is
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    // Ensure consistent padding (e.g., 1/4/2026 -> 01/04/2026)
    const parts = trimmed.split('/');
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    return `${day}/${month}/${parts[2]}`;
  }

  // Parse to Date object and convert to DD/MM/YYYY
  const parsed = parseUKDate(dateStr);
  if (isNaN(parsed.getTime())) {
    console.warn(`Could not normalize date: "${dateStr}"`);
    return '';
  }

  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * Format a date string for display using UK locale
 * Handles UK format input (DD/MM/YYYY)
 * @param dateStr - Date string to format
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string
 */
export function formatGameDate(
  dateStr: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }
): string {
  return parseUKDate(dateStr).toLocaleDateString('en-GB', options);
}
