'use client';

// app/help/bar/page.tsx
// The bar till help, all on one page, for the committee and whoever trains bar staff.
// The same text the till shows from its Help button (src/components/BarHelp.tsx).

import { LastUpdated, BackLink } from '../_components';
import { BarHelpPage } from '@/components/BarHelp';

export default function HelpBarPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Bar till</h1>
          <p className="text-gray-500 text-sm mt-1">
            For bar staff. The till shows the same help from its Help button, and from the ? in its dialogs.
          </p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">
          <BarHelpPage />
        </div>
      </div>
    </div>
  );
}
