'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  clampJalaliDate,
  currentLocalGregorianDate,
  formatPersianNumber,
  getJalaliMonthDates,
  gregorianToJalali,
  isDateWithinBounds,
  jalaliMonthNames,
  jalaliToGregorian,
  parseTimeValue,
  toAsciiDigits,
} from './persian-calendar';

const weekDays = [
  { short: 'ش', full: 'شنبه' },
  { short: 'ی', full: 'یکشنبه' },
  { short: 'د', full: 'دوشنبه' },
  { short: 'س', full: 'سه‌شنبه' },
  { short: 'چ', full: 'چهارشنبه' },
  { short: 'پ', full: 'پنجشنبه' },
  { short: 'ج', full: 'جمعه' },
] as const;

export type JalaliDateSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  maxDate?: string;
};

export function JalaliDateSelector({ value, onChange, minDate, maxDate }: JalaliDateSelectorProps) {
  const selectorRef = useRef<HTMLElement>(null);
  const initialJalali = gregorianToJalali(value) ?? gregorianToJalali(currentLocalGregorianDate());
  const [visibleMonth, setVisibleMonth] = useState(() => initialJalali ?? { year: 1400, month: 1, day: 1 });
  const [yearDraft, setYearDraft] = useState(() => formatPersianNumber(initialJalali?.year ?? 1400));
  const [activeDate, setActiveDate] = useState(value || currentLocalGregorianDate());
  const dates = useMemo(
    () => getJalaliMonthDates(visibleMonth.year, visibleMonth.month),
    [visibleMonth.month, visibleMonth.year],
  );
  const firstDate = dates[0]?.iso;
  const weekdayOffset = firstDate ? (new Date(`${firstDate}T12:00:00Z`).getUTCDay() + 1) % 7 : 0;
  const dateCells: Array<{ day: number; iso: string } | null> = [];
  for (let index = 0; index < weekdayOffset; index += 1) dateCells.push(null);
  dateCells.push(...dates);
  while (dateCells.length % 7 !== 0) dateCells.push(null);
  const dateRows = Array.from({ length: dateCells.length / 7 }, (_, rowIndex) =>
    dateCells.slice(rowIndex * 7, rowIndex * 7 + 7),
  );

  useEffect(() => {
    const jalali = gregorianToJalali(value);
    if (!jalali) return;
    setVisibleMonth(jalali);
    setYearDraft(formatPersianNumber(jalali.year));
    setActiveDate(value);
  }, [value]);

  const setMonth = (year: number, month: number) => {
    const normalized = normalizeMonth(year, month);
    const next = clampJalaliDate({ ...visibleMonth, ...normalized });
    setVisibleMonth(next);
    setYearDraft(formatPersianNumber(next.year));
    const iso = jalaliToGregorian(next);
    if (iso) setActiveDate(iso);
  };

  const shiftMonth = (amount: number, preferredDay = visibleMonth.day): string | null => {
    const normalized = normalizeMonth(visibleMonth.year, visibleMonth.month + amount);
    const next = clampJalaliDate({ ...visibleMonth, ...normalized, day: preferredDay });
    setVisibleMonth(next);
    setYearDraft(formatPersianNumber(next.year));
    const iso = jalaliToGregorian(next);
    if (iso) setActiveDate(iso);
    return iso;
  };

  const commitYearDraft = () => {
    const normalizedYear = toAsciiDigits(yearDraft.trim());
    const year = Number(normalizedYear);
    if (/^\d{1,4}$/u.test(normalizedYear) && year > 0 && year <= 9999) {
      setMonth(year, visibleMonth.month);
    } else {
      setYearDraft(formatPersianNumber(visibleMonth.year));
    }
  };

  const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)) return;
    event.preventDefault();
    if (key === 'PageUp' || key === 'PageDown') {
      const targetDate = shiftMonth(key === 'PageUp' ? -1 : 1);
      if (targetDate) requestAnimationFrame(() => selectorRef.current?.querySelector<HTMLButtonElement>(`[data-date="${targetDate}"]`)?.focus());
      return;
    }
    let nextIndex = index;
    if (key === 'ArrowLeft') nextIndex += 1;
    if (key === 'ArrowRight') nextIndex -= 1;
    if (key === 'ArrowDown') nextIndex += 7;
    if (key === 'ArrowUp') nextIndex -= 7;
    if (key === 'Home') nextIndex = Math.max(0, index - ((weekdayOffset + index) % 7));
    if (key === 'End') nextIndex = Math.min(dates.length - 1, index + (6 - ((weekdayOffset + index) % 7)));

    const target = dates[nextIndex];
    if (target) {
      setActiveDate(target.iso);
      selectorRef.current?.querySelector<HTMLButtonElement>(`[data-date="${target.iso}"]`)?.focus();
    } else if (nextIndex < 0) {
      const targetDate = shiftMonth(-1, 31);
      if (targetDate) requestAnimationFrame(() => selectorRef.current?.querySelector<HTMLButtonElement>(`[data-date="${targetDate}"]`)?.focus());
    } else if (nextIndex >= dates.length) {
      const targetDate = shiftMonth(1, 1);
      if (targetDate) requestAnimationFrame(() => selectorRef.current?.querySelector<HTMLButtonElement>(`[data-date="${targetDate}"]`)?.focus());
    }
  };

  return (
    <section ref={selectorRef} className="ft-date-picker" aria-label="انتخاب تاریخ جلالی">
      <div className="ft-date-picker__navigation">
        <button className="ft-date-picker__month-step" type="button" aria-label="ماه قبل" onClick={() => shiftMonth(-1)}>
          <span aria-hidden="true">›</span>
        </button>
        <label className="ft-date-picker__month-select">
          <span className="ft-visually-hidden">ماه</span>
          <select
            value={visibleMonth.month}
            onChange={(event) => setMonth(visibleMonth.year, Number(event.target.value))}
          >
            {jalaliMonthNames.map((month, index) => (
              <option key={month} value={index + 1}>{month}</option>
            ))}
          </select>
        </label>
        <label className="ft-date-picker__year">
          <span className="ft-visually-hidden">سال</span>
          <input
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={yearDraft}
            onChange={(event) => setYearDraft(event.target.value)}
            onBlur={commitYearDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitYearDraft();
                event.currentTarget.blur();
              }
            }}
            aria-label="سال شمسی"
          />
        </label>
        <button className="ft-date-picker__month-step" type="button" aria-label="ماه بعد" onClick={() => shiftMonth(1)}>
          <span aria-hidden="true">‹</span>
        </button>
      </div>

      <div className="ft-date-picker__calendar" role="grid" aria-label={`${jalaliMonthNames[visibleMonth.month - 1]} ${formatPersianNumber(visibleMonth.year)}`}>
        <div className="ft-date-picker__week" role="row">
          {weekDays.map((day) => (
            <span key={day.full} role="columnheader" aria-label={day.full} title={day.full}>{day.short}</span>
          ))}
        </div>
        <div className="ft-date-picker__days" role="rowgroup">
          {dateRows.map((row, rowIndex) => (
            <div className="ft-date-picker__week-row" role="row" key={`week-${rowIndex}`}>
              {row.map((date, columnIndex) => {
                if (!date) {
                  return <span className="ft-date-picker__empty" role="gridcell" aria-hidden="true" key={`empty-${rowIndex}-${columnIndex}`} />;
                }
                const dayIndex = dates.findIndex((item) => item.iso === date.iso);
                const jalali = gregorianToJalali(date.iso);
                const label = jalali ? `${jalali.day} ${jalaliMonthNames[jalali.month - 1]} ${jalali.year}` : date.iso;
                const selected = value === date.iso;
                const withinBounds = isDateWithinBounds(date.iso, minDate, maxDate);
                const isToday = date.iso === currentLocalGregorianDate();
                return (
                  <button
                    key={date.iso}
                    type="button"
                    className={`ft-date-picker__day${selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                    role="gridcell"
                    aria-label={label}
                    aria-selected={selected}
                    aria-current={isToday ? 'date' : undefined}
                    disabled={!withinBounds}
                    tabIndex={activeDate === date.iso || (!dates.some((item) => item.iso === activeDate) && dayIndex === 0) ? 0 : -1}
                    data-date={date.iso}
                    data-picker-autofocus={activeDate === date.iso ? '' : undefined}
                    onFocus={() => setActiveDate(date.iso)}
                    onClick={() => {
                      onChange(date.iso);
                      setActiveDate(date.iso);
                    }}
                    onKeyDown={(event) => handleDayKeyDown(event, dayIndex)}
                  >
                    {formatPersianNumber(date.day)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="ft-date-picker__hint">برای جابه‌جایی بین روزها از کلیدهای جهت‌دار استفاده کنید.</p>
    </section>
  );
}

export type ClockTimeSelectorProps = {
  value: string;
  onChange: (value: string) => void;
};

export function ClockTimeSelector({ value, onChange }: ClockTimeSelectorProps) {
  const selectorRef = useRef<HTMLElement>(null);
  const parsed = parseTimeValue(value) ?? { hour: 0, minute: 0 };
  const [stage, setStage] = useState<'hour' | 'minute'>('hour');
  const [activeHour, setActiveHour] = useState(parsed.hour);
  const [activeMinute, setActiveMinute] = useState(parsed.minute);

  useEffect(() => {
    setActiveHour(parsed.hour);
    setActiveMinute(parsed.minute);
  }, [parsed.hour, parsed.minute]);

  const setHour = (hour: number) => {
    setActiveHour(hour);
    onChange(`${pad(hour)}:${pad(parsed.minute)}`);
    setStage('minute');
  };

  const focusHour = (hour: number) => selectorRef.current?.querySelector<HTMLButtonElement>(`[data-hour="${hour}"]`)?.focus();
  const focusMinute = (minute: number) => selectorRef.current?.querySelector<HTMLButtonElement>(`[data-minute="${minute}"]`)?.focus();

  const hourKeyDown = (event: KeyboardEvent<HTMLButtonElement>, hour: number) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 4, ArrowLeft: -1, ArrowUp: -4 };
    if (event.key in steps) {
      event.preventDefault();
      const next = (hour + steps[event.key] + 24) % 24;
      setActiveHour(next);
      focusHour(next);
    }
  };

  const minuteKeyDown = (event: KeyboardEvent<HTMLButtonElement>, minute: number) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 6, ArrowLeft: -1, ArrowUp: -6 };
    if (event.key in steps) {
      event.preventDefault();
      const next = (minute + steps[event.key] + 60) % 60;
      setActiveMinute(next);
      focusMinute(next);
    }
  };

  return (
    <section ref={selectorRef} className="ft-time-picker" aria-label="انتخاب ساعت ۲۴ ساعته">
      <div className="ft-time-picker__display" aria-live="polite">
        <button type="button" className={stage === 'hour' ? 'is-active' : ''} aria-label="انتخاب ساعت" onClick={() => setStage('hour')}>
          {formatPersianNumber(parsed.hour, 2)}
        </button>
        <span aria-hidden="true">:</span>
        <button type="button" className={stage === 'minute' ? 'is-active' : ''} aria-label="انتخاب دقیقه" onClick={() => setStage('minute')}>
          {formatPersianNumber(parsed.minute, 2)}
        </button>
      </div>

      {stage === 'hour' ? (
        <div className="ft-time-picker__clock" role="grid" aria-label="ساعت‌ها">
          {[...Array(24)].map((_, hour) => {
            const ringHour = hour % 12;
            const angle = ringHour * 30 - 90;
            const radius = hour < 12 ? 41 : 25;
            const style = {
              '--x': `${50 + Math.cos((angle * Math.PI) / 180) * radius}%`,
              '--y': `${50 + Math.sin((angle * Math.PI) / 180) * radius}%`,
            } as CSSProperties;
            return (
              <button
                key={hour}
                type="button"
                role="gridcell"
                className={`ft-time-picker__hour${hour >= 12 ? ' is-inner' : ''}${parsed.hour === hour ? ' is-selected' : ''}`}
                aria-label={`${formatPersianNumber(hour, 2)} ساعت`}
                aria-selected={parsed.hour === hour}
                data-hour={hour}
                data-picker-autofocus={activeHour === hour ? '' : undefined}
                tabIndex={activeHour === hour ? 0 : -1}
                style={style}
                onFocus={() => setActiveHour(hour)}
                onClick={() => setHour(hour)}
                onKeyDown={(event) => hourKeyDown(event, hour)}
              >
                {formatPersianNumber(hour, 2)}
              </button>
            );
          })}
          <span className="ft-time-picker__clock-center" aria-hidden="true">ساعت</span>
        </div>
      ) : (
        <div className="ft-time-picker__minutes" role="grid" aria-label="دقیقه‌ها">
          {[...Array(60)].map((_, minute) => (
            <button
              key={minute}
              type="button"
              role="gridcell"
              className={`ft-time-picker__minute${parsed.minute === minute ? ' is-selected' : ''}`}
              aria-label={`${formatPersianNumber(minute, 2)} دقیقه`}
              aria-selected={parsed.minute === minute}
              data-minute={minute}
              data-picker-autofocus={activeMinute === minute ? '' : undefined}
              tabIndex={activeMinute === minute ? 0 : -1}
              onFocus={() => setActiveMinute(minute)}
              onClick={() => {
                setActiveMinute(minute);
                onChange(`${pad(parsed.hour)}:${pad(minute)}`);
              }}
              onKeyDown={(event) => minuteKeyDown(event, minute)}
            >
              {formatPersianNumber(minute, 2)}
            </button>
          ))}
        </div>
      )}
      <p className="ft-time-picker__hint">
        {stage === 'hour' ? 'ساعت را در بازهٔ ۰۰ تا ۲۳ انتخاب کنید.' : 'دقیقه را انتخاب کنید یا برای تغییر ساعت، عدد ساعت را بزنید.'}
      </p>
    </section>
  );
}

function normalizeMonth(year: number, month: number) {
  let nextYear = year;
  let nextMonth = month;
  while (nextMonth < 1) { nextMonth += 12; nextYear -= 1; }
  while (nextMonth > 12) { nextMonth -= 12; nextYear += 1; }
  return { year: Math.min(9999, Math.max(1, nextYear)), month: nextMonth };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
