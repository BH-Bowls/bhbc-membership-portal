// src/components/sweeping-rota/PatternEntryModal.tsx
// Modal for selecting a recurring pattern for sweeping rota entries

'use client';

import { useState, useEffect } from 'react';
import { PatternType, DayOfWeek, PatternConfig, PatternAction } from '@/lib/types/sweeping';
import { getPatternDisplayName, getDayName, generatePatternDates } from '@/lib/sweeping-patterns';
import { SearchableSelect } from '@/components/SearchableSelect';

interface PatternResult {
  addedCount: number;
  skippedCount: number;
}

interface MemberOption {
  userName: string;
  fullName: string;
}

interface PatternEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (dates: string[], action: PatternAction, userName?: string) => Promise<PatternResult>;
  isNonMember: boolean;
  currentUserName: string;
  members?: MemberOption[];
}

const PATTERN_TYPES: PatternType[] = [
  'every',
  'first',
  'second',
  'third',
  'fourth',
  'last',
  'first_and_third',
  'second_and_fourth',
];

const DAYS_OF_WEEK: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

// Generate month options for the next 12 months
function getMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    const label = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    options.push({ value, label });
  }

  return options;
}

export function PatternEntryModal({
  isOpen,
  onClose,
  onConfirm,
  isNonMember,
  currentUserName,
  members = [],
}: PatternEntryModalProps) {
  const [action, setAction] = useState<PatternAction>('assign');
  const [selectedUserName, setSelectedUserName] = useState(currentUserName);
  const [patternType, setPatternType] = useState<PatternType | ''>('');
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeek | ''>('');
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [previewDates, setPreviewDates] = useState<string[]>([]);
  const [removedDates, setRemovedDates] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const monthOptions = getMonthOptions();

  // Initialize on open
  useEffect(() => {
    if (isOpen) {
      // Reset form state
      setAction('assign');
      setSelectedUserName(currentUserName);
      setPatternType('');
      setDayOfWeek('');
      setFromMonth(monthOptions[0]?.value || '');
      setToMonth(monthOptions[2]?.value || ''); // Default to 3 months ahead
      setPreviewDates([]);
      setRemovedDates(new Set());
      setSuccessMessage(null);
    }
  }, [isOpen, currentUserName]);

  // Generate preview dates when config changes
  useEffect(() => {
    if (patternType && dayOfWeek !== '' && fromMonth && toMonth) {
      // Convert month values to start/end dates
      const [fromYear, fromMonthNum] = fromMonth.split('-').map(Number);
      const [toYear, toMonthNum] = toMonth.split('-').map(Number);

      const startDate = new Date(fromYear, fromMonthNum - 1, 1);
      const endDate = new Date(toYear, toMonthNum, 0); // Last day of toMonth

      const formatDate = (date: Date): string => {
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
      };

      const config: PatternConfig = {
        patternType: patternType as PatternType,
        dayOfWeek: dayOfWeek as DayOfWeek,
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
      };

      const dates = generatePatternDates(config);
      setPreviewDates(dates);
      setRemovedDates(new Set()); // reset exclusions when pattern changes
    } else {
      setPreviewDates([]);
      setRemovedDates(new Set());
    }
  }, [patternType, dayOfWeek, fromMonth, toMonth]);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isSubmitting, onClose]);

  const finalDates = previewDates.filter(d => !removedDates.has(d));
  const canSubmit = patternType !== '' && dayOfWeek !== '' && finalDates.length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);

    try {
      const result = await onConfirm(
        finalDates,
        action,
        action === 'assign' ? selectedUserName : undefined
      );
      // Success - reset form for another entry
      setPatternType('');
      setDayOfWeek('');
      setPreviewDates([]);

      // Show appropriate message based on action and result
      const actionVerb = action === 'assign' ? 'Added' : action === 'block' ? 'Blocked' : 'Cleared';
      const actionVerbPast = action === 'assign' ? 'taken' : action === 'block' ? 'blocked' : 'already clear';

      if (result.addedCount === 0 && result.skippedCount > 0) {
        setSuccessMessage(`All ${result.skippedCount} date${result.skippedCount !== 1 ? 's were' : ' was'} ${actionVerbPast}`);
      } else if (result.skippedCount > 0) {
        setSuccessMessage(`${actionVerb} ${result.addedCount}, skipped ${result.skippedCount}`);
      } else {
        setSuccessMessage(`${actionVerb} ${result.addedCount} date${result.addedCount !== 1 ? 's' : ''}`);
      }
    } catch (error) {
      // Error handling is done in parent
    } finally {
      setIsSubmitting(false);
    }
  };

  const getButtonText = () => {
    if (isSubmitting) {
      return action === 'assign' ? 'Adding...' : action === 'block' ? 'Blocking...' : 'Clearing...';
    }
    return action === 'assign' ? 'Add Dates' : action === 'block' ? 'Block Dates' : 'Clear Dates';
  };

  const getButtonClass = () => {
    if (action === 'block') return 'bg-gray-600 hover:bg-gray-700';
    if (action === 'clear') return 'bg-red-600 hover:bg-red-700';
    return 'bg-blue-600 hover:bg-blue-700';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Add Pattern</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 flex-1 overflow-y-auto space-y-4">
          {/* Success message */}
          {successMessage && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
              {successMessage}
            </div>
          )}

          {/* Action Type (non-members only) */}
          {isNonMember && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Action
              </label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as PatternAction)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="assign">Assign Member</option>
                <option value="block">Block Days</option>
                <option value="clear">Clear Days</option>
              </select>
            </div>
          )}

          {/* Member Selection (non-members only, when action is assign) */}
          {isNonMember && action === 'assign' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Member
              </label>
              <SearchableSelect
                options={members.map(m => ({ value: m.userName, label: m.fullName }))}
                value={selectedUserName}
                onChange={setSelectedUserName}
                placeholder="Type to search..."
                disabled={isSubmitting}
              />
            </div>
          )}

          {/* Pattern Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pattern
            </label>
            <select
              value={patternType}
              onChange={(e) => setPatternType(e.target.value as PatternType | '')}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">Select</option>
              {PATTERN_TYPES.map(type => (
                <option key={type} value={type}>
                  {getPatternDisplayName(type)}
                </option>
              ))}
            </select>
          </div>

          {/* Day of Week */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Day of Week
            </label>
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(e.target.value === '' ? '' : Number(e.target.value) as DayOfWeek)}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">Select</option>
              {DAYS_OF_WEEK.map(day => (
                <option key={day} value={day}>
                  {getDayName(day)}
                </option>
              ))}
            </select>
          </div>

          {/* Month Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                From Month
              </label>
              <select
                value={fromMonth}
                onChange={(e) => setFromMonth(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                {monthOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To Month
              </label>
              <select
                value={toMonth}
                onChange={(e) => setToMonth(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                {monthOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Pattern Description */}
          {patternType && dayOfWeek !== '' && (
            <div className="p-3 bg-blue-50 rounded-md">
              <p className="text-sm text-blue-800">
                <span className="font-medium">{getPatternDisplayName(patternType as PatternType)} {getDayName(dayOfWeek as DayOfWeek)}</span>
                {patternType !== 'every' && ' of each month'}
              </p>
            </div>
          )}

          {/* Preview */}
          {previewDates.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Preview ({finalDates.length} date{finalDates.length !== 1 ? 's' : ''}
                {removedDates.size > 0 && (
                  <span className="text-gray-400 font-normal"> — {removedDates.size} removed</span>
                )}
                )
              </label>
              <p className="text-xs text-gray-500 mb-2">Tap × to remove a date before confirming.</p>
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md p-2">
                <div className="flex flex-wrap gap-1.5">
                  {previewDates.map((date, index) => {
                    const removed = removedDates.has(date);
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          const next = new Set(removedDates);
                          if (removed) next.delete(date);
                          else next.add(date);
                          setRemovedDates(next);
                        }}
                        disabled={isSubmitting}
                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                          removed
                            ? 'bg-gray-100 text-gray-400 line-through'
                            : 'bg-blue-50 text-blue-700 hover:bg-red-50 hover:text-red-600'
                        }`}
                        title={removed ? 'Click to restore' : 'Click to remove'}
                      >
                        {date}
                        {!removed && (
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Close
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md flex items-center gap-2 ${getButtonClass()} disabled:bg-gray-400 disabled:cursor-not-allowed`}
          >
            {isSubmitting && (
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {getButtonText()}
          </button>
        </div>
      </div>
    </div>
  );
}
