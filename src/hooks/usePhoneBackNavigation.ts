// src/hooks/usePhoneBackNavigation.ts
// Intercepts the phone's back button (popstate) in PWA mode and navigates
// to a fixed destination instead of letting the browser decide.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export function usePhoneBackNavigation(destination: string) {
  const router = useRouter();
  const destinationRef = useRef(destination);

  // Keep ref in sync without re-adding the listener
  useEffect(() => {
    destinationRef.current = destination;
  }, [destination]);

  useEffect(() => {
    // Push a duplicate entry so there's always one to intercept before the
    // app would exit / fall back to wherever the user came from
    window.history.pushState(null, document.title, window.location.href);

    const handle = () => router.push(destinationRef.current);
    window.addEventListener('popstate', handle);
    return () => window.removeEventListener('popstate', handle);
  }, [router]);
}
