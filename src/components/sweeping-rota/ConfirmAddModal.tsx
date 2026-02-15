// src/components/sweeping-rota/ConfirmAddModal.tsx
// Confirmation modal for adding multiple sweeping dates

'use client';

import { useEffect, useState } from 'react';
import { SearchableSelect } from '@/components/SearchableSelect';

interface MemberOption {
  userName: string;
  fullName: string;
}

interface ConfirmAddModalProps {
  isOpen: boolean;
  dates: string[];
  onClose: () => void;
  onConfirm: (userName?: string) => void;
  isLoading?: boolean;
  isNonMember?: boolean;
  currentUserName?: string;
  members?: MemberOption[];
}

export function ConfirmAddModal({
  isOpen,
  dates,
  onClose,
  onConfirm,
  isLoading = false,
  isNonMember = false,
  currentUserName = '',
  members = [],
}: ConfirmAddModalProps) {
  const [selectedUserName, setSelectedUserName] = useState(currentUserName);

  // Reset selected user when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedUserName(currentUserName);
    }
  }, [isOpen, currentUserName]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isLoading, onClose]);

  // Prevent body scroll when dialog is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Sort dates chronologically
  const sortedDates = [...dates].sort((a, b) => {
    const [dayA, monthA, yearA] = a.split('/').map(Number);
    const [dayB, monthB, yearB] = b.split('/').map(Number);
    const dateA = new Date(yearA, monthA - 1, dayA);
    const dateB = new Date(yearB, monthB - 1, dayB);
    return dateA.getTime() - dateB.getTime();
  });

  // Format date for display (e.g., "Sat 15 Feb")
  const formatDisplayDate = (dateStr: string): string => {
    const [day, month, year] = dateStr.split('/').map(Number);
    const date = new Date(year, month - 1, day);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${dayNames[date.getDay()]} ${day} ${monthNames[month - 1]}`;
  };

  const handleConfirm = () => {
    onConfirm(isNonMember ? selectedUserName : undefined);
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={() => !isLoading && onClose()}
        aria-hidden="true"
      />

      {/* Dialog container */}
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Dialog panel */}
        <div
          className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6 transform transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Icon */}
          <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-blue-100">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>

          {/* Title */}
          <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
            Confirm Add Dates
          </h3>

          {/* Message */}
          <p className="text-sm text-gray-600 text-center mb-4">
            Add {sortedDates.length} date{sortedDates.length !== 1 ? 's' : ''}?
          </p>

          {/* Member Selection (non-members only) */}
          {isNonMember && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assign to
              </label>
              <SearchableSelect
                options={members.map(m => ({ value: m.userName, label: m.fullName }))}
                value={selectedUserName}
                onChange={setSelectedUserName}
                placeholder="Type to search..."
                disabled={isLoading}
              />
            </div>
          )}

          {/* Date list */}
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md p-3 mb-6">
            <div className="flex flex-wrap gap-2">
              {sortedDates.map((date, index) => (
                <span
                  key={index}
                  className="px-3 py-1 text-sm rounded-full bg-blue-100 text-blue-800"
                >
                  {formatDisplayDate(date)}
                </span>
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="inline-flex justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isLoading}
              className="inline-flex justify-center items-center px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors disabled:opacity-50 bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
            >
              {isLoading && (
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
