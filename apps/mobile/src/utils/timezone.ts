/**
 * Timezone and Date Utility Module for StockFlow
 *
 * All dates and times are interpreted in the device's local timezone
 * and serialized to/from UTC ISO-8601 for backend persistence.
 */

/**
 * Returns YYYY-MM-DD string representing the local date of the given Date object.
 */
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Given a UTC ISO-8601 string, returns the calendar date in device-local timezone (YYYY-MM-DD).
 * Never splits naively on 'T' so midnight boundary crossings are respected.
 */
export function getTaskLocalDateString(isoString: string | null): string | null {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  return getLocalDateString(d);
}

/**
 * Parses time strings in either 12-hour (e.g. "5:48 PM", "9:00 AM", "12:30 pm")
 * or 24-hour (e.g. "17:48", "09:00") format with exact hour and minute.
 */
export function parseTimeString(timeStr: string): { hour: number; minute: number } {
  if (!timeStr || !timeStr.trim()) return { hour: 9, minute: 0 };
  const trimmed = timeStr.trim();
  const isPM = /pm$/i.test(trimmed);
  const isAM = /am$/i.test(trimmed);
  const numOnly = trimmed.replace(/[^\d:.]/g, '');

  let h = 9;
  let m = 0;

  const parts = numOnly.split(/[:.]/);
  if (parts.length >= 2) {
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
  } else if (parts.length === 1) {
    const single = parts[0];
    if (single.length === 4) {
      h = parseInt(single.slice(0, 2), 10);
      m = parseInt(single.slice(2), 10);
    } else if (single.length === 3) {
      h = parseInt(single.slice(0, 1), 10);
      m = parseInt(single.slice(1), 10);
    } else {
      h = parseInt(single, 10);
      m = 0;
    }
  }

  if (isNaN(h)) h = 9;
  if (isNaN(m)) m = 0;

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  return {
    hour: Math.min(23, Math.max(0, h)),
    minute: Math.min(59, Math.max(0, m)),
  };
}

/**
 * Parses a date string in YYYY-MM-DD or DD-MM-YYYY format into year, month (1-indexed), day.
 */
export function parseDateString(dateStr: string): { year: number; month: number; day: number } {
  const now = new Date();
  if (!dateStr || !dateStr.trim()) {
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }

  const parts = dateStr.trim().split(/[-/.]/).map(Number);
  if (parts.length === 3) {
    if (parts[0] > 1000) {
      // YYYY-MM-DD
      return { year: parts[0], month: parts[1], day: parts[2] };
    }
    if (parts[2] > 1000) {
      // DD-MM-YYYY
      return { year: parts[2], month: parts[1], day: parts[0] };
    }
  }

  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * Interprets the given date and time strings as device-local time and converts to UTC ISO-8601 string.
 */
export function buildScheduledIsoString(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;

  const { year, month, day } = parseDateString(dateStr);
  const { hour, minute } = parseTimeString(timeStr);

  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (isNaN(localDate.getTime())) return null;

  return localDate.toISOString();
}

/**
 * Formats a Date object in device-local 12-hour time (e.g. "5:48 PM").
 */
export function formatLocalTime(d: Date): string {
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}

/**
 * Formats a Date object in device-local 24-hour time (e.g. "17:48").
 */
export function formatTime24(d: Date): string {
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Returns scheduled display info in device-local timezone.
 */
export function formatScheduledDisplay(isoString: string | null): {
  label: string;
  timeLabel: string;
  isOverdue: boolean;
  isFuture: boolean;
  isToday: boolean;
} {
  if (!isoString) {
    return {
      label: 'No scheduled date',
      timeLabel: '',
      isOverdue: false,
      isFuture: false,
      isToday: false,
    };
  }

  const taskDate = new Date(isoString);
  if (isNaN(taskDate.getTime())) {
    return {
      label: 'Invalid date',
      timeLabel: '',
      isOverdue: false,
      isFuture: false,
      isToday: false,
    };
  }

  const now = new Date();
  const isOverdue = taskDate.getTime() < now.getTime();
  const isFuture = taskDate.getTime() > now.getTime();

  const isToday = taskDate.toDateString() === now.toDateString();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = taskDate.toDateString() === tomorrow.toDateString();

  const time12 = formatLocalTime(taskDate);

  if (isToday) {
    return {
      label: `Today at ${time12}`,
      timeLabel: time12,
      isOverdue,
      isFuture,
      isToday: true,
    };
  }

  if (isTomorrow) {
    return {
      label: `Tomorrow at ${time12}`,
      timeLabel: time12,
      isOverdue: false,
      isFuture: true,
      isToday: false,
    };
  }

  const dateStr = taskDate.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return {
    label: `${dateStr} · ${time12}`,
    timeLabel: time12,
    isOverdue,
    isFuture,
    isToday: false,
  };
}

/**
 * Checks whether a task is overdue (past scheduled time and not completed).
 */
export function isTaskOverdue(scheduledAt: string | null, isCompleted = false): boolean {
  if (isCompleted || !scheduledAt) return false;
  const d = new Date(scheduledAt);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

/**
 * Returns an 8-day window starting from baseDate:
 * [baseDate (Day 0), baseDate + 1, ..., baseDate + 7].
 */
export function getEightDayWindow(baseDate: Date = new Date()): Date[] {
  const result: Date[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + i);
    result.push(d);
  }
  return result;
}

/**
 * Returns an array of YYYY-MM-DD date strings between startStr and endStr inclusive.
 */
export function getDateRangeDays(startStr: string, endStr: string): string[] {
  const startDate = new Date(startStr + 'T00:00:00');
  const endDate = new Date(endStr + 'T00:00:00');
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return [startStr];

  const minDate = startDate <= endDate ? startDate : endDate;
  const maxDate = startDate <= endDate ? endDate : startDate;

  const dates: string[] = [];
  const current = new Date(minDate);

  // Safety cap at 60 days
  let count = 0;
  while (current <= maxDate && count < 60) {
    dates.push(getLocalDateString(current));
    current.setDate(current.getDate() + 1);
    count++;
  }
  return dates;
}

/**
 * Format date string into human-friendly representation, e.g. "Monday, Oct 12"
 */
export function formatFriendlyDate(dateStr: string): string {
  const { year, month, day } = parseDateString(dateStr);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
