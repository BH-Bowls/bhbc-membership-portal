// src/components/VersionDisplay.tsx
// Displays application version information

'use client';

import { getVersionString, getFullVersionString } from '@/config/version';

interface VersionDisplayProps {
  showBuildDate?: boolean;
  className?: string;
}

export function VersionDisplay({ showBuildDate = false, className = '' }: VersionDisplayProps) {
  const versionText = showBuildDate ? getFullVersionString() : getVersionString();

  return (
    <span className={`text-xs text-gray-500 ${className}`} title={getFullVersionString()}>
      {versionText}
    </span>
  );
}
