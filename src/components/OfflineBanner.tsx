'use client';

import { useState } from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/**
 * Site-wide offline indicator — renders useOnlineStatus() (src/hooks/useOnlineStatus.ts),
 * which does the actual dual-signal detection (navigator.onLine + a fetch-failure
 * wrapper), shared with the bar till's own offline handling so there's only ever one
 * fetch wrapper installed.
 */
export function OfflineBanner() {
  const { offline, retry } = useOnlineStatus();
  const [checking, setChecking] = useState(false);

  if (!offline) return null;

  async function handleRetry() {
    setChecking(true);
    await retry();
    setChecking(false);
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-3 bg-amber-600 px-4 py-1.5 text-center text-sm font-medium text-white shadow">
      <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
      </svg>
      You appear to be offline — some things won’t load until you reconnect.
      <button
        onClick={handleRetry}
        disabled={checking}
        className="underline decoration-white/60 hover:decoration-white disabled:opacity-60"
      >
        {checking ? 'Checking…' : 'Retry'}
      </button>
    </div>
  );
}
