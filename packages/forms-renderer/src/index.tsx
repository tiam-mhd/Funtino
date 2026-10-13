'use client';

import type { CSSProperties, ChangeEvent, ReactNode } from 'react';
import {
  evaluateCondition,
  nextFlowPage,
  previousFlowPage,
  resolveCurrentFlowPage,
  visibleQuestionPages,
  visibleFlowPages,
  type FormAnswers,
  type FormDefinition,
  type FormField,
  type FormPage,
} from '@funtino/forms-schema';

export type FormRendererProps = {
  definition: FormDefinition;
  answers: FormAnswers;
  onAnswerChange?: (fieldId: string, value: unknown) => void;
  pageIndex?: number;
  onPageChange?: (index: number) => void;
  pageId?: string;
  onPageIdChange?: (pageId: string) => void;
  errors?: Readonly<Record<string, string>>;
  mode?: 'preview' | 'runtime' | 'response';
  readOnly?: boolean;
  completed?: boolean;
  onComplete?: () => void;
  submitting?: boolean;
};

export function FormRenderer({
  definition,
  answers,
  onAnswerChange,
  pageIndex = 0,
  onPageChange,
  pageId,
  onPageIdChange,
  errors = {},
  mode = 'runtime',
  readOnly = mode === 'response',
  completed = false,
  onComplete,
  submitting = false,
}: FormRendererProps) {
  const questions = visibleQuestionPages(definition, answers);
  const flowPages = visibleFlowPages(definition, answers);
  const defaultPage =
    mode === 'response' || readOnly
      ? (questions[pageIndex] ?? questions[0])
      : (flowPages[pageIndex] ?? flowPages[0]);
  const page = completed
    ? visibleFlowPages(definition, answers, true)[0]
    : pageId
      ? resolveCurrentFlowPage(definition, answers, pageId)
      : defaultPage;
  const theme = definition.theme;
  const pagesToRender =
    page?.kind === 'questions' && theme.layout === 'single' ? questions : page ? [page] : [];
  const style = {
    '--form-primary': theme.primaryColor,
    '--form-accent': theme.accentColor,
    '--form-background': theme.backgroundColor,
    '--form-surface': theme.surfaceColor,
    '--form-radius':
      theme.cornerStyle === 'soft' ? '12px' : theme.cornerStyle === 'pill' ? '26px' : '18px',
    '--form-card-max-width': cardWidth(theme.cardStyle.maxWidth),
    '--form-card-padding': `${theme.cardStyle.padding}px`,
    '--form-card-gap': `${theme.cardStyle.gap}px`,
    '--form-card-background': theme.cardStyle.backgroundColor,
    '--form-card-border-color': theme.cardStyle.borderColor,
    '--form-card-border-width': `${theme.cardStyle.borderWidth}px`,
    '--form-card-radius': `${theme.cardStyle.radius}px`,
    '--form-card-shadow': cardShadow(theme.cardStyle.shadow),
    '--form-field-background': theme.surfaceColor,
    '--form-density': theme.density === 'compact' ? '10px' : '14px',
    '--form-button-style': theme.buttonStyle === 'outlined' ? 'transparent' : theme.primaryColor,
    '--form-button-text-color': theme.buttonStyle === 'outlined' ? theme.primaryColor : '#ffffff',
  } as CSSProperties;

  if (!page && completed) {
    return (
      <section
        className={`ft-form ft-form--${mode} ft-form--font-${theme.font}`}
        dir="rtl"
        lang="fa"
        style={style}
      >
        <header className="ft-form__header">
          <p className="ft-form__eyebrow">فانتینو · فرم امن و کوتاه</p>
          <h1>{definition.title}</h1>
        </header>
        <div className="ft-form__page">
          <h2>{definition.successMessage}</h2>
        </div>
      </section>
    );
  }
  if (!page) return <p className="ft-form-state">این فرم هنوز صفحه‌ای برای نمایش ندارد.</p>;

  const currentQuestionIndex = questions.findIndex((candidate) => candidate.id === page.id);
  const progressIndex = currentQuestionIndex < 0 ? 0 : currentQuestionIndex + 1;
  const nextPage =
    page.kind === 'start' ? questions[0] : nextFlowPage(definition, answers, page.id);
  const previousPage = previousFlowPage(definition, answers, page.id);
  const canNavigate =
    !completed && !readOnly && mode !== 'response' && Boolean(onPageIdChange || onPageChange);
  const pageStyle = (currentPage: FormPage): CSSProperties => {
    const card = { ...theme.cardStyle, ...(currentPage.cardStyle ?? {}) };
    return {
      '--form-card-max-width': cardWidth(card.maxWidth),
      '--form-card-padding': `${card.padding}px`,
      '--form-card-gap': `${card.gap}px`,
      '--form-card-background': card.backgroundColor,
      '--form-card-border-color': card.borderColor,
      '--form-card-border-width': `${card.borderWidth}px`,
      '--form-card-radius': `${card.radius}px`,
      '--form-card-shadow': cardShadow(card.shadow),
      '--form-page-background': currentPage.backgroundColor ?? theme.surfaceColor,
    } as CSSProperties;
  };

  const changePage = (target: FormPage) => {
    if (onPageIdChange) onPageIdChange(target.id);
    else
      onPageChange?.(
        visibleFlowPages(definition, answers).findIndex((candidate) => candidate.id === target.id),
      );
  };

  return (
    <section
      className={`ft-form ft-form--${mode} ft-form--font-${theme.font}`}
      dir="rtl"
      lang="fa"
      style={style}
    >
      <header className="ft-form__header">
        <p className="ft-form__eyebrow">فانتینو · فرم امن و کوتاه</p>
        <h1>{definition.title}</h1>
        {definition.description && <p className="ft-form__description">{definition.description}</p>}
        {page.kind === 'start' && definition.welcomeTitle && (
          <h2 className="ft-form__welcome-title">{definition.welcomeTitle}</h2>
        )}
        {page.kind === 'start' && definition.welcomeMessage && (
          <p className="ft-form__welcome-message">{definition.welcomeMessage}</p>
        )}
      </header>
      {!completed &&
        page.kind === 'questions' &&
        theme.layout !== 'single' &&
        theme.showProgress &&
        questions.length > 1 && (
          <div
            className="ft-form__progress"
            aria-label={`مرحله ${progressIndex} از ${questions.length}`}
          >
            <div
              className="ft-form__progress-track"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={questions.length}
              aria-valuenow={progressIndex}
            >
              <span style={{ width: `${(progressIndex / questions.length) * 100}%` }} />
            </div>
            <span>
              مرحلهٔ {progressIndex} از {questions.length}
            </span>
          </div>
        )}
      {pagesToRender.map((currentPage) => {
        const currentPageStyle = pageStyle(currentPage);
        return (
          <div
            className={`ft-form__page ft-form__page--${currentPage.kind}`}
            key={currentPage.id}
            style={currentPageStyle}
          >
            <div className="ft-form__page-heading">
              <h2>{currentPage.title}</h2>
              {currentPage.description && <p>{currentPage.description}</p>}
            </div>
            <div className="ft-form__fields">
              {currentPage.fields
                .filter(
                  (field) => field.type !== 'hidden' && evaluateCondition(field.condition, answers),
                )
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
            {canNavigate && currentPage.id === page.id && page.kind === 'start' && (
              <nav className="ft-form__navigation" aria-label="حرکت بین مرحله‌های فرم">
                <span />
                <button
                  type="button"
                  className="ft-form__button"
                  disabled={!nextPage || submitting}
                  onClick={() => nextPage && changePage(nextPage)}
                >
                  شروع فرم
                </button>
              </nav>
            )}
            {canNavigate &&
              currentPage.id === page.id &&
              page.kind === 'questions' &&
              theme.layout !== 'single' && (
                <nav className="ft-form__navigation" aria-label="حرکت بین مرحله‌های فرم">
                  {previousPage ? (
                    <button
                      type="button"
                      className="ft-form__button ft-form__button--secondary"
                      disabled={submitting}
                      onClick={() => changePage(previousPage)}
                    >
                      مرحلهٔ قبل
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type={nextPage ? 'button' : mode === 'runtime' ? 'submit' : 'button'}
                    className="ft-form__button"
                    disabled={submitting}
                    onClick={
                      !nextPage && mode === 'preview'
                        ? onComplete
                        : nextPage
                          ? () => changePage(nextPage)
                          : undefined
                    }
                  >
                    {submitting
                      ? 'در حال ثبت…'
                      : nextPage
                        ? 'مرحلهٔ بعد'
                        : mode === 'preview'
                          ? 'ثبت پاسخ‌ها'
                          : 'ثبت پاسخ‌ها'}
                  </button>
                </nav>
              )}
            {currentPage.id === page.id &&
              page.kind === 'questions' &&
              theme.layout === 'single' &&
              canNavigate && (
                <nav className="ft-form__navigation" aria-label="ثبت پاسخ‌های فرم">
                  <button
                    type={mode === 'runtime' ? 'submit' : 'button'}
                    className="ft-form__button"
                    disabled={submitting}
                    onClick={mode === 'preview' ? onComplete : undefined}
                  >
                    {submitting ? 'در حال ثبت…' : 'ثبت پاسخ‌ها'}
                  </button>
                </nav>
              )}
          </div>
        );
      })}
      {submitting && (
        <p className="ft-form__submitting" role="status" aria-live="polite">
          در حال ثبت پاسخ‌ها…
        </p>
      )}
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
  const describedBy =
    [field.helpText ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const setValue = (next: unknown) => onChange?.(field.id, next);

  if (field.type === 'heading') {
    return (
      <div className="ft-form__content">
        <h3>{field.label}</h3>
        {field.description && <p>{field.description}</p>}
      </div>
    );
  }
  if (field.type === 'paragraph') {
    return (
      <div className="ft-form__content">
        <p>{field.label}</p>
        {field.description && <p>{field.description}</p>}
      </div>
    );
  }

  const options = field.options ?? [];
  let control: ReactNode;
  const common = {
    id,
    required: field.required,
    disabled: readOnly,
    'aria-describedby': describedBy,
    'aria-invalid': Boolean(error),
  };

  if (['short_text', 'full_name', 'phone', 'email'].includes(field.type)) {
    const inputType = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text';
    control = (
      <input
        {...common}
        type={inputType}
        autoComplete={
          field.type === 'full_name'
            ? 'name'
            : field.type === 'phone'
              ? 'tel'
              : field.type === 'email'
                ? 'email'
                : 'off'
        }
        placeholder={field.placeholder}
        value={typeof value === 'string' ? value : ''}
        maxLength={field.validation.maxLength ?? 4000}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
      />
    );
  } else if (field.type === 'long_text') {
    control = (
      <textarea
        {...common}
        rows={4}
        placeholder={field.placeholder}
        value={typeof value === 'string' ? value : ''}
        maxLength={field.validation.maxLength ?? 4000}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
      />
    );
  } else if (field.type === 'number' || field.type === 'money' || field.type === 'slider') {
    control = (
      <input
        {...common}
        type={field.type === 'slider' ? 'range' : 'number'}
        inputMode="decimal"
        min={field.validation.min}
        max={field.validation.max}
        step={field.type === 'slider' ? 1 : 'any'}
        value={
          typeof value === 'number'
            ? value
            : field.type === 'slider'
              ? (field.validation.min ?? 0)
              : ''
        }
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          setValue(event.target.value === '' ? undefined : Number(event.target.value))
        }
      />
    );
  } else if (field.type === 'date' || field.type === 'time') {
    control = (
      <input
        {...common}
        type={field.type}
        value={typeof value === 'string' ? value : ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
      />
    );
  } else if (field.type === 'single_choice' || field.type === 'yes_no') {
    const choices =
      field.type === 'yes_no'
        ? [
            { id: 'yes', label: 'بله', value: true },
            { id: 'no', label: 'خیر', value: false },
          ]
        : options.map((option) => ({ ...option, value: option.id }));
    control = (
      <div className="ft-form__choice-list" role="radiogroup" aria-labelledby={`${id}-label`}>
        {choices.map((option) => (
          <label className="ft-form__choice" key={option.id}>
            <input
              {...common}
              type="radio"
              name={id}
              value={String(option.value)}
              checked={value === option.value}
              onChange={() => setValue(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  } else if (field.type === 'dropdown') {
    control = (
      <select
        {...common}
        value={typeof value === 'string' ? value : ''}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => setValue(event.target.value)}
      >
        <option value="">انتخاب کنید</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'multiple_choice') {
    const selected = Array.isArray(value) ? value : [];
    control = (
      <div className="ft-form__choice-list">
        {options.map((option) => (
          <label className="ft-form__choice" key={option.id}>
            <input
              {...common}
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={(event) =>
                setValue(
                  event.target.checked
                    ? [...selected, option.id]
                    : selected.filter((item) => item !== option.id),
                )
              }
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  } else if (field.type === 'rating' || field.type === 'nps') {
    const min = field.type === 'nps' ? 0 : 1;
    const max = field.type === 'nps' ? 10 : (field.validation.max ?? 5);
    control = (
      <div className="ft-form__scale" role="radiogroup" aria-labelledby={`${id}-label`}>
        {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((option) => (
          <label key={option} className="ft-form__scale-option">
            <input
              {...common}
              type="radio"
              name={id}
              checked={value === option}
              onChange={() => setValue(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  } else if (field.type === 'ranking') {
    const ranking = Array.isArray(value) ? value.map(String) : options.map((option) => option.id);
    control = (
      <ol className="ft-form__ranking">
        {ranking.map((optionId, index) => {
          const option = options.find((item) => item.id === optionId);
          return (
            <li key={optionId}>
              <span>{option?.label ?? 'گزینه'}</span>
              <button
                type="button"
                aria-label={`انتقال ${option?.label ?? 'گزینه'} به بالا`}
                disabled={readOnly || index === 0}
                onClick={() => setValue(move(ranking, index, index - 1))}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`انتقال ${option?.label ?? 'گزینه'} به پایین`}
                disabled={readOnly || index === ranking.length - 1}
                onClick={() => setValue(move(ranking, index, index + 1))}
              >
                ↓
              </button>
            </li>
          );
        })}
      </ol>
    );
  } else if (field.type === 'matrix') {
    const matrix = (
      value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    ) as Record<string, string>;
    control = (
      <div className="ft-form__matrix-wrap">
        <table className="ft-form__matrix">
          <thead>
            <tr>
              <th scope="col">پرسش</th>
              {options.map((option) => (
                <th key={option.id} scope="col">
                  {option.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(field.rows ?? []).map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                {options.map((option) => (
                  <td key={option.id}>
                    <label>
                      <span className="ft-form__visually-hidden">
                        {row.label}: {option.label}
                      </span>
                      <input
                        {...common}
                        type="radio"
                        name={`${id}-${row.id}`}
                        checked={matrix[row.id] === option.id}
                        onChange={() => setValue({ ...matrix, [row.id]: option.id })}
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (field.type === 'consent') {
    control = (
      <label className="ft-form__choice">
        <input
          {...common}
          type="checkbox"
          checked={value === true}
          onChange={(event) => setValue(event.target.checked)}
        />
        <span>با متن بالا موافقم</span>
      </label>
    );
  } else {
    control = <p className="ft-form__unsupported">این نوع پرسش در نسخهٔ فعلی پشتیبانی نمی‌شود.</p>;
  }

  return (
    <fieldset
      className={`ft-form__field${error ? ' ft-form__field--error' : ''}${field.presentation?.width === 'half' ? ' ft-form__field--half' : ''}${field.presentation?.alignment ? ` ft-form__field--align-${field.presentation.alignment}` : ''}`}
    >
      <legend id={`${id}-label`}>
        {field.label}
        {field.required && <span aria-hidden="true"> *</span>}
      </legend>
      {field.description && <p className="ft-form__field-description">{field.description}</p>}
      {control}
      {field.helpText && (
        <p id={helpId} className="ft-form__help">
          {field.helpText}
        </p>
      )}
      {error && (
        <p id={errorId} className="ft-form__error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function cardWidth(width: 'narrow' | 'medium' | 'wide' | 'full'): string {
  if (width === 'narrow') return '520px';
  if (width === 'medium') return '720px';
  if (width === 'full') return '100%';
  return '960px';
}

function cardShadow(shadow: 'none' | 'soft' | 'raised'): string {
  if (shadow === 'none') return 'none';
  return shadow === 'raised' ? '0 14px 36px rgb(32 35 65 / 12%)' : '0 8px 22px rgb(32 35 65 / 6%)';
}

function move<T>(values: T[], from: number, to: number): T[] {
  if (to < 0 || to >= values.length || from < 0 || from >= values.length) return values;
  const next = [...values];
  const [value] = next.splice(from, 1);
  if (value !== undefined) next.splice(to, 0, value);
  return next;
}
