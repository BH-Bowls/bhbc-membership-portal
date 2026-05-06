// src/lib/form-draft-utils.ts
// Utility functions for managing form drafts in sessionStorage
// Prevents data loss when users navigate away from forms with unsaved changes

/**
 * Save form draft to sessionStorage
 *
 * @param formName The form identifier (e.g., 'Profile', 'Renewals', 'ChangePassword')
 * @param userName The user's username to make the draft user-specific
 * @param data The form data to save
 */
export function saveDraft(formName: string, userName: string, data: any): void {
  if (typeof window === 'undefined') return; // Skip on server-side

  const key = `FormDraft-${formName}-${userName}`;

  try {
    sessionStorage.setItem(key, JSON.stringify({
      data,
      timestamp: Date.now(),
    }));
  } catch (error) {
    console.error(`[saveDraft] Failed to save draft for ${formName}:`, error);
  }
}

/**
 * Restore form draft from sessionStorage
 * Returns null if no draft exists or if draft is stale
 *
 * @param formName The form identifier (e.g., 'Profile', 'Renewals', 'ChangePassword')
 * @param userName The user's username
 * @param maxAge Optional max age in milliseconds (default: 7 days)
 * @returns The restored draft data or null if not found/stale
 */
export function restoreDraft<T = any>(
  formName: string,
  userName: string,
  maxAge: number = 7 * 24 * 60 * 60 * 1000 // 7 days default
): T | null {
  if (typeof window === 'undefined') return null; // Skip on server-side

  const key = `FormDraft-${formName}-${userName}`;

  try {
    const stored = sessionStorage.getItem(key);

    if (!stored) {
      return null;
    }

    const { data, timestamp } = JSON.parse(stored);

    // Check if draft is too old
    const age = Date.now() - timestamp;
    if (age > maxAge) {
      // Remove stale draft
      sessionStorage.removeItem(key);
      console.log(`[restoreDraft] Removed stale draft for ${formName} (${Math.round(age / 1000 / 60 / 60 / 24)} days old)`);
      return null;
    }

    return data as T;
  } catch (error) {
    console.error(`[restoreDraft] Failed to restore draft for ${formName}:`, error);
    return null;
  }
}

/**
 * Clear a specific form draft from sessionStorage
 *
 * @param formName The form identifier (e.g., 'Profile', 'Renewals', 'ChangePassword')
 * @param userName The user's username
 */
export function clearDraft(formName: string, userName: string): void {
  if (typeof window === 'undefined') return; // Skip on server-side

  const key = `FormDraft-${formName}-${userName}`;

  try {
    sessionStorage.removeItem(key);
  } catch (error) {
    console.error(`[clearDraft] Failed to clear draft for ${formName}:`, error);
  }
}

/**
 * Check if any unsaved form drafts exist in sessionStorage
 *
 * @returns true if any FormDraft keys exist, false otherwise
 */
export function checkForUnsavedChanges(): boolean {
  if (typeof window === 'undefined') return false; // Skip on server-side

  try {
    const drafts = Object.keys(sessionStorage).filter(key =>
      key.startsWith('FormDraft-')
    );

    return drafts.length > 0;
  } catch (error) {
    console.error('[checkForUnsavedChanges] Failed to check for drafts:', error);
    return false;
  }
}

/**
 * Clear all drafts whose key starts with `FormDraft-{formName}-`.
 * Use instead of clearDraft when the exact userName may be uncertain
 * (e.g. session timing issues) to ensure no orphaned draft key is left behind.
 */
export function clearDraftsByFormName(formName: string): void {
  if (typeof window === 'undefined') return;
  try {
    const prefix = `FormDraft-${formName}-`;
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(prefix))
      .forEach(k => sessionStorage.removeItem(k));
  } catch (error) {
    console.error(`[clearDraftsByFormName] Failed for ${formName}:`, error);
  }
}

/**
 * Dispatch a browser-level event so other components (e.g. Navbar) can
 * re-check for unsaved changes immediately after a programmatic draft clear.
 */
export function notifyDraftsChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('drafts-changed'));
  }
}

/**
 * Clear all form drafts from sessionStorage
 * Used when switching users or logging out
 */
export function clearAllDrafts(): void {
  if (typeof window === 'undefined') return; // Skip on server-side

  try {
    const keysToRemove = Object.keys(sessionStorage).filter(key =>
      key.startsWith('FormDraft-')
    );

    keysToRemove.forEach(key => {
      sessionStorage.removeItem(key);
    });

    if (keysToRemove.length > 0) {
      console.log(`[clearAllDrafts] Cleared ${keysToRemove.length} draft(s)`);
    }
  } catch (error) {
    console.error('[clearAllDrafts] Failed to clear drafts:', error);
  }
}

/**
 * Human-readable labels for each form draft key.
 * Used in unsaved-changes warnings to tell the user exactly where their drafts are.
 */
const DRAFT_DISPLAY_NAMES: Record<string, string> = {
  Profile:          'Your profile',
  Renewals:         'Renewals',
  FriendliesGame:   'Friendlies game',
  InternalGame:     'Internal game',
  CleaningRota:     'Cleaning rota',
  TeaRota:          'Tea rota',
  MemberSuggestion: 'Member suggestion',
  Club:             'Club details',
  NewClub:          'New club',
};

/**
 * Get list of all form names with unsaved drafts
 * Useful for showing user which forms have unsaved changes
 *
 * @returns Array of raw form names with drafts (e.g., ['Profile', 'Renewals'])
 */
export function getFormsWithDrafts(): string[] {
  if (typeof window === 'undefined') return []; // Skip on server-side

  try {
    const draftKeys = Object.keys(sessionStorage).filter(key =>
      key.startsWith('FormDraft-')
    );

    // Extract form names from keys like "FormDraft-Profile-john.smith"
    const formNames = draftKeys.map(key => {
      const parts = key.split('-');
      return parts[1]; // Form name is second part
    });

    // Remove duplicates
    return Array.from(new Set(formNames));
  } catch (error) {
    console.error('[getFormsWithDrafts] Failed to get forms with drafts:', error);
    return [];
  }
}

/**
 * Build a human-readable summary of which forms have unsaved drafts.
 * Used in logout / switch-user warning dialogs.
 *
 * @returns E.g. "Your profile, Friendlies game" or empty string if none
 */
export function getUnsavedChangesSummary(): string {
  const rawNames = getFormsWithDrafts();
  if (rawNames.length === 0) return '';

  const labels = rawNames.map(name => DRAFT_DISPLAY_NAMES[name] ?? name);
  return labels.join(', ');
}
