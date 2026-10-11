'use client';

import type { CSSProperties, ChangeEvent, ReactNode } from 'react';
import {
  evaluateCondition,
  visiblePages,
  type FormAnswers,
  type FormDefinition,
  type FormField,
} from '@funtino/forms-schema';

export type FormRendererProps = {
  definition: FormDefinition;
  answers: FormAnswers;
  onAnswerChange?: (fieldId: string, value: unknown) => void;
  pageIndex?: number;
  onPageChange?: (index: number) => void;
  errors?: Readonly<Record<string, string>>;
  mode?: 'preview' | 'runtime' | 'response';
  readOnly?: boolean;
};

export function FormRenderer({
  definition,
  answers,
  onAnswerChange,
  pageIndex = 0,
  onPageChange,
  errors = {},
  mode = 'runtime',
  readOnly = mode === 'response',
}: FormRendererProps) {
  const pages = visiblePages(definition, answers);
  const safePageIndex = Math.max(0, Math.min(pageIndex, Math.max(0, pages.length - 1)));
  const page = pages[safePageIndex];
  if (!page) return <p className="ft-form-state">این فرم هنوز صفحه‌ای برای نمایش ندارد.</p>;

  const theme = definition.theme;
  const pagesToRender = theme.layout === 'single' ? pages : [page];
  const style = {
    '--form-primary': theme.primaryColor,
    '--form-accent': theme.accentColor,
    '--form-background': theme.backgroundColor,
    '--form-surface': theme.surfaceColor,
    '--form-radius': theme.cornerStyle === 'soft' ? '12px' : theme.cornerStyle === 'pill' ? '26px' : '18px',
  } as CSSProperties;

  return (
    <section className={`ft-form ft-form--${mode}`} dir="rtl" lang="fa" style={style}>
      <header className="ft-form__header">
        <p className="ft-form__eyebrow">فانتینو · فرم امن و کوتاه</p>
        <h1>{definition.title}</h1>
        {definition.description && <p className="ft-form__description">{definition.description}</p>}
        {safePageIndex === 0 && definition.welcomeTitle && <h2 className="ft-form__welcome-title">{definition.welcomeTitle}</h2>}
        {safePageIndex === 0 && definition.welcomeMessage && <p className="ft-form__welcome-message">{definition.welcomeMessage}</p>}
      </header>
      {theme.layout !== 'single' && theme.showProgress && pages.length > 1 && (
        <div className="ft-form__progress" aria-label={`مرحله ${safePageIndex + 1} از ${pages.length}`}>
          <div className="ft-form__progress-track" role="progressbar" aria-valuemin={1} aria-valuemax={pages.length} aria-valuenow={safePageIndex + 1}>
            <span style={{ width: `${((safePageIndex + 1) / pages.length) * 100}%` }} />
          </div>
          <span>مرحلهٔ {safePageIndex + 1} از {pages.length}</span>
        </div>
      )}
      {pagesToRender.map((currentPage) => (
        <div className="ft-form__page" key={currentPage.id}>
          <div className="ft-form__page-heading">
            <h2>{currentPage.title}</h2>
            {currentPage.description && <p>{currentPage.description}</p>}
          </div>
          <div className="ft-form__fields">
            {currentPage.fields
              .filter((field) => field.type !== 'hidden' && evaluateCondition(field.condition, answers))
              .map((field) => (
                <FieldControl
                  key={field.id}
                  field={field}
                  value={answers[field.id] === undefined ? field.defaultValue : answers[field.id]}
                  error={errors[field.id]}
                  onChange={onAnswerChange}
                  readOnly={readOnly}
                />
              ))}
          </div>
          {theme.layout !== 'single' && onPageChange && pages.length > 1 && (
            <nav className="ft-form__navigation" aria-label="حرکت بین مرحله‌های فرم">
              <button type="button" className="ft-form__button ft-form__button--secondary" disabled={safePageIndex === 0} onClick={() => onPageChange(safePageIndex - 1)}>
                مرحلهٔ قبل
              </button>
              <button type="button" className="ft-form__button" disabled={safePageIndex >= pages.length - 1} onClick={() => onPageChange(safePageIndex + 1)}>
                مرحلهٔ بعد
              </button>
            </nav>
          )}
        </div>
      ))}
    </section>
  );
}

function FieldControl({
  field,
  value,
  error,
  onChange,
  readOnly,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  onChange?: (fieldId: string, value: unknown) => void;
  readOnly: boolean;
}) {
  const id = `form-field-${field.id}`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [field.helpText ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const setValue = (next: unknown) => onChange?.(field.id, next);

  if (field.type === 'heading') {
    return <div className="ft-form__content"><h3>{field.label}</h3>{field.description && <p>{field.description}</p>}</div>;
  }
  if (field.type === 'paragraph') {
    return <div className="ft-form__content"><p>{field.label}</p>{field.description && <p>{field.description}</p>}</div>;
  }

  const options = field.options ?? [];
  let control: ReactNode;
  const common = { id, required: field.required, disabled: readOnly, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) };

  if (['short_text', 'full_name', 'phone', 'email'].includes(field.type)) {
    const inputType = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text';
    control = <input {...common} type={inputType} autoComplete={field.type === 'full_name' ? 'name' : field.type === 'phone' ? 'tel' : field.type === 'email' ? 'email' : 'off'} placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} maxLength={field.validation.maxLength ?? 4000} onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)} />;
  } else if (field.type === 'long_text') {
    control = <textarea {...common} rows={4} placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} maxLength={field.validation.maxLength ?? 4000} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)} />;
  } else if (field.type === 'number' || field.type === 'money' || field.type === 'slider') {
    control = <input {...common} type={field.type === 'slider' ? 'range' : 'number'} inputMode="decimal" min={field.validation.min} max={field.validation.max} step={field.type === 'slider' ? 1 : 'any'} value={typeof value === 'number' ? value : field.type === 'slider' ? field.validation.min ?? 0 : ''} onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value === '' ? undefined : Number(event.target.value))} />;
  } else if (field.type === 'date' || field.type === 'time') {
    control = <input {...common} type={field.type} value={typeof value === 'string' ? value : ''} onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)} />;
  } else if (field.type === 'single_choice' || field.type === 'yes_no') {
    const choices = field.type === 'yes_no' ? [{ id: 'yes', label: 'بله', value: true }, { id: 'no', label: 'خیر', value: false }] : options.map((option) => ({ ...option, value: option.id }));
    control = <div className="ft-form__choice-list" role="radiogroup" aria-labelledby={`${id}-label`}>{choices.map((option) => <label className="ft-form__choice" key={option.id}><input {...common} type="radio" name={id} value={String(option.value)} checked={value === option.value} onChange={() => setValue(option.value)} /><span>{option.label}</span></label>)}</div>;
  } else if (field.type === 'dropdown') {
    control = <select {...common} value={typeof value === 'string' ? value : ''} onChange={(event: ChangeEvent<HTMLSelectElement>) => setValue(event.target.value)}><option value="">انتخاب کنید</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>;
  } else if (field.type === 'multiple_choice') {
    const selected = Array.isArray(value) ? value : [];
    control = <div className="ft-form__choice-list">{options.map((option) => <label className="ft-form__choice" key={option.id}><input {...common} type="checkbox" checked={selected.includes(option.id)} onChange={(event) => setValue(event.target.checked ? [...selected, option.id] : selected.filter((item) => item !== option.id))} /><span>{option.label}</span></label>)}</div>;
  } else if (field.type === 'rating' || field.type === 'nps') {
    const min = field.type === 'nps' ? 0 : 1;
    const max = field.type === 'nps' ? 10 : field.validation.max ?? 5;
    control = <div className="ft-form__scale" role="radiogroup" aria-labelledby={`${id}-label`}>{Array.from({ length: max - min + 1 }, (_, index) => min + index).map((option) => <label key={option} className="ft-form__scale-option"><input {...common} type="radio" name={id} checked={value === option} onChange={() => setValue(option)} /><span>{option}</span></label>)}</div>;
  } else if (field.type === 'ranking') {
    const ranking = Array.isArray(value) ? value.map(String) : options.map((option) => option.id);
    control = <ol className="ft-form__ranking">{ranking.map((optionId, index) => { const option = options.find((item) => item.id === optionId); return <li key={optionId}><span>{option?.label ?? 'گزینه'}</span><button type="button" aria-label={`انتقال ${option?.label ?? 'گزینه'} به بالا`} disabled={readOnly || index === 0} onClick={() => setValue(move(ranking, index, index - 1))}>↑</button><button type="button" aria-label={`انتقال ${option?.label ?? 'گزینه'} به پایین`} disabled={readOnly || index === ranking.length - 1} onClick={() => setValue(move(ranking, index, index + 1))}>↓</button></li>; })}</ol>;
  } else if (field.type === 'matrix') {
    const matrix = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, string>;
    control = <div className="ft-form__matrix-wrap"><table className="ft-form__matrix"><thead><tr><th scope="col">پرسش</th>{options.map((option) => <th key={option.id} scope="col">{option.label}</th>)}</tr></thead><tbody>{(field.rows ?? []).map((row) => <tr key={row.id}><th scope="row">{row.label}</th>{options.map((option) => <td key={option.id}><label><span className="ft-form__visually-hidden">{row.label}: {option.label}</span><input {...common} type="radio" name={`${id}-${row.id}`} checked={matrix[row.id] === option.id} onChange={() => setValue({ ...matrix, [row.id]: option.id })} /></label></td>)}</tr>)}</tbody></table></div>;
  } else if (field.type === 'consent') {
    control = <label className="ft-form__choice"><input {...common} type="checkbox" checked={value === true} onChange={(event) => setValue(event.target.checked)} /><span>با متن بالا موافقم</span></label>;
  } else {
    control = <p className="ft-form__unsupported">این نوع پرسش در نسخهٔ فعلی پشتیبانی نمی‌شود.</p>;
  }

  return (
    <fieldset className={`ft-form__field${error ? ' ft-form__field--error' : ''}`}>
      <legend id={`${id}-label`}>{field.label}{field.required && <span aria-hidden="true"> *</span>}</legend>
      {field.description && <p className="ft-form__field-description">{field.description}</p>}
      {control}
      {field.helpText && <p id={helpId} className="ft-form__help">{field.helpText}</p>}
      {error && <p id={errorId} className="ft-form__error" role="alert">{error}</p>}
    </fieldset>
  );
}

function move<T>(values: T[], from: number, to: number): T[] {
  if (to < 0 || to >= values.length || from < 0 || from >= values.length) return values;
  const next = [...values];
  const [value] = next.splice(from, 1);
  if (value !== undefined) next.splice(to, 0, value);
  return next;
}
