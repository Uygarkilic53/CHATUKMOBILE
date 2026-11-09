/**
 * Utility functions for WhatsApp-style Message Info formatting.
 * Safe across Hermes, JSC, and Web without relying on crash-prone Intl locale options.
 */

const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAYS_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

/**
 * Safely parse any date value (ISO string, unix ms, Date object) into a Date.
 * Returns null if invalid.
 */
export function parseSafeDate(value?: string | number | Date | null): Date | null {
  if (value === undefined || value === null || value === '') return null;
  try {
    let d: Date;
    if (value instanceof Date) {
      d = value;
    } else if (typeof value === 'number') {
      d = new Date(value);
    } else {
      // String parsing
      const num = Number(value);
      if (!isNaN(num) && String(num) === String(value).trim()) {
        d = new Date(num);
      } else {
        d = new Date(value);
      }
    }
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Formats full human-readable date.
 * Examples: "Today", "Yesterday", "Friday, 6 November 2026", or "6 November 2026"
 */
export function formatInfoDate(value?: string | number | Date | null, includeWeekday = true): string {
  const d = parseSafeDate(value);
  if (!d) return '—';

  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return 'Yesterday';

  const weekday = WEEKDAYS_FULL[d.getDay()] || '';
  const day = d.getDate();
  const month = MONTH_NAMES_FULL[d.getMonth()] || '';
  const year = d.getFullYear();

  if (includeWeekday) {
    if (year === now.getFullYear()) {
      return `${weekday}, ${day} ${month}`;
    }
    return `${weekday}, ${day} ${month} ${year}`;
  }

  if (year === now.getFullYear()) {
    return `${day} ${month}`;
  }
  return `${day} ${month} ${year}`;
}

/**
 * Formats exact time.
 * Examples: "21:34:50" or "21:34"
 */
export function formatExactTime(value?: string | number | Date | null, includeSeconds = true): string {
  const d = parseSafeDate(value);
  if (!d) return '—';

  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  if (includeSeconds) {
    const seconds = d.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }
  return `${hours}:${minutes}`;
}

/**
 * Formats time in HH:MM format for message bubbles.
 */
export function formatMessageTime(value?: string | number | Date | null): string {
  return formatExactTime(value, false);
}

/**
 * Formats full date and exact time combined.
 * Examples: "Today at 21:34:50", "Friday, 6 November 2026 at 21:34:50"
 */
export function formatFullDateTime(
  value?: string | number | Date | null,
  includeSeconds = true
): string {
  const d = parseSafeDate(value);
  if (!d) return '—';

  const dateStr = formatInfoDate(d, true);
  const timeStr = formatExactTime(d, includeSeconds);
  return `${dateStr} at ${timeStr}`;
}
