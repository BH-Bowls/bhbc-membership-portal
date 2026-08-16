// app/admin/logs/page.tsx
// Admin-only viewer for the three audit-log tables (login_attempts,
// password_reset_requests, impersonation_log) — previously only viewable by opening
// the Members spreadsheet directly. Each section shows the most recent rows (capped
// server-side) and has a "Clear log" button for an end-of-season reset.

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { getButtonClasses, getBadgeClasses, getAlertClasses } from '@/config/theme-helpers';

interface LoginAttemptRow {
  id: string;
  identifier: string;
  userName: string | null;
  success: boolean;
  failureReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  deviceType: string | null;
  attemptedAt: string;
}

interface PasswordResetRow {
  id: string;
  identifier: string;
  userName: string | null;
  requestedAt: string;
}

interface ImpersonationRow {
  id: string;
  sessionId: string;
  action: string;
  adminUserName: string | null;
  adminName: string | null;
  targetUserName: string | null;
  targetName: string | null;
  ipAddress: string | null;
  loggedAt: string;
}

interface MemberEmailRow {
  id: string;
  userName: string | null;
  fullName: string | null;
  emailAddress: string | null;
  templateName: string;
  subject: string;
  success: boolean;
  errorMessage: string | null;
  sentBy: string;
  attachments: string[];
  sentAt: string;
}

interface LogsResponse {
  loginAttempts: { rows: LoginAttemptRow[]; total: number };
  passwordResetRequests: { rows: PasswordResetRow[]; total: number };
  impersonationLog: { rows: ImpersonationRow[]; total: number };
  memberEmails: { rows: MemberEmailRow[]; total: number };
}

type LogType = 'login_attempts' | 'password_reset_requests' | 'impersonation_log' | 'member_emails';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function LogSection({
  title,
  subtitle,
  total,
  shown,
  onClear,
  clearing,
  children,
}: {
  title: string;
  subtitle: string;
  total: number;
  shown: number;
  onClear: () => void;
  clearing: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <div className="flex items-center gap-2">
          <span className={getBadgeClasses(total > 0 ? 'secondary' : 'success', 'sm')}>
            {total} row{total === 1 ? '' : 's'}
          </span>
          <button
            onClick={onClear}
            disabled={clearing || total === 0}
            className={getButtonClasses('danger', 'sm')}
          >
            {clearing ? 'Clearing…' : 'Clear log'}
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-700 mb-3">{subtitle}</p>

      {total === 0 ? (
        <p className="text-sm text-gray-400 italic py-4 text-center">No rows.</p>
      ) : (
        <>
          {total > shown && (
            <p className="text-xs text-gray-500 mb-2">Showing the most recent {shown} of {total} rows.</p>
          )}
          <div className="overflow-x-auto">{children}</div>
        </>
      )}
    </div>
  );
}

const LOG_TYPE_LABELS: Record<LogType, string> = {
  login_attempts: 'Login Attempts',
  password_reset_requests: 'Password Reset Requests',
  impersonation_log: 'Impersonation Log',
  member_emails: 'Member Emails',
};
const LOG_TYPES: LogType[] = ['login_attempts', 'password_reset_requests', 'impersonation_log', 'member_emails'];

export default function AdminLogsPage() {
  const { data: session } = useSession();

  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState<LogType | null>(null);
  const [confirmType, setConfirmType] = useState<LogType | null>(null);
  const [selectedType, setSelectedType] = useState<LogType>('login_attempts');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/logs');
      if (res.status === 403) { setError('You do not have access to this page.'); return; }
      if (!res.ok) throw new Error('Failed to load logs');
      setData(await res.json());
    } catch (err) {
      console.error('[AdminLogsPage] load error:', err);
      setError('Failed to load logs. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function clearLog(type: LogType) {
    setConfirmType(null);
    setClearing(type);
    try {
      const res = await fetch(`/api/admin/logs?type=${type}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to clear log');
      }
      await load();
    } catch (err: any) {
      alert(err.message || 'Failed to clear log');
    } finally {
      setClearing(null);
    }
  }

  const displayName = session && session.user && session.user.name ? session.user.name : undefined;
  const role = session && session.user ? session.user.role : '';

  const confirmLabels: Record<LogType, string> = {
    login_attempts: 'login attempts',
    password_reset_requests: 'password reset requests',
    impersonation_log: 'impersonation log',
    member_emails: 'member email log',
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-4">
          <RouterBackLink fallbackHref="/" label="Home" />
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Logs</h1>
            <button onClick={load} disabled={loading} className={getButtonClasses('secondary', 'sm')}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <p className="text-sm text-gray-700 mt-1">
            Login attempts, password reset requests, and impersonation events — previously only
            viewable by opening the spreadsheet directly. Clearing a log is permanent.
          </p>
        </div>

        {error && <div className={getAlertClasses('danger') + ' mb-4'}>{error}</div>}

        {data && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">Log</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as LogType)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
            >
              {LOG_TYPES.map((t) => <option key={t} value={t}>{LOG_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
        )}

        {loading && !data && (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-700">Loading…</p>
          </div>
        )}

        {data && (
          <>
            {selectedType === 'login_attempts' && (
            <LogSection
              title="Login Attempts"
              subtitle="Every login attempt, successful or not."
              total={data.loginAttempts.total}
              shown={data.loginAttempts.rows.length}
              onClear={() => setConfirmType('login_attempts')}
              clearing={clearing === 'login_attempts'}
            >
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-3 py-1.5 font-medium text-gray-700">When</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Identifier</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Username</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Result</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">IP</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Device</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.loginAttempts.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-gray-900 whitespace-nowrap">{fmtTime(r.attemptedAt)}</td>
                      <td className="px-3 py-1.5 text-gray-900">{r.identifier}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.userName ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className={getBadgeClasses(r.success ? 'success' : 'danger', 'sm')}>
                          {r.success ? 'Success' : r.failureReason || 'Failed'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-700">{r.ipAddress ?? '—'}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.deviceType ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </LogSection>
            )}

            {selectedType === 'password_reset_requests' && (
            <LogSection
              title="Password Reset Requests"
              subtitle="Rate-limits forgotten-password requests to 3/hour per identifier."
              total={data.passwordResetRequests.total}
              shown={data.passwordResetRequests.rows.length}
              onClear={() => setConfirmType('password_reset_requests')}
              clearing={clearing === 'password_reset_requests'}
            >
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-3 py-1.5 font-medium text-gray-700">When</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Identifier</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Username</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.passwordResetRequests.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-gray-900 whitespace-nowrap">{fmtTime(r.requestedAt)}</td>
                      <td className="px-3 py-1.5 text-gray-900">{r.identifier}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.userName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </LogSection>
            )}

            {selectedType === 'impersonation_log' && (
            <LogSection
              title="Impersonation Log"
              subtitle="Every Switch User start/stop event."
              total={data.impersonationLog.total}
              shown={data.impersonationLog.rows.length}
              onClear={() => setConfirmType('impersonation_log')}
              clearing={clearing === 'impersonation_log'}
            >
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-3 py-1.5 font-medium text-gray-700">When</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Action</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Admin</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Target</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.impersonationLog.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-gray-900 whitespace-nowrap">{fmtTime(r.loggedAt)}</td>
                      <td className="px-3 py-1.5">
                        <span className={getBadgeClasses(r.action === 'START' ? 'success' : 'secondary', 'sm')}>
                          {r.action}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-900">{r.adminName || r.adminUserName || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.targetName || r.targetUserName || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </LogSection>
            )}

            {selectedType === 'member_emails' && (
            <LogSection
              title="Member Emails"
              subtitle="Every email the app has sent — Friendlies notices, renewals, admin bulk sends, password resets, and more."
              total={data.memberEmails.total}
              shown={data.memberEmails.rows.length}
              onClear={() => setConfirmType('member_emails')}
              clearing={clearing === 'member_emails'}
            >
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-3 py-1.5 font-medium text-gray-700">When</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">To</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Subject</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Template</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Sent By</th>
                    <th className="px-3 py-1.5 font-medium text-gray-700">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.memberEmails.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-gray-900 whitespace-nowrap">{fmtTime(r.sentAt)}</td>
                      <td className="px-3 py-1.5 text-gray-900">
                        {r.fullName ? (
                          <>
                            <div>{r.fullName}</div>
                            <div className="text-xs text-gray-500">{r.userName} · {r.emailAddress}</div>
                          </>
                        ) : (
                          r.emailAddress || '—'
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-gray-700">{r.subject}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.templateName}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.sentBy}</td>
                      <td className="px-3 py-1.5">
                        <span className={getBadgeClasses(r.success ? 'success' : 'danger', 'sm')}>
                          {r.success ? 'Sent' : r.errorMessage || 'Failed'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </LogSection>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmType !== null}
        title="Clear log?"
        message={confirmType ? `This permanently deletes all ${confirmLabels[confirmType]}. This cannot be undone.` : ''}
        confirmLabel="Clear log"
        confirmVariant="danger"
        onConfirm={() => confirmType && clearLog(confirmType)}
        onCancel={() => setConfirmType(null)}
      />
    </div>
  );
}
