// app/sweeping-rota/page.tsx
// Sweeping Rota page - self-service sign-up for sweeping duties
// Members can add themselves to available days via calendar or pattern

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { MonthCalendar } from '@/components/sweeping-rota/MonthCalendar';
import { PatternEntryModal } from '@/components/sweeping-rota/PatternEntryModal';
import { ConfirmAddModal } from '@/components/sweeping-rota/ConfirmAddModal';
import { PrintRangeModal } from '@/components/sweeping-rota/PrintRangeModal';
import { PrintableCalendar } from '@/components/sweeping-rota/PrintableCalendar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SweepingRotaEntry, CalendarDay, DayStatus, PatternAction } from '@/lib/types/sweeping';
import { formatDate, parseDate } from '@/lib/sweeping-patterns';

interface MemberLookup {
  [userName: string]: string; // userName -> fullName
}

interface MemberOption {
  userName: string;
  fullName: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function SweepingRotaPage() {
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';

  // Current view state
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());

  // Data state
  const [entries, setEntries] = useState<SweepingRotaEntry[]>([]);
  const [memberLookup, setMemberLookup] = useState<MemberLookup>({});
  const [membersList, setMembersList] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  // Modal state
  const [patternModalOpen, setPatternModalOpen] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState<string | null>(null);
  const [cancelUserName, setCancelUserName] = useState<string | null>(null);

  // Loading states
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Print state
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [printData, setPrintData] = useState<{
    months: { year: number; month: number }[];
    entries: SweepingRotaEntry[];
  } | null>(null);

  // User info
  const currentUser = session?.user?.userName || '';
  const userRole = session?.user?.role || '';
  const isNonMember = userRole !== 'Member' && userRole !== '';
  const isKiosk = userRole === 'Kiosk';
  const isSweepingAdmin = userRole === 'superadmin' ||
    userRole.split(',').map(r => r.trim()).some(r => r === 'Admin' || r === 'SweepingAdmin');
  // Guests can view but cannot add/remove sweeping assignments; kiosk has full control
  const isReadOnly = isGuest;

  // Fetch members lookup
  const fetchMembers = useCallback(async () => {
    try {
      const response = await fetch('/api/members/lookup');
      const data = await response.json();
      if (data.members) {
        const lookup: MemberLookup = {};
        const list: MemberOption[] = [];
        data.members.forEach((m: { userName: string; fullName: string }) => {
          lookup[m.userName] = m.fullName;
          list.push({ userName: m.userName, fullName: m.fullName });
        });
        setMemberLookup(lookup);
        // Sort by fullName and put current user first
        list.sort((a, b) => {
          if (a.userName === currentUser) return -1;
          if (b.userName === currentUser) return 1;
          return a.fullName.localeCompare(b.fullName);
        });
        setMembersList(list);
      }
    } catch (err) {
      console.error('Failed to fetch members:', err);
    }
  }, [currentUser]);

  // Fetch sweeping rota entries for current month
  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const firstDay = new Date(currentYear, currentMonth, 1);
      const lastDay = new Date(currentYear, currentMonth + 1, 0);

      const startDate = formatDate(firstDay);
      const endDate = formatDate(lastDay);

      const response = await fetch(
        `/api/sweeping-rota?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch sweeping rota');
      }

      const data = await response.json();
      setEntries(data.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [currentYear, currentMonth]);

  // Initial load
  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Fetch entries when month changes
  useEffect(() => {
    fetchEntries();
    setSelectedDates(new Set()); // Clear selection when month changes
  }, [fetchEntries]);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Navigate months
  const goToPreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  // Build calendar days for current month
  const buildCalendarDays = (): CalendarDay[] => {
    const days: CalendarDay[] = [];
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Create lookup for entries by date
    const entryMap = new Map<string, SweepingRotaEntry>();
    entries.forEach(entry => {
      entryMap.set(entry.date, entry);
    });

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth, day);
      const dateString = formatDate(date);
      const entry = entryMap.get(dateString);

      let status: DayStatus = 'available';
      let userName: string | undefined;
      let displayName: string | undefined;

      if (date < today) {
        status = 'past';
        if (entry?.userName) {
          userName = entry.userName;
          displayName = memberLookup[entry.userName] || entry.userName;
        }
      } else if (entry) {
        if (entry.isBlocked) {
          status = 'blocked';
        } else if (entry.userName) {
          userName = entry.userName;
          displayName = memberLookup[entry.userName] || entry.userName;
          status = entry.userName === currentUser ? 'own' : 'assigned';
        }
      }

      days.push({
        date,
        dateString,
        status,
        userName,
        displayName,
      });
    }

    return days;
  };

  // Handle day click
  const handleDayClick = (day: CalendarDay) => {
    if ((day.status === 'own' || day.status === 'assigned') && isNonMember) {
      // Non-members toggle allocated days into the multi-select for bulk clearing
      const newSelected = new Set(selectedDates);
      if (newSelected.has(day.dateString)) {
        newSelected.delete(day.dateString);
      } else {
        newSelected.add(day.dateString);
      }
      setSelectedDates(newSelected);
    } else if (day.status === 'own') {
      // Members cancel their own assignment via single-day dialog
      setCancelDate(day.dateString);
      setCancelUserName(day.userName || null);
      setConfirmCancelOpen(true);
    } else if (day.status === 'available') {
      // Toggle selection
      const newSelected = new Set(selectedDates);
      if (newSelected.has(day.dateString)) {
        newSelected.delete(day.dateString);
      } else {
        newSelected.add(day.dateString);
      }
      setSelectedDates(newSelected);
    }
  };

  // Confirm add selected dates
  const handleConfirmAdd = async (userName?: string) => {
    if (selectedDates.size === 0) return;

    try {
      setSubmitting(true);
      const dates = Array.from(selectedDates);

      const body: { dates: string[]; userName?: string } = { dates };
      if (isNonMember && userName) {
        body.userName = userName;
      }

      const response = await fetch('/api/sweeping-rota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add dates');
      }

      setSuccessMessage(`Added ${data.addedCount} date${data.addedCount !== 1 ? 's' : ''}`);
      setSelectedDates(new Set());
      setConfirmModalOpen(false);
      fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add dates');
    } finally {
      setSubmitting(false);
    }
  };

  // Clear individually selected dates (remove assignments/blocks)
  const handleClearSelected = async () => {
    if (selectedDates.size === 0) return;

    try {
      setSubmitting(true);
      const response = await fetch('/api/sweeping-rota/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: Array.from(selectedDates) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to clear dates');
      setSuccessMessage(`Cleared ${data.clearedCount} date${data.clearedCount !== 1 ? 's' : ''}`);
      setSelectedDates(new Set());
      fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear dates');
    } finally {
      setSubmitting(false);
    }
  };

  // Block individually selected dates
  const handleBlockSelected = async () => {
    if (selectedDates.size === 0) return;
    if (!confirm(`Block ${selectedDates.size} date${selectedDates.size !== 1 ? 's' : ''}? These will be marked as unavailable.`)) return;

    try {
      setSubmitting(true);
      const response = await fetch('/api/sweeping-rota/blocked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: Array.from(selectedDates) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to block dates');
      setSuccessMessage(`Blocked ${data.blockedCount} date${data.blockedCount !== 1 ? 's' : ''}`);
      setSelectedDates(new Set());
      fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to block dates');
    } finally {
      setSubmitting(false);
    }
  };

  // Confirm add with pattern
  const handlePatternConfirm = async (
    dates: string[],
    action: PatternAction,
    userName?: string
  ): Promise<{ addedCount: number; skippedCount: number }> => {
    let endpoint = '/api/sweeping-rota';
    const body: { dates: string[]; userName?: string } = { dates };

    if (action === 'block') {
      endpoint = '/api/sweeping-rota/blocked';
    } else if (action === 'clear') {
      endpoint = '/api/sweeping-rota/clear';
    } else if (action === 'assign' && userName) {
      body.userName = userName;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || 'Failed to process pattern');
      throw new Error(data.error || 'Failed to process pattern');
    }

    fetchEntries();

    // Return appropriate counts based on action
    if (action === 'block') {
      return { addedCount: data.blockedCount || 0, skippedCount: data.skippedCount || 0 };
    } else if (action === 'clear') {
      return { addedCount: data.clearedCount || 0, skippedCount: data.skippedCount || 0 };
    }
    return { addedCount: data.addedCount || 0, skippedCount: data.skippedCount || 0 };
  };

  // Cancel assignment
  const handleCancelAssignment = async () => {
    if (!cancelDate) return;

    try {
      setSubmitting(true);

      const response = await fetch(`/api/sweeping-rota/${encodeURIComponent(cancelDate)}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel assignment');
      }

      setSuccessMessage('Assignment cancelled');
      setCancelDate(null);
      setCancelUserName(null);
      setConfirmCancelOpen(false);
      fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setSubmitting(false);
    }
  };

  // Print handler - open modal to select range
  const handlePrint = () => {
    setPrintModalOpen(true);
  };

  // Handle print range confirmation
  const handlePrintConfirm = async (fromMonth: string, toMonth: string) => {
    try {
      setPrintLoading(true);

      // Parse month strings (YYYY-MM format)
      const [fromYear, fromMonthNum] = fromMonth.split('-').map(Number);
      const [toYear, toMonthNum] = toMonth.split('-').map(Number);

      // Build list of months to include
      const months: { year: number; month: number }[] = [];
      let iterYear = fromYear;
      let iterMonth = fromMonthNum - 1; // 0-indexed

      while (
        iterYear < toYear ||
        (iterYear === toYear && iterMonth <= toMonthNum - 1)
      ) {
        months.push({ year: iterYear, month: iterMonth });

        iterMonth++;
        if (iterMonth > 11) {
          iterMonth = 0;
          iterYear++;
        }
      }

      // Fetch entries for the full range
      const startDate = formatDate(new Date(fromYear, fromMonthNum - 1, 1));
      const endDate = formatDate(new Date(toYear, toMonthNum, 0)); // Last day of toMonth

      const response = await fetch(
        `/api/sweeping-rota?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch sweeping rota for print');
      }

      const data = await response.json();

      // Close modal and show printable view
      setPrintModalOpen(false);
      setPrintData({
        months,
        entries: data.entries || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load print data');
    } finally {
      setPrintLoading(false);
    }
  };

  // Close printable view
  const handleClosePrint = () => {
    setPrintData(null);
  };

  const calendarDays = buildCalendarDays();

  // Get display name for cancel dialog
  const getCancelDisplayName = () => {
    if (!cancelUserName) return '';
    return memberLookup[cancelUserName] || cancelUserName;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name || ''}
        userRole={session?.user?.role || ''}
        showLogoOnly={isGuest}
      />

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Sweeping Rota</h1>
          <p className="text-gray-600 mt-1">
            Tap on available days to sign up for sweeping duty
          </p>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-700"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Success display */}
        {successMessage && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
            {successMessage}
          </div>
        )}

        {/* Controls */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {/* Month navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={goToPreviousMonth}
              className="p-2 rounded-md hover:bg-gray-100"
              title="Previous month"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <h2 className="text-lg font-semibold text-gray-900 min-w-[160px] text-center">
              {MONTH_NAMES[currentMonth]} {currentYear}
            </h2>

            <button
              onClick={goToNextMonth}
              className="p-2 rounded-md hover:bg-gray-100"
              title="Next month"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <button
              onClick={goToToday}
              className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-md"
            >
              Today
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Print button */}
            <button
              onClick={handlePrint}
              className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md flex items-center gap-1"
              title="Print calendar"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span className="hidden sm:inline">Print</span>
            </button>

            {/* Pattern button (not in kiosk or guest) */}
            {!isReadOnly && (
              <button
                onClick={() => setPatternModalOpen(true)}
                className="px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md flex items-center gap-1"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 13v4m-2-2h4" />
                </svg>
                <span className="hidden sm:inline">Add Pattern</span>
              </button>
            )}
          </div>
        </div>

        {/* Calendar */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : (
          <div>
            <MonthCalendar
              year={currentYear}
              month={currentMonth}
              days={calendarDays}
              selectedDates={selectedDates}
              onDayClick={handleDayClick}
              isAdmin={isNonMember}
              adminMode={false}
              showLegend={!isReadOnly}
            />
          </div>
        )}

        {/* Selection actions */}
        {selectedDates.size > 0 && !isReadOnly && (
          <div className="mt-4 flex items-center justify-between p-4 bg-blue-50 rounded-lg">
            <span className="text-sm text-blue-800">
              {selectedDates.size} date{selectedDates.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedDates(new Set())}
                className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md"
              >
                Deselect All
              </button>
              <button
                onClick={handleClearSelected}
                disabled={submitting}
                className="px-4 py-2 text-sm text-white rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
              >
                Clear
              </button>
              {isSweepingAdmin && (
                <button
                  onClick={handleBlockSelected}
                  disabled={submitting}
                  className="px-4 py-2 text-sm text-white rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  Block Selected
                </button>
              )}
              <button
                onClick={() => setConfirmModalOpen(true)}
                className="px-4 py-2 text-sm text-white rounded-md bg-blue-600 hover:bg-blue-700"
              >
                Add Selected
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Print Modal */}
      <PrintRangeModal
        isOpen={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        onConfirm={handlePrintConfirm}
        isLoading={printLoading}
      />

      {/* Printable Calendar View */}
      {printData && (
        <PrintableCalendar
          months={printData.months}
          entries={printData.entries}
          memberLookup={memberLookup}
          onClose={handleClosePrint}
        />
      )}

      {/* Pattern Modal */}
      <PatternEntryModal
        isOpen={patternModalOpen}
        onClose={() => setPatternModalOpen(false)}
        onConfirm={handlePatternConfirm}
        isNonMember={isNonMember}
        canBlock={isSweepingAdmin}
        currentUserName={currentUser}
        members={membersList}
      />

      {/* Confirm Add Modal */}
      <ConfirmAddModal
        isOpen={confirmModalOpen}
        dates={Array.from(selectedDates)}
        onClose={() => setConfirmModalOpen(false)}
        onConfirm={handleConfirmAdd}
        isLoading={submitting}
        isNonMember={isNonMember}
        currentUserName={currentUser}
        members={membersList}
      />

      {/* Confirm Cancel Dialog */}
      <ConfirmDialog
        isOpen={confirmCancelOpen}
        title="Cancel Assignment"
        message={cancelUserName === currentUser
          ? `Remove yourself from ${cancelDate}?`
          : `Remove ${getCancelDisplayName()} from ${cancelDate}?`
        }
        confirmLabel="Yes, Cancel"
        confirmVariant="danger"
        onConfirm={handleCancelAssignment}
        onCancel={() => {
          setConfirmCancelOpen(false);
          setCancelDate(null);
          setCancelUserName(null);
        }}
      />
    </div>
  );
}
