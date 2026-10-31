// src/components/HonoursPrintSpec.tsx
// A pop-up showing the honours boards' print spec as plain text, with buttons to copy it to
// the clipboard (for pasting into an email) and to close it. Used on the Print Honours Boards page.

'use client';

import { useEffect, useState } from 'react';
import { getButtonClasses } from '@/config/theme-helpers';

interface Props {
  text: string;
  onClose: () => void;
}

export function HonoursPrintSpec({ text, onClose }: Props) {
  // 'copied' briefly after a copy; 'failed' if the browser wouldn't allow it
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  // Runs while open: Escape closes the pop-up
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Copies the spec to the clipboard and says so on the button for a moment. */
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      // Clipboard access can be refused (e.g. an older browser): the text can still be selected by hand
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* Clicks inside the box don't close it */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="honours-print-spec-title"
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5">
          <h2 id="honours-print-spec-title" className="font-semibold text-gray-900">Print spec</h2>
          <p className="text-sm text-gray-700">The rows and style as set for this print, ready to paste into an email.</p>
        </div>
        <pre className="mx-5 my-3 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900 font-sans">
          {text}
        </pre>
        <div className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5">
          {copyState === 'failed' && (
            <span className="text-sm text-red-700 mr-auto">Couldn&apos;t copy — select the text and copy it instead.</span>
          )}
          <button onClick={copy} className={getButtonClasses('primary', 'md')}>
            {copyState === 'copied' ? 'Copied' : 'Copy to clipboard'}
          </button>
          <button onClick={onClose} className={getButtonClasses('secondary', 'md')}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
