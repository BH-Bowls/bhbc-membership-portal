// app/admin/emails/page.tsx
// Admin page for sending emails to members with include="Y"
// 3-step wizard: Select template → Select attachments → Confirm and send

'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses } from '@/config/theme-helpers';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Email template information
 */
interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  filePath: string;
}

/**
 * Attachment template information
 */
interface AttachmentTemplate {
  id: string;
  name: string;
  filePath: string;
}

/**
 * Progress event from Server-Sent Events stream
 */
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

// ============================================================================
// Main Component
// ============================================================================

/**
 * Admin page for sending member emails
 * 3-step wizard for template selection, attachment selection, and sending
 */
export default function SendMemberEmailsPage() {
  // Get current user session
  const { data: session, status } = useSession();

  // Wizard step state (1 = template, 2 = attachments, 3 = summary)
  const [currentStep, setCurrentStep] = useState(1);

  // Template selection state
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');

  // Attachment selection state
  const [attachmentTemplates, setAttachmentTemplates] = useState<AttachmentTemplate[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set());

  // Recipient count state
  const [recipientCount, setRecipientCount] = useState(0);

  // Loading states
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  // Sending state
  const [isSending, setIsSending] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [totalEmails, setTotalEmails] = useState(0);
  const [currentUserName, setCurrentUserName] = useState('');

  // Results state
  const [successList, setSuccessList] = useState<string[]>([]);
  const [errorList, setErrorList] = useState<Array<{ userName: string; error: string }>>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [finalStats, setFinalStats] = useState({ sent: 0, succeeded: 0, failed: 0 });
  const [isCancelled, setIsCancelled] = useState(false);

  // Ref to hold AbortController for cancelling email send
  const abortControllerRef = useRef<AbortController | null>(null);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Load templates on page load
   */
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role === 'Admin') {
      loadTemplates();
    }
  }, [status, session]);

  /**
   * Load recipient count when reaching summary step
   */
  useEffect(() => {
    if (currentStep === 3 && recipientCount === 0) {
      loadRecipients();
    }
  }, [currentStep]);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Load available email and attachment templates
   */
  async function loadTemplates() {
    setLoadingTemplates(true);
    try {
      const response = await fetch('/api/admin/emails/templates');
      const data = await response.json();

      if (response.ok) {
        setEmailTemplates(data.emailTemplates);
        setAttachmentTemplates(data.attachmentTemplates);
      } else {
        alert(data.error || 'Failed to load templates');
      }
    } catch (error) {
      console.error('Error loading templates:', error);
      alert('Failed to load templates');
    } finally {
      setLoadingTemplates(false);
    }
  }

  /**
   * Load recipient count (members with Include="Y")
   */
  async function loadRecipients() {
    setLoadingRecipients(true);
    try {
      const response = await fetch('/api/admin/emails/recipients');
      const data = await response.json();

      if (response.ok) {
        setRecipientCount(data.count);
      } else {
        alert(data.error || 'Failed to load recipients');
      }
    } catch (error) {
      console.error('Error loading recipients:', error);
      alert('Failed to load recipients');
    } finally {
      setLoadingRecipients(false);
    }
  }

  /**
   * Start sending emails using Server-Sent Events
   */
  async function startSendingEmails() {
    try {
      // Create new AbortController for this send operation
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Make POST request to API endpoint
      const response = await fetch('/api/admin/emails/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          templateId: selectedTemplate,
          attachmentIds: Array.from(selectedAttachments),
        }),
        signal: abortController.signal, // Pass abort signal
      });

      // Check if request was successful
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Get response body as ReadableStream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      // Create TextDecoder to convert chunks to text
      const decoder = new TextDecoder();

      // Read stream chunks
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.substring(6);
            try {
              const data: ProgressEvent = JSON.parse(jsonStr);

              if (data.type === 'progress') {
                setCurrentProgress(data.current || 0);
                setTotalEmails(data.total || 0);
                setCurrentUserName(data.userName || '');
              } else if (data.type === 'success') {
                setSuccessList((prev) => [...prev, data.userName || '']);
              } else if (data.type === 'error') {
                setErrorList((prev) => [
                  ...prev,
                  {
                    userName: data.userName || 'Unknown',
                    error: data.error || 'Unknown error',
                  },
                ]);
              } else if (data.type === 'complete') {
                setFinalStats({
                  sent: data.sent || 0,
                  succeeded: data.succeeded || 0,
                  failed: data.failed || 0,
                });
                setIsComplete(true);
                setIsSending(false);
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError);
            }
          }
        }
      }
    } catch (error) {
      // Check if error is due to abort
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Email sending cancelled by user');
        setIsCancelled(true);
        setIsSending(false);
        setIsComplete(true);
        return;
      }

      console.error('Error in startSendingEmails:', error);
      setIsSending(false);
      setIsComplete(true);
      setErrorList([
        {
          userName: 'System',
          error: error instanceof Error ? error.message : 'Failed to start email sending',
        },
      ]);
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle template selection change
   */
  function handleTemplateChange(templateId: string) {
    setSelectedTemplate(templateId);
  }

  /**
   * Handle attachment checkbox toggle
   */
  function handleAttachmentToggle(attachmentId: string) {
    setSelectedAttachments((prev) => {
      const next = new Set(prev);
      if (next.has(attachmentId)) {
        next.delete(attachmentId);
      } else {
        next.add(attachmentId);
      }
      return next;
    });
  }

  /**
   * Handle Next button click
   */
  function handleNext() {
    if (currentStep === 1 && !selectedTemplate) {
      alert('Please select an email template');
      return;
    }
    setCurrentStep((prev) => prev + 1);
  }

  /**
   * Handle Back button click
   */
  function handleBack() {
    setCurrentStep((prev) => prev - 1);
  }

  /**
   * Handle Send Emails button click
   */
  function handleSend() {
    // Reset sending state
    setIsSending(true);
    setIsComplete(false);
    setIsCancelled(false);
    setCurrentProgress(0);
    setTotalEmails(recipientCount); // Set total immediately from recipient count
    setCurrentUserName('');
    setSuccessList([]);
    setErrorList([]);
    setFinalStats({ sent: 0, succeeded: 0, failed: 0 });

    // Start sending
    startSendingEmails();
  }

  /**
   * Handle Stop Sending button click
   */
  function handleStop() {
    // Abort the fetch request (will finish current email then stop)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  /**
   * Handle Start Over button click
   */
  function handleStartOver() {
    setCurrentStep(1);
    setSelectedTemplate('');
    setSelectedAttachments(new Set());
    setRecipientCount(0);
    setIsComplete(false);
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Get selected template object
   */
  function getSelectedTemplateObject(): EmailTemplate | undefined {
    return emailTemplates.find((t) => t.id === selectedTemplate);
  }

  /**
   * Get selected attachment objects
   */
  function getSelectedAttachmentObjects(): AttachmentTemplate[] {
    return attachmentTemplates.filter((a) => selectedAttachments.has(a.id));
  }

  // ============================================================================
  // Authorization Check
  // ============================================================================

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="container mx-auto p-6">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="container mx-auto p-6">
          <p className="text-red-600">Please log in to access this page.</p>
        </div>
      </div>
    );
  }

  if (session.user?.role !== 'Admin') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session.user?.name ?? undefined} userRole={session.user?.role ?? undefined} />
        <div className="container mx-auto p-6">
          <p className="text-red-600">Access denied. Admin privileges required.</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session.user?.name ?? undefined} userRole={session.user?.role ?? undefined} />

      <div className="container mx-auto p-6 max-w-4xl">
        {/* Page Header */}
        <h1 className="text-3xl font-bold mb-2">Send Member Emails</h1>
        <p className="text-gray-600 mb-6">Send emails to all members with Include = &quot;Y&quot;</p>

        {/* Progress Indicator */}
        {!isSending && !isComplete && (
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {[1, 2, 3].map((step) => (
                <div key={step} className="flex items-center flex-1">
                  <div
                    className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                      currentStep >= step
                        ? 'bg-blue-500 border-blue-500 text-white'
                        : 'bg-white border-gray-300 text-gray-500'
                    }`}
                  >
                    {step}
                  </div>
                  <div className="flex-1 mx-2">
                    <div
                      className={`text-sm font-medium ${
                        currentStep >= step ? 'text-blue-500' : 'text-gray-500'
                      }`}
                    >
                      {step === 1 && 'Template'}
                      {step === 2 && 'Attachments'}
                      {step === 3 && 'Confirm'}
                    </div>
                  </div>
                  {step < 3 && (
                    <div
                      className={`flex-1 h-1 ${currentStep > step ? 'bg-blue-500' : 'bg-gray-300'}`}
                    ></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Select Email Template */}
        {currentStep === 1 && !isSending && !isComplete && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Step 1: Select Email Template</h2>

            {loadingTemplates ? (
              <p className="text-gray-600">Loading templates...</p>
            ) : emailTemplates.length === 0 ? (
              <p className="text-red-600">No email templates found</p>
            ) : (
              <div className="space-y-3">
                {emailTemplates.map((template) => (
                  <label
                    key={template.id}
                    className="flex items-start p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                    style={{
                      borderColor: selectedTemplate === template.id ? '#3b82f6' : '#e5e7eb',
                    }}
                  >
                    <input
                      type="radio"
                      name="emailTemplate"
                      value={template.id}
                      checked={selectedTemplate === template.id}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      className="mt-1 mr-3"
                    />
                    <div>
                      <div className="font-semibold text-gray-900">{template.name}</div>
                      <div className="text-sm text-gray-600 mt-1">Subject: {template.subject}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleNext}
                disabled={!selectedTemplate}
                className={getButtonClasses('primary', 'md')}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Select Attachments */}
        {currentStep === 2 && !isSending && !isComplete && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Step 2: Select Attachments (Optional)</h2>
            <p className="text-sm text-gray-600 mb-4">
              Select DOCX templates to populate and attach as PDFs. Leave all unchecked to send emails without attachments.
            </p>

            {attachmentTemplates.length === 0 ? (
              <p className="text-gray-600">No attachment templates available</p>
            ) : (
              <div className="space-y-2">
                {attachmentTemplates.map((attachment) => (
                  <label
                    key={attachment.id}
                    className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAttachments.has(attachment.id)}
                      onChange={() => handleAttachmentToggle(attachment.id)}
                      className="mr-3"
                    />
                    <span className="text-gray-900">{attachment.name}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button
                onClick={handleBack}
                className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-100"
              >
                Back
              </button>
              <button
                onClick={handleNext}
                className={getButtonClasses('primary', 'md')}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Summary and Confirm */}
        {currentStep === 3 && !isSending && !isComplete && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Step 3: Confirm and Send</h2>

            <div className="space-y-4">
              {/* Selected Template */}
              <div className="border-b pb-4">
                <h3 className="font-semibold text-gray-700 mb-2">Email Template</h3>
                <p className="text-gray-900">{getSelectedTemplateObject()?.name}</p>
                <p className="text-sm text-gray-600 mt-1">
                  Subject: {getSelectedTemplateObject()?.subject}
                </p>
              </div>

              {/* Selected Attachments */}
              <div className="border-b pb-4">
                <h3 className="font-semibold text-gray-700 mb-2">Attachments</h3>
                {selectedAttachments.size === 0 ? (
                  <p className="text-gray-600 italic">No attachments selected</p>
                ) : (
                  <ul className="list-disc list-inside space-y-1">
                    {getSelectedAttachmentObjects().map((attachment) => (
                      <li key={attachment.id} className="text-gray-900">
                        {attachment.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Recipient Count */}
              <div>
                <h3 className="font-semibold text-gray-700 mb-2">Recipients</h3>
                {loadingRecipients ? (
                  <p className="text-gray-600">Loading recipients...</p>
                ) : (
                  <p className="text-2xl font-bold text-blue-500">{recipientCount} members</p>
                )}
                <p className="text-sm text-gray-600 mt-1">Members with Include = &quot;Y&quot;</p>
              </div>
            </div>

            <div className="mt-6 flex justify-between">
              <button
                onClick={handleBack}
                className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-100"
              >
                Back
              </button>
              <button
                onClick={handleSend}
                disabled={recipientCount === 0}
                className={getButtonClasses('primary', 'md')}
              >
                Send Emails
              </button>
            </div>
          </div>
        )}

        {/* Sending Progress */}
        {isSending && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Sending Emails...</h2>

            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>
                  {currentProgress} of {totalEmails} emails sent
                </span>
                <span>{totalEmails > 0 ? Math.round((currentProgress / totalEmails) * 100) : 0}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-4">
                <div
                  className="bg-blue-500 h-4 rounded-full transition-all"
                  style={{
                    width: `${totalEmails > 0 ? (currentProgress / totalEmails) * 100 : 0}%`,
                  }}
                ></div>
              </div>
            </div>

            {currentUserName && (
              <p className="text-sm text-gray-700 mb-4">Currently sending to: {currentUserName}</p>
            )}

            {/* Stop button */}
            <button
              onClick={handleStop}
              className="bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700 transition-colors mb-4"
            >
              Stop Sending
            </button>

            {successList.length > 0 && (
              <p className="text-sm text-green-600 mt-2">✓ {successList.length} emails sent successfully</p>
            )}

            {errorList.length > 0 && (
              <p className="text-sm text-red-600 mt-2">✗ {errorList.length} emails failed</p>
            )}
          </div>
        )}

        {/* Completion Summary */}
        {isComplete && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">
              {isCancelled ? 'Email Send Cancelled' : 'Email Send Complete'}
            </h2>

            {isCancelled && (
              <p className="text-yellow-600 mb-4">
                Sending stopped after starting {currentProgress} of {totalEmails} emails.
                {(successList.length > 0 || errorList.length > 0) && (
                  <> ({successList.length} succeeded, {errorList.length} failed)</>
                )}
              </p>
            )}

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-500">
                  {isCancelled ? (successList.length + errorList.length) : finalStats.sent}
                </div>
                <div className="text-sm text-gray-600">Total Processed</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">
                  {isCancelled ? successList.length : finalStats.succeeded}
                </div>
                <div className="text-sm text-gray-600">Succeeded</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-red-600">
                  {isCancelled ? errorList.length : finalStats.failed}
                </div>
                <div className="text-sm text-gray-600">Failed</div>
              </div>
            </div>

            {successList.length > 0 && (
              <div className="mb-4">
                <h3 className="font-bold text-green-600 mb-2">Successful Sends:</h3>
                <div className="max-h-48 overflow-y-auto border border-gray-300 rounded p-3">
                  {successList.map((userName, index) => (
                    <div key={index} className="text-sm text-gray-700">
                      ✓ {userName}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {errorList.length > 0 && (
              <div className="mb-4">
                <h3 className="font-bold text-red-600 mb-2">Failed Sends:</h3>
                <div className="max-h-48 overflow-y-auto border border-red-300 rounded p-3 bg-red-50">
                  {errorList.map((item, index) => (
                    <div key={index} className="text-sm mb-2">
                      <div className="font-semibold">✗ {item.userName}</div>
                      <div className="text-gray-700 ml-4">{item.error}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleStartOver}
              className={getButtonClasses('primary', 'md')}
            >
              Send Another Batch
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
