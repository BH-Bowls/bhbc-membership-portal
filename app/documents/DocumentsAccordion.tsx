'use client';

import { useState } from 'react';
import type { DocumentFolder, DocumentFile } from '@/lib/drive';

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

/** Total PDF count for a folder, including everything in its subfolders. */
function countFiles(folder: DocumentFolder): number {
  return folder.files.length + folder.subfolders.reduce((n, sub) => n + countFiles(sub), 0);
}

interface FileRowProps {
  file: DocumentFile;
  isOpen: boolean;
  onToggle: (link: string) => void;
}

function FileRow({ file, isOpen, onToggle }: FileRowProps) {
  return (
    <li>
      <div className="flex items-center justify-between gap-4 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex-shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            PDF
          </span>
          <span className="truncate text-base text-gray-900">{file.name}</span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            onClick={() => onToggle(file.webViewLink)}
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
}

interface FolderNodeProps {
  folder: DocumentFolder;
  path: string;
  depth: number;
  expanded: Record<string, boolean>;
  openFile: string | null;
  onToggleFolder: (path: string) => void;
  onToggleFile: (link: string) => void;
}

function FolderNode({ folder, path, depth, expanded, openFile, onToggleFolder, onToggleFile }: FolderNodeProps) {
  const isExpanded = !!expanded[path];
  const total = countFiles(folder);
  const isEmpty = folder.files.length === 0 && folder.subfolders.length === 0;

  return (
    <div className={`overflow-hidden rounded-xl border bg-white ${depth === 0 ? 'border-gray-100 shadow-md' : 'border-gray-200'}`}>
      <button
        onClick={() => onToggleFolder(path)}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-green-50"
        aria-expanded={isExpanded}
      >
        <span className={`flex items-center gap-2 font-bold text-gray-900 ${depth === 0 ? 'text-lg' : 'text-base'}`}>
          <svg className="h-5 w-5 flex-shrink-0 text-green-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          {folder.name}
        </span>
        <span className="flex flex-shrink-0 items-center gap-2 text-sm text-gray-700">
          {total} {total === 1 ? 'document' : 'documents'}
          <svg
            className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100">
          {isEmpty && (
            <p className="px-6 py-4 text-sm text-gray-700">This folder is empty.</p>
          )}

          {/* Subfolders first, indented and themselves expandable */}
          {folder.subfolders.length > 0 && (
            <div className="space-y-3 bg-gray-50 px-3 py-3 sm:px-4">
              {folder.subfolders.map((sub) => (
                <FolderNode
                  key={`${path}/${sub.name}`}
                  folder={sub}
                  path={`${path}/${sub.name}`}
                  depth={depth + 1}
                  expanded={expanded}
                  openFile={openFile}
                  onToggleFolder={onToggleFolder}
                  onToggleFile={onToggleFile}
                />
              ))}
            </div>
          )}

          {/* Files directly in this folder */}
          {folder.files.length > 0 && (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {folder.files.map((file) => (
                <FileRow
                  key={file.webViewLink}
                  file={file}
                  isOpen={openFile === file.webViewLink}
                  onToggle={onToggleFile}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function DocumentsAccordion({ folders }: DocumentsAccordionProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openFile, setOpenFile] = useState<string | null>(null);

  function toggleFolder(path: string) {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
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
        <FolderNode
          key={folder.name}
          folder={folder}
          path={folder.name}
          depth={0}
          expanded={expanded}
          openFile={openFile}
          onToggleFolder={toggleFolder}
          onToggleFile={toggleFile}
        />
      ))}
    </div>
  );
}
