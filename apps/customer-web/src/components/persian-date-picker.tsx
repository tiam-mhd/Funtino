'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { CustomerIcon } from './customer-icons';

const ROW_HEIGHT = 44;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = [
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
];

type PersianDate = { year: number; month: number; day: number };
type WheelValue = number | string;

const persianFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const persianDisplayFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function PersianDatePicker({
  value,
  onChange,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const today = useMemo(() => getPersianDate(new Date()), []);
  const todayYear = today.year;
  const minimumYear = today.year - 120;
  const fallbackValue = useMemo(() => ({ year: todayYear - 18, month: 1, day: 1 }), [todayYear]);
  const [selected, setSelected] = useState<PersianDate>(() =>
    clampPersianDate(parseGregorianDate(value) ?? fallbackValue, today, minimumYear),
  );
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogTitleId = useId();

  useEffect(() => {
    const parsed = parseGregorianDate(value);
    if (parsed) setSelected(clampPersianDate(parsed, today, minimumYear));
  }, [minimumYear, today, value]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const yearOptions = useMemo(
    () => Array.from({ length: today.year - minimumYear + 1 }, (_, index) => minimumYear + index),
    [minimumYear, today.year],
  );
  const monthOptions = useMemo(
    () =>
      Array.from(
        { length: selected.year === today.year ? today.month : 12 },
        (_, index) => index + 1,
      ),
    [selected.year, today.month, today.year],
  );
  const maximumDay = getPersianMonthLength(selected.year, selected.month);
  const dayOptions = useMemo(
    () =>
      Array.from(
        {
          length:
            selected.year === today.year && selected.month === today.month
              ? Math.min(maximumDay, today.day)
              : maximumDay,
        },
        (_, index) => index + 1,
      ),
    [maximumDay, selected.month, selected.year, today.day, today.month, today.year],
  );

  function openPicker() {
    const parsed = parseGregorianDate(value);
    setSelected(clampPersianDate(parsed ?? fallbackValue, today, minimumYear));
    setIsOpen(true);
  }

  function closePicker() {
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function selectPart(part: keyof PersianDate, valueToApply: number) {
    setSelected((current) =>
      clampPersianDate({ ...current, [part]: valueToApply }, today, minimumYear),
    );
  }

  function confirmSelection() {
    onChange(toGregorianDate(selected));
    closePicker();
  }

  return (
    <div
      className="customer-persian-date-picker"
      data-has-value={Boolean(value)}
      data-required={required}
    >
      <button
        ref={triggerRef}
        type="button"
        className="customer-persian-date-picker__field"
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className={value ? '' : 'is-placeholder'}>
          {value ? formatPersianDate(value) : 'تاریخ تولد را انتخاب کن'}
        </span>
        <CustomerIcon name="chevron-left" size={17} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          className="customer-date-picker-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePicker();
          }}
        >
          <section
            className="customer-date-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
          >
            <div className="customer-date-picker-dialog__header">
              <div>
                <span>تقویم شمسی</span>
                <h2 id={dialogTitleId}>تاریخ تولد را انتخاب کن</h2>
              </div>
              <button
                type="button"
                className="customer-date-picker-dialog__close"
                onClick={closePicker}
                autoFocus
                aria-label="بستن انتخاب تاریخ"
              >
                <CustomerIcon name="close" size={17} />
              </button>
            </div>

            <div className="customer-date-wheels" dir="rtl" aria-label="انتخاب تاریخ شمسی">
              <WheelColumn
                label="روز"
                values={dayOptions}
                selectedIndex={Math.max(0, dayOptions.indexOf(selected.day))}
                formatValue={(item) => toPersianDigits(String(item))}
                onChange={(item) => selectPart('day', Number(item))}
              />
              <WheelColumn
                label="ماه"
                values={monthOptions}
                selectedIndex={Math.max(0, monthOptions.indexOf(selected.month))}
                formatValue={(item) => MONTH_NAMES[Number(item) - 1] ?? ''}
                onChange={(item) => selectPart('month', Number(item))}
              />
              <WheelColumn
                label="سال"
                values={yearOptions}
                selectedIndex={Math.max(0, yearOptions.indexOf(selected.year))}
                formatValue={(item) => toPersianDigits(String(item))}
                onChange={(item) => selectPart('year', Number(item))}
              />
            </div>
            <span className="customer-persian-date-picker__hint">
              {toPersianDigits(String(selected.year))}/
              {toPersianDigits(String(selected.month).padStart(2, '0'))}/
              {toPersianDigits(String(selected.day).padStart(2, '0'))}
            </span>
            <div className="customer-date-picker-dialog__actions">
              <button type="button" className="customer-secondary-button" onClick={closePicker}>
                انصراف
              </button>
              <button type="button" className="customer-primary-button" onClick={confirmSelection}>
                تأیید تاریخ <CustomerIcon name="check" size={16} />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export function formatPersianDate(value: string): string {
  const date = parseGregorianValue(value);
  return date ? persianDisplayFormatter.format(date) : 'ثبت نشده';
}

function WheelColumn({
  label,
  values,
  selectedIndex,
  formatValue,
  onChange,
}: {
  label: string;
  values: WheelValue[];
  selectedIndex: number;
  formatValue: (value: WheelValue) => string;
  onChange: (value: WheelValue) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<number | null>(null);

  useEffect(() => {
    viewport.current?.scrollTo({ top: selectedIndex * ROW_HEIGHT, behavior: 'auto' });
  }, [selectedIndex, values.length]);

  useEffect(
    () => () => {
      if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current);
    },
    [],
  );

  function settleSelection() {
    const element = viewport.current;
    if (!element) return;
    const index = Math.max(
      0,
      Math.min(values.length - 1, Math.round(element.scrollTop / ROW_HEIGHT)),
    );
    element.scrollTo({ top: index * ROW_HEIGHT, behavior: 'smooth' });
    onChange(values[index] ?? values[0] ?? '');
  }

  return (
    <div className="customer-date-wheel">
      <span className="customer-date-wheel__label">{label}</span>
      <div
        ref={viewport}
        className="customer-date-wheel__viewport"
        role="listbox"
        aria-label={label}
        onScroll={() => {
          if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current);
          scrollTimer.current = window.setTimeout(settleSelection, 90);
        }}
      >
        <div className="customer-date-wheel__spacer" aria-hidden="true" />
        {values.map((item, index) => (
          <button
            type="button"
            role="option"
            aria-selected={selectedIndex === index}
            className={
              selectedIndex === index
                ? 'customer-date-wheel__option is-selected'
                : 'customer-date-wheel__option'
            }
            key={`${label}-${String(item)}`}
            onClick={() => {
              viewport.current?.scrollTo({ top: index * ROW_HEIGHT, behavior: 'smooth' });
              onChange(item);
            }}
          >
            {formatValue(item)}
          </button>
        ))}
        <div className="customer-date-wheel__spacer" aria-hidden="true" />
        <span className="customer-date-wheel__selection" aria-hidden="true" />
      </div>
    </div>
  );
}

function parseGregorianDate(value: string): PersianDate | null {
  const date = parseGregorianValue(value);
  return date ? getPersianDate(date) : null;
}

function parseGregorianValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPersianDate(date: Date): PersianDate {
  const parts = persianFormatter.formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value ?? 0),
    month: Number(parts.find((part) => part.type === 'month')?.value ?? 0),
    day: Number(parts.find((part) => part.type === 'day')?.value ?? 0),
  };
}

function toGregorianDate(value: PersianDate): string {
  const approximate = Date.UTC(value.year + 621, 2, 21);
  for (let offset = -370; offset <= 370; offset += 1) {
    const date = new Date(approximate + offset * DAY_MS);
    const candidate = getPersianDate(date);
    if (
      candidate.year === value.year &&
      candidate.month === value.month &&
      candidate.day === value.day
    ) {
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }
  }
  throw new Error('Persian date could not be converted.');
}

function getPersianMonthLength(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  const first = Date.parse(`${toGregorianDate({ year, month: 12, day: 1 })}T00:00:00.000Z`);
  const next = Date.parse(`${toGregorianDate({ year: year + 1, month: 1, day: 1 })}T00:00:00.000Z`);
  return Math.round((next - first) / DAY_MS);
}

function clampPersianDate(
  value: PersianDate,
  today: PersianDate,
  minimumYear: number,
): PersianDate {
  const year = Math.min(today.year, Math.max(minimumYear, value.year));
  const monthLimit = year === today.year ? today.month : 12;
  const month = Math.min(monthLimit, Math.max(1, value.month));
  const dayLimit = getPersianMonthLength(year, month);
  const cappedDayLimit =
    year === today.year && month === today.month ? Math.min(dayLimit, today.day) : dayLimit;
  return { year, month, day: Math.min(cappedDayLimit, Math.max(1, value.day)) };
}

function toPersianDigits(value: string): string {
  return value.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)] ?? digit);
}
