// app/admin/members/applications/page.tsx
// Applications workflow — lists membership applications grouped by status and
// provides the per-status admin actions (set listed date, approve, reject, mark
// paid, convert to member). Admin only (enforced in middleware.ts).

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { getButtonClasses, getBadgeClasses, getInputClasses, getCardClasses } from '@/config/theme-helpers';
import { parseUKDate } from '@/lib/date-utils';
import type { Application } from '@/lib/applications-sheets';

// Number of days the objection period runs after a name is listed.
const OBJECTION_PERIOD_DAYS = 14;

// Build today's date as a YYYY-MM-DD string for <input type="date"> defaults.
function todayInput(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Format a Date as DD/MM/YYYY for display.
function formatUK(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Compute the objection deadline (listed date + 14 days), or null if no listed date.
function objectionDeadline(listedDate: string): Date | null {
  if (!listedDate) {
    return null;
  }
  const listed = parseUKDate(listedDate);
  const deadline = new Date(listed.getTime());
  deadline.setDate(deadline.getDate() + OBJECTION_PERIOD_DAYS);
  return deadline;
}

// Return true when a Listed application's objection period has passed.
function isObjectionPassed(application: Application): boolean {
  const deadline = objectionDeadline(application.listedDate);
  if (deadline === null) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return deadline.getTime() <= today.getTime();
}

// Human-readable member type label from gender + Playing/Social.
function memberTypeLabel(application: Application): string {
  if (application.memberType === 'Playing') {
    return application.gender === 'M' ? 'Playing Man' : 'Playing Lady';
  }
  if (application.memberType === 'Social') {
    return application.gender === 'M' ? 'Social Man' : 'Social Lady';
  }
  return application.memberType;
}

// Map a status to a badge variant.
function statusBadgeVariant(status: string): 'primary' | 'secondary' | 'success' | 'danger' | 'warning' {
  if (status === 'Submitted') return 'warning';
  if (status === 'Listed') return 'secondary';
  if (status === 'Approved') return 'primary';
  if (status === 'Paid') return 'success';
  if (status === 'Rejected') return 'danger';
  return 'primary';
}

// Format a fee number as £XX.XX, or a dash when not set.
function formatFee(fee: number | null): string {
  if (fee === null) {
    return '—';
  }
  return `£${fee.toFixed(2)}`;
}

// The modal kinds available across the workflow.
type ModalKind = 'listed' | 'approve' | 'reject' | 'paid' | 'convert';

export default function ApplicationsPage() {
  const { data: session } = useSession();

  // Loaded applications (null while first loading)
  const [applications, setApplications] = useState<Application[] | null>(null);
  // Page-level error banner
  const [error, setError] = useState<string | null>(null);
  // Success banner (e.g. conversion result)
  const [notice, setNotice] = useState<string | null>(null);

  // Active modal: which action and which application
  const [modalKind, setModalKind] = useState<ModalKind | null>(null);
  const [modalApp, setModalApp] = useState<Application | null>(null);
  // True while a modal action request is in flight
  const [submitting, setSubmitting] = useState(false);
  // Row number currently resending its payment email (for per-button feedback)
  const [resendingRow, setResendingRow] = useState<number | null>(null);

  // Form field state shared across modals
  const [listedDate, setListedDate] = useState(todayInput());
  const [approveFee, setApproveFee] = useState('');
  const [approveNotes, setApproveNotes] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [paidFee, setPaidFee] = useState('');
  const [paidMethod, setPaidMethod] = useState('Bank Transfer');
  const [paidDate, setPaidDate] = useState(todayInput());

  // Collapsible history sections
  const [showConverted, setShowConverted] = useState(false);
  const [showRejected, setShowRejected] = useState(false);

  // Load all applications from the API
  const loadApplications = async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/applications');
      if (!res.ok) {
        setError('Failed to load applications.');
        setApplications([]);
        return;
      }
      const json = await res.json();
      setApplications(json.applications || []);
    } catch {
      setError('Failed to load applications.');
      setApplications([]);
    }
  };

  // Initial load
  useEffect(() => {
    loadApplications();
  }, []);

  // Open a modal for the given action/application, seeding its form fields
  const openModal = (kind: ModalKind, app: Application) => {
    setError(null);
    setNotice(null);
    setModalKind(kind);
    setModalApp(app);

    if (kind === 'listed') {
      setListedDate(todayInput());
    } else if (kind === 'approve') {
      setApproveFee(app.feeDue !== null ? String(app.feeDue) : '');
      setApproveNotes('');
    } else if (kind === 'reject') {
      setRejectNotes('');
    } else if (kind === 'paid') {
      setPaidFee(app.feeDue !== null ? String(app.feeDue) : '');
      setPaidMethod('Bank Transfer');
      setPaidDate(todayInput());
    }
  };

  // Close the active modal
  const closeModal = () => {
    setModalKind(null);
    setModalApp(null);
    setSubmitting(false);
  };

  // Send an action request and refresh the list on success
  const performAction = async (url: string, method: string, body: any, onSuccess?: (json: any) => void) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Action failed.');
        setSubmitting(false);
        return;
      }
      if (onSuccess) {
        onSuccess(json);
      }
      closeModal();
      await loadApplications();
    } catch {
      setError('Action failed.');
      setSubmitting(false);
    }
  };

  // Confirm handlers per modal kind
  const confirmListed = () => {
    if (!modalApp) return;
    performAction(`/api/admin/applications/${modalApp.rowNumber}/set-listed-date`, 'PATCH', {
      listedDate,
    });
  };

  const confirmApprove = () => {
    if (!modalApp) return;
    performAction(`/api/admin/applications/${modalApp.rowNumber}/approve`, 'PATCH', {
      feeDue: approveFee,
      notes: approveNotes,
    }, (json) => {
      if (json.emailSent === false) {
        setNotice('Application approved, but the payment email could not be sent. Use "Resend Payment Email".');
      } else {
        setNotice('Application approved and payment email sent.');
      }
    });
  };

  const confirmReject = () => {
    if (!modalApp) return;
    performAction(`/api/admin/applications/${modalApp.rowNumber}/reject`, 'PATCH', {
      notes: rejectNotes,
    }, () => {
      setNotice('Application rejected.');
    });
  };

  const confirmPaid = () => {
    if (!modalApp) return;
    performAction(`/api/admin/applications/${modalApp.rowNumber}/mark-paid`, 'PATCH', {
      feePaid: paidFee,
      paymentMethod: paidMethod,
      paymentDate: paidDate,
    }, () => {
      setNotice('Payment recorded.');
    });
  };

  const confirmConvert = () => {
    if (!modalApp) return;
    performAction(`/api/admin/applications/${modalApp.rowNumber}/convert`, 'POST', {}, (json) => {
      const emailNote = json.emailSent === false
        ? ' (welcome email could not be sent — pass the login details on manually)'
        : '';
      setNotice(`Member created with username "${json.userName}"${emailNote}.`);
    });
  };

  // Resend the payment email for an approved application, with per-button feedback
  const handleResend = async (app: Application) => {
    setError(null);
    setNotice(null);
    setResendingRow(app.rowNumber);
    try {
      const res = await fetch(`/api/admin/applications/${app.rowNumber}/resend-payment-email`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to resend payment email.');
      } else {
        setNotice(`Payment email resent to ${app.firstName} ${app.lastName}.`);
      }
    } catch {
      setError('Failed to resend payment email.');
    } finally {
      setResendingRow(null);
    }
  };

  // Derive Navbar props
  const userName = session && session.user && session.user.name ? session.user.name : undefined;
  const userRole = session && session.user ? session.user.role : undefined;

  // Group applications by workflow state
  const actionRequired: Application[] = [];
  const pending: Application[] = [];
  const approved: Application[] = [];
  const paid: Application[] = [];
  const converted: Application[] = [];
  const rejected: Application[] = [];

  if (applications) {
    for (let i = 0; i < applications.length; i++) {
      const app = applications[i];
      if (app.status === 'Submitted') {
        actionRequired.push(app);
      } else if (app.status === 'Listed') {
        if (isObjectionPassed(app)) {
          actionRequired.push(app);
        } else {
          pending.push(app);
        }
      } else if (app.status === 'Approved') {
        approved.push(app);
      } else if (app.status === 'Paid') {
        paid.push(app);
      } else if (app.status === 'Converted') {
        converted.push(app);
      } else if (app.status === 'Rejected') {
        rejected.push(app);
      }
    }
  }

  // Render a single application row with optional action buttons
  const renderRow = (app: Application, actions: React.ReactNode) => {
    const deadline = objectionDeadline(app.listedDate);
    return (
      <div key={app.rowNumber} className="border-b border-gray-100 py-3 last:border-b-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">
              {app.firstName} {app.lastName}
              <span className="ml-2 align-middle">
                <span className={getBadgeClasses(statusBadgeVariant(app.status), 'sm')}>{app.status}</span>
              </span>
            </p>
            <p className="text-xs text-gray-700 mt-0.5">{app.emailAddress}</p>
            <p className="text-xs text-gray-700 mt-0.5">
              {memberTypeLabel(app)} · Submitted {app.createdAt}
            </p>
            {app.listedDate ? (
              <p className="text-xs text-gray-700 mt-0.5">
                Listed {app.listedDate}
                {deadline ? ` · Objection deadline ${formatUK(deadline)}` : ''}
              </p>
            ) : null}
            {app.feeDue !== null ? (
              <p className="text-xs text-gray-700 mt-0.5">Fee due: {formatFee(app.feeDue)}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
      </div>
    );
  };

  // Render a section card with a heading and rows
  const renderSection = (title: string, rows: React.ReactNode) => {
    return (
      <div className={`${getCardClasses('md')} mb-4`}>
        <h2 className="text-base font-semibold text-gray-900 mb-2">{title}</h2>
        {rows}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={userName} userRole={userRole} />

      <main className="max-w-3xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <Link href="/admin/members" className="text-sm text-gray-700 mb-2 inline-block hover:text-gray-900">← Member Management</Link>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Applications</h1>
        <p className="text-sm text-gray-700 mb-4">
          Process new membership applications from submission through to full membership.
        </p>

        {/* Error and notice banners */}
        {error ? (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">{notice}</div>
        ) : null}

        {applications === null ? (
          <p className="text-sm text-gray-700">Loading applications…</p>
        ) : (
          <>
            {/* Action Required */}
            {renderSection(
              `Action Required (${actionRequired.length})`,
              actionRequired.length === 0 ? (
                <p className="text-sm text-gray-700">Nothing needs action right now.</p>
              ) : (
                actionRequired.map((app) => {
                  if (app.status === 'Submitted') {
                    return renderRow(app, (
                      <button className={getButtonClasses('primary', 'sm')} onClick={() => openModal('listed', app)}>
                        Set Listed Date
                      </button>
                    ));
                  }
                  // Listed with objection period passed
                  return renderRow(app, (
                    <>
                      <button className={getButtonClasses('success', 'sm')} onClick={() => openModal('approve', app)}>
                        Approve
                      </button>
                      <button className={getButtonClasses('danger', 'sm')} onClick={() => openModal('reject', app)}>
                        Reject
                      </button>
                    </>
                  ));
                })
              )
            )}

            {/* Pending (objection period running) */}
            {renderSection(
              `Pending (${pending.length})`,
              pending.length === 0 ? (
                <p className="text-sm text-gray-700">No applications in the objection period.</p>
              ) : (
                pending.map((app) => renderRow(app, (
                  <span className="text-xs text-gray-700 self-center">Awaiting objection deadline</span>
                )))
              )
            )}

            {/* Approved (awaiting payment) */}
            {renderSection(
              `Approved (${approved.length})`,
              approved.length === 0 ? (
                <p className="text-sm text-gray-700">No applications awaiting payment.</p>
              ) : (
                approved.map((app) => renderRow(app, (
                  <>
                    <button className={getButtonClasses('primary', 'sm')} onClick={() => openModal('paid', app)}>
                      Mark as Paid
                    </button>
                    <button
                      className={getButtonClasses('secondary', 'sm')}
                      disabled={resendingRow === app.rowNumber}
                      onClick={() => handleResend(app)}
                    >
                      {resendingRow === app.rowNumber ? 'Sending…' : 'Resend Payment Email'}
                    </button>
                  </>
                )))
              )
            )}

            {/* Paid (ready to convert) */}
            {renderSection(
              `Paid (${paid.length})`,
              paid.length === 0 ? (
                <p className="text-sm text-gray-700">No applications ready to convert.</p>
              ) : (
                paid.map((app) => renderRow(app, (
                  <button className={getButtonClasses('success', 'sm')} onClick={() => openModal('convert', app)}>
                    Convert to Member
                  </button>
                )))
              )
            )}

            {/* Converted (history, collapsible) */}
            <div className={`${getCardClasses('md')} mb-4`}>
              <button
                className="w-full flex items-center justify-between text-base font-semibold text-gray-900"
                onClick={() => setShowConverted(!showConverted)}
              >
                <span>Converted ({converted.length})</span>
                <span className="text-gray-700">{showConverted ? '−' : '+'}</span>
              </button>
              {showConverted ? (
                <div className="mt-2">
                  {converted.length === 0 ? (
                    <p className="text-sm text-gray-700">No converted applications.</p>
                  ) : (
                    converted.map((app) => renderRow(app, (
                      <span className="text-xs text-gray-700 self-center">
                        {app.convertedUsername ? `→ ${app.convertedUsername}` : 'Converted'}
                      </span>
                    )))
                  )}
                </div>
              ) : null}
            </div>

            {/* Rejected (history, collapsible) */}
            <div className={`${getCardClasses('md')} mb-4`}>
              <button
                className="w-full flex items-center justify-between text-base font-semibold text-gray-900"
                onClick={() => setShowRejected(!showRejected)}
              >
                <span>Rejected ({rejected.length})</span>
                <span className="text-gray-700">{showRejected ? '−' : '+'}</span>
              </button>
              {showRejected ? (
                <div className="mt-2">
                  {rejected.length === 0 ? (
                    <p className="text-sm text-gray-700">No rejected applications.</p>
                  ) : (
                    rejected.map((app) => renderRow(app, (
                      <span className="text-xs text-gray-700 self-center">
                        {app.decisionNotes ? app.decisionNotes : 'Rejected'}
                      </span>
                    )))
                  )}
                </div>
              ) : null}
            </div>
          </>
        )}
      </main>

      {/* Set Listed Date modal */}
      <ConfirmDialog
        isOpen={modalKind === 'listed'}
        title="Set Listed Date"
        message={modalApp ? `Record the date ${modalApp.firstName} ${modalApp.lastName} was listed on the board.` : ''}
        confirmLabel="Set Listed"
        confirmDisabled={submitting || !listedDate}
        onConfirm={confirmListed}
        onCancel={closeModal}
      >
        <div className="mb-4 text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1">Listed Date</label>
          <input type="date" className={getInputClasses()} value={listedDate} onChange={(e) => setListedDate(e.target.value)} />
        </div>
      </ConfirmDialog>

      {/* Approve modal */}
      <ConfirmDialog
        isOpen={modalKind === 'approve'}
        title="Approve Application"
        message={modalApp ? `Approve ${modalApp.firstName} ${modalApp.lastName} and send the payment request email.` : ''}
        confirmLabel="Approve & Send"
        confirmVariant="primary"
        confirmDisabled={submitting || approveFee === ''}
        onConfirm={confirmApprove}
        onCancel={closeModal}
      >
        <div className="mb-3 text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1">Fee Due (£)</label>
          <input
            type="number"
            step="0.50"
            min="0"
            className={getInputClasses()}
            value={approveFee}
            onChange={(e) => setApproveFee(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-700">Adjust for any pro-rata reduction before sending.</p>
        </div>
        <div className="mb-4 text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
          <textarea className={getInputClasses()} rows={2} value={approveNotes} onChange={(e) => setApproveNotes(e.target.value)} />
        </div>
      </ConfirmDialog>

      {/* Reject modal */}
      <ConfirmDialog
        isOpen={modalKind === 'reject'}
        title="Reject Application"
        message={modalApp ? `Reject ${modalApp.firstName} ${modalApp.lastName}. No email is sent.` : ''}
        confirmLabel="Reject"
        confirmVariant="danger"
        confirmDisabled={submitting}
        onConfirm={confirmReject}
        onCancel={closeModal}
      >
        <div className="mb-4 text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason / Notes (optional)</label>
          <textarea className={getInputClasses()} rows={2} value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} />
        </div>
      </ConfirmDialog>

      {/* Mark as Paid modal */}
      <ConfirmDialog
        isOpen={modalKind === 'paid'}
        title="Mark as Paid"
        message={modalApp ? `Record payment for ${modalApp.firstName} ${modalApp.lastName}.` : ''}
        confirmLabel="Record Payment"
        confirmVariant="primary"
        confirmDisabled={submitting || paidFee === ''}
        onConfirm={confirmPaid}
        onCancel={closeModal}
      >
        <div className="mb-3 text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1">Fee Paid (£)</label>
          <input type="number" step="0.50" min="0" className={getInputClasses()} value={paidFee} onChange={(e) => setPaidFee(e.target.value)} />
        </div>
        <div className="mb-3 text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
          <select className={getInputClasses()} value={paidMethod} onChange={(e) => setPaidMethod(e.target.value)}>
            <option>Bank Transfer</option>
            <option>Card</option>
            <option>Cash</option>
            <option>Cheque</option>
          </select>
        </div>
        <div className="mb-4 text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
          <input type="date" className={getInputClasses()} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </div>
      </ConfirmDialog>

      {/* Convert to Member modal */}
      <ConfirmDialog
        isOpen={modalKind === 'convert'}
        title="Convert to Member"
        message={modalApp ? `Create a member record for ${modalApp.firstName} ${modalApp.lastName} and email their login details.` : ''}
        confirmLabel="Convert"
        confirmVariant="primary"
        confirmDisabled={submitting}
        onConfirm={confirmConvert}
        onCancel={closeModal}
      >
        {modalApp ? (
          <div className="mb-4 text-left text-sm text-gray-700">
            <p>Member type: <strong className="text-gray-900">{memberTypeLabel(modalApp)}</strong></p>
            <p className="mt-1">A username and temporary password will be generated and emailed to {modalApp.emailAddress}.</p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
