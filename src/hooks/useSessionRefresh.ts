// src/hooks/useSessionRefresh.ts
// Hook to refresh session data from the database
// Useful when user data (like role) may have changed since login

import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';

/**
 * Hook that refreshes session data from the database on mount
 * Only refreshes once per page load to avoid excessive API calls
 * Updates session if role, name, or email has changed
 */
export function useSessionRefresh() {
  const { data: session, update } = useSession();
  const hasRefreshed = useRef(false);

  useEffect(() => {
    // Only run once per mount and only if session exists
    if (hasRefreshed.current || !session?.user?.userName) {
      return;
    }

    // Don't refresh while impersonating (would overwrite impersonated user data)
    if (session.user.isImpersonating) {
      return;
    }

    hasRefreshed.current = true;

    const refreshSession = async () => {
      try {
        const response = await fetch('/api/auth/refresh-session', {
          method: 'POST',
        });

        if (!response.ok) {
          console.warn('Failed to refresh session');
          return;
        }

        const data = await response.json();

        // Only update if there are actual changes
        if (data.hasChanges && data.userData) {
          console.log('Session data changed, updating...');
          await update({
            action: 'REFRESH_USER_DATA',
            userData: data.userData,
          });
        }
      } catch (error) {
        console.error('Error refreshing session:', error);
      }
    };

    refreshSession();
  }, [session, update]);
}
