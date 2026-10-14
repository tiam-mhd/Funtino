'use client';

import { useId, useState, type AriaAttributes, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  currentLocalGregorianDate,
  formatPersianDateTime,
  formatJalaliDate,
  formatPersianTime,
  isDateWithinBounds,
  joinLocalDateTime,
  parseLocalDateTime,
  parseTimeValue,
} from './persian-calendar';
import { PickerDialog } from './picker-dialog';
import { ClockTimeSelector, JalaliDateSelector } from './selectors';

type PickerFieldProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  title?: string;
  className?: string;
} & Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid' | 'aria-labelledby'>;

export type JalaliDatePickerFieldProps = PickerFieldProps & {
  minDate?: string;
  maxDate?: string;
};

export function JalaliDatePickerField({
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  allowClear = true,
  title = 'انتخاب تاریخ',
  minDate,
  maxDate,
  className,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  'aria-labelledby': labelledBy,
}: JalaliDatePickerFieldProps) {
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const display = formatJalaliDate(value);

  const begin = () => {
    if (disabled) return;
    const today = currentLocalGregorianDate();
    const preferred = value || today;
    setDraft(isDateWithinBounds(preferred, minDate, maxDate) ? preferred : nearestBoundedDate(preferred, minDate, maxDate));
    setOpen(true);
  };

  const confirm = () => {
    if (!draft || !isDateWithinBounds(draft, minDate, maxDate)) return;
    onChange(draft);
    setOpen(false);
  };

  return (
    <>
      <span className="ft-picker-control">
        <input
          id={id}
          type="text"
          className={`ft-picker-field${invalid ? ' is-invalid' : ''}${className ? ` ${className}` : ''}`}
          value={display ?? ''}
          placeholder="انتخاب تاریخ"
          required={required}
          disabled={disabled}
          inputMode="none"
          role="combobox"
          aria-haspopup="dialog"
          aria-autocomplete="none"
          aria-controls={dialogId}
          aria-expanded={open}
          aria-readonly="true"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-labelledby={labelledBy}
          onChange={() => undefined}
          onBeforeInput={(event) => event.preventDefault()}
          onPaste={(event) => event.preventDefault()}
          onDrop={(event) => event.preventDefault()}
          onClick={begin}
          onKeyDown={(event) => handlePickerKeyDown(event, begin)}
        />
        <CalendarIcon />
      </span>
      <PickerDialog
        id={dialogId}
        open={open}
        title={title}
        onClose={() => setOpen(false)}
        footer={(
          <>
            {allowClear && value && <button className="ft-picker-dialog__text-action" type="button" onClick={() => { onChange(''); setOpen(false); }}>پاک‌کردن تاریخ</button>}
            <span className="ft-picker-dialog__footer-spacer" />
            <button className="ft-picker-dialog__secondary" type="button" onClick={() => setOpen(false)}>انصراف</button>
            <button className="ft-picker-dialog__primary" type="button" disabled={!draft || !isDateWithinBounds(draft, minDate, maxDate)} onClick={confirm}>تأیید تاریخ</button>
          </>
        )}
      >
        <JalaliDateSelector value={draft || currentLocalGregorianDate()} onChange={setDraft} minDate={minDate} maxDate={maxDate} />
      </PickerDialog>
    </>
  );
}

export type ClockTimePickerFieldProps = PickerFieldProps;

export function ClockTimePickerField({
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  allowClear = true,
  title = 'انتخاب ساعت',
  className,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  'aria-labelledby': labelledBy,
}: ClockTimePickerFieldProps) {
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const display = formatPersianTime(value);

  const begin = () => {
    if (disabled) return;
    setDraft(parseTimeValue(value) ? value : '00:00');
    setOpen(true);
  };
  const confirm = () => {
    if (!parseTimeValue(draft)) return;
    onChange(draft);
    setOpen(false);
  };

  return (
    <>
      <span className="ft-picker-control">
        <input
          id={id}
          type="text"
          className={`ft-picker-field ft-picker-field--time${invalid ? ' is-invalid' : ''}${className ? ` ${className}` : ''}`}
          value={display ?? ''}
          placeholder="انتخاب ساعت"
          required={required}
          disabled={disabled}
          inputMode="none"
          role="combobox"
          aria-haspopup="dialog"
          aria-autocomplete="none"
          aria-controls={dialogId}
          aria-expanded={open}
          aria-readonly="true"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-labelledby={labelledBy}
          onChange={() => undefined}
          onBeforeInput={(event) => event.preventDefault()}
          onPaste={(event) => event.preventDefault()}
          onDrop={(event) => event.preventDefault()}
          onClick={begin}
          onKeyDown={(event) => handlePickerKeyDown(event, begin)}
        />
        <ClockIcon />
      </span>
      <PickerDialog
        id={dialogId}
        open={open}
        title={title}
        onClose={() => setOpen(false)}
        footer={(
          <>
            {allowClear && value && <button className="ft-picker-dialog__text-action" type="button" onClick={() => { onChange(''); setOpen(false); }}>پاک‌کردن ساعت</button>}
            <span className="ft-picker-dialog__footer-spacer" />
            <button className="ft-picker-dialog__secondary" type="button" onClick={() => setOpen(false)}>انصراف</button>
            <button className="ft-picker-dialog__primary" type="button" onClick={confirm}>تأیید ساعت</button>
          </>
        )}
      >
        <ClockTimeSelector value={draft || '00:00'} onChange={setDraft} />
      </PickerDialog>
    </>
  );
}

export type DateTimePickerFieldProps = PickerFieldProps;

export function DateTimePickerField({
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  allowClear = true,
  title = 'انتخاب تاریخ و ساعت',
  className,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  'aria-labelledby': labelledBy,
}: DateTimePickerFieldProps) {
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'date' | 'time'>('date');
  const [draftDate, setDraftDate] = useState(currentLocalGregorianDate());
  const [draftTime, setDraftTime] = useState('00:00');
  const display = formatPersianDateTime(value);

  const begin = () => {
    if (disabled) return;
    const parsed = parseLocalDateTime(value);
    setDraftDate(parsed?.date ?? currentLocalGregorianDate());
    const now = new Date();
    setDraftTime(parsed?.time ?? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    setStage('date');
    setOpen(true);
  };
  const confirm = () => {
    const result = joinLocalDateTime(draftDate, draftTime);
    if (!result) return;
    onChange(result);
    setOpen(false);
  };

  return (
    <>
      <span className="ft-picker-control">
        <input
          id={id}
          type="text"
          className={`ft-picker-field${invalid ? ' is-invalid' : ''}${className ? ` ${className}` : ''}`}
          value={display ?? ''}
          placeholder="انتخاب تاریخ و ساعت"
          required={required}
          disabled={disabled}
          inputMode="none"
          role="combobox"
          aria-haspopup="dialog"
          aria-autocomplete="none"
          aria-controls={dialogId}
          aria-expanded={open}
          aria-readonly="true"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-labelledby={labelledBy}
          onChange={() => undefined}
          onBeforeInput={(event) => event.preventDefault()}
          onPaste={(event) => event.preventDefault()}
          onDrop={(event) => event.preventDefault()}
          onClick={begin}
          onKeyDown={(event) => handlePickerKeyDown(event, begin)}
        />
        <CalendarIcon />
      </span>
      <PickerDialog
        id={dialogId}
        open={open}
        title={title}
        onClose={() => setOpen(false)}
        footer={(
          <>
            {allowClear && value && <button className="ft-picker-dialog__text-action" type="button" onClick={() => { onChange(''); setOpen(false); }}>پاک‌کردن</button>}
            <span className="ft-picker-dialog__footer-spacer" />
            <button className="ft-picker-dialog__secondary" type="button" onClick={() => setOpen(false)}>انصراف</button>
            <button className="ft-picker-dialog__primary" type="button" onClick={confirm}>تأیید تاریخ و ساعت</button>
          </>
        )}
      >
        <div className="ft-date-time-picker">
          <div className="ft-date-time-picker__tabs" role="tablist" aria-label="بخش انتخاب زمان">
            <button type="button" role="tab" aria-selected={stage === 'date'} className={stage === 'date' ? 'is-active' : ''} onClick={() => setStage('date')}>
              {formatJalaliDate(draftDate) ?? 'تاریخ'}
            </button>
            <button type="button" role="tab" aria-selected={stage === 'time'} className={stage === 'time' ? 'is-active' : ''} onClick={() => setStage('time')}>
              {formatPersianTime(draftTime) ?? 'ساعت'}
            </button>
          </div>
          {stage === 'date' ? (
            <JalaliDateSelector value={draftDate} onChange={setDraftDate} />
          ) : (
            <ClockTimeSelector value={draftTime} onChange={setDraftTime} />
          )}
        </div>
      </PickerDialog>
    </>
  );
}

function nearestBoundedDate(value: string, minDate?: string, maxDate?: string): string {
  if (minDate && value < minDate) return minDate;
  if (maxDate && value > maxDate) return maxDate;
  return value;
}

function handlePickerKeyDown(
  event: ReactKeyboardEvent<HTMLInputElement>,
  openPicker: () => void,
) {
  if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    openPicker();
    return;
  }
  if (!['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
  }
}

function CalendarIcon() {
  return (
    <svg className="ft-picker-field__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="2.5" y="4" width="15" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 2.5v3M14 2.5v3M3 7.5h14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="ft-picker-field__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 5.5V10l3 1.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
