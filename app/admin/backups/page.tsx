// app/admin/backups/page.tsx
// Admin-only page ("Backups") that checks the nightly database backups are arriving in
// Google Drive and explains how the backup system works. Read-only: the checks look at
// file names, dates and sizes, and nothing here can change or restore a backup.

'use client';

import React, { useEffect, useState } from 'react';
import { RouterBackLink } from '@/components/RouterBackLink';
import { getButtonClasses, getBadgeClasses, getAlertClasses } from '@/config/theme-helpers';
import type { BackupFile, BackupHealth, BackupStatus } from '@/lib/backup-status';

// Show dates in UK time, whatever device the page is opened on
function formatDateTime(isoTime: string): string {
  return new Date(isoTime).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(sizeBytes: number): string {
  const sizeKb = sizeBytes / 1024;
  if (sizeKb < 1024) {
    return `${Math.round(sizeKb)} KB`;
  }
  return `${(sizeKb / 1024).toFixed(1)} MB`;
}

function getHealthBadge(health: BackupHealth): 'success' | 'warning' | 'danger' {
  if (health === 'ok') return 'success';
  if (health === 'warning') return 'warning';
  return 'danger';
}

function getHealthLabel(health: BackupHealth): string {
  if (health === 'ok') return 'OK';
  if (health === 'warning') return 'Check';
  return 'Problem';
}

function getSummaryMessage(health: BackupHealth): string {
  if (health === 'ok') return 'Backups look healthy.';
  if (health === 'warning') return 'Something needs checking. Backups may have missed a run.';
  return 'Backups need attention now. Check the Actions tab on GitHub.';
}

function getSummaryAlert(health: BackupHealth): 'success' | 'warning' | 'danger' {
  if (health === 'ok') return 'success';
  if (health === 'warning') return 'warning';
  return 'danger';
}

// Fixed explanation of the backup system. Kept short: the full detail is in
// specs/BHBC_Database_Backup_Technical_Runbook.md.
function HowBackupsWork() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <h2 className="text-base font-semibold text-gray-900 mb-2">How backups work</h2>
      <div className="text-sm text-gray-900 space-y-3">
        <p>
          The club&apos;s Supabase plan keeps no backups of its own, so this is the only copy of
          the database outside Supabase.
        </p>
        <div>
          <h3 className="font-semibold">Each night</h3>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            <li>
              A GitHub Actions workflow (<code className="bg-gray-100 px-1 rounded">db-backup.yml</code>)
              makes a compressed copy of the production database. It&apos;s scheduled for 02:30 UTC,
              but GitHub often starts it several hours late, which is harmless.
            </li>
            <li>
              It tests the copy is complete, then uploads it to the{' '}
              <span className="font-medium">BHBC Database Backups</span> folder in the{' '}
              <span className="font-medium">burgesshillbc@gmail.com</span> Google Drive.
            </li>
            <li>Backups older than 90 days are deleted.</li>
            <li>If any step fails, GitHub emails the alert list.</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">What this page checks</h3>
          <p className="mt-1">
            It looks at the files in Drive: how recent the newest one is, its size, whether any
            recent day was missed, and whether old files are being cleared. This also proves the
            portal&apos;s Google connection is working. It doesn&apos;t open the files, so it can&apos;t
            prove a backup restores. Only a restore drill does that.
          </p>
        </div>
        <div>
          <h3 className="font-semibold">Restoring</h3>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            <li>
              Restores are run by a developer from their own PC, not from this page. Try a backup
              safely on the dev database with{' '}
              <code className="bg-gray-100 px-1 rounded">npm run db-drill-dev</code>.
            </li>
            <li>
              A production restore uses{' '}
              <code className="bg-gray-100 px-1 rounded">npm run db-restore-production-full</code>,
              which takes a safety backup first.
            </li>
            <li>
              After a production restore, redeploy the app in Vercel. Until then it can keep showing
              old data from its caches.
            </li>
          </ul>
        </div>
        <p>
          Full instructions are in{' '}
          <code className="bg-gray-100 px-1 rounded">specs/BHBC_Database_Backup_Technical_Runbook.md</code>.
        </p>
      </div>
    </div>
  );
}

function BackupTable({ backups }: { backups: BackupFile[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <h2 className="text-base font-semibold text-gray-900 mb-2">Recent backups</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-900 border-b border-gray-200">
              <th className="py-2 pr-4 font-semibold">Made</th>
              <th className="py-2 pr-4 font-semibold">File</th>
              <th className="py-2 font-semibold text-right">Size</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((backup) => (
              <tr key={backup.name} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-900 whitespace-nowrap">{formatDateTime(backup.createdTime)}</td>
                <td className="py-2 pr-4 text-gray-700">{backup.name}</td>
                <td className="py-2 text-gray-900 text-right whitespace-nowrap">{formatSize(backup.sizeBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BackupsPage() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/backups');
      if (res.status === 403) {
        setError('You do not have access to this page.');
        return;
      }
      if (!res.ok) {
        // Clear any earlier result so an old "healthy" message can't stay on screen
        setStatus(null);
        setError(
          'Could not read the backups from Google Drive, so their health is unknown. The Google ' +
          'refresh token may have lapsed, which would also stop backups and attachment uploads.'
        );
        return;
      }
      const data = await res.json();
      setStatus(data.data);
    } catch (err) {
      console.error('[BackupsPage] load error:', err);
      setStatus(null);
      setError('Failed to check the backups. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-4">
          <RouterBackLink fallbackHref="/" label="Home" />
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Backups</h1>
            <button onClick={load} disabled={loading} className={getButtonClasses('secondary', 'sm')}>
              {loading ? 'Checking…' : 'Check again'}
            </button>
          </div>
          <p className="text-sm text-gray-700 mt-1">
            Checks the nightly database backups in Google Drive. Nothing on this page changes them.
          </p>
        </div>

        {error && <div className={getAlertClasses('danger') + ' mb-4'}>{error}</div>}

        {loading && !status && (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-700">Checking…</p>
          </div>
        )}

        {status && (
          <>
            <div className={getAlertClasses(getSummaryAlert(status.health)) + ' mb-4'}>
              <p className="text-sm font-medium">{getSummaryMessage(status.health)}</p>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
              <h2 className="text-base font-semibold text-gray-900 mb-2">Checks</h2>
              <ul className="divide-y divide-gray-100">
                {status.checks.map((check) => (
                  <li key={check.label} className="py-2 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{check.label}</p>
                      <p className="text-sm text-gray-700">{check.detail}</p>
                    </div>
                    <span className={getBadgeClasses(getHealthBadge(check.health), 'sm')}>
                      {getHealthLabel(check.health)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-gray-700 mt-3">
                {status.totalCount} backups held, {formatSize(status.totalBytes)} in total.
                {status.oldestTime !== null && ` Oldest from ${formatDateTime(status.oldestTime)}.`}
              </p>
            </div>

            {status.recentBackups.length > 0 && <BackupTable backups={status.recentBackups} />}
          </>
        )}

        <HowBackupsWork />
      </div>
    </div>
  );
}
