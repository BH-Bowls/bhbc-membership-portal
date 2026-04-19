// app/member-suggestions/new/page.tsx
// Create New Suggestion Page
// Simple form for submitting new suggestions

'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';

// ============================================================================
// Main Component
// ============================================================================

export default function NewSuggestionPage() {
  const { data: session } = useSession();
  const router = useRouter();
  usePhoneBackNavigation('/member-suggestions');

  // State: Form data
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    reasonForImprovement: '',
  });

  // State: Form submission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // State: Validation errors
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle field change
   */
  function handleChange(field: keyof typeof formData, value: string) {
    setFormData({ ...formData, [field]: value });
    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors({ ...validationErrors, [field]: '' });
    }
  }

  /**
   * Validate form
   */
  function validateForm(): boolean {
    const errors: Record<string, string> = {};

    if (!formData.title.trim()) {
      errors.title = 'Title is required';
    } else if (formData.title.length > 200) {
      errors.title = 'Title must be 200 characters or less';
    }

    if (!formData.description.trim()) {
      errors.description = 'Description is required';
    } else if (formData.description.length > 2000) {
      errors.description = 'Description must be 2000 characters or less';
    }

    if (!formData.reasonForImprovement.trim()) {
      errors.reasonForImprovement = 'Reason for improvement is required';
    } else if (formData.reasonForImprovement.length > 2000) {
      errors.reasonForImprovement = 'Reason must be 2000 characters or less';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /**
   * Handle form submission
   */
  async function handleSubmit() {
    // Validate form
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        // Success - redirect to the new suggestion
        router.push(`/member-suggestions/${data.suggestionId}`);
      } else {
        setError(data.error || 'Failed to create suggestion');
      }
    } catch (error) {
      console.error('Error creating suggestion:', error);
      setError('Failed to create suggestion. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Handle cancel
   */
  function handleCancel() {
    router.push('/member-suggestions');
  }

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation bar with action buttons */}
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
        actionButtons={{
          primary: {
            label: 'Submit',
            onClick: handleSubmit,
            loading: isSubmitting,
            variant: 'primary' as const,
          },
          secondary: {
            label: 'Cancel',
            onClick: handleCancel,
            disabled: isSubmitting,
            variant: 'secondary' as const,
          },
        }}
      />

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Back button */}
        <button
          onClick={handleCancel}
          className="mb-4 text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          ← Back to Suggestions
        </button>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-4 rounded-md bg-red-50 border border-red-200 text-red-700">
            {error}
          </div>
        )}

        {/* Page header */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h1 className="text-2xl font-bold mb-2 text-gray-900">New Suggestion</h1>
          <p className="text-gray-600">
            Submit your ideas to help improve Burgess Hill Bowling Club. The committee will review
            your suggestion and get back to you.
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="space-y-6">
            {/* Title */}
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="title"
                type="text"
                value={formData.title}
                onChange={(e) => handleChange('title', e.target.value)}
                disabled={isSubmitting}
                maxLength={200}
                placeholder="Brief title for your suggestion"
                className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                  validationErrors.title ? 'border-red-500' : ''
                }`}
              />
              {validationErrors.title && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.title}</p>
              )}
              <p className="mt-1 text-sm text-gray-500">
                {formData.title.length}/200 characters
              </p>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                disabled={isSubmitting}
                rows={6}
                maxLength={2000}
                placeholder="Provide a detailed description of your suggestion..."
                className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                  validationErrors.description ? 'border-red-500' : ''
                }`}
              />
              {validationErrors.description && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.description}</p>
              )}
              <p className="mt-1 text-sm text-gray-500">
                {formData.description.length}/2000 characters
              </p>
            </div>

            {/* Reason for Improvement */}
            <div>
              <label
                htmlFor="reasonForImprovement"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Why This Would Improve the Club <span className="text-red-500">*</span>
              </label>
              <textarea
                id="reasonForImprovement"
                value={formData.reasonForImprovement}
                onChange={(e) => handleChange('reasonForImprovement', e.target.value)}
                disabled={isSubmitting}
                rows={4}
                maxLength={2000}
                placeholder="Explain how this suggestion would benefit the club and its members..."
                className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                  validationErrors.reasonForImprovement ? 'border-red-500' : ''
                }`}
              />
              {validationErrors.reasonForImprovement && (
                <p className="mt-1 text-sm text-red-600">
                  {validationErrors.reasonForImprovement}
                </p>
              )}
              <p className="mt-1 text-sm text-gray-500">
                {formData.reasonForImprovement.length}/2000 characters
              </p>
            </div>

            {/* Info box */}
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> Once submitted, you won't be able to edit your suggestion.
                The committee will review it and may contact you for more information if needed.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
