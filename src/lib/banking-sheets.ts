// src/lib/banking-sheets.ts
// Shared row-parsing utilities for Sheets-backed modules. Originally also held the
// RenewalPayments/Renewals-touching Banking functions — those moved to
// banking-supabase.ts (supabase/migrations/0031_renewals.sql) since they read/write the
// same `renewals` table renewals-supabase.ts owns. This file now exists purely for these
// utilities, still used by invite-games-(attachments-)sheets.ts and
// leagues-attachments-sheets.ts (Suggestions/its attachments and profile-sheets.ts
// have since been cut over to Postgres and deleted).

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Wrap an error with additional context
 * Preserves the original error as the cause while adding contextual information
 *
 * @param message Context message describing what was being attempted
 * @param originalError The original error that occurred
 * @returns New error with context and original error preserved
 */
export function wrapError(message: string, originalError: unknown): Error {
  const error = new Error(message);
  error.cause = originalError;

  // Preserve stack trace from original error if available
  if (originalError instanceof Error && originalError.stack) {
    error.stack = `${error.stack}\n\nCaused by: ${originalError.stack}`;
  }

  return error;
}

// ============================================================================
// Shared Helper Functions
// ============================================================================

/**
 * Create a field getter for extracting string values from a sheet row
 *
 * @param row The sheet row data
 * @param colMap Column name to index mapping
 * @returns Function that gets a field value by column name
 */
export function createRowFieldGetter(row: any[], colMap: Record<string, number>) {
  return (field: string): string => {
    const colIndex = colMap[field];
    return colIndex !== undefined ? (row[colIndex] || '').toString().trim() : '';
  };
}

/**
 * Create a number getter for extracting numeric values from a sheet row
 * Handles currency formatting (£, $), commas, and whitespace
 *
 * @param get The field getter function
 * @returns Function that gets a numeric field value by column name
 */
export function createRowNumberGetter(get: (field: string) => string) {
  return (field: string): number => {
    const val = get(field);
    if (!val) return 0;
    // Strip currency symbols, commas, whitespace
    const cleaned = val.replace(/[£$,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };
}

/**
 * Convert camelCase field name to snake_case column name
 * Handles special cases with custom field mapping
 *
 * @param field Field name in camelCase (e.g., "firstName", "emailAddress")
 * @param customMappings Optional custom field to column mappings
 * @returns Column name in snake_case (e.g., "first_name", "email_address")
 *
 * @example
 * camelToSnakeCase("firstName") // "first_name"
 * camelToSnakeCase("emailAddress") // "email_address"
 * camelToSnakeCase("address1", { address1: "address_1" }) // "address_1"
 */
export function camelToSnakeCase(
  field: string,
  customMappings?: Record<string, string>
): string {
  // Check custom mappings first
  if (customMappings && field in customMappings) {
    return customMappings[field];
  }

  // Convert camelCase to snake_case
  // Inserts underscore before each capital letter, then lowercases
  return field.replace(/([A-Z])/g, '_$1').toLowerCase();
}
