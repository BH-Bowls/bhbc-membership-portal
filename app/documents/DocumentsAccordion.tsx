'use client';

import { useState } from 'react';
import type { DocumentFolder } from '@/lib/drive';

interface DocumentsAccordionProps {
  folders: DocumentFolder[];
}

function toPreviewUrl(webViewLink: string): string {
  return webViewLink.split('?')[0].replace('/view', '/preview');
}

function toDownloadUrl(webViewLink: string): string {
  const match = webViewLink.match(/\/file\/d\/([^/?]+)/);
  if (!match) return webViewLink;
  return `https://drive.google.com/uc?export=download&id=${match[1]}`;
}

export default function DocumentsAccordion({ folders }: DocumentsAccordionProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openFile, setOpenFile] = useState<string | null>(null);

  function toggleFolder(name: string) {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  function toggleFile(webViewLink: string) {
    setOpenFile((prev) => (prev === webViewLink ? null : webViewLink));
  }

  if (folders.length === 0) {
    return (
      <div className="rounded-xl bg-gray-50 p-6 text-center">
        <p className="text-base text-gray-700">No documents are currently available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {folders.map((folder) => (
        <div key={folder.name} className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-md">
          <button
            onClick={() => toggleFolder(folder.name)}
            className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-green-50"
            aria-expanded={expanded[folder.name]}
          >
            <span className="font-bold text-gray-900 text-lg">{folder.name}</span>
            <span className="flex items-center gap-2 text-sm text-gray-700">
              {folder.files.length} {folder.files.length === 1 ? 'document' : 'documents'}
              <svg
                className={`h-4 w-4 transition-transform duration-200 ${expanded[folder.name] ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </button>

          {expanded[folder.name] && (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {folder.files.length === 0 && (
                <li className="px-6 py-4 text-sm text-gray-700">No documents in this folder.</li>
              )}
              {folder.files.map((file) => {
                const isOpen = openFile === file.webViewLink;
                return (
                  <li key={file.webViewLink}>
                    <div className="flex items-center justify-between gap-4 px-6 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex-shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                          PDF
                        </span>
                        <span className="truncate text-base text-gray-900">{file.name}</span>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <button
                          onClick={() => toggleFile(file.webViewLink)}
                          className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                            isOpen
                              ? 'border-gray-400 text-gray-700 hover:bg-gray-50'
                              : 'border-green-600 text-green-700 hover:bg-green-50'
                          }`}
                        >
                          {isOpen ? 'Close' : 'View'}
                        </button>
                        <a
                          href={toDownloadUrl(file.webViewLink)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                        >
                          Download
                        </a>
                        <a
                          href={file.webViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          Print
                        </a>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="border-t border-gray-100 px-6 pb-6 pt-4">
                        <iframe
                          src={toPreviewUrl(file.webViewLink)}
                          title={file.name}
                          className="w-full rounded-lg border border-gray-200 shadow-sm"
                          height={700}
                          allow="autoplay"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
