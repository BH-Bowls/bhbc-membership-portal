// src/lib/sweeping-patterns.ts
// Pattern date generation logic for sweeping rota

import { PatternConfig, PatternType, DayOfWeek } from './types/sweeping';

/**
 * Parse DD/MM/YYYY string to Date object
 */
export function parseDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split('/').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format Date object to DD/MM/YYYY string
 */
export function formatDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Get all dates matching a day of week in a month
 * @param year Full year (e.g., 2024)
 * @param month 0-indexed month (0 = January)
 * @param dayOfWeek 0-indexed day (0 = Sunday)
 * @returns Array of Date objects
 */
function getDaysOfWeekInMonth(year: number, month: number, dayOfWeek: DayOfWeek): Date[] {
  const dates: Date[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Find first occurrence of the day of week
  let current = new Date(firstDay);
  while (current.getDay() !== dayOfWeek) {
    current.setDate(current.getDate() + 1);
  }

  // Collect all occurrences
  while (current <= lastDay) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }

  return dates;
}

/**
 * Get the Nth occurrence of a day of week in a month
 * @param year Full year
 * @param month 0-indexed month
 * @param dayOfWeek 0-indexed day
 * @param n Which occurrence (1 = first, 2 = second, etc.)
 * @returns Date or null if doesn't exist
 */
function getNthDayOfWeekInMonth(
  year: number,
  month: number,
  dayOfWeek: DayOfWeek,
  n: number
): Date | null {
  const days = getDaysOfWeekInMonth(year, month, dayOfWeek);
  return days[n - 1] || null;
}

/**
 * Get the last occurrence of a day of week in a month
 */
function getLastDayOfWeekInMonth(
  year: number,
  month: number,
  dayOfWeek: DayOfWeek
): Date | null {
  const days = getDaysOfWeekInMonth(year, month, dayOfWeek);
  return days[days.length - 1] || null;
}

/**
 * Generate dates based on pattern configuration
 * @param config Pattern configuration
 * @returns Array of DD/MM/YYYY date strings
 */
export function generatePatternDates(config: PatternConfig): string[] {
  const startDate = parseDate(config.startDate);
  const endDate = parseDate(config.endDate);
  const dates: string[] = [];

  // Validate date range
  if (startDate > endDate) {
    return [];
  }

  // Iterate through months in range
  let currentYear = startDate.getFullYear();
  let currentMonth = startDate.getMonth();
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth();

  while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
    let matchingDates: (Date | null)[] = [];

    switch (config.patternType) {
      case 'every':
        matchingDates = getDaysOfWeekInMonth(currentYear, currentMonth, config.dayOfWeek);
        break;

      case 'first':
        matchingDates = [getNthDayOfWeekInMonth(currentYear, currentMonth, config.dayOfWeek, 1)];
        break;

      case 'second':
        matchingDates = [getNthDayOfWeekInMonth(currentYear, currentMonth, config.dayOfWeek, 2)];
        break;

      case 'third':
        matchingDates = [getNthDayOfWeekInMonth(currentYear, currentMonth, config.dayOfWeek, 3)];
        break;

      case 'fourth':
        matchingDates = [getNthDayOfWeekInMonth(currentYear, currentMonth, config.dayOfWeek, 4)];
        break;

      case 'last':
        matchingDates = [getLastDayOfWeekInMonth(currentYear, currentMonth, config.dayOfWeek)];
        break;

      case 'first_and_third':
        matchingDates = [
          getNthDayOfWeekInMonth(currentYear, currentMonth, config.dayOfWeek, 1),
          getNthDayOfWeekInMonth(currentYear, currentMonth, config.dayOfWeek, 3),
        ];
        break;

      case 'second_and_fourth':
        matchingDates = [
          getNthDayOfWeekInMonth(currentYear, currentMonth, config.dayOfWeek, 2),
          getNthDayOfWeekInMonth(currentYear, currentMonth, config.dayOfWeek, 4),
        ];
        break;
    }

    // Filter and add valid dates within range
    for (const date of matchingDates) {
      if (date && date >= startDate && date <= endDate) {
        dates.push(formatDate(date));
      }
    }

    // Move to next month
    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
  }

  return dates;
}

/**
 * Get the display name for a pattern type
 */
export function getPatternDisplayName(patternType: PatternType): string {
  const names: Record<PatternType, string> = {
    every: 'Every',
    first: 'First',
    second: 'Second',
    third: 'Third',
    fourth: 'Fourth',
    last: 'Last',
    first_and_third: 'First and third',
    second_and_fourth: 'Second and fourth',
  };
  return names[patternType];
}

/**
 * Get the display name for a day of week
 */
export function getDayName(dayOfWeek: DayOfWeek): string {
  const names: Record<DayOfWeek, string> = {
    0: 'Sunday',
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday',
  };
  return names[dayOfWeek];
}
