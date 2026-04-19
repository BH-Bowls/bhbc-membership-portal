// src/components/RouterBackLink.tsx
// A back-navigation link that mirrors the phone's back button.
// Uses router.back() when browser history exists (normal in-app navigation),
// falling back to a hardcoded href when the user opened the page directly.

'use client';

import { useRouter } from 'next/navigation';

interface Props {
  fallbackHref: string;
  label: string;
  className?: string;
}

export function RouterBackLink({
  fallbackHref,
  label,
  className = 'text-blue-600 hover:text-blue-800 mb-2 inline-block',
}: Props) {
  const router = useRouter();

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      e.preventDefault();
      router.back();
    }
    // else fall through to the href so direct-link users still navigate correctly
  }

  return (
    <a href={fallbackHref} onClick={handleClick} className={className}>
      ← {label}
    </a>
  );
}
