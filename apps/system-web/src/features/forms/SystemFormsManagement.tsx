'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Badge, Button, Surface } from '@funtino/design-system';
import { formFieldTypes, formThemeSchema, type FormDefinition, type FormField, type FormFieldType, type FormStatus, type FormTheme } from '@funtino/forms-schema';
import { FormRenderer } from '@funtino/forms-renderer';
import { ApiRequestError } from '../../lib/api/client';
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
  short_text: 'متن کوتاه', long_text: 'متن بلند', full_name: 'نام کامل', phone: 'تلفن', email: 'ایمیل',
  number: 'عدد', money: 'مبلغ', date: 'تاریخ', time: 'زمان', single_choice: 'تک‌گزینه‌ای',
  multiple_choice: 'چندگزینه‌ای', dropdown: 'فهرست کشویی', yes_no: 'بله/خیر', rating: 'امتیاز',
  nps: 'شاخص NPS', slider: 'مقیاس', ranking: 'رتبه‌بندی', matrix: 'ماتریس', consent: 'رضایت',
  heading: 'عنوان', paragraph: 'توضیح', hidden: 'فیلد پنهان',
};

export function SystemFormsManagement() {
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
  const [filterBusy, setFilterBusy] = useState(false);

  const selectedTemplate = useMemo(() => templates.find((item) => item.id === selectedTemplateId) ?? null, [templates, selectedTemplateId]);

  const loadMetadata = useCallback(async (cursor?: string, append = false) => {
    const page = await getSystemForms({ query: formQuery.trim() || undefined, status: formStatus || undefined, cursor, pageSize: 50 });
    setForms((current) => append ? [...current, ...page.items] : page.items);
    setFormNextCursor(page.nextCursor);
  }, [formQuery, formStatus]);

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
      setTemplates(globalTemplates);
      setSelectedTemplateId((current) => globalTemplates.some((item) => item.id === current) ? current : globalTemplates[0]?.id ?? '');
      setSettings(currentSettings);
      setThemeDraft(currentSettings.defaultTheme);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilterBusy(true);
    setError('');
    try {
      await loadMetadata(undefined, false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setFilterBusy(false);
    }
  }

  async function loadMoreForms() {
    if (!formNextCursor) return;
    setFilterBusy(true);
    try {
      await loadMetadata(formNextCursor, true);
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
      setTemplates((current) => [...current, template].sort((left, right) => left.name.localeCompare(right.name, 'fa')));
      setSelectedTemplateId(template.id);
      setTemplateName('');
      setTemplateDescription('');
      setNotice('قالب سراسری ایجاد شد.');
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
      setTemplates((current) => current.map((item) => item.id === updated.id ? updated : item));
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
    setTemplates((current) => current.map((item) => item.id === selectedTemplate.id ? updater(item) : item));
  }

  function updateTemplateDefinition(updater: (definition: FormDefinition) => FormDefinition) {
    updateSelectedTemplate((template) => ({ ...template, definition: normalizeDefinition(updater(template.definition)) }));
  }

  const fieldEntries = selectedTemplate?.definition.pages.flatMap((page, pageIndex) => page.fields.map((field, fieldIndex) => ({ pageIndex, fieldIndex, field }))) ?? [];

  return (
    <main className={styles.page} dir="rtl">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>مدیریت سراسری · Forms</p>
          <h1>فرم‌ها و قالب‌های فانتینو</h1>
          <p>فهرست زیر فقط فراداده و شمارنده‌های تجمیعی را نشان می‌دهد؛ پاسخ‌های مشتری در این بستر نمایش داده نمی‌شوند.</p>
        </div>
        <nav className={styles.nav} aria-label="بخش‌های مدیریت سامانه">
          <Link href="/fa/organizations">مجموعه‌ها</Link>
          <Link href="/fa/access">دسترسی‌ها</Link>
          <Link href="/fa/system-health">سلامت سامانه</Link>
        </nav>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      <section className={styles.section} aria-labelledby="forms-list-title" aria-busy={loading}>
        <div className={styles.sectionHeading}>
          <div><h2 id="forms-list-title">فراداده‌ی فرم‌ها</h2><p>جست‌وجو بر اساس عنوان، وضعیت انتشار و محدوده‌ی مالک.</p></div>
          <Button type="button" tone="ghost" disabled={loading || busy} onClick={() => void loadAll()}>بازخوانی</Button>
        </div>
        <form className={styles.filters} onSubmit={(event) => void applyFilters(event)}>
          <label>عنوان فرم<input value={formQuery} onChange={(event) => setFormQuery(event.target.value)} maxLength={120} /></label>
          <label>وضعیت<select value={formStatus} onChange={(event) => setFormStatus(event.target.value as FormStatus | '')}><option value="">همه</option><option value="draft">پیش‌نویس</option><option value="published">منتشرشده</option><option value="paused">متوقف</option><option value="archived">بایگانی</option></select></label>
          <Button type="submit" disabled={filterBusy}>{filterBusy ? 'در حال دریافت…' : 'اعمال فیلتر'}</Button>
        </form>
        {loading ? <p role="status">در حال دریافت فراداده…</p> : forms.length === 0 ? <p>فرمی با این فیلتر پیدا نشد.</p> : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption>فرم‌ها، وضعیت و شمارنده‌ی کلی پاسخ‌ها؛ بدون محتوای پاسخ یا شناسه‌ی مشتری.</caption>
              <thead><tr><th scope="col">عنوان</th><th scope="col">محدوده</th><th scope="col">وضعیت</th><th scope="col">نسخه</th><th scope="col">پاسخ‌ها</th><th scope="col">زمان ایجاد</th></tr></thead>
              <tbody>{forms.map((form) => <tr key={form.id}>
                <th scope="row">{form.title}<small dir="ltr">{form.slug}</small></th>
                <td><small dir="ltr">{form.organizationId.slice(0, 8)} · {form.branchId.slice(0, 8)}</small></td>
                <td><Badge tone={form.status === 'published' ? 'success' : form.status === 'paused' ? 'warning' : 'neutral'}>{statusLabel(form.status)}</Badge></td>
                <td>{form.currentVersion ?? '—'}</td>
                <td>{form.responseCount.toLocaleString('fa-IR')}</td>
                <td>{new Date(form.createdAt).toLocaleDateString('fa-IR')}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {formNextCursor && <Button className={styles.more} type="button" tone="secondary" disabled={filterBusy} onClick={() => void loadMoreForms()}>بارگذاری موارد بعدی</Button>}
      </section>

      <div className={styles.columns}>
        <section className={styles.section} aria-labelledby="templates-title">
          <div className={styles.sectionHeading}><div><h2 id="templates-title">قالب‌های سراسری</h2><p>قالب‌های فعال برای مدیران مجموعه و شعبه در دسترس‌اند.</p></div><span>{templates.length.toLocaleString('fa-IR')} قالب</span></div>
          <label>قالب منتخب<select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}><option value="">انتخاب کنید</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}{item.enabled ? '' : ' · غیرفعال'}</option>)}</select></label>
          {selectedTemplate && (
            <div className={styles.templateEditor}>
              <label>نام قالب<input value={selectedTemplate.name} onChange={(event) => updateSelectedTemplate((item) => ({ ...item, name: event.target.value }))} maxLength={120} /></label>
              <label>توضیح<textarea value={selectedTemplate.description} onChange={(event) => updateSelectedTemplate((item) => ({ ...item, description: event.target.value }))} rows={2} maxLength={500} /></label>
              <label className={styles.check}><input type="checkbox" checked={selectedTemplate.enabled} onChange={(event) => updateSelectedTemplate((item) => ({ ...item, enabled: event.target.checked }))} />قالب فعال و قابل استفاده باشد</label>
              <label>عنوان فرم<input value={selectedTemplate.definition.title} onChange={(event) => updateTemplateDefinition((definition) => ({ ...definition, title: event.target.value }))} maxLength={160} /></label>
              <label>توضیح فرم<textarea value={selectedTemplate.definition.description} onChange={(event) => updateTemplateDefinition((definition) => ({ ...definition, description: event.target.value }))} rows={2} maxLength={1500} /></label>
              <h3>پرسش‌های قالب</h3>
              {fieldEntries.map(({ pageIndex, fieldIndex, field }) => (
                <div className={styles.templateField} key={field.id}>
                  <label>برچسب<input value={field.label} onChange={(event) => updateTemplateDefinition((definition) => updateField(definition, pageIndex, fieldIndex, { label: event.target.value }))} maxLength={160} /></label>
                  <label>نوع<select value={field.type} onChange={(event) => updateTemplateDefinition((definition) => changeFieldType(definition, pageIndex, fieldIndex, event.target.value as FormFieldType))}>{formFieldTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></label>
                  <label className={styles.check}><input type="checkbox" checked={field.required} onChange={(event) => updateTemplateDefinition((definition) => updateField(definition, pageIndex, fieldIndex, { required: event.target.checked }))} />الزامی</label>
                  {['full_name', 'phone', 'email'].includes(field.type) && <p className={styles.helper}>این نوع پرسش همیشه با مجوز جداگانه‌ی داده‌ی حساس محافظت می‌شود.</p>}
                </div>
              ))}
              <Button type="button" tone="ghost" disabled={busy} onClick={() => updateTemplateDefinition((definition) => addTemplateField(definition))}>افزودن پرسش کوتاه</Button>
              {selectedTemplate.definition.pages[0] && <div className={styles.preview}><FormRenderer definition={selectedTemplate.definition} answers={{}} mode="preview" readOnly /></div>}
              <Button type="button" disabled={busy} onClick={() => void saveTemplate()}>{busy ? 'در حال ذخیره…' : 'ذخیره‌ی قالب'}</Button>
            </div>
          )}
          <form className={styles.createTemplate} onSubmit={(event) => void createTemplate(event)}>
            <h3>قالب سراسری تازه</h3>
            <label>نام<input required value={templateName} onChange={(event) => setTemplateName(event.target.value)} maxLength={120} /></label>
            <label>توضیح<textarea value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} rows={2} maxLength={500} /></label>
            <Button type="submit" tone="secondary" disabled={busy || !themeDraft}>{busy ? 'در حال ساخت…' : 'ساخت قالب بازخورد'}</Button>
          </form>
        </section>

        <section className={styles.section} aria-labelledby="theme-title">
          <div className={styles.sectionHeading}><div><h2 id="theme-title">ظاهر پیش‌فرض</h2><p>فقط روی فرم‌های جدید اثر می‌گذارد؛ نسخه‌های منتشرشده تغییر نمی‌کنند.</p></div></div>
          {themeDraft && <div className={styles.themeForm}>
            <label>رنگ اصلی<input type="color" value={themeDraft.primaryColor} onChange={(event) => setThemeDraft({ ...themeDraft, primaryColor: event.target.value })} /></label>
            <label>رنگ تأکیدی<input type="color" value={themeDraft.accentColor} onChange={(event) => setThemeDraft({ ...themeDraft, accentColor: event.target.value })} /></label>
            <label>پس‌زمینه<input type="color" value={themeDraft.backgroundColor} onChange={(event) => setThemeDraft({ ...themeDraft, backgroundColor: event.target.value })} /></label>
            <label>سطح فرم<input type="color" value={themeDraft.surfaceColor} onChange={(event) => setThemeDraft({ ...themeDraft, surfaceColor: event.target.value })} /></label>
            <label>فونت<select value={themeDraft.font} onChange={(event) => setThemeDraft({ ...themeDraft, font: event.target.value as FormTheme['font'] })}><option value="vazirmatn">وزیرمتن</option><option value="estedad">استعداد</option></select></label>
            <label>گوشه‌ها<select value={themeDraft.cornerStyle} onChange={(event) => setThemeDraft({ ...themeDraft, cornerStyle: event.target.value as FormTheme['cornerStyle'] })}><option value="soft">نرم</option><option value="rounded">گرد</option><option value="pill">کپسولی</option></select></label>
            <label>چیدمان<select value={themeDraft.layout} onChange={(event) => setThemeDraft({ ...themeDraft, layout: event.target.value as FormTheme['layout'] })}><option value="paged">مرحله‌ای</option><option value="single">یک‌صفحه‌ای</option></select></label>
            <label className={styles.check}><input type="checkbox" checked={themeDraft.showProgress} onChange={(event) => setThemeDraft({ ...themeDraft, showProgress: event.target.checked })} />نمایش پیشرفت</label>
            <div className={styles.themePreview} style={{ backgroundColor: themeDraft.backgroundColor }}><span style={{ backgroundColor: themeDraft.primaryColor, color: '#fff' }}>نمونه‌ی رنگ اصلی</span><span style={{ backgroundColor: themeDraft.surfaceColor, borderColor: themeDraft.accentColor }}>سطح فرم</span></div>
            <Button type="button" disabled={busy} onClick={() => void saveTheme()}>{busy ? 'در حال ذخیره…' : 'ذخیره‌ی ظاهر پیش‌فرض'}</Button>
            {settings?.updatedAt && <small>آخرین تغییر: {new Date(settings.updatedAt).toLocaleString('fa-IR')}</small>}
          </div>}
        </section>
      </div>
    </main>
  );
}

function emptyTemplateDefinition(title: string, theme: FormTheme): FormDefinition {
  return {
    schemaVersion: 1,
    title,
    description: '',
    welcomeTitle: '',
    welcomeMessage: '',
    successMessage: 'پاسخ شما ثبت شد. از همراهی‌تان ممنونیم.',
    pages: [{
      id: crypto.randomUUID(),
      title: 'پرسش‌های اصلی',
      description: '',
      fields: [
        { id: crypto.randomUUID(), type: 'rating', label: 'تجربه‌ی شما چطور بود؟', description: '', helpText: '', placeholder: '', required: true, sensitive: false, searchable: false, validation: { max: 5 } },
        { id: crypto.randomUUID(), type: 'long_text', label: 'چه چیزی را بهتر کنیم؟', description: '', helpText: '', placeholder: '', required: false, sensitive: false, searchable: false, validation: {} },
      ],
    }],
    theme,
  };
}

function updateField(definition: FormDefinition, pageIndex: number, fieldIndex: number, patch: Partial<FormField>): FormDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page, currentPage) => currentPage !== pageIndex ? page : {
      ...page,
      fields: page.fields.map((field, currentField) => currentField !== fieldIndex ? field : { ...field, ...patch }),
    }),
  };
}

function changeFieldType(definition: FormDefinition, pageIndex: number, fieldIndex: number, type: FormFieldType): FormDefinition {
  const field = definition.pages[pageIndex]?.fields[fieldIndex];
  if (!field) return definition;
  const sensitive = ['full_name', 'phone', 'email'].includes(type);
  const options = ['single_choice', 'multiple_choice', 'dropdown', 'ranking'].includes(type)
    ? field.options?.length ? field.options : [
        { id: crypto.randomUUID(), label: 'گزینه‌ی اول' },
        { id: crypto.randomUUID(), label: 'گزینه‌ی دوم' },
      ]
    : field.options;
  const rows = type === 'matrix'
    ? field.rows?.length ? field.rows : [{ id: crypto.randomUUID(), label: 'پرسش نخست' }]
    : field.rows;
  return updateField(definition, pageIndex, fieldIndex, {
    type,
    sensitive,
    searchable: sensitive ? false : field.searchable,
    options,
    rows,
    prefillKey: type === 'hidden' ? field.prefillKey ?? 'source' : undefined,
    validation: type === 'rating' ? { max: 5 } : field.validation,
  });
}

function addTemplateField(definition: FormDefinition): FormDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page, index) => index !== 0 ? page : {
      ...page,
      fields: [...page.fields, {
        id: crypto.randomUUID(), type: 'short_text', label: 'پرسش تازه', description: '', helpText: '', placeholder: '', required: false,
        sensitive: false, searchable: false, validation: {},
      }],
    }),
  };
}

function normalizeDefinition(definition: FormDefinition): FormDefinition {
  return formThemeSchema.safeParse(definition.theme).success ? definition : { ...definition, theme: formThemeSchema.parse({}) };
}

function statusLabel(status: SystemFormMetadata['status']): string {
  if (status === 'published') return 'منتشرشده';
  if (status === 'paused') return 'متوقف';
  if (status === 'archived') return 'بایگانی';
  return 'پیش‌نویس';
}

function errorMessage(failure: unknown): string {
  if (failure instanceof ApiRequestError && failure.status === 401) return 'نشست شما پایان یافته است؛ دوباره وارد شوید.';
  if (failure instanceof ApiRequestError && failure.status === 403) return 'مجوز مدیریت سراسری فرم‌ها برای این عملیات لازم است.';
  return failure instanceof Error ? failure.message : 'دریافت یا ذخیره‌ی اطلاعات فرم انجام نشد.';
}
