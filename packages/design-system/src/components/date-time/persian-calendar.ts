export type JalaliDateParts = { year: number; month: number; day: number };
export type GregorianDateParts = { year: number; month: number; day: number };

export const jalaliMonthNames = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

const dayInMilliseconds = 86_400_000;
const persianCalendarFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  calendar: 'persian',
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});
const persianNumberFormatter = new Intl.NumberFormat('fa-IR', {
  useGrouping: false,
  minimumIntegerDigits: 2,
});

const jalaliToGregorianCache = new Map<string, string | null>();

export function toAsciiDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/gu, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function formatPersianNumber(value: number, minimumDigits = 1): string {
  return new Intl.NumberFormat('fa-IR', {
    useGrouping: false,
    minimumIntegerDigits: minimumDigits,
  }).format(value);
}

export function parseGregorianDate(value: string): GregorianDateParts | null {
  const match = toAsciiDigits(value.trim()).match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const date = makeUtcDate(parts.year, parts.month - 1, parts.day);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() + 1 !== parts.month ||
    date.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return parts;
}

export function isGregorianDate(value: string): boolean {
  return parseGregorianDate(value) !== null;
}

export function gregorianToJalali(value: string): JalaliDateParts | null {
  const gregorian = parseGregorianDate(value);
  if (!gregorian) return null;

  const date = makeUtcDate(gregorian.year, gregorian.month - 1, gregorian.day);
  const parts = persianCalendarFormatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get('year'));
  const month = Number(values.get('month'));
  const day = Number(values.get('day'));
  if (![year, month, day].every(Number.isInteger) || month < 1 || month > 12) return null;
  return { year, month, day };
}

export function jalaliToGregorian(value: JalaliDateParts): string | null {
  const { year, month, day } = value;
  if (
    ![year, month, day].every(Number.isInteger) ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const key = `${year}/${month}/${day}`;
  if (jalaliToGregorianCache.has(key)) return jalaliToGregorianCache.get(key) ?? null;

  // Intl owns the calendar rules. Search the Gregorian year in which this
  // Persian year begins rather than duplicating leap-year logic here.
  const firstSearchDay = makeUtcDate(year + 621, 2, 1);
  for (let offset = 0; offset <= 400; offset += 1) {
    const candidate = new Date(firstSearchDay.getTime() + offset * dayInMilliseconds);
    const candidateIso = formatIsoDate(candidate);
    const candidateJalali = gregorianToJalali(candidateIso);
    if (
      candidateJalali?.year === year &&
      candidateJalali.month === month &&
      candidateJalali.day === day
    ) {
      jalaliToGregorianCache.set(key, candidateIso);
      return candidateIso;
    }
    if (candidateJalali && candidateJalali.year > year) break;
  }

  jalaliToGregorianCache.set(key, null);
  return null;
}

export function getJalaliMonthDates(year: number, month: number): Array<{ day: number; iso: string }> {
  const firstDay = jalaliToGregorian({ year, month, day: 1 });
  if (!firstDay) return [];

  const result: Array<{ day: number; iso: string }> = [];
  let current = firstDay;
  for (let index = 0; index < 31; index += 1) {
    const jalali = gregorianToJalali(current);
    if (jalali?.year !== year || jalali.month !== month) break;
    result.push({ day: jalali.day, iso: current });
    current = addGregorianDays(current, 1);
  }
  return result;
}

export function clampJalaliDate(value: JalaliDateParts): JalaliDateParts {
  const dayCount = getJalaliMonthDates(value.year, value.month).length;
  if (!dayCount) return { year: value.year, month: value.month, day: 1 };
  return {
    year: value.year,
    month: value.month,
    day: Math.min(Math.max(value.day, 1), dayCount),
  };
}

export function formatJalaliDate(value: string): string | null {
  const jalali = gregorianToJalali(value);
  if (!jalali) return null;
  return `${formatPersianNumber(jalali.day)} ${jalaliMonthNames[jalali.month - 1]} ${formatPersianNumber(jalali.year)}`;
}

export function currentLocalGregorianDate(value = new Date()): string {
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

export function parseTimeValue(value: string): { hour: number; minute: number } | null {
  const match = toAsciiDigits(value.trim()).match(/^(\d{2}):(\d{2})$/u);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatPersianTime(value: string): string | null {
  const time = parseTimeValue(value);
  if (!time) return null;
  return `${persianNumberFormatter.format(time.hour)}:${persianNumberFormatter.format(time.minute)}`;
}

export function parseLocalDateTime(value: string): { date: string; time: string } | null {
  const normalized = toAsciiDigits(value.trim());
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/u);
  if (!match || !isGregorianDate(match[1]) || !parseTimeValue(match[2])) return null;
  return { date: match[1], time: match[2] };
}

export function formatPersianDateTime(value: string): string | null {
  const dateTime = parseLocalDateTime(value);
  const dateLabel = dateTime ? formatJalaliDate(dateTime.date) : null;
  const timeLabel = dateTime ? formatPersianTime(dateTime.time) : null;
  return dateLabel && timeLabel ? `${dateLabel}، ${timeLabel}` : null;
}

export function joinLocalDateTime(date: string, time: string): string | null {
  if (!isGregorianDate(date) || !parseTimeValue(time)) return null;
  return `${toAsciiDigits(date)}T${toAsciiDigits(time)}`;
}

export function isDateWithinBounds(
  value: string,
  minDate?: string,
  maxDate?: string,
): boolean {
  if (!isGregorianDate(value)) return false;
  if (minDate && isGregorianDate(minDate) && value < minDate) return false;
  if (maxDate && isGregorianDate(maxDate) && value > maxDate) return false;
  return true;
}

function addGregorianDays(value: string, amount: number): string {
  const parts = parseGregorianDate(value);
  if (!parts) return value;
  const date = makeUtcDate(parts.year, parts.month - 1, parts.day + amount);
  return formatIsoDate(date);
}

function makeUtcDate(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function formatIsoDate(value: Date): string {
  return [
    String(value.getUTCFullYear()).padStart(4, '0'),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
