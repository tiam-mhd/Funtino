'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Badge, Button, ClockTimePickerField, JalaliDatePickerField } from '@funtino/design-system';
import {
  createEmptyFormDefinition,
  formFieldTypes,
  formThemeSchema,
  type FormDefinition,
  type FormField,
  type FormFieldType,
  type FormStatus,
  type FormTheme,
} from '@funtino/forms-schema';
import { FormRenderer } from '@funtino/forms-renderer';
import { ApiRequestError } from '../../lib/api/client';
import { LoadingSkeleton } from '../../components/system-shell/LoadingSkeleton';
import { ManagementListPage } from '../../components/system-shell/ManagementListPage';
import {
  createSystemFormTemplate,
  getSystemFormTemplates,
  getSystemForms,
  getSystemFormsSettings,
  updateSystemFormTemplate,
  updateSystemFormsSettings,
  type SystemFormMetadata,
  type SystemFormTemplate,
  type SystemFormsSettings,
} from '../../lib/api/system-forms';
import styles from './SystemFormsManagement.module.css';

const typeLabels: Record<FormFieldType, string> = {
  short_text: 'متن کوتاه',
  long_text: 'متن بلند',
  full_name: 'نام کامل',
  phone: 'تلفن',
  email: 'ایمیل',
  number: 'عدد',
  money: 'مبلغ',
  date: 'تاریخ',
  time: 'زمان',
  single_choice: 'تک‌گزینه‌ای',
  multiple_choice: 'چندگزینه‌ای',
  dropdown: 'فهرست کشویی',
  yes_no: 'بله/خیر',
  rating: 'امتیاز',
  nps: 'شاخص NPS',
  slider: 'مقیاس',
  ranking: 'رتبه‌بندی',
  matrix: 'ماتریس',
  consent: 'رضایت',
  heading: 'عنوان',
  paragraph: 'توضیح',
  hidden: 'فیلد پنهان',
};
const formFieldInputRenderers = {
  date: JalaliDatePickerField,
  time: ClockTimePickerField,
};

export function SystemFormsManagement({ view = 'forms' }: { view?: 'forms' | 'templates' }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const locale = pathname.split('/')[1] || 'fa';
  const templatesBasePath = `/${locale}/forms/templates`;
  const templateRouteParts = (pathname.split('/forms/templates')[1] ?? '')
    .split('/')
    .filter(Boolean);
  const templateRouteMode =
    templateRouteParts[0] === 'new'
      ? 'create'
      : templateRouteParts[0] === 'settings'
        ? 'settings'
        : templateRouteParts.length > 1 && templateRouteParts[1] === 'edit'
          ? 'edit'
          : templateRouteParts.length === 1
            ? 'details'
            : 'list';
  const templateRouteId =
    templateRouteMode === 'edit' || templateRouteMode === 'details'
      ? decodeURIComponent(templateRouteParts[0] ?? '')
      : '';
  const [forms, setForms] = useState<SystemFormMetadata[]>([]);
  const [templates, setTemplates] = useState<SystemFormTemplate[]>([]);
  const [settings, setSettings] = useState<SystemFormsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [themeDraft, setThemeDraft] = useState<FormTheme | null>(null);
  const [formQuery, setFormQuery] = useState('');
  const [formStatus, setFormStatus] = useState<FormStatus | ''>('');
  const [formNextCursor, setFormNextCursor] = useState<string | null>(null);
  const [formCursorHistory, setFormCursorHistory] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [formPageNumber, setFormPageNumber] = useState(1);
  const [appliedFilters, setAppliedFilters] = useState<{
    query: string;
    status: FormStatus | '';
  } | null>(null);
  const [filterBusy, setFilterBusy] = useState(false);
  const [templatePageNumber, setTemplatePageNumber] = useState(1);
  const [templateQuery, setTemplateQuery] = useState('');
  const [templateEnabled, setTemplateEnabled] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [appliedTemplateFilters, setAppliedTemplateFilters] = useState({
    query: '',
    enabled: 'all' as 'all' | 'enabled' | 'disabled',
  });

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const loadMetadata = useCallback(
    async (cursor?: string) => {
      const page = await getSystemForms({
        query: formQuery.trim() || undefined,
        status: formStatus || undefined,
        cursor,
        pageSize: 50,
      });
      setForms(page.items);
      setFormNextCursor(page.nextCursor);
    },
    [formQuery, formStatus],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [page, globalTemplates, currentSettings] = await Promise.all([
        getSystemForms({ pageSize: 50 }),
        getSystemFormTemplates(),
        getSystemFormsSettings(),
      ]);
      setForms(page.items);
      setFormNextCursor(page.nextCursor);
      setFormCursorHistory([undefined]);
      setFormPageNumber(1);
      setAppliedFilters(null);
      setFormQuery('');
      setFormStatus('');
      setTemplates(globalTemplates);
      setSelectedTemplateId((current) =>
        globalTemplates.some((item) => item.id === current)
          ? current
          : (globalTemplates[0]?.id ?? ''),
      );
      setSettings(currentSettings);
      setThemeDraft(currentSettings.defaultTheme);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (templateRouteId && templates.some((item) => item.id === templateRouteId)) {
      setSelectedTemplateId(templateRouteId);
    }
  }, [templateRouteId, templates]);

  useEffect(() => {
    setTemplatePageNumber(1);
  }, [templateRouteMode, appliedTemplateFilters]);

  async function applyFilters(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    setFilterBusy(true);
    setError('');
    try {
      await loadMetadata();
      setAppliedFilters({ query: formQuery.trim(), status: formStatus });
      setFormCursorHistory([undefined]);
      setFormPageNumber(1);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setFilterBusy(false);
    }
  }

  async function clearFilters(): Promise<boolean> {
    setFormQuery('');
    setFormStatus('');
    setFilterBusy(true);
    setError('');
    try {
      const page = await getSystemForms({ pageSize: 50 });
      setForms(page.items);
      setFormNextCursor(page.nextCursor);
      setFormCursorHistory([undefined]);
      setFormPageNumber(1);
      setAppliedFilters(null);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setFilterBusy(false);
    }
  }

  async function loadNextForms() {
    if (!formNextCursor || filterBusy) return;
    setFilterBusy(true);
    setError('');
    try {
      await loadMetadata(formNextCursor);
      setFormCursorHistory((current) => [...current, formNextCursor]);
      setFormPageNumber((current) => current + 1);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setFilterBusy(false);
    }
  }

  async function loadPreviousForms() {
    if (formCursorHistory.length < 2 || filterBusy) return;
    const previousCursor = formCursorHistory[formCursorHistory.length - 2];
    setFilterBusy(true);
    setError('');
    try {
      await loadMetadata(previousCursor);
      setFormCursorHistory((current) => current.slice(0, -1));
      setFormPageNumber((current) => Math.max(1, current - 1));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setFilterBusy(false);
    }
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateName.trim() || !themeDraft) return;
    setBusy(true);
    setError('');
    try {
      const template = await createSystemFormTemplate({
        name: templateName.trim(),
        description: templateDescription.trim(),
        definition: emptyTemplateDefinition(templateName.trim(), themeDraft),
      });
      setTemplates((current) =>
        [...current, template].sort((left, right) => left.name.localeCompare(right.name, 'fa')),
      );
      setSelectedTemplateId(template.id);
      setTemplateName('');
      setTemplateDescription('');
      setNotice('قالب سراسری ایجاد شد.');
      router.push(`${templatesBasePath}/${encodeURIComponent(template.id)}`);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (!selectedTemplate) return;
    setBusy(true);
    setError('');
    try {
      const updated = await updateSystemFormTemplate(selectedTemplate.id, {
        name: selectedTemplate.name,
        description: selectedTemplate.description,
        definition: selectedTemplate.definition,
        enabled: selectedTemplate.enabled,
      });
      setTemplates((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice('تغییرات قالب ذخیره شد.');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveTheme() {
    if (!themeDraft) return;
    const parsed = formThemeSchema.safeParse(themeDraft);
    if (!parsed.success) {
      setError('تنظیمات ظاهر معتبر نیست.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await updateSystemFormsSettings(parsed.data);
      setSettings(updated);
      setThemeDraft(updated.defaultTheme);
      setNotice('ظاهر پیش‌فرض فرم‌های جدید ذخیره شد.');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function updateSelectedTemplate(updater: (template: SystemFormTemplate) => SystemFormTemplate) {
    if (!selectedTemplate) return;
    setTemplates((current) =>
      current.map((item) => (item.id === selectedTemplate.id ? updater(item) : item)),
    );
  }

  function updateTemplateDefinition(updater: (definition: FormDefinition) => FormDefinition) {
    updateSelectedTemplate((template) => ({
      ...template,
      definition: normalizeDefinition(updater(template.definition)),
    }));
  }

  const fieldEntries =
    selectedTemplate?.definition.pages.flatMap((page, pageIndex) =>
      page.fields.map((field, fieldIndex) => ({ pageIndex, fieldIndex, field })),
    ) ?? [];
  const filteredTemplates = templates.filter((template) => {
    const matchesQuery = `${template.name} ${template.description}`
      .toLocaleLowerCase('fa-IR')
      .includes(appliedTemplateFilters.query.toLocaleLowerCase('fa-IR'));
    const matchesEnabled =
      appliedTemplateFilters.enabled === 'all' ||
      template.enabled === (appliedTemplateFilters.enabled === 'enabled');
    return matchesQuery && matchesEnabled;
  });
  const visibleTemplates = filteredTemplates.slice(
    (templatePageNumber - 1) * 25,
    templatePageNumber * 25,
  );

  function applyTemplateFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedTemplateFilters({ query: templateQuery.trim(), enabled: templateEnabled });
  }

  function clearTemplateFilters() {
    setTemplateQuery('');
    setTemplateEnabled('all');
    setAppliedTemplateFilters({ query: '', enabled: 'all' });
  }

  return (
    <main className={styles.page} dir="rtl">
      <ManagementListPage
        eyebrow="مدیریت سراسری · فرم‌ها"
        title={
          view === 'forms'
            ? 'فهرست فرم‌ها'
            : templateRouteMode === 'create'
              ? 'ایجاد قالب بازخورد'
              : templateRouteMode === 'edit'
                ? 'ویرایش قالب بازخورد'
                : templateRouteMode === 'details'
                  ? 'جزئیات قالب بازخورد'
                  : templateRouteMode === 'settings'
                    ? 'ظاهر پیش‌فرض فرم‌ها'
                    : 'قالب‌های سراسری'
        }
        description={
          view === 'forms'
            ? 'فراداده و شمارنده‌ی پاسخ‌ها را بررسی کنید؛ محتوای پاسخ مشتری در این پنل نمایش داده نمی‌شود.'
            : templateRouteMode === 'create'
              ? 'قالب تازه را برای استفاده‌ی مدیران مجموعه و شعبه تعریف کنید.'
              : templateRouteMode === 'edit'
                ? 'اطلاعات و پرسش‌های قالب منتخب را بازبینی و ذخیره کنید.'
                : templateRouteMode === 'details'
                  ? 'مشخصات و پیش‌نمایش قالب را مشاهده کنید.'
                  : templateRouteMode === 'settings'
                    ? 'ظاهر پیش‌فرض فقط برای فرم‌های تازه به کار می‌رود.'
                    : 'قالب‌های در دسترس مدیران و ظاهر پیش‌فرض فرم‌های تازه را مدیریت کنید.'
        }
        headerActions={
          view === 'templates' && templateRouteMode === 'list' ? (
            <>
              <Button type="button" onClick={() => router.push(`${templatesBasePath}/new`)}>
                ایجاد قالب
              </Button>
              <Button
                type="button"
                tone="secondary"
                onClick={() => router.push(`${templatesBasePath}/settings`)}
              >
                تنظیمات ظاهر
              </Button>
            </>
          ) : view === 'templates' && templateRouteMode === 'details' && selectedTemplate ? (
            <Button
              type="button"
              onClick={() =>
                router.push(`${templatesBasePath}/${encodeURIComponent(selectedTemplate.id)}/edit`)
              }
            >
              ویرایش قالب
            </Button>
          ) : view === 'templates' && templateRouteMode === 'edit' ? (
            <Button
              type="button"
              disabled={busy || !selectedTemplate}
              onClick={() => void saveTemplate()}
            >
              {busy ? 'در حال ذخیره…' : 'ذخیره‌ی تغییرات'}
            </Button>
          ) : undefined
        }
        toolbarActions={
          view === 'forms' || (view === 'templates' && templateRouteMode === 'list') ? (
            <Button
              type="button"
              tone="ghost"
              disabled={loading || busy}
              onClick={() => void loadAll()}
            >
              بازخوانی
            </Button>
          ) : undefined
        }
        filterTitle={view === 'forms' ? 'جست‌وجو و فیلتر فرم‌ها' : 'جست‌وجو و فیلتر قالب‌ها'}
        filterDescription={
          view === 'forms'
            ? 'عنوان یا وضعیت انتشار را برای محدودکردن نتیجه‌ها انتخاب کنید.'
            : 'عبارت را روی مجموعه‌ی کامل قالب‌های دریافت‌شده اعمال کنید.'
        }
        filterFields={
          view === 'forms' ? (
            <>
              <label>
                عنوان فرم
                <input
                  value={formQuery}
                  onChange={(event) => setFormQuery(event.target.value)}
                  maxLength={120}
                />
              </label>
              <label>
                وضعیت
                <select
                  value={formStatus}
                  onChange={(event) => setFormStatus(event.target.value as FormStatus | '')}
                >
                  <option value="">همه</option>
                  <option value="draft">پیش‌نویس</option>
                  <option value="published">منتشرشده</option>
                  <option value="paused">متوقف</option>
                  <option value="archived">بایگانی</option>
                </select>
              </label>
            </>
          ) : view === 'templates' && templateRouteMode === 'list' ? (
            <>
              <label>
                نام یا توضیح قالب
                <input
                  value={templateQuery}
                  onChange={(event) => setTemplateQuery(event.target.value)}
                  maxLength={120}
                />
              </label>
              <label>
                وضعیت قالب
                <select
                  value={templateEnabled}
                  onChange={(event) =>
                    setTemplateEnabled(event.target.value as 'all' | 'enabled' | 'disabled')
                  }
                >
                  <option value="all">همه</option>
                  <option value="enabled">فعال</option>
                  <option value="disabled">غیرفعال</option>
                </select>
              </label>
            </>
          ) : undefined
        }
        appliedFilterCount={
          view === 'forms'
            ? (appliedFilters?.query ? 1 : 0) + (appliedFilters?.status ? 1 : 0)
            : view === 'templates' && templateRouteMode === 'list'
              ? (appliedTemplateFilters.query ? 1 : 0) +
                (appliedTemplateFilters.enabled !== 'all' ? 1 : 0)
              : 0
        }
        onApplyFilters={
          view === 'forms'
            ? applyFilters
            : view === 'templates' && templateRouteMode === 'list'
              ? applyTemplateFilters
              : undefined
        }
        onClearFilters={
          view === 'forms'
            ? clearFilters
            : view === 'templates' && templateRouteMode === 'list'
              ? clearTemplateFilters
              : undefined
        }
        filtersBusy={filterBusy}
        pagination={
          view === 'forms'
            ? {
                page: formPageNumber,
                itemCount: forms.length,
                canGoPrevious: formCursorHistory.length > 1,
                canGoNext: Boolean(formNextCursor),
                busy: filterBusy,
                onPrevious: () => void loadPreviousForms(),
                onNext: () => void loadNextForms(),
              }
            : view === 'templates' && templateRouteMode === 'list'
              ? {
                  page: templatePageNumber,
                  itemCount: visibleTemplates.length,
                  canGoPrevious: templatePageNumber > 1,
                  canGoNext: templatePageNumber * 25 < filteredTemplates.length,
                  busy: loading,
                  onPrevious: () => setTemplatePageNumber((current) => Math.max(1, current - 1)),
                  onNext: () => setTemplatePageNumber((current) => current + 1),
                }
              : undefined
        }
      >
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}

        {view === 'forms' && (
          <section
            className={styles.section}
            aria-labelledby="forms-list-title"
            aria-busy={loading}
          >
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="forms-list-title">فراداده‌ی فرم‌ها</h2>
                <p>جست‌وجو بر اساس عنوان، وضعیت انتشار و محدوده‌ی مالک.</p>
              </div>
            </div>
            {loading ? (
              <LoadingSkeleton label="در حال دریافت فهرست فرم‌ها" rows={4} />
            ) : forms.length === 0 && error ? null : forms.length === 0 ? (
              <div className={styles.emptyState} role="status">
                <strong>
                  {appliedFilters && (appliedFilters.query || appliedFilters.status)
                    ? 'با فیلترهای اعمال‌شده نتیجه‌ای پیدا نشد.'
                    : 'هنوز فرمی در سامانه ثبت نشده است.'}
                </strong>
                {appliedFilters && (appliedFilters.query || appliedFilters.status) && (
                  <span>عبارت جست‌وجو یا وضعیت را تغییر دهید و دوباره اعمال کنید.</span>
                )}
              </div>
            ) : (
              <>
                <div className={styles.resultsMeta} aria-live="polite">
                  <span>{forms.length.toLocaleString('fa-IR')} فرم در فهرست فعلی</span>
                  {appliedFilters && (appliedFilters.query || appliedFilters.status) && (
                    <span>فیلتر فعال</span>
                  )}
                  {formNextCursor && <span>نتایج ادامه دارد</span>}
                </div>
                <div className={styles.tableWrap} data-table-scroll>
                  <table className={styles.table}>
                    <caption>
                      فرم‌ها، وضعیت و شمارنده‌ی کلی پاسخ‌ها؛ بدون محتوای پاسخ یا شناسه‌ی مشتری.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">عنوان</th>
                        <th scope="col">محدوده</th>
                        <th scope="col">وضعیت</th>
                        <th scope="col">نسخه</th>
                        <th scope="col">پاسخ‌ها</th>
                        <th scope="col">زمان ایجاد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forms.map((form) => (
                        <tr key={form.id}>
                          <th scope="row">
                            {form.title}
                            <small dir="ltr">{form.slug}</small>
                          </th>
                          <td data-label="محدوده">
                            <small dir="ltr">
                              {form.organizationId.slice(0, 8)} · {form.branchId.slice(0, 8)}
                            </small>
                          </td>
                          <td data-label="وضعیت">
                            <Badge
                              tone={
                                form.status === 'published'
                                  ? 'success'
                                  : form.status === 'paused'
                                    ? 'warning'
                                    : 'neutral'
                              }
                            >
                              {statusLabel(form.status)}
                            </Badge>
                          </td>
                          <td data-label="نسخه">{form.currentVersion ?? '—'}</td>
                          <td data-label="پاسخ‌ها">{form.responseCount.toLocaleString('fa-IR')}</td>
                          <td data-label="زمان ایجاد">
                            {new Date(form.createdAt).toLocaleDateString('fa-IR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {view === 'templates' && templateRouteMode === 'list' && (
          <section
            className={styles.section}
            aria-labelledby="templates-list-title"
            aria-busy={loading}
          >
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="templates-list-title">فهرست قالب‌ها</h2>
                <p>برای دیدن یا تغییر هر قالب، صفحه‌ی جزئیات آن را باز کنید.</p>
              </div>
              <span>{filteredTemplates.length.toLocaleString('fa-IR')} قالب</span>
            </div>
            {loading ? (
              <LoadingSkeleton label="در حال دریافت قالب‌های سراسری" rows={3} />
            ) : filteredTemplates.length === 0 ? (
              <div className={styles.emptyState} role="status">
                <strong>
                  {appliedTemplateFilters.query || appliedTemplateFilters.enabled !== 'all'
                    ? 'با فیلترهای فعلی قالبی پیدا نشد.'
                    : 'قالبی ثبت نشده است.'}
                </strong>
                {(appliedTemplateFilters.query || appliedTemplateFilters.enabled !== 'all') && (
                  <span>فیلترها را تغییر دهید یا پاک کنید.</span>
                )}
              </div>
            ) : (
              <div className={styles.tableWrap} data-table-scroll>
                <table className={styles.table}>
                  <caption>قالب‌های سراسری، وضعیت و تعداد پرسش‌ها</caption>
                  <thead>
                    <tr>
                      <th scope="col">نام قالب</th>
                      <th scope="col">وضعیت</th>
                      <th scope="col">پرسش‌ها</th>
                      <th scope="col">نسخه</th>
                      <th scope="col">عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTemplates.map((template) => (
                      <tr key={template.id}>
                        <th scope="row">
                          {template.name}
                          <small>{template.description || 'بدون توضیح'}</small>
                        </th>
                        <td>
                          <Badge tone={template.enabled ? 'success' : 'neutral'}>
                            {template.enabled ? 'فعال' : 'غیرفعال'}
                          </Badge>
                        </td>
                        <td>
                          {template.definition.pages
                            .reduce((total, page) => total + page.fields.length, 0)
                            .toLocaleString('fa-IR')}
                        </td>
                        <td>{template.version.toLocaleString('fa-IR')}</td>
                        <td>
                          <div className={styles.templateActions}>
                            <Button
                              type="button"
                              tone="ghost"
                              onClick={() =>
                                router.push(
                                  `${templatesBasePath}/${encodeURIComponent(template.id)}`,
                                )
                              }
                            >
                              جزئیات
                            </Button>
                            <Button
                              type="button"
                              tone="secondary"
                              onClick={() =>
                                router.push(
                                  `${templatesBasePath}/${encodeURIComponent(template.id)}/edit`,
                                )
                              }
                            >
                              ویرایش
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {view === 'templates' && templateRouteMode === 'create' && (
          <section className={styles.section} aria-labelledby="create-template-title">
            <h2 id="create-template-title">مشخصات قالب جدید</h2>
            <form
              className={styles.createTemplate}
              onSubmit={(event) => void createTemplate(event)}
            >
              <label>
                نام
                <input
                  required
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  maxLength={120}
                />
              </label>
              <label>
                توضیح
                <textarea
                  value={templateDescription}
                  onChange={(event) => setTemplateDescription(event.target.value)}
                  rows={2}
                  maxLength={500}
                />
              </label>
              <div className={styles.formActions}>
                <Button type="button" tone="ghost" onClick={() => router.push(templatesBasePath)}>
                  انصراف
                </Button>
                <Button type="submit" disabled={busy || !themeDraft}>
                  {busy ? 'در حال ساخت…' : 'ساخت قالب بازخورد'}
                </Button>
              </div>
            </form>
          </section>
        )}

        {view === 'templates' &&
          templateRouteMode === 'details' &&
          (selectedTemplate ? (
            <section className={styles.section} aria-labelledby="template-details-title">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="template-details-title">{selectedTemplate.name}</h2>
                  <p>{selectedTemplate.description || 'این قالب توضیحی ندارد.'}</p>
                </div>
                <Badge tone={selectedTemplate.enabled ? 'success' : 'neutral'}>
                  {selectedTemplate.enabled ? 'فعال' : 'غیرفعال'}
                </Badge>
              </div>
              <p>
                نسخه {selectedTemplate.version.toLocaleString('fa-IR')} ·{' '}
                {fieldEntries.length.toLocaleString('fa-IR')} پرسش
              </p>
              {selectedTemplate.definition.pages[0] && (
                <div className={styles.preview}>
                  <FormRenderer
                    definition={selectedTemplate.definition}
                    answers={{}}
                    mode="preview"
                    readOnly
                    fieldInputRenderers={formFieldInputRenderers}
                  />
                </div>
              )}
            </section>
          ) : loading ? (
            <LoadingSkeleton label="در حال دریافت جزئیات قالب" rows={2} />
          ) : (
            <p className={styles.error} role="alert">
              قالب انتخاب‌شده در فهرست مجاز وجود ندارد. به فهرست قالب‌ها برگردید.
            </p>
          ))}

        {view === 'templates' &&
          (templateRouteMode === 'edit' || templateRouteMode === 'settings') && (
            <div className={styles.columns} data-mode={templateRouteMode}>
              {templateRouteMode === 'edit' && (
                <section className={styles.section} aria-labelledby="templates-title">
                  <div className={styles.sectionHeading}>
                    <div>
                      <h2 id="templates-title">{selectedTemplate?.name ?? 'ویرایش قالب'}</h2>
                      <p>تغییرات این صفحه پس از ذخیره در سرویس مالک ثبت می‌شوند.</p>
                    </div>
                    <span>{templates.length.toLocaleString('fa-IR')} قالب</span>
                  </div>
                  {selectedTemplate && (
                    <div className={styles.templateEditor}>
                      <label>
                        نام قالب
                        <input
                          value={selectedTemplate.name}
                          onChange={(event) =>
                            updateSelectedTemplate((item) => ({
                              ...item,
                              name: event.target.value,
                            }))
                          }
                          maxLength={120}
                        />
                      </label>
                      <label>
                        توضیح
                        <textarea
                          value={selectedTemplate.description}
                          onChange={(event) =>
                            updateSelectedTemplate((item) => ({
                              ...item,
                              description: event.target.value,
                            }))
                          }
                          rows={2}
                          maxLength={500}
                        />
                      </label>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={selectedTemplate.enabled}
                          onChange={(event) =>
                            updateSelectedTemplate((item) => ({
                              ...item,
                              enabled: event.target.checked,
                            }))
                          }
                        />
                        قالب فعال و قابل استفاده باشد
                      </label>
                      <label>
                        عنوان فرم
                        <input
                          value={selectedTemplate.definition.title}
                          onChange={(event) =>
                            updateTemplateDefinition((definition) => ({
                              ...definition,
                              title: event.target.value,
                            }))
                          }
                          maxLength={160}
                        />
                      </label>
                      <label>
                        توضیح فرم
                        <textarea
                          value={selectedTemplate.definition.description}
                          onChange={(event) =>
                            updateTemplateDefinition((definition) => ({
                              ...definition,
                              description: event.target.value,
                            }))
                          }
                          rows={2}
                          maxLength={1500}
                        />
                      </label>
                      <h3>پرسش‌های قالب</h3>
                      {fieldEntries.map(({ pageIndex, fieldIndex, field }) => (
                        <div className={styles.templateField} key={field.id}>
                          <label>
                            برچسب
                            <input
                              value={field.label}
                              onChange={(event) =>
                                updateTemplateDefinition((definition) =>
                                  updateField(definition, pageIndex, fieldIndex, {
                                    label: event.target.value,
                                  }),
                                )
                              }
                              maxLength={160}
                            />
                          </label>
                          <label>
                            نوع
                            <select
                              value={field.type}
                              onChange={(event) =>
                                updateTemplateDefinition((definition) =>
                                  changeFieldType(
                                    definition,
                                    pageIndex,
                                    fieldIndex,
                                    event.target.value as FormFieldType,
                                  ),
                                )
                              }
                            >
                              {formFieldTypes.map((type) => (
                                <option key={type} value={type}>
                                  {typeLabels[type]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.check}>
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(event) =>
                                updateTemplateDefinition((definition) =>
                                  updateField(definition, pageIndex, fieldIndex, {
                                    required: event.target.checked,
                                  }),
                                )
                              }
                            />
                            الزامی
                          </label>
                          {['full_name', 'phone', 'email'].includes(field.type) && (
                            <p className={styles.helper}>
                              این نوع پرسش همیشه با مجوز جداگانه‌ی داده‌ی حساس محافظت می‌شود.
                            </p>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        tone="ghost"
                        disabled={busy}
                        onClick={() =>
                          updateTemplateDefinition((definition) => addTemplateField(definition))
                        }
                      >
                        افزودن پرسش کوتاه
                      </Button>
                      {selectedTemplate.definition.pages[0] && (
                        <div className={styles.preview}>
                          <FormRenderer
                            definition={selectedTemplate.definition}
                            answers={{}}
                            mode="preview"
                            readOnly
                            fieldInputRenderers={formFieldInputRenderers}
                          />
                        </div>
                      )}
                      <Button type="button" disabled={busy} onClick={() => void saveTemplate()}>
                        {busy ? 'در حال ذخیره…' : 'ذخیره‌ی قالب'}
                      </Button>
                    </div>
                  )}
                </section>
              )}

              {templateRouteMode === 'settings' && (
                <section className={styles.section} aria-labelledby="theme-title">
                  <div className={styles.sectionHeading}>
                    <div>
                      <h2 id="theme-title">ظاهر پیش‌فرض</h2>
                      <p>فقط روی فرم‌های جدید اثر می‌گذارد؛ نسخه‌های منتشرشده تغییر نمی‌کنند.</p>
                    </div>
                  </div>
                  {themeDraft && (
                    <div className={styles.themeForm}>
                      <label>
                        رنگ اصلی
                        <input
                          type="color"
                          value={themeDraft.primaryColor}
                          onChange={(event) =>
                            setThemeDraft({ ...themeDraft, primaryColor: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        رنگ تأکیدی
                        <input
                          type="color"
                          value={themeDraft.accentColor}
                          onChange={(event) =>
                            setThemeDraft({ ...themeDraft, accentColor: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        پس‌زمینه
                        <input
                          type="color"
                          value={themeDraft.backgroundColor}
                          onChange={(event) =>
                            setThemeDraft({ ...themeDraft, backgroundColor: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        سطح فرم
                        <input
                          type="color"
                          value={themeDraft.surfaceColor}
                          onChange={(event) =>
                            setThemeDraft({ ...themeDraft, surfaceColor: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        فونت
                        <select
                          value={themeDraft.font}
                          onChange={(event) =>
                            setThemeDraft({
                              ...themeDraft,
                              font: event.target.value as FormTheme['font'],
                            })
                          }
                        >
                          <option value="vazirmatn">وزیرمتن</option>
                          <option value="estedad">استعداد</option>
                        </select>
                      </label>
                      <label>
                        گوشه‌ها
                        <select
                          value={themeDraft.cornerStyle}
                          onChange={(event) =>
                            setThemeDraft({
                              ...themeDraft,
                              cornerStyle: event.target.value as FormTheme['cornerStyle'],
                            })
                          }
                        >
                          <option value="soft">نرم</option>
                          <option value="rounded">گرد</option>
                          <option value="pill">کپسولی</option>
                        </select>
                      </label>
                      <label>
                        چیدمان
                        <select
                          value={themeDraft.layout}
                          onChange={(event) =>
                            setThemeDraft({
                              ...themeDraft,
                              layout: event.target.value as FormTheme['layout'],
                            })
                          }
                        >
                          <option value="paged">مرحله‌ای</option>
                          <option value="single">یک‌صفحه‌ای</option>
                        </select>
                      </label>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={themeDraft.showProgress}
                          onChange={(event) =>
                            setThemeDraft({ ...themeDraft, showProgress: event.target.checked })
                          }
                        />
                        نمایش پیشرفت
                      </label>
                      <div
                        className={styles.themePreview}
                        style={{ backgroundColor: themeDraft.backgroundColor }}
                      >
                        <span style={{ backgroundColor: themeDraft.primaryColor, color: '#fff' }}>
                          نمونه‌ی رنگ اصلی
                        </span>
                        <span
                          style={{
                            backgroundColor: themeDraft.surfaceColor,
                            borderColor: themeDraft.accentColor,
                          }}
                        >
                          سطح فرم
                        </span>
                      </div>
                      <Button type="button" disabled={busy} onClick={() => void saveTheme()}>
                        {busy ? 'در حال ذخیره…' : 'ذخیره‌ی ظاهر پیش‌فرض'}
                      </Button>
                      {settings?.updatedAt && (
                        <small>
                          آخرین تغییر: {new Date(settings.updatedAt).toLocaleString('fa-IR')}
                        </small>
                      )}
                    </div>
                  )}
                </section>
              )}
              {templateRouteMode === 'edit' &&
                !selectedTemplate &&
                (loading ? (
                  <LoadingSkeleton label="در حال دریافت قالب برای ویرایش" rows={2} />
                ) : (
                  <p className={styles.error} role="alert">
                    قالب در فهرست مجاز پیدا نشد. به فهرست قالب‌ها برگردید.
                  </p>
                ))}
            </div>
          )}
      </ManagementListPage>
    </main>
  );
}

function emptyTemplateDefinition(title: string, theme: FormTheme): FormDefinition {
  const empty = createEmptyFormDefinition(title, theme);
  return {
    ...empty,
    pages: [
      empty.pages[0]!,
      {
        ...empty.pages[1]!,
        fields: [
          {
            id: crypto.randomUUID(),
            type: 'rating',
            label: 'تجربه‌ی شما چطور بود؟',
            description: '',
            helpText: '',
            placeholder: '',
            required: true,
            sensitive: false,
            searchable: false,
            validation: { max: 5 },
          },
          {
            id: crypto.randomUUID(),
            type: 'long_text',
            label: 'چه چیزی را بهتر کنیم؟',
            description: '',
            helpText: '',
            placeholder: '',
            required: false,
            sensitive: false,
            searchable: false,
            validation: {},
          },
        ],
      },
      empty.pages[2]!,
    ],
  };
}

function updateField(
  definition: FormDefinition,
  pageIndex: number,
  fieldIndex: number,
  patch: Partial<FormField>,
): FormDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page, currentPage) =>
      currentPage !== pageIndex
        ? page
        : {
            ...page,
            fields: page.fields.map((field, currentField) =>
              currentField !== fieldIndex ? field : { ...field, ...patch },
            ),
          },
    ),
  };
}

function changeFieldType(
  definition: FormDefinition,
  pageIndex: number,
  fieldIndex: number,
  type: FormFieldType,
): FormDefinition {
  const field = definition.pages[pageIndex]?.fields[fieldIndex];
  if (!field) return definition;
  const sensitive = ['full_name', 'phone', 'email'].includes(type);
  const options = ['single_choice', 'multiple_choice', 'dropdown', 'ranking'].includes(type)
    ? field.options?.length
      ? field.options
      : [
          { id: crypto.randomUUID(), label: 'گزینه‌ی اول' },
          { id: crypto.randomUUID(), label: 'گزینه‌ی دوم' },
        ]
    : field.options;
  const rows =
    type === 'matrix'
      ? field.rows?.length
        ? field.rows
        : [{ id: crypto.randomUUID(), label: 'پرسش نخست' }]
      : field.rows;
  return updateField(definition, pageIndex, fieldIndex, {
    type,
    sensitive,
    searchable: sensitive ? false : field.searchable,
    options,
    rows,
    prefillKey: type === 'hidden' ? (field.prefillKey ?? 'source') : undefined,
    validation: type === 'rating' ? { max: 5 } : field.validation,
  });
}

function addTemplateField(definition: FormDefinition): FormDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page, index) =>
      index !== 0
        ? page
        : {
            ...page,
            fields: [
              ...page.fields,
              {
                id: crypto.randomUUID(),
                type: 'short_text',
                label: 'پرسش تازه',
                description: '',
                helpText: '',
                placeholder: '',
                required: false,
                sensitive: false,
                searchable: false,
                validation: {},
              },
            ],
          },
    ),
  };
}

function normalizeDefinition(definition: FormDefinition): FormDefinition {
  return formThemeSchema.safeParse(definition.theme).success
    ? definition
    : { ...definition, theme: formThemeSchema.parse({}) };
}

function statusLabel(status: SystemFormMetadata['status']): string {
  if (status === 'published') return 'منتشرشده';
  if (status === 'paused') return 'متوقف';
  if (status === 'archived') return 'بایگانی';
  return 'پیش‌نویس';
}

function errorMessage(failure: unknown): string {
  if (failure instanceof ApiRequestError && failure.status === 401)
    return 'نشست شما پایان یافته است؛ دوباره وارد شوید.';
  if (failure instanceof ApiRequestError && failure.status === 403)
    return 'مجوز مدیریت سراسری فرم‌ها برای این عملیات لازم است.';
  return failure instanceof Error ? failure.message : 'دریافت یا ذخیره‌ی اطلاعات فرم انجام نشد.';
}
