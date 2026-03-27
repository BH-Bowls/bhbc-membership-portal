// src/hooks/useImpersonation.ts
// React hook for managing user impersonation state and actions

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

/**
 * Hook for managing impersonation functionality
 * Provides methods to start/stop impersonating users
 * Returns current impersonation state from session
 */
export function useImpersonation() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Start impersonating a target user or club.
   * @param id Username (user) or club_id (club)
   * @param type 'user' (default) or 'club'
   */
  const startImpersonation = async (id: string, type: 'user' | 'club' = 'user') => {
    setIsLoading(true);
    setError(null);

    const body = type === 'club'
      ? { targetClubId: id, targetType: 'club' }
      : { targetUserName: id };

    try {
      const response = await fetch('/api/admin/impersonate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start impersonation');
      }

      // CRITICAL: Trigger NextAuth session update
      // This calls the JWT callback with trigger='update' and session=data
      await update(data);

      // Force page reload to reflect new session
      router.refresh();
      window.location.reload();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsLoading(false);
    }
  };

  /**
   * Stop impersonating and return to original admin user
   */
  const stopImpersonation = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/impersonate/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'stored-in-jwt' }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to stop impersonation');
      }

      // Trigger NextAuth session update to clear impersonation
      await update(data);

      // Force page reload to reflect restored session
      router.refresh();
      window.location.reload();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsLoading(false);
    }
  };

  return {
    // Current impersonation state from session
    isImpersonating: session?.user?.isImpersonating || false,
    originalAdmin: session?.user?.originalAdmin,

    // Actions
    startImpersonation,
    stopImpersonation,

    // UI state
    isLoading,
    error,
  };
}
