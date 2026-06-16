'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import DocumentsAccordion from './DocumentsAccordion';
import type { DocumentFolder } from '@/lib/drive';

export default function DocumentsPage() {
  const { data: session } = useSession();
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/documents')
      .then((res) => res.json())
      .then((data) => {
        if (data.folders) setFolders(data.folders);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Club Documents</h1>
          <p className="text-gray-600 mt-1">Policies, procedures, AGM minutes and club documents</p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading documents...</p>
          </div>
        ) : error ? (
          <div className="rounded-xl bg-gray-50 p-8 text-center">
            <p className="text-base text-gray-700">
              Documents are not available at the moment. Please try again later.
            </p>
          </div>
        ) : (
          <DocumentsAccordion folders={folders} />
        )}
      </div>
    </div>
  );
}
