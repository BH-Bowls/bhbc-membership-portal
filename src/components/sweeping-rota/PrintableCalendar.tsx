// src/components/sweeping-rota/PrintableCalendar.tsx
// Print-friendly calendar view for sweeping rota

'use client';

import { SweepingRotaEntry } from '@/lib/types/sweeping';
import { formatDate } from '@/lib/sweeping-patterns';

interface PrintableCalendarProps {
  months: { year: number; month: number }[];
  entries: SweepingRotaEntry[];
  memberLookup: { [userName: string]: string };
  onClose: () => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function PrintableCalendar({
  months,
  entries,
  memberLookup,
  onClose,
}: PrintableCalendarProps) {
  // Create entry lookup map
  const entryMap = new Map<string, SweepingRotaEntry>();
  entries.forEach(entry => {
    entryMap.set(entry.date, entry);
  });

  // Build calendar grid for a single month
  const buildMonthGrid = (year: number, month: number) => {
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const weeks: (number | null)[][] = [];
    let currentWeek: (number | null)[] = [];

    // Add empty cells for days before the 1st
    for (let i = 0; i < firstDayOfMonth; i++) {
      currentWeek.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      currentWeek.push(day);

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }

    // Fill remaining cells in the last week
    while (currentWeek.length < 7 && currentWeek.length > 0) {
      currentWeek.push(null);
    }
    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return weeks;
  };

  // Truncate name to max characters for print
  const truncateName = (name: string, maxLength: number = 18): string => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength);
  };

  // Get display info for a day
  const getDayInfo = (year: number, month: number, day: number) => {
    const date = new Date(year, month, day);
    const dateString = formatDate(date);
    const entry = entryMap.get(dateString);

    if (entry) {
      if (entry.isBlocked) {
        return { status: 'blocked', label: 'Maint' };
      }
      if (entry.userName) {
        const displayName = memberLookup[entry.userName] || entry.userName;
        return { status: 'assigned', label: truncateName(displayName) };
      }
    }

    return { status: 'available', label: '' };
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-auto print:static print:overflow-visible">
      {/* Screen-only header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between print:hidden">
        <h2 className="text-lg font-semibold text-gray-900">Print Preview</h2>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
        </div>
      </div>

      {/* Printable content */}
      <div className="p-4 print:p-0">
        {/* Title */}
        <h1 className="text-2xl font-bold text-center mb-4 print:text-xl print:mb-2">
          Sweeping Rota
        </h1>

        {/* Legend */}
        <div className="flex justify-center gap-4 text-xs mb-4 print:mb-2">
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 border border-gray-300 bg-white print-color"></div>
            <span>Available</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-green-200 border border-green-400 print-color"></div>
            <span>Assigned</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-gray-300 border border-gray-400 print-color"></div>
            <span>Maintenance</span>
          </div>
        </div>

        {/* Calendars */}
        <div className="space-y-6 print:space-y-4">
          {months.map(({ year, month }) => {
            const weeks = buildMonthGrid(year, month);

            return (
              <div key={`${year}-${month}`} className="break-inside-avoid">
                {/* Month header */}
                <h2 className="text-lg font-semibold text-center mb-2 print:text-base print:mb-1">
                  {MONTH_NAMES[month]} {year}
                </h2>

                {/* Calendar grid */}
                <table className="w-full border-collapse border border-gray-400 text-sm print:text-xs">
                  <thead>
                    <tr>
                      {DAY_NAMES.map(dayName => (
                        <th
                          key={dayName}
                          className="border border-gray-400 bg-gray-100 py-1 px-1 text-center font-medium w-[14.28%]"
                        >
                          {dayName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((week, weekIndex) => (
                      <tr key={weekIndex}>
                        {week.map((day, dayIndex) => {
                          if (day === null) {
                            return (
                              <td
                                key={dayIndex}
                                className="border border-gray-400 bg-gray-50 h-12 print:h-10"
                              />
                            );
                          }

                          const info = getDayInfo(year, month, day);
                          let bgClass = 'bg-white';
                          if (info.status === 'blocked') {
                            bgClass = 'bg-gray-300';
                          } else if (info.status === 'assigned') {
                            bgClass = 'bg-green-200';
                          }

                          return (
                            <td
                              key={dayIndex}
                              className={`border border-gray-400 h-12 print:h-10 align-top p-1 print-color ${bgClass}`}
                            >
                              <div className="font-medium">{day}</div>
                              {info.label && (
                                <div className="text-[10px] print:text-[8px] break-words leading-tight">
                                  {info.label}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>

      {/* Print-specific styles */}
      <style jsx global>{`
        .print-color {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        @media print {
          body * {
            visibility: hidden;
          }
          .fixed.inset-0.z-50,
          .fixed.inset-0.z-50 * {
            visibility: visible;
          }
          .fixed.inset-0.z-50 {
            position: absolute;
            inset: 0;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print-color {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .bg-green-200 {
            background-color: #bbf7d0 !important;
          }
          .bg-gray-300 {
            background-color: #d1d5db !important;
          }
          .bg-gray-50 {
            background-color: #f9fafb !important;
          }
          .bg-gray-100 {
            background-color: #f3f4f6 !important;
          }
          @page {
            size: A4 portrait;
            margin: 1cm;
          }
        }
      `}</style>
    </div>
  );
}
