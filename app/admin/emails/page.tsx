// app/admin/emails/page.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses } from '@/config/theme-helpers';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  filePath: string;
}

interface AttachmentTemplate {
  id: string;
  name: string;
  filePath: string;
}

interface ProgressEvent {
  type: 'progress' | 'success' | 'error' | 'complete';
  current?: number;
  total?: number;
  userName?: string;
  error?: string;
  sent?: number;
  succeeded?: number;
  failed?: number;
}

type RecipientType = 'members' | 'club-contacts';

export default function SendMemberEmailsPage() {
  const { data: session, status } = useSession();

  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: Recipients
  const [recipientType, setRecipientType] = useState<RecipientType>('members');

  // Step 2: Template
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Step 3: Attachments
  const [attachmentTemplates, setAttachmentTemplates] = useState<AttachmentTemplate[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set());

  // Step 4: Confirm
  const [recipientCount, setRecipientCount] = useState(0);
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  // Sending state
  const [isSending, setIsSending] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [totalEmails, setTotalEmails] = useState(0);
  const [currentUserName, setCurrentUserName] = useState('');
  const [successList, setSuccessList] = useState<string[]>([]);
  const [errorList, setErrorList] = useState<Array<{ userName: string; error: string }>>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [finalStats, setFinalStats] = useState({ sent: 0, succeeded: 0, failed: 0 });
  const [isCancelled, setIsCancelled] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load recipient count when reaching step 4
  useEffect(() => {
    if (currentStep === 4 && recipientCount === 0) {
      loadRecipients();
    }
  }, [currentStep]);

  async function loadTemplates() {
    setLoadingTemplates(true);
    try {
      const url = recipientType === 'club-contacts'
        ? '/api/admin/emails/templates?type=club'
        : '/api/admin/emails/templates';
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) {
        setEmailTemplates(data.emailTemplates || []);
        setAttachmentTemplates(data.attachmentTemplates || []);
      } else {
        alert(data.error || 'Failed to load templates');
      }
    } catch {
      alert('Failed to load templates');
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function loadRecipients() {
    setLoadingRecipients(true);
    try {
      if (recipientType === 'club-contacts') {
        const res = await fetch('/api/admin/emails/club-contacts');
        const data = await res.json();
        if (res.ok) setRecipientCount(data.count || 0);
      } else {
        const res = await fetch('/api/admin/emails/recipients');
        const data = await res.json();
        if (res.ok) setRecipientCount(data.count);
      }
    } catch {
      alert('Failed to load recipients');
    } finally {
      setLoadingRecipients(false);
    }
  }

  async function startSendingEmails() {
    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let response: Response;

      if (recipientType === 'club-contacts') {
        response = await fetch('/api/admin/emails/club-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: selectedTemplate }),
          signal: abortController.signal,
        });
      } else {
        response = await fetch('/api/admin/emails/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateId: selectedTemplate,
            attachmentIds: Array.from(selectedAttachments),
          }),
          signal: abortController.signal,
        });
      }

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data: ProgressEvent = JSON.parse(line.substring(6));
              if (data.type === 'progress') {
                setCurrentProgress(data.current || 0);
                setTotalEmails(data.total || 0);
                setCurrentUserName(data.userName || '');
              } else if (data.type === 'success') {
                setSuccessList(prev => [...prev, data.userName || '']);
              } else if (data.type === 'error') {
                setErrorList(prev => [...prev, { userName: data.userName || 'Unknown', error: data.error || 'Unknown error' }]);
              } else if (data.type === 'complete') {
                setFinalStats({ sent: data.sent || 0, succeeded: data.succeeded || 0, failed: data.failed || 0 });
                setIsComplete(true);
                setIsSending(false);
              }
            } catch {}
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setIsCancelled(true);
        setIsSending(false);
        setIsComplete(true);
        return;
      }
      setIsSending(false);
      setIsComplete(true);
      setErrorList([{ userName: 'System', error: error instanceof Error ? error.message : 'Failed to start email sending' }]);
    }
  }

  function handleNext() {
    if (currentStep === 1) {
      // Load templates for the chosen recipient type
      setEmailTemplates([]);
      setSelectedTemplate('');
      loadTemplates();
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (!selectedTemplate) {
        alert('Please select an email template');
        return;
      }
      setCurrentStep(3);
    } else if (currentStep === 3) {
      setCurrentStep(4);
    }
  }

  function handleBack() {
    setCurrentStep(prev => prev - 1);
  }

  function handleSend() {
    setIsSending(true);
    setIsComplete(false);
    setIsCancelled(false);
    setCurrentProgress(0);
    setTotalEmails(recipientCount);
    setCurrentUserName('');
    setSuccessList([]);
    setErrorList([]);
    setFinalStats({ sent: 0, succeeded: 0, failed: 0 });
    startSendingEmails();
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  function handleStartOver() {
    setCurrentStep(1);
    setRecipientType('members');
    setSelectedTemplate('');
    setSelectedAttachments(new Set());
    setRecipientCount(0);
    setIsComplete(false);
    setEmailTemplates([]);
  }

  function handleAttachmentToggle(id: string) {
    setSelectedAttachments(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="container mx-auto p-6"><p>Loading...</p></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="container mx-auto p-6"><p className="text-red-600">Please log in to access this page.</p></div>
      </div>
    );
  }

  if (session.user?.role !== 'Admin') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session.user?.name ?? undefined} userRole={session.user?.role ?? undefined} />
        <div className="container mx-auto p-6"><p className="text-red-600">Access denied. Admin privileges required.</p></div>
      </div>
    );
  }

  const stepLabels = ['Recipients', 'Template', 'Attachments', 'Confirm'];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session.user?.name ?? undefined} userRole={session.user?.role ?? undefined} />
      <div className="container mx-auto p-6 max-w-4xl">
        <h1 className="text-3xl font-bold mb-2 text-gray-900">Send Emails</h1>
        <p className="text-gray-600 mb-6">Send emails to members or club contacts</p>

        {/* Progress Indicator */}
        {!isSending && !isComplete && (
          <div className="mb-8">
            <div className="flex items-center">
              {[1, 2, 3, 4].map((step) => (
                <div key={step} className="flex items-center flex-1">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 flex-shrink-0 ${
                    currentStep >= step ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-gray-300 text-gray-500'
                  }`}>
                    {step}
                  </div>
                  <div className="mx-2 flex-shrink-0">
                    <div className={`text-sm font-medium whitespace-nowrap ${currentStep >= step ? 'text-blue-500' : 'text-gray-500'}`}>
                      {stepLabels[step - 1]}
                    </div>
                  </div>
                  {step < 4 && (
                    <div className={`flex-1 h-1 mx-2 ${currentStep > step ? 'bg-blue-500' : 'bg-gray-300'}`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Recipients */}
        {currentStep === 1 && !isSending && !isComplete && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4 text-gray-900">Step 1: Select Recipients</h2>
            <div className="space-y-3 mb-6">
              <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors`}
                style={{ borderColor: recipientType === 'members' ? '#3b82f6' : '#e5e7eb' }}>
                <input type="radio" name="recipientType" value="members" checked={recipientType === 'members'}
                  onChange={() => setRecipientType('members')} className="mt-1 mr-3" />
                <div>
                  <div className="font-semibold text-gray-900">All members</div>
                  <div className="text-sm text-gray-600 mt-1">Members with Include = Y in the Members sheet</div>
                </div>
              </label>
              <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors`}
                style={{ borderColor: recipientType === 'club-contacts' ? '#3b82f6' : '#e5e7eb' }}>
                <input type="radio" name="recipientType" value="club-contacts" checked={recipientType === 'club-contacts'}
                  onChange={() => setRecipientType('club-contacts')} className="mt-1 mr-3" />
                <div>
                  <div className="font-semibold text-gray-900">Club contacts</div>
                  <div className="text-sm text-gray-600 mt-1">Contacts with Include = Y in the Match Day Contacts spreadsheet</div>
                </div>
              </label>
            </div>
            <div className="flex justify-end">
              <button onClick={handleNext} className={getButtonClasses('primary', 'md')}>Next</button>
            </div>
          </div>
        )}

        {/* Step 2: Template */}
        {currentStep === 2 && !isSending && !isComplete && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4 text-gray-900">Step 2: Select Email Template</h2>
            {loadingTemplates ? (
              <p className="text-gray-600">Loading templates...</p>
            ) : emailTemplates.length === 0 ? (
              <p className="text-red-600">No email templates found{recipientType === 'club-contacts' ? ' — add HTML files to src/lib/email/templates/Club Emails/Email Templates/' : ''}</p>
            ) : (
              <div className="space-y-3">
                {emailTemplates.map(template => (
                  <label key={template.id} className="flex items-start p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                    style={{ borderColor: selectedTemplate === template.id ? '#3b82f6' : '#e5e7eb' }}>
                    <input type="radio" name="emailTemplate" value={template.id} checked={selectedTemplate === template.id}
                      onChange={e => setSelectedTemplate(e.target.value)} className="mt-1 mr-3" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900">{template.name}</div>
                      <div className="text-sm text-gray-600 mt-1">Subject: {template.subject}</div>
                    </div>
                    <button
                      type="button"
                      onClick={e => { e.preventDefault(); window.open(`/api/admin/emails/templates/preview?id=${encodeURIComponent(template.id)}&type=${recipientType === 'club-contacts' ? 'club' : 'member'}`, '_blank'); }}
                      className="ml-4 shrink-0 text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
                    >
                      Preview
                    </button>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-between">
              <button onClick={handleBack} className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-100">Back</button>
              <button onClick={handleNext} disabled={!selectedTemplate} className={getButtonClasses('primary', 'md')}>Next</button>
            </div>
          </div>
        )}

        {/* Step 3: Attachments */}
        {currentStep === 3 && !isSending && !isComplete && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4 text-gray-900">Step 3: Attachments</h2>
            {recipientType === 'club-contacts' ? (
              <p className="text-gray-600 italic">Attachments are not available for club contact emails.</p>
            ) : attachmentTemplates.length === 0 ? (
              <p className="text-gray-600">No attachment templates available</p>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-4">Select DOCX templates to populate and attach as PDFs. Leave all unchecked to send without attachments.</p>
                <div className="space-y-2">
                  {attachmentTemplates.map(att => (
                    <label key={att.id} className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                      <input type="checkbox" checked={selectedAttachments.has(att.id)}
                        onChange={() => handleAttachmentToggle(att.id)} className="mr-3" />
                      <span className="text-gray-900">{att.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="mt-6 flex justify-between">
              <button onClick={handleBack} className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-100">Back</button>
              <button onClick={handleNext} className={getButtonClasses('primary', 'md')}>Next</button>
            </div>
          </div>
        )}

        {/* Step 4: Confirm */}
        {currentStep === 4 && !isSending && !isComplete && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4 text-gray-900">Step 4: Confirm and Send</h2>
            <div className="space-y-4">
              <div className="border-b pb-4">
                <h3 className="font-semibold text-gray-700 mb-2">Recipients</h3>
                <p className="text-gray-900">
                  {recipientType === 'members' ? 'All members (Include = Y)' : 'Club contacts (Include = Y)'}
                </p>
              </div>
              <div className="border-b pb-4">
                <h3 className="font-semibold text-gray-700 mb-2">Email Template</h3>
                <p className="text-gray-900">{emailTemplates.find(t => t.id === selectedTemplate)?.name}</p>
                <p className="text-sm text-gray-600 mt-1">Subject: {emailTemplates.find(t => t.id === selectedTemplate)?.subject}</p>
              </div>
              {recipientType === 'members' && (
                <div className="border-b pb-4">
                  <h3 className="font-semibold text-gray-700 mb-2">Attachments</h3>
                  {selectedAttachments.size === 0 ? (
                    <p className="text-gray-600 italic">No attachments selected</p>
                  ) : (
                    <ul className="list-disc list-inside space-y-1">
                      {attachmentTemplates.filter(a => selectedAttachments.has(a.id)).map(a => (
                        <li key={a.id} className="text-gray-900">{a.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div>
                <h3 className="font-semibold text-gray-700 mb-2">Will send to</h3>
                {loadingRecipients ? (
                  <p className="text-gray-600">Loading...</p>
                ) : (
                  <p className="text-2xl font-bold text-blue-500">{recipientCount} {recipientType === 'members' ? 'members' : 'contacts'}</p>
                )}
                {recipientType === 'club-contacts' && (
                  <p className="text-sm text-gray-500 mt-1">Contacts with both an email address and a Club ID set</p>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-between">
              <button onClick={handleBack} className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-100">Back</button>
              <button onClick={handleSend} disabled={recipientCount === 0} className={getButtonClasses('primary', 'md')}>Send Emails</button>
            </div>
          </div>
        )}

        {/* Sending Progress */}
        {isSending && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4 text-gray-900">Sending Emails...</h2>
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>{currentProgress} of {totalEmails} emails sent</span>
                <span>{totalEmails > 0 ? Math.round((currentProgress / totalEmails) * 100) : 0}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-4">
                <div className="bg-blue-500 h-4 rounded-full transition-all"
                  style={{ width: `${totalEmails > 0 ? (currentProgress / totalEmails) * 100 : 0}%` }} />
              </div>
            </div>
            {currentUserName && <p className="text-sm text-gray-700 mb-4">Currently sending to: {currentUserName}</p>}
            <button onClick={handleStop} className="bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700 transition-colors mb-4">Stop Sending</button>
            {successList.length > 0 && <p className="text-sm text-green-600 mt-2">✓ {successList.length} emails sent successfully</p>}
            {errorList.length > 0 && <p className="text-sm text-red-600 mt-2">✗ {errorList.length} emails failed</p>}
          </div>
        )}

        {/* Completion Summary */}
        {isComplete && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4 text-gray-900">{isCancelled ? 'Email Send Cancelled' : 'Email Send Complete'}</h2>
            {isCancelled && (
              <p className="text-yellow-600 mb-4">
                Sending stopped after starting {currentProgress} of {totalEmails} emails.
                {(successList.length > 0 || errorList.length > 0) && <> ({successList.length} succeeded, {errorList.length} failed)</>}
              </p>
            )}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-500">{isCancelled ? (successList.length + errorList.length) : finalStats.sent}</div>
                <div className="text-sm text-gray-600">Total Processed</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">{isCancelled ? successList.length : finalStats.succeeded}</div>
                <div className="text-sm text-gray-600">Succeeded</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-red-600">{isCancelled ? errorList.length : finalStats.failed}</div>
                <div className="text-sm text-gray-600">Failed</div>
              </div>
            </div>
            {successList.length > 0 && (
              <div className="mb-4">
                <h3 className="font-bold text-green-600 mb-2">Successful Sends:</h3>
                <div className="max-h-48 overflow-y-auto border border-gray-300 rounded p-3">
                  {successList.map((name, i) => <div key={i} className="text-sm text-gray-700">✓ {name}</div>)}
                </div>
              </div>
            )}
            {errorList.length > 0 && (
              <div className="mb-4">
                <h3 className="font-bold text-red-600 mb-2">Failed Sends:</h3>
                <div className="max-h-48 overflow-y-auto border border-red-300 rounded p-3 bg-red-50">
                  {errorList.map((item, i) => (
                    <div key={i} className="text-sm mb-2">
                      <div className="font-semibold">✗ {item.userName}</div>
                      <div className="text-gray-700 ml-4">{item.error}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={handleStartOver} className={getButtonClasses('primary', 'md')}>Send Another Batch</button>
          </div>
        )}
      </div>
    </div>
  );
}
