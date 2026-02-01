// src/hooks/useEditMode.ts
// Shared hook for edit mode pattern with sessionStorage draft support
// Used by game management pages (Friendlies, Internal Games) for consistent edit/save/cancel behavior

import { useState, useEffect, useCallback } from 'react';

interface UseEditModeOptions<T> {
  /** Unique key for sessionStorage (e.g., 'FriendliesGame-13Jan25') */
  draftKey: string;
  /** Initial data to compare against for changes */
  initialData: T;
  /** Called when save is triggered */
  onSave: (data: T) => Promise<boolean>;
  /** Optional: Called after successful save */
  onSaveSuccess?: () => void;
}

interface UseEditModeReturn<T> {
  /** Whether in edit mode */
  isEditing: boolean;
  /** Current edited data */
  editedData: T;
  /** Whether data has been modified from initial */
  hasChanges: boolean;
  /** Whether save is in progress */
  isSaving: boolean;
  /** Enter edit mode */
  startEditing: () => void;
  /** Update the edited data */
  updateData: (data: T | ((prev: T) => T)) => void;
  /** Save changes and exit edit mode */
  handleSave: () => Promise<void>;
  /** Cancel changes and exit edit mode */
  handleCancel: () => void;
  /** Navbar action buttons configuration */
  getNavbarActions: () => {
    primary?: { label: string; onClick: () => void; loading?: boolean };
    secondary?: { label: string; onClick: () => void; variant: 'secondary' };
  } | undefined;
}

/**
 * Hook for managing edit mode with draft support
 * Provides consistent edit/save/cancel behavior across game management pages
 */
export function useEditMode<T>({
  draftKey,
  initialData,
  onSave,
  onSaveSuccess,
}: UseEditModeOptions<T>): UseEditModeReturn<T> {
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<T>(initialData);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const storageKey = `FormDraft-${draftKey}`;

  // Check for existing draft on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      try {
        const { data, timestamp } = JSON.parse(stored);
        // Check if draft is stale (> 7 days)
        const isStale = Date.now() - timestamp > 7 * 24 * 60 * 60 * 1000;
        if (!isStale && data) {
          setEditedData(data);
          setIsEditing(true);
          setHasChanges(true);
        } else {
          sessionStorage.removeItem(storageKey);
        }
      } catch {
        sessionStorage.removeItem(storageKey);
      }
    }
  }, [storageKey]);

  // Update editedData when initialData changes (but only if not editing)
  useEffect(() => {
    if (!isEditing) {
      setEditedData(initialData);
    }
  }, [initialData, isEditing]);

  // Auto-save draft when editing
  useEffect(() => {
    if (isEditing && hasChanges && typeof window !== 'undefined') {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          data: editedData,
          timestamp: Date.now(),
        })
      );
    }
  }, [isEditing, hasChanges, editedData, storageKey]);

  const startEditing = useCallback(() => {
    setIsEditing(true);
    setEditedData(initialData);
    setHasChanges(false);
  }, [initialData]);

  const updateData = useCallback((dataOrUpdater: T | ((prev: T) => T)) => {
    setEditedData((prev) => {
      const newData = typeof dataOrUpdater === 'function'
        ? (dataOrUpdater as (prev: T) => T)(prev)
        : dataOrUpdater;
      return newData;
    });
    setHasChanges(true);
  }, []);

  const clearDraft = useCallback(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const success = await onSave(editedData);
      if (success) {
        clearDraft();
        setIsEditing(false);
        setHasChanges(false);
        onSaveSuccess?.();
      }
    } finally {
      setIsSaving(false);
    }
  }, [editedData, onSave, onSaveSuccess, clearDraft]);

  const handleCancel = useCallback(() => {
    clearDraft();
    setIsEditing(false);
    setEditedData(initialData);
    setHasChanges(false);
  }, [initialData, clearDraft]);

  const getNavbarActions = useCallback(() => {
    if (!isEditing) {
      return {
        primary: {
          label: 'Edit',
          onClick: startEditing,
        },
      };
    }

    return {
      primary: {
        label: 'Save',
        onClick: handleSave,
        loading: isSaving,
      },
      secondary: {
        label: 'Cancel',
        onClick: handleCancel,
        variant: 'secondary' as const,
      },
    };
  }, [isEditing, isSaving, startEditing, handleSave, handleCancel]);

  return {
    isEditing,
    editedData,
    hasChanges,
    isSaving,
    startEditing,
    updateData,
    handleSave,
    handleCancel,
    getNavbarActions,
  };
}
