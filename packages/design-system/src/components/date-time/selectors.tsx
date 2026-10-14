'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
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
} from './persian-calendar';

export type JalaliDateSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  maxDate?: string;
};

export function JalaliDateSelector({ value, onChange, minDate, maxDate }: JalaliDateSelectorProps) {
  const selectorId = useId();
  const selected = gregorianToJalali(value) ??
    gregorianToJalali(currentLocalGregorianDate()) ?? { year: 1400, month: 1, day: 1 };
  const minParts = minDate ? gregorianToJalali(minDate) : null;
  const maxParts = maxDate ? gregorianToJalali(maxDate) : null;
  const hasValidRange = !(minParts && maxParts && minDate && maxDate && minDate > maxDate);
  const firstYear = hasValidRange ? (minParts?.year ?? 1) : selected.year;
  const lastYear = hasValidRange ? (maxParts?.year ?? 9999) : selected.year;
  const hasSelectableYears = hasValidRange && firstYear <= lastYear;
  const yearCount = hasSelectableYears ? lastYear - firstYear + 1 : 1;
  const dates = useMemo(
    () => getJalaliMonthDates(selected.year, selected.month),
    [selected.month, selected.year],
  );
  const selectionRef = useRef({
    selected,
    value,
    minParts,
    maxParts,
    minDate,
    maxDate,
    hasValidRange,
    onChange,
  });
  selectionRef.current = {
    selected,
    value,
    minParts,
    maxParts,
    minDate,
    maxDate,
    hasValidRange,
    onChange,
  };

  const selectDatePart = (part: 'day' | 'month' | 'year', partValue: number) => {
    const current = selectionRef.current;
    if (!current.hasValidRange) return;

    const next = { ...current.selected, [part]: partValue };
    if (part !== 'day') {
      if (
        current.minParts &&
        next.year === current.minParts.year &&
        (next.month < current.minParts.month ||
          (next.month === current.minParts.month && next.day < current.minParts.day))
      ) {
        next.month = current.minParts.month;
        next.day = current.minParts.day;
      }
      if (
        current.maxParts &&
        next.year === current.maxParts.year &&
        (next.month > current.maxParts.month ||
          (next.month === current.maxParts.month && next.day > current.maxParts.day))
      ) {
        next.month = current.maxParts.month;
        next.day = current.maxParts.day;
      }
    }

    const normalized = clampJalaliDate(next);
    const iso = jalaliToGregorian(normalized);
    if (iso && isDateWithinBounds(iso, current.minDate, current.maxDate) && iso !== current.value) {
      selectionRef.current = { ...current, selected: normalized, value: iso };
      current.onChange(iso);
    }
  };

  return (
    <section className="ft-date-picker" aria-label="انتخاب تاریخ جلالی">
      <div className="ft-date-picker__columns" role="group" aria-label="ستون‌های انتخاب تاریخ">
        <DateWheelColumn
          id={`${selectorId}-day`}
          hintId={`${selectorId}-hint`}
          label="روز"
          startValue={1}
          optionCount={dates.length}
          selectedValue={selected.day}
          dataPickerAutofocus
          getOptionLabel={(day) => formatPersianNumber(day)}
          isOptionDisabled={(day) => {
            const date = dates[day - 1];
            return !hasValidRange || !date || !isDateWithinBounds(date.iso, minDate, maxDate);
          }}
          onSelect={(day) => selectDatePart('day', day)}
        />
        <DateWheelColumn
          id={`${selectorId}-month`}
          hintId={`${selectorId}-hint`}
          label="ماه"
          startValue={1}
          optionCount={12}
          selectedValue={selected.month}
          getOptionLabel={(month) => jalaliMonthNames[month - 1]}
          isOptionDisabled={(month) =>
            !hasValidRange ||
            Boolean(minParts && selected.year === minParts.year && month < minParts.month) ||
            Boolean(maxParts && selected.year === maxParts.year && month > maxParts.month)
          }
          onSelect={(month) => selectDatePart('month', month)}
        />
        <DateWheelColumn
          id={`${selectorId}-year`}
          hintId={`${selectorId}-hint`}
          label="سال"
          startValue={hasSelectableYears ? firstYear : selected.year}
          optionCount={yearCount}
          selectedValue={selected.year}
          getOptionLabel={(year) => formatPersianNumber(year)}
          isOptionDisabled={() => !hasSelectableYears}
          onSelect={(year) => selectDatePart('year', year)}
        />
      </div>
      <p id={`${selectorId}-hint`} className="ft-date-picker__hint">
        {hasValidRange
          ? 'هر ستون را با اسکرول یا کلیدهای جهت‌دار جابه‌جا کنید؛ مقدار وسط انتخاب می‌شود.'
          : 'برای این بازه تاریخی وجود ندارد.'}
      </p>
    </section>
  );
}

type DateWheelColumnProps = {
  id: string;
  hintId: string;
  label: string;
  startValue: number;
  optionCount: number;
  selectedValue: number;
  getOptionLabel: (value: number) => string;
  isOptionDisabled: (value: number) => boolean;
  onSelect: (value: number) => void;
  dataPickerAutofocus?: boolean;
};

const dateWheelRowHeight = 48;
const dateWheelHeight = 240;
const dateWheelCenterPadding = (dateWheelHeight - dateWheelRowHeight) / 2;
const dateWheelWindowSize = 15;

function DateWheelColumn({
  id,
  hintId,
  label,
  startValue,
  optionCount,
  selectedValue,
  getOptionLabel,
  isOptionDisabled,
  onSelect,
  dataPickerAutofocus = false,
}: DateWheelColumnProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<number | null>(null);
  const selectedIndex = clampIndex(selectedValue - startValue, optionCount);
  const [centeredIndex, setCenteredIndex] = useState(selectedIndex);
  const centeredIndexRef = useRef(selectedIndex);
  const [windowStart, setWindowStart] = useState(() =>
    getDateWheelWindowStart(selectedIndex, optionCount),
  );

  useEffect(() => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    const nextIndex = clampIndex(selectedValue - startValue, optionCount);
    centeredIndexRef.current = nextIndex;
    setCenteredIndex(nextIndex);
    setWindowStart(getDateWheelWindowStart(nextIndex, optionCount));
    if (listRef.current) listRef.current.scrollTop = nextIndex * dateWheelRowHeight;
  }, [optionCount, selectedValue, startValue]);

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    },
    [],
  );

  const setCenteredOption = (index: number) => {
    const nextIndex = clampIndex(index, optionCount);
    centeredIndexRef.current = nextIndex;
    setCenteredIndex(nextIndex);
    setWindowStart(getDateWheelWindowStart(nextIndex, optionCount));
  };

  const scrollToIndex = (index: number, behavior: ScrollBehavior) => {
    const nextIndex = clampIndex(index, optionCount);
    const list = listRef.current;
    if (!list) return;
    if (behavior === 'auto') setCenteredOption(nextIndex);
    list.scrollTo({ top: nextIndex * dateWheelRowHeight, behavior });
  };

  const nearestEnabledIndex = (index: number) => {
    const target = clampIndex(index, optionCount);
    for (let distance = 0; distance < optionCount; distance += 1) {
      const candidates = distance === 0 ? [target] : [target - distance, target + distance];
      for (const candidate of candidates) {
        if (candidate < 0 || candidate >= optionCount) continue;
        if (!isOptionDisabled(startValue + candidate)) return candidate;
      }
    }
    return -1;
  };

  const handleScroll = () => {
    const list = listRef.current;
    if (!list || optionCount < 1) return;
    const nextIndex = clampIndex(Math.round(list.scrollTop / dateWheelRowHeight), optionCount);
    setCenteredOption(nextIndex);
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      const centered = clampIndex(Math.round(list.scrollTop / dateWheelRowHeight), optionCount);
      const selectableIndex = nearestEnabledIndex(centered);
      if (selectableIndex < 0) return;
      if (selectableIndex !== centered) {
        scrollToIndex(selectableIndex, getDateWheelScrollBehavior());
        return;
      }
      setCenteredOption(centered);
      onSelect(startValue + centered);
    }, 110);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = listRef.current
      ? clampIndex(Math.round(listRef.current.scrollTop / dateWheelRowHeight), optionCount)
      : centeredIndexRef.current;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const selectableIndex = nearestEnabledIndex(currentIndex);
      if (selectableIndex < 0) return;
      if (selectableIndex !== currentIndex) {
        scrollToIndex(selectableIndex, getDateWheelScrollBehavior());
      } else {
        onSelect(startValue + selectableIndex);
      }
      return;
    }

    let targetIndex = currentIndex;
    if (event.key === 'ArrowDown') targetIndex += 1;
    else if (event.key === 'ArrowUp') targetIndex -= 1;
    else if (event.key === 'PageDown') targetIndex += 5;
    else if (event.key === 'PageUp') targetIndex -= 5;
    else if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = optionCount - 1;
    else return;

    event.preventDefault();
    const selectableIndex = nearestEnabledIndex(targetIndex);
    if (selectableIndex < 0) return;
    scrollToIndex(selectableIndex, getDateWheelScrollBehavior());
    if (selectableIndex === currentIndex) onSelect(startValue + selectableIndex);
  };

  const handleOptionClick = (index: number) => {
    const optionValue = startValue + index;
    if (isOptionDisabled(optionValue)) return;
    listRef.current?.focus({ preventScroll: true });
    const list = listRef.current;
    if (list && Math.abs(list.scrollTop - index * dateWheelRowHeight) < 1) {
      setCenteredOption(index);
      onSelect(optionValue);
      return;
    }
    scrollToIndex(index, getDateWheelScrollBehavior());
  };

  const windowEnd = Math.min(optionCount, windowStart + dateWheelWindowSize);
  const options = [];
  for (let index = windowStart; index < windowEnd; index += 1) {
    const optionValue = startValue + index;
    const optionId = `${id}-option-${optionValue}`;
    const disabled = isOptionDisabled(optionValue);
    const style = {
      '--option-top': `${dateWheelCenterPadding + index * dateWheelRowHeight}px`,
    } as CSSProperties;
    options.push(
      <div
        key={optionValue}
        id={optionId}
        role="option"
        aria-setsize={optionCount}
        aria-posinset={index + 1}
        aria-label={`${label} ${getOptionLabel(optionValue)}`}
        aria-selected={selectedValue === optionValue}
        aria-disabled={disabled || undefined}
        className={`ft-date-picker__option${centeredIndex === index ? ' is-centered' : ''}`}
        style={style}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => handleOptionClick(index)}
      >
        {getOptionLabel(optionValue)}
      </div>,
    );
  }

  return (
    <div className="ft-date-picker__column">
      <span className="ft-date-picker__column-label" id={`${id}-label`}>
        {label}
      </span>
      <div
        ref={listRef}
        className="ft-date-picker__column-list"
        role="listbox"
        aria-labelledby={`${id}-label`}
        aria-describedby={hintId}
        aria-activedescendant={`${id}-option-${startValue + centeredIndex}`}
        tabIndex={0}
        data-picker-autofocus={dataPickerAutofocus ? '' : undefined}
        onFocus={(event) => {
          if (event.target === event.currentTarget) scrollToIndex(selectedIndex, 'auto');
        }}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
      >
        <div
          className="ft-date-picker__column-track"
          role="presentation"
          style={{ height: `${dateWheelCenterPadding * 2 + optionCount * dateWheelRowHeight}px` }}
        >
          {options}
        </div>
      </div>
      <span className="ft-date-picker__column-center" aria-hidden="true" />
    </div>
  );
}

function clampIndex(index: number, optionCount: number): number {
  return Math.min(Math.max(index, 0), Math.max(optionCount - 1, 0));
}

function getDateWheelWindowStart(centerIndex: number, optionCount: number): number {
  const maxStart = Math.max(optionCount - dateWheelWindowSize, 0);
  return Math.min(Math.max(centerIndex - Math.floor(dateWheelWindowSize / 2), 0), maxStart);
}

function getDateWheelScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'auto';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
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

  const focusHour = (hour: number) =>
    selectorRef.current?.querySelector<HTMLButtonElement>(`[data-hour="${hour}"]`)?.focus();
  const focusMinute = (minute: number) =>
    selectorRef.current?.querySelector<HTMLButtonElement>(`[data-minute="${minute}"]`)?.focus();

  const hourKeyDown = (event: KeyboardEvent<HTMLButtonElement>, hour: number) => {
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 4,
      ArrowLeft: -1,
      ArrowUp: -4,
    };
    if (event.key in steps) {
      event.preventDefault();
      const next = (hour + steps[event.key] + 24) % 24;
      setActiveHour(next);
      focusHour(next);
    }
  };

  const minuteKeyDown = (event: KeyboardEvent<HTMLButtonElement>, minute: number) => {
    let next: number;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const ringStart = minute < 30 ? 0 : 30;
      next = ringStart + (((minute % 30) + step + 30) % 30);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      next = minute < 30 ? minute + 30 : minute - 30;
    } else {
      return;
    }

    event.preventDefault();
    setActiveMinute(next);
    focusMinute(next);
  };

  return (
    <section ref={selectorRef} className="ft-time-picker" aria-label="انتخاب ساعت ۲۴ ساعته">
      <div className="ft-time-picker__display" aria-live="polite">
        <button
          type="button"
          className={stage === 'hour' ? 'is-active' : ''}
          aria-label="انتخاب ساعت"
          onClick={() => setStage('hour')}
        >
          {formatPersianNumber(parsed.hour, 2)}
        </button>
        <span aria-hidden="true">:</span>
        <button
          type="button"
          className={stage === 'minute' ? 'is-active' : ''}
          aria-label="انتخاب دقیقه"
          onClick={() => setStage('minute')}
        >
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
          <span className="ft-time-picker__clock-center" aria-hidden="true">
            ساعت
          </span>
        </div>
      ) : (
        <div className="ft-time-picker__minute-dial" role="grid" aria-label="دقیقه‌ها">
          {[...Array(60)].map((_, minute) => {
            const angle = (minute % 30) * 12 - 90;
            const radius = minute < 30 ? 43 : 32;
            const style = {
              '--x': `${50 + Math.cos((angle * Math.PI) / 180) * radius}%`,
              '--y': `${50 + Math.sin((angle * Math.PI) / 180) * radius}%`,
            } as CSSProperties;

            return (
              <button
                key={minute}
                type="button"
                role="gridcell"
                className={`ft-time-picker__minute${minute >= 30 ? ' is-inner' : ''}${parsed.minute === minute ? ' is-selected' : ''}`}
                aria-label={`${formatPersianNumber(minute, 2)} دقیقه`}
                aria-selected={parsed.minute === minute}
                data-minute={minute}
                data-picker-autofocus={activeMinute === minute ? '' : undefined}
                tabIndex={activeMinute === minute ? 0 : -1}
                style={style}
                onFocus={() => setActiveMinute(minute)}
                onClick={() => {
                  setActiveMinute(minute);
                  onChange(`${pad(parsed.hour)}:${pad(minute)}`);
                }}
                onKeyDown={(event) => minuteKeyDown(event, minute)}
              >
                {formatPersianNumber(minute, 2)}
              </button>
            );
          })}
          <span className="ft-time-picker__minute-center" aria-hidden="true">
            دقیقه
          </span>
        </div>
      )}
      <p className="ft-time-picker__hint">
        {stage === 'hour'
          ? 'ساعت را در بازهٔ ۰۰ تا ۲۳ انتخاب کنید.'
          : 'دقیقه را انتخاب کنید یا برای تغییر ساعت، عدد ساعت را بزنید.'}
      </p>
    </section>
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
