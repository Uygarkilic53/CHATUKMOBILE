import {
  parseSafeDate,
  formatInfoDate,
  formatExactTime,
  formatFullDateTime,
} from '../src/utils/messageInfo';

describe('messageInfo utilities', () => {
  describe('parseSafeDate', () => {
    it('returns null for undefined, null, or empty string', () => {
      expect(parseSafeDate(undefined)).toBeNull();
      expect(parseSafeDate(null)).toBeNull();
      expect(parseSafeDate('')).toBeNull();
    });

    it('returns null for invalid date strings', () => {
      expect(parseSafeDate('invalid-date')).toBeNull();
    });

    it('parses valid ISO string', () => {
      const d = parseSafeDate('2026-11-06T18:34:50.000Z');
      expect(d).toBeInstanceOf(Date);
      expect(d?.toISOString()).toBe('2026-11-06T18:34:50.000Z');
    });

    it('parses unix timestamp in milliseconds (number or numeric string)', () => {
      const ts = 1730918090000;
      const d = parseSafeDate(ts);
      expect(d?.getTime()).toBe(ts);

      const dStr = parseSafeDate(String(ts));
      expect(dStr?.getTime()).toBe(ts);
    });

    it('returns the Date instance itself if passed a Date', () => {
      const original = new Date(2026, 10, 6, 21, 34, 50);
      expect(parseSafeDate(original)).toBe(original);
    });
  });

  describe('formatInfoDate', () => {
    it('returns dash for invalid date', () => {
      expect(formatInfoDate('invalid')).toBe('—');
      expect(formatInfoDate(null)).toBe('—');
    });

    it('returns "Today" for current day', () => {
      const now = new Date();
      expect(formatInfoDate(now.toISOString())).toBe('Today');
    });

    it('returns "Yesterday" for previous day', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(formatInfoDate(yesterday.toISOString())).toBe('Yesterday');
    });

    it('formats full date for older dates', () => {
      const past = new Date(2025, 5, 15, 12, 0, 0); // 15 June 2025 (Sunday)
      const formatted = formatInfoDate(past, true);
      expect(formatted).toBe('Sunday, 15 June 2025');

      const withoutWeekday = formatInfoDate(past, false);
      expect(withoutWeekday).toBe('15 June 2025');
    });
  });

  describe('formatExactTime', () => {
    it('returns dash for invalid date', () => {
      expect(formatExactTime(null)).toBe('—');
    });

    it('formats time with seconds by default', () => {
      const d = new Date(2026, 10, 6, 9, 5, 8);
      expect(formatExactTime(d)).toBe('09:05:08');
    });

    it('formats time without seconds when specified', () => {
      const d = new Date(2026, 10, 6, 21, 34, 50);
      expect(formatExactTime(d, false)).toBe('21:34');
    });
  });

  describe('formatFullDateTime', () => {
    it('returns combined string', () => {
      const past = new Date(2025, 5, 15, 14, 20, 30);
      const res = formatFullDateTime(past);
      expect(res).toBe('Sunday, 15 June 2025 at 14:20:30');
    });
  });
});

