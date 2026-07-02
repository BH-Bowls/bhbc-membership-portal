// src/components/ContactLink.tsx
// Hyperlinked phone/email with a small copy-to-clipboard icon beside it.
// Use EmailLink / PhoneLink throughout the app wherever a contact is displayed.

'use client';

import { useState } from 'react';

interface ContactLinkProps {
  type: 'tel' | 'mailto';
  value: string;
  className?: string;            // extra classes for the link (e.g. truncate, break-all)
  children?: React.ReactNode;    // custom link label (defaults to the value)
  copy?: boolean;                // show the copy-to-clipboard icon (default true)
  stopPropagation?: boolean;     // stop click bubbling — for use inside clickable cards/rows
}

export function ContactLink({
  type,
  value,
  className = '',
  children,
  copy = true,
  stopPropagation = false,
}: ContactLinkProps) {
  // Track brief "copied" feedback after a successful copy
  const [copied, setCopied] = useState(false);

  // Nothing to render without a value
  if (!value) return null;

  // tel: strips spaces so the dialler gets a clean number; mailto: uses the raw address
  const href = type === 'tel'
    ? `tel:${value.replace(/\s/g, '')}`
    : `mailto:${value}`;

  // Copy the raw value to the clipboard, showing a tick for ~1.5s
  async function handleCopy(e: React.MouseEvent) {
    // The copy control must never trigger a surrounding clickable card/row
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context) — silently ignore
    }
  }

  // When inside a clickable card, stop the link click from bubbling to the card
  function handleLinkClick(e: React.MouseEvent) {
    if (stopPropagation) {
      e.stopPropagation();
    }
  }

  const label = type === 'tel' ? 'phone number' : 'email address';

  return (
    <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
      <a
        href={href}
        onClick={handleLinkClick}
        className={`text-blue-600 hover:text-blue-800 hover:underline transition-colors ${className}`}
      >
        {children || value}
      </a>
      {copy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : `Copy ${label}`}
          title={copied ? 'Copied!' : 'Copy to clipboard'}
          className="shrink-0 text-gray-500 hover:text-gray-700 focus:outline-none"
        >
          {copied ? (
            // Tick — shown briefly after copying
            <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            // Clipboard icon
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-1m-6-3h6a2 2 0 002-2V5a2 2 0 00-2-2h-6a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      )}
    </span>
  );
}

// Convenience wrappers — preferred at call sites for readability
export function PhoneLink({
  phone,
  className = '',
  copy = true,
  stopPropagation = false,
}: { phone: string; className?: string; copy?: boolean; stopPropagation?: boolean }) {
  return <ContactLink type="tel" value={phone} className={className} copy={copy} stopPropagation={stopPropagation} />;
}

export function EmailLink({
  email,
  className = '',
  copy = true,
  stopPropagation = false,
}: { email: string; className?: string; copy?: boolean; stopPropagation?: boolean }) {
  return <ContactLink type="mailto" value={email} className={className} copy={copy} stopPropagation={stopPropagation} />;
}
