'use client';

import { useEffect } from 'react';

/**
 * Recovers automatically from the classic SPA-after-deploy failure: a tab left open
 * across a deploy holds JS chunk references from the old build, and the next
 * client-side navigation tries to fetch a chunk file that no longer exists on the new
 * deployment (404). Webpack surfaces this as a ChunkLoadError (or a rejected dynamic
 * import with "Loading chunk N failed" in the message). Rather than leaving the user
 * on a broken partial render, force a full reload — the fresh page load picks up the
 * current build's chunk manifest and just works.
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    const isChunkLoadError = (name: string | undefined, message: string | undefined) => {
      const text = `${name || ''} ${message || ''}`;
      return /ChunkLoadError|Loading chunk [\d]+ failed|Loading CSS chunk/i.test(text);
    };

    const handleError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error?.name, event.error?.message || event.message)) {
        window.location.reload();
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason?.name, event.reason?.message)) {
        window.location.reload();
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null;
}
