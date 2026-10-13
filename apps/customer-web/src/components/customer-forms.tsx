'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { FuntinoMark } from '@funtino/design-system';
import { FormRenderer } from '@funtino/forms-renderer';
import {
  nextFlowPage,
  resolveCurrentFlowPage,
  validateFormSubmission,
  visibleQuestionPages,
  type FormAnswers,
} from '@funtino/forms-schema';
import { CustomerApiError } from '../lib/customer-api';
import {
  getCustomerFormSession,
  getPublicForm,
  getPublicForms,
  submitPublicForm,
  type PublicForm,
  type PublicFormCard,
} from '../lib/customer-forms';

export function CustomerFormsList({ locale }: { locale: string }) {
  const [forms, setForms] = useState<PublicFormCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void getPublicForms()
      .then((items) => {
        if (active) setForms(items);
      })
      .catch((failure: unknown) => {
        if (active) setError(errorMessage(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="customer-app customer-forms-page">
      <header className="customer-mini-header">
        <FuntinoMark compact className="customer-brand-lockup" />
        <Link href={`/${locale}`} className="ft-form-back-link">
          بازگشت به فانتینو
        </Link>
      </header>
      <section aria-labelledby="customer-forms-heading">
        <p className="ft-form__eyebrow">فانتینو · تجربه‌های شما</p>
        <h1 id="customer-forms-heading">فرم‌های فعال</h1>
        <p className="ft-form__description">
          پرسش‌نامه‌ها و درخواست‌های در دسترس را اینجا می‌بینید.
        </p>
        {loading && (
          <p role="status" aria-live="polite">
            در حال دریافت فرم‌ها…
          </p>
        )}
        {error && (
          <p className="ft-form__error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && forms.length === 0 && (
          <p className="ft-form-state">فعلاً فرمی برای پاسخ‌گویی منتشر نشده است.</p>
        )}
        <ul className="ft-public-form-list">
          {forms.map((form) => (
            <li key={form.id}>
              <Link
                href={`/${locale}/forms/${encodeURIComponent(form.slug)}`}
                className="ft-public-form-card"
              >
                <span className="ft-public-form-card__icon" aria-hidden="true">
                  ✦
                </span>
                <span>
                  <strong>{form.title}</strong>
                  {form.description && <span>{form.description}</span>}
                </span>
                <span className="ft-public-form-card__arrow" aria-hidden="true">
                  ←
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export function CustomerPublicForm({
  locale,
  slug,
  linkParameters,
}: {
  locale: string;
  slug: string;
  linkParameters: Record<string, string | undefined>;
}) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionKnown, setSessionKnown] = useState(false);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [pageId, setPageId] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [linkToAccountConsent, setLinkToAccountConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const submitInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([getPublicForm(slug), getCustomerFormSession()])
      .then(([formResult, sessionResult]) => {
        if (!active) return;
        if (formResult.status === 'fulfilled') {
          setForm(formResult.value);
          setPageId(
            formResult.value.definition.pages.find((page) => page.kind === 'start')?.id ??
              formResult.value.definition.pages.find((page) => page.kind === 'questions')?.id,
          );
        } else {
          setLoadError(errorMessage(formResult.reason));
        }
        if (sessionResult.status === 'fulfilled') {
          setAuthenticated(sessionResult.value.authenticated);
          setSessionKnown(true);
        } else {
          setAuthenticated(false);
          setSessionKnown(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!form || success) return;
    const current = resolveCurrentFlowPage(form.definition, answers, pageId);
    if (current && current.id !== pageId) setPageId(current.id);
  }, [answers, form, pageId, success]);

  function focusFirstIssue(issues: Array<{ fieldId: string; message: string }>) {
    const firstFieldId = issues.find((issue) => issue.fieldId !== 'form')?.fieldId;
    if (!firstFieldId || !form) return;
    const page = visibleQuestionPages(form.definition, answers).find((item) =>
      item.fields.some((field) => field.id === firstFieldId),
    );
    if (page) setPageId(page.id);
    requestAnimationFrame(() => {
      const fieldset = document.getElementById(`form-field-${firstFieldId}`);
      const control = fieldset?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), textarea, select, button',
      );
      control?.focus();
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || busy || success || submitInFlight.current) return;
    const currentPage = resolveCurrentFlowPage(form.definition, answers, pageId);
    if (currentPage?.kind === 'start') {
      const next = nextFlowPage(form.definition, answers, currentPage.id);
      if (next) setPageId(next.id);
      return;
    }
    if (currentPage?.kind === 'questions') {
      const next = nextFlowPage(form.definition, answers, currentPage.id);
      if (next) {
        setPageId(next.id);
        return;
      }
    }
    setSubmitError('');
    const validation = validateFormSubmission(form.definition, answers, linkParameters);
    if (!validation.success) {
      const nextErrors = Object.fromEntries(
        validation.issues.map((issue) => [issue.fieldId, issue.message]),
      );
      setFieldErrors(nextErrors);
      focusFirstIssue(validation.issues);
      return;
    }
    if (form.accessMode === 'auth_required' && (!sessionKnown || !authenticated)) {
      setSubmitError('برای پاسخ‌گویی به این فرم ابتدا وارد حساب مشتری شوید.');
      return;
    }
    submitInFlight.current = true;
    idempotencyKey.current ??= crypto.randomUUID();
    setBusy(true);
    try {
      const result = await submitPublicForm(form.slug, {
        answers: validation.answers,
        idempotencyKey: idempotencyKey.current,
        linkToAccountConsent: authenticated && linkToAccountConsent,
        linkParameters,
      });
      if (result.status === 'invalid') {
        idempotencyKey.current = null;
        const nextErrors = Object.fromEntries(
          result.issues.map((issue) => [issue.fieldId, issue.message]),
        );
        setFieldErrors(nextErrors);
        focusFirstIssue(result.issues);
        setSubmitError('پاسخ‌ها را بررسی کنید و موارد مشخص‌شده را اصلاح کنید.');
      } else {
        setSuccess(true);
      }
    } catch (failure) {
      if (
        failure instanceof CustomerApiError &&
        failure.statusCode === 403 &&
        form.accessMode === 'auth_required'
      ) {
        setSubmitError('برای پاسخ‌گویی به این فرم ابتدا وارد حساب مشتری شوید.');
      } else {
        setSubmitError(errorMessage(failure));
      }
    } finally {
      submitInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="customer-app customer-form-page">
      <header className="customer-mini-header">
        <FuntinoMark compact className="customer-brand-lockup" />
        <Link href={`/${locale}/forms`} className="ft-form-back-link">
          فهرست فرم‌ها
        </Link>
      </header>
      {loading && (
        <p role="status" aria-live="polite">
          در حال بارگذاری فرم…
        </p>
      )}
      {loadError && (
        <section className="ft-form-state" role="alert">
          {loadError}
        </section>
      )}
      {form && success && (
        <section
          className="ft-form-success"
          aria-live="polite"
          aria-labelledby="form-success-heading"
        >
          <span aria-hidden="true" className="ft-form-success__mark">
            ✓
          </span>
          <h1 id="form-success-heading" className="ft-form__visually-hidden">
            ثبت موفق پاسخ
          </h1>
          <FormRenderer definition={form.definition} answers={answers} completed />
          <Link href={`/${locale}/forms`} className="ft-form__button">
            دیدن فرم‌های دیگر
          </Link>
        </section>
      )}
      {form && !success && (
        <form onSubmit={(event) => void handleSubmit(event)}>
          {form.accessMode === 'auth_required' && sessionKnown && !authenticated && (
            <aside className="ft-form-auth-notice" role="status">
              <p>برای پاسخ‌گویی به این فرم باید وارد حساب مشتری شوید.</p>
              <Link href={`/${locale}`} className="ft-form__button">
                ورود به حساب
              </Link>
            </aside>
          )}
          <FormRenderer
            definition={form.definition}
            answers={answers}
            errors={fieldErrors}
            pageId={pageId}
            onPageIdChange={setPageId}
            submitting={busy}
            onAnswerChange={(fieldId, value) => {
              setAnswers((current) => ({ ...current, [fieldId]: value }));
              setFieldErrors((current) => {
                if (!current[fieldId]) return current;
                const next = { ...current };
                delete next[fieldId];
                return next;
              });
              setSubmitError('');
            }}
          />
          {authenticated && (
            <label className="ft-form-consent">
              <input
                type="checkbox"
                checked={linkToAccountConsent}
                onChange={(event) => setLinkToAccountConsent(event.target.checked)}
              />
              <span>
                با رضایت من، پاسخ به حساب مشتری من متصل شود. اگر این گزینه را انتخاب نکنم، پاسخ
                ناشناس می‌ماند.
              </span>
            </label>
          )}
          {form.accessMode === 'auth_required' && !sessionKnown && (
            <p className="ft-form__error" role="status">
              وضعیت ورود بررسی نشده است؛ فرم را دوباره بارگذاری کنید.
            </p>
          )}
          {submitError && (
            <p role="alert" className="ft-form__error">
              {submitError}
            </p>
          )}
        </form>
      )}
    </main>
  );
}

function errorMessage(failure: unknown): string {
  if (failure instanceof CustomerApiError && failure.statusCode === 404)
    return 'این فرم دیگر در دسترس نیست.';
  return failure instanceof Error ? failure.message : 'فرم بارگذاری نشد. دوباره تلاش کنید.';
}
