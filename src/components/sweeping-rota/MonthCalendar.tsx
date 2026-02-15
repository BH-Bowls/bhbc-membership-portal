// src/components/sweeping-rota/MonthCalendar.tsx
// Calendar grid component for sweeping rota

'use client';

import { CalendarDay, DayStatus } from '@/lib/types/sweeping';

interface MonthCalendarProps {
  year: number;
  month: number; // 0-indexed
  days: CalendarDay[];
  selectedDates: Set<string>;
  onDayClick: (day: CalendarDay) => void;
  isAdmin?: boolean;
  adminMode?: boolean;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function MonthCalendar({
  year,
  month,
  days,
  selectedDates,
  onDayClick,
  isAdmin = false,
  adminMode = false,
}: MonthCalendarProps) {
  // Get first day of month and total days
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Create lookup map for quick access
  const dayMap = new Map<number, CalendarDay>();
  days.forEach(day => {
    dayMap.set(day.date.getDate(), day);
  });

  // Generate calendar grid
  const weeks: (CalendarDay | null)[][] = [];
  let currentWeek: (CalendarDay | null)[] = [];

  // Add empty cells for days before the 1st
  for (let i = 0; i < firstDayOfMonth; i++) {
    currentWeek.push(null);
  }

  // Add days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    const calendarDay = dayMap.get(day);
    currentWeek.push(calendarDay || null);

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

  const getDayClasses = (day: CalendarDay | null): string => {
    if (!day) {
      return 'bg-gray-50';
    }

    const isSelected = selectedDates.has(day.dateString);
    const baseClasses = 'min-h-[60px] md:min-h-[80px] p-1 md:p-2 transition-all cursor-pointer touch-manipulation';

    // Status-based styling
    switch (day.status) {
      case 'past':
        return `${baseClasses} bg-gray-100 text-gray-400 cursor-not-allowed`;

      case 'blocked':
        return `${baseClasses} bg-gray-300 text-gray-600 ${adminMode ? 'cursor-pointer hover:bg-gray-400' : 'cursor-not-allowed'}`;

      case 'assigned':
        return `${baseClasses} bg-green-100 text-green-800 ${isAdmin ? 'hover:bg-green-200' : 'cursor-default'}`;

      case 'own':
        return `${baseClasses} bg-green-200 text-green-900 border-2 border-green-500 hover:bg-green-300`;

      case 'available':
        if (isSelected) {
          return `${baseClasses} bg-blue-100 border-2 border-blue-500 hover:bg-blue-200`;
        }
        return `${baseClasses} bg-white hover:bg-blue-50 border border-gray-200`;

      default:
        return `${baseClasses} bg-white`;
    }
  };

  const canInteract = (day: CalendarDay | null): boolean => {
    if (!day) return false;
    if (day.status === 'past') return false;
    if (day.status === 'blocked' && adminMode) return true;
    if (day.status === 'blocked') return false;
    if (day.status === 'assigned' && !isAdmin) return false;
    return true;
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 bg-gray-100 border-b border-gray-200">
        {DAY_NAMES.map(dayName => (
          <div
            key={dayName}
            className="py-2 text-center text-xs md:text-sm font-medium text-gray-600"
          >
            {dayName}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {weeks.map((week, weekIndex) => (
          week.map((day, dayIndex) => (
            <div
              key={`${weekIndex}-${dayIndex}`}
              className={getDayClasses(day)}
              onClick={() => {
                if (day && canInteract(day)) {
                  onDayClick(day);
                }
              }}
            >
              {day && (
                <>
                  {/* Date number */}
                  <div className="text-xs md:text-sm font-medium mb-1">
                    {day.date.getDate()}
                  </div>

                  {/* Status indicator */}
                  {day.status === 'blocked' && (
                    <div className="text-[10px] md:text-xs text-gray-600 truncate">
                      Maintenance
                    </div>
                  )}

                  {(day.status === 'assigned' || day.status === 'own' || (day.status === 'past' && day.displayName)) && day.displayName && (
                    <div className="text-[10px] md:text-xs break-words leading-tight" title={day.displayName}>
                      {day.displayName}
                    </div>
                  )}

                  {/* Selection indicator */}
                  {selectedDates.has(day.dateString) && day.status === 'available' && (
                    <div className="absolute top-1 right-1">
                      <svg className="h-4 w-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        ))}
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-white border border-gray-200 rounded"></div>
            <span>Available</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-green-100 rounded"></div>
            <span>Assigned</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-green-200 border-2 border-green-500 rounded"></div>
            <span>Your day</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-gray-300 rounded"></div>
            <span>Maintenance</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-blue-100 border-2 border-blue-500 rounded"></div>
            <span>Selected</span>
          </div>
        </div>
      </div>
    </div>
  );
}
