'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { FormRenderer } from '@funtino/forms-renderer';
import {
  formDefinitionSchema,
  formFieldTypes,
  type FormAnswers,
  type FormCondition,
  type FormDefinition,
  type FormField,
  type FormFieldType,
  type FormStatus,
  type ResponseStatus,
} from '@funtino/forms-schema';
import { ApiRequestError } from '../../lib/api/client';
import type { OperationsScope, OperationsScopeOption } from '../../lib/auth/operations-access';
import { OperationsMfaStepUpPanel } from '../../components/forms/OperationsMfaStepUpPanel';
import {
  addOperationsResponseNote,
  changeOperationsFormState,
  correctOperationsFormResponse,
  createOperationsForm,
  createOperationsFormTemplate,
  duplicateOperationsForm,
  exportOperationsFormResponses,
  getOperationsForm,
  getOperationsFormAggregateStats,
  getOperationsFormResponse,
  getOperationsFormResponseStats,
  getOperationsFormResponses,
  getOperationsForms,
  getOperationsFormsCapabilities,
  getOperationsFormTemplates,
  saveOperationsFormDraft,
  saveOperationsFormSettings,
  updateOperationsResponseStatus,
  updateOperationsResponseTags,
  type OperationsForm,
  type OperationsFormResponse,
  type OperationsFormResponseDetail,
  type OperationsFormTemplate,
  type OperationsFormsCapabilities,
} from '../../lib/api/operations-forms';
import styles from './OperationsForms.module.css';

const fieldLabels: Record<FormFieldType, string> = {
  short_text: 'متن کوتاه', long_text: 'متن بلند', full_name: 'نام کامل', phone: 'شماره تلفن', email: 'ایمیل',
  number: 'عدد', money: 'مبلغ', date: 'تاریخ', time: 'زمان', single_choice: 'تک‌گزینه‌ای',
  multiple_choice: 'چندگزینه‌ای', dropdown: 'فهرست کشویی', yes_no: 'بله/خیر', rating: 'امتیاز',
  nps: 'NPS', slider: 'مقیاس', ranking: 'رتبه‌بندی', matrix: 'ماتریس', consent: 'رضایت',
  heading: 'عنوان', paragraph: 'توضیح', hidden: 'فیلد پنهان',
};
const responseStatusLabels: Record<ResponseStatus, string> = {
  new: 'جدید', in_review: 'در حال بررسی', followed_up: 'پیگیری‌شده', closed: 'بسته', spam: 'نامعتبر',
};
const formStatusLabels: Record<FormStatus, string> = {
  draft: 'پیش‌نویس', published: 'منتشرشده', paused: 'متوقف', archived: 'بایگانی',
};

type Props = {
  scope: OperationsScope;
  scopeOptions: OperationsScopeOption[];
  onSessionExpired: () => void;
  mfaStepUpUntil: number | null;
  onMfaStepUp: (validUntil: number) => void;
};

type FormSettingsDraft = {
  accessMode: OperationsForm['accessMode'];
  linkEnabled: boolean;
  startsAt: string;
  endsAt: string;
  responseLimit: string;
};

const emptySettings: FormSettingsDraft = {
  accessMode: 'guest', linkEnabled: false, startsAt: '', endsAt: '', responseLimit: '',
};

export function OperationsForms({ scope, scopeOptions, onSessionExpired, mfaStepUpUntil, onMfaStepUp }: Props) {
  const [forms, setForms] = useState<OperationsForm[]>([]);
  const [templates, setTemplates] = useState<OperationsFormTemplate[]>([]);
  const [capabilities, setCapabilities] = useState<OperationsFormsCapabilities | null>(null);
  const [selectedForm, setSelectedForm] = useState<OperationsForm | null>(null);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const definitionRef = useRef<FormDefinition | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [undoStack, setUndoStack] = useState<FormDefinition[]>([]);
  const [redoStack, setRedoStack] = useState<FormDefinition[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<FormSettingsDraft>(emptySettings);
  const [branchId, setBranchId] = useState(scope.type === 'branch' ? scope.branchId : '');
  const [newTitle, setNewTitle] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [reason, setReason] = useState('');
  const [activeTab, setActiveTab] = useState<'builder' | 'responses'>('builder');
  const [previewAnswers, setPreviewAnswers] = useState<FormAnswers>({});
  const [previewPage, setPreviewPage] = useState(0);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [responses, setResponses] = useState<OperationsFormResponse[]>([]);
  const [responseNextCursor, setResponseNextCursor] = useState<string | null>(null);
  const [responseStats, setResponseStats] = useState<{ total: number; byStatus: Partial<Record<ResponseStatus, number>> } | null>(null);
  const [aggregateStats, setAggregateStats] = useState<{ total: number; byStatus: Partial<Record<ResponseStatus, number>>; byBranch: Array<{ branchId: string; count: number }> } | null>(null);
  const [responseStatusFilter, setResponseStatusFilter] = useState('');
  const [responseFrom, setResponseFrom] = useState('');
  const [responseTo, setResponseTo] = useState('');
  const [searchFieldId, setSearchFieldId] = useState('');
  const [responseSearch, setResponseSearch] = useState('');
  const [selectedResponse, setSelectedResponse] = useState<OperationsFormResponseDetail | null>(null);
  const [responseStatusDraft, setResponseStatusDraft] = useState<ResponseStatus>('in_review');
  const [responseReason, setResponseReason] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState('');
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [showSensitiveDetail, setShowSensitiveDetail] = useState(false);
  const [showStepUp, setShowStepUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const branches = useMemo(() => {
    if (scope.type === 'branch') return scopeOptions.filter((item) => item.scope.type === 'branch' && item.scope.branchId === scope.branchId);
    return scopeOptions.filter((item) => item.scope.type === 'branch' && item.scope.organizationId === scope.organizationId);
  }, [scope, scopeOptions]);

  const formScope = useMemo<OperationsScope | null>(() => selectedForm
    ? { type: 'branch', organizationId: selectedForm.organizationId, branchId: selectedForm.branchId }
    : null, [selectedForm]);
  const searchableFields = useMemo(() => definition?.pages.flatMap((page) => page.fields).filter((field) => field.searchable && !field.sensitive) ?? [], [definition]);

  const refreshForms = useCallback(async () => {
    const [permissionSet] = await Promise.all([getOperationsFormsCapabilities(scope)]);
    setCapabilities(permissionSet);
    setAggregateStats(null);
    if (scope.type === 'organization' && permissionSet.canReadResponses) {
      setAggregateStats(await getOperationsFormAggregateStats(scope));
    }
    if (permissionSet.canRead) {
      const page = await getOperationsForms(scope, { pageSize: 100 });
      setForms(page.items);
      if (selectedForm && !page.items.some((form) => form.id === selectedForm.id)) {
        setSelectedForm(null);
        setDefinition(null);
        definitionRef.current = null;
      }
    } else {
      setForms([]);
    }
    if (permissionSet.canManageTemplates) {
      const templateScope = scope.type === 'branch' ? scope : branchId
        ? { type: 'branch' as const, organizationId: scope.organizationId, branchId }
        : scope;
      setTemplates(await getOperationsFormTemplates(templateScope));
    } else {
      setTemplates([]);
    }
  }, [branchId, scope, selectedForm]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void refreshForms().catch((failure: unknown) => {
      if (active) {
        setError(errorMessage(failure, onSessionExpired));
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshForms, onSessionExpired]);

  useEffect(() => {
    if (scope.type === 'branch') {
      setBranchId(scope.branchId);
      return;
    }
    setBranchId((current) => branches.some((item) => item.scope.type === 'branch' && item.scope.branchId === current)
      ? current
      : branches[0]?.scope.type === 'branch' ? branches[0].scope.branchId : '');
  }, [scope, branches]);

  useEffect(() => {
    if (!selectedForm || !definition || !draftDirty || selectedForm.status === 'archived') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const snapshot = definition;
    const formId = selectedForm.id;
    const targetScope = formScope;
    if (!targetScope) return;
    saveTimer.current = setTimeout(() => {
      saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
        const parsed = formDefinitionSchema.safeParse(snapshot);
        if (!parsed.success) {
          setError('پیش‌نویس هنوز کامل و معتبر نیست؛ برچسب‌ها، گزینه‌ها و شرط‌ها را بررسی کنید.');
          return;
        }
        setSaving(true);
        setError('');
        try {
          const updated = await saveOperationsFormDraft(formId, targetScope, parsed.data);
          if (definitionRef.current === snapshot) {
            setSelectedForm(updated);
            setDraftDirty(false);
            setNotice('پیش‌نویس به‌طور خودکار ذخیره شد.');
          }
        } catch (failure) {
          setError(errorMessage(failure, onSessionExpired));
          if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        } finally {
          setSaving(false);
        }
      });
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [definition, draftDirty, formScope, onSessionExpired, selectedForm]);

  async function openForm(formId: string, rowOverride?: OperationsForm) {
    const row = rowOverride ?? forms.find((item) => item.id === formId);
    if (!row) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const targetScope: OperationsScope = { type: 'branch', organizationId: row.organizationId, branchId: row.branchId };
      const form = await getOperationsForm(row.id, targetScope);
      const nextDefinition = formDefinitionSchema.parse(form.draftSchema);
      setSelectedForm(form);
      setDefinition(nextDefinition);
      definitionRef.current = nextDefinition;
      setUndoStack([]);
      setRedoStack([]);
      setDraftDirty(false);
      setSettingsDraft(settingsFromForm(form));
      setPreviewAnswers({});
      setPreviewPage(0);
      setResponses([]);
      setSelectedResponse(null);
      setShowSensitiveDetail(false);
      setIncludeSensitive(false);
      setResponseStats(null);
      setActiveTab('builder');
      const stats = await getOperationsFormResponseStats(form.id, targetScope).catch(() => null);
      setResponseStats(stats);
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
    } finally {
      setLoading(false);
    }
  }

  function commitDefinition(updater: (current: FormDefinition) => FormDefinition) {
    const current = definitionRef.current;
    if (!current) return;
    const next = normalizeDefinition(updater(current));
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    setUndoStack((stack) => [...stack.slice(-49), current]);
    setRedoStack([]);
    definitionRef.current = next;
    setDefinition(next);
    setDraftDirty(true);
    setError('');
  }

  function undo() {
    const previous = undoStack.at(-1);
    const current = definitionRef.current;
    if (!previous || !current) return;
    setRedoStack((stack) => [...stack, current]);
    setUndoStack((stack) => stack.slice(0, -1));
    definitionRef.current = previous;
    setDefinition(previous);
    setDraftDirty(true);
  }

  function redo() {
    const next = redoStack.at(-1);
    const current = definitionRef.current;
    if (!next || !current) return;
    setUndoStack((stack) => [...stack, current]);
    setRedoStack((stack) => stack.slice(0, -1));
    definitionRef.current = next;
    setDefinition(next);
    setDraftDirty(true);
  }

  async function createForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !newTitle.trim() || !capabilities?.canManage) return;
    setSaving(true);
    setError('');
    try {
      const targetScope: OperationsScope = { type: 'branch', organizationId: scope.organizationId, branchId };
      const created = await createOperationsForm({ organizationId: scope.organizationId, branchId, title: newTitle.trim() });
      const template = templates.find((item) => item.id === selectedTemplateId && item.enabled);
      const definition = template
        ? normalizeDefinition({ ...JSON.parse(JSON.stringify(template.definition)) as FormDefinition, title: newTitle.trim() })
        : emptyDefinition(newTitle.trim());
      const saved = await saveOperationsFormDraft(created.id, targetScope, definition);
      setNewTitle('');
      setNotice(template ? 'فرم از روی قالب ساخته شد.' : 'فرم تازه ساخته شد.');
      const page = await getOperationsForms(scope, { pageSize: 100 });
      setForms(page.items);
      setSelectedForm(saved);
      setDefinition(formDefinitionSchema.parse(saved.draftSchema));
      definitionRef.current = formDefinitionSchema.parse(saved.draftSchema);
      setSettingsDraft(settingsFromForm(saved));
      setUndoStack([]);
      setRedoStack([]);
      setDraftDirty(false);
      setActiveTab('builder');
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
    } finally {
      setSaving(false);
    }
  }

  async function saveDraftNow(): Promise<boolean> {
    if (!selectedForm || !definition || !formScope) return false;
    const parsed = formDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      setError('پیش‌نویس معتبر نیست؛ موارد ناقص را اصلاح کنید.');
      return false;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await saveOperationsFormDraft(selectedForm.id, formScope, parsed.data);
      setSelectedForm(updated);
      setDraftDirty(false);
      setNotice('پیش‌نویس ذخیره شد.');
      return true;
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    if (!selectedForm || !formScope) return;
    setSaving(true);
    setError('');
    try {
      const updated = await saveOperationsFormSettings(selectedForm.id, formScope, {
        accessMode: settingsDraft.accessMode,
        linkEnabled: settingsDraft.linkEnabled,
        startsAt: settingsDraft.startsAt ? new Date(settingsDraft.startsAt).toISOString() : null,
        endsAt: settingsDraft.endsAt ? new Date(settingsDraft.endsAt).toISOString() : null,
        responseLimit: settingsDraft.responseLimit ? Number(settingsDraft.responseLimit) : null,
      });
      setSelectedForm((current) => current?.id === updated.id ? { ...current, ...updated } : current);
      setNotice('تنظیمات فرم ذخیره شد.');
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  async function changeFormState(action: 'publish' | 'pause' | 'archive') {
    if (!selectedForm || !formScope || !capabilities?.canPublish || reason.trim().length < 8) return;
    if (action === 'archive' && !window.confirm('فرم بایگانی می‌شود و پیوند عمومی آن غیرفعال خواهد شد. ادامه می‌دهید؟')) return;
    setSaving(true);
    setError('');
    try {
      if (draftDirty && !(await saveDraftNow())) return;
      const updated = await changeOperationsFormState(selectedForm.id, formScope, action, reason.trim());
      setSelectedForm((current) => current?.id === updated.id ? { ...current, ...updated } : current);
      setReason('');
      setNotice(action === 'publish' ? `نسخه‌ی ${updated.currentVersion ?? ''} منتشر شد.` : action === 'pause' ? 'فرم متوقف شد.' : 'فرم بایگانی شد.');
      await refreshForms();
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  async function duplicateForm() {
    if (!selectedForm || !formScope || !capabilities?.canManage) return;
    setSaving(true);
    try {
      const copied = await duplicateOperationsForm(selectedForm.id, formScope);
      await refreshForms();
      setNotice('نسخه‌ی پیش‌نویس فرم ساخته شد.');
      await openForm(copied.id, copied);
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  async function copyPublicLink() {
    if (!selectedForm) return;
    const configured = process.env.NEXT_PUBLIC_CUSTOMER_WEB_URL;
    if (!configured) {
      setError('نشانی وب مشتری در تنظیم build-time پنل عملیات تنظیم نشده است.');
      return;
    }
    try {
      const link = new URL(`/fa/forms/${encodeURIComponent(selectedForm.slug)}`, configured).toString();
      await navigator.clipboard.writeText(link);
      setNotice('پیوند عمومی فرم کپی شد.');
    } catch {
      setError('کپی پیوند ممکن نشد؛ دسترسی Clipboard مرورگر را بررسی کنید.');
    }
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedForm || !definition || !capabilities?.canManageTemplates || !templateName.trim()) return;
    setSaving(true);
    try {
      const template = await createOperationsFormTemplate({
        organizationId: selectedForm.organizationId,
        ...(formScope?.type === 'branch' ? { branchId: selectedForm.branchId } : {}),
        name: templateName.trim(),
        description: templateDescription.trim(),
        definition,
      });
      setTemplates((current) => [template, ...current]);
      setTemplateName('');
      setTemplateDescription('');
      setNotice('قالب در محدوده‌ی فعلی ذخیره شد.');
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  async function loadResponses(append = false, cursor?: string) {
    if (!selectedForm || !formScope || !capabilities?.canReadResponses) return;
    setResponsesLoading(true);
    setError('');
    try {
      const from = responseFrom ? new Date(`${responseFrom}T00:00:00`).toISOString() : undefined;
      const to = responseTo ? new Date(`${responseTo}T23:59:59.999`).toISOString() : undefined;
      const page = await getOperationsFormResponses(selectedForm.id, formScope, {
        status: responseStatusFilter ? responseStatusFilter as ResponseStatus : undefined,
        from,
        to,
        searchFieldId: searchFieldId || undefined,
        search: responseSearch.trim() || undefined,
        cursor,
        pageSize: 50,
      });
      setResponses((current) => append ? [...current, ...page.items] : page.items);
      setResponseNextCursor(page.nextCursor);
      setResponseStats(await getOperationsFormResponseStats(selectedForm.id, formScope));
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setResponsesLoading(false);
    }
  }

  async function openResponses() {
    setActiveTab('responses');
    setSelectedResponse(null);
    await loadResponses(false);
  }

  async function openResponse(responseId: string, revealSensitive = false) {
    if (!selectedForm || !formScope) return;
    if (revealSensitive && !capabilities?.canReadSensitiveResponses) {
      if (capabilities?.sensitiveStepUpRequired) setShowStepUp(true);
      else setError('برای نمایش داده‌های حساس مجوز forms.responses.pii.read لازم است.');
      return;
    }
    setError('');
    try {
      const detail = await getOperationsFormResponse(selectedForm.id, responseId, formScope, revealSensitive);
      setSelectedResponse(detail);
      setShowSensitiveDetail(revealSensitive);
      setResponseStatusDraft(detail.status);
      setTagsDraft(detail.tags.join(', '));
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      if (failure instanceof ApiRequestError && failure.status === 403 && capabilities?.sensitiveStepUpRequired) setShowStepUp(true);
      setError(errorMessage(failure, onSessionExpired));
    }
  }

  async function updateResponseStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedForm || !selectedResponse || !formScope || !capabilities?.canManageResponses || responseReason.trim().length < 8) return;
    setSaving(true);
    try {
      await updateOperationsResponseStatus(selectedForm.id, selectedResponse.id, formScope, responseStatusDraft, responseReason.trim());
      setResponseReason('');
      await loadResponses(false);
      await openResponse(selectedResponse.id, showSensitiveDetail);
      setNotice('وضعیت پاسخ تغییر کرد.');
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  async function correctResponse(
    expectedVersion: number,
    changes: Array<{ fieldId: string; value: unknown }>,
    reason: string,
  ) {
    if (!selectedForm || !selectedResponse || !formScope || !capabilities?.canCorrectResponses) return;
    setSaving(true);
    try {
      await correctOperationsFormResponse(selectedForm.id, selectedResponse.id, formScope, { expectedVersion, changes, reason });
      await openResponse(selectedResponse.id, showSensitiveDetail);
      setNotice('اصلاح پاسخ ثبت شد و در سابقه باقی می‌ماند.');
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
      throw failure;
    } finally {
      setSaving(false);
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedForm || !selectedResponse || !formScope || !capabilities?.canManageResponses || !noteDraft.trim()) return;
    setSaving(true);
    try {
      await addOperationsResponseNote(selectedForm.id, selectedResponse.id, formScope, noteDraft.trim());
      setNoteDraft('');
      await openResponse(selectedResponse.id, showSensitiveDetail);
      setNotice('یادداشت داخلی ثبت شد.');
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  async function saveTags() {
    if (!selectedForm || !selectedResponse || !formScope || !capabilities?.canManageResponses) return;
    setSaving(true);
    try {
      await updateOperationsResponseTags(selectedForm.id, selectedResponse.id, formScope, tagsDraft.split(',').map((tag) => tag.trim()).filter(Boolean));
      await openResponse(selectedResponse.id, showSensitiveDetail);
      setNotice('برچسب‌های پاسخ ذخیره شد.');
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  async function exportCsv() {
    if (!selectedForm || !formScope || !capabilities?.canExportResponses) return;
    if (includeSensitive && !capabilities.canReadSensitiveResponses) {
      if (capabilities.sensitiveStepUpRequired) setShowStepUp(true);
      else setError('برای خروجی شامل داده‌ی حساس مجوز جداگانه لازم است.');
      return;
    }
    setSaving(true);
    try {
      const file = await exportOperationsFormResponses(selectedForm.id, formScope, {
        status: responseStatusFilter ? responseStatusFilter as ResponseStatus : undefined,
        from: responseFrom ? new Date(`${responseFrom}T00:00:00`).toISOString() : undefined,
        to: responseTo ? new Date(`${responseTo}T23:59:59.999`).toISOString() : undefined,
        includeSensitive,
      });
      const url = URL.createObjectURL(new Blob([file.content], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`${file.exportedCount.toLocaleString('fa-IR')} پاسخ خروجی گرفته شد${file.truncated ? '؛ خروجی به سقف ۵۰۰۰ ردیف رسید.' : '.'}`);
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.page} aria-labelledby="operations-forms-heading" aria-busy={loading}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>مدیریت مشتریان · فرم‌ساز</p><h2 id="operations-forms-heading">فرم‌ها</h2><p>پیش‌نویس‌ها جدا از نسخه‌های منتشرشده ذخیره می‌شوند. هر انتشار یک نسخه‌ی تغییرناپذیر می‌سازد.</p></div>
        <div className={styles.actions}><Badge tone={draftDirty ? 'warning' : saving ? 'neutral' : 'success'}>{draftDirty ? 'تغییر ذخیره‌نشده' : saving ? 'در حال ذخیره' : 'همگام'}</Badge></div>
      </header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      {scope.type === 'organization' && capabilities?.canReadResponses && aggregateStats && <section className={styles.aggregateReport} aria-labelledby="forms-branch-comparison-heading">
        <div className={styles.sectionHeading}><div><h3 id="forms-branch-comparison-heading">مقایسه‌ی پاسخ شعب</h3><p>تجمیع فرم‌های همین مجموعه؛ متن پاسخ‌ها در این گزارش نمایش داده نمی‌شود.</p></div><Badge tone="neutral">{aggregateStats.total.toLocaleString('fa-IR')} پاسخ</Badge></div>
        <ul className={styles.aggregateBranches}>{aggregateStats.byBranch.map((item) => {
          const branch = branches.find((option) => option.scope.type === 'branch' && option.scope.branchId === item.branchId)?.branch;
          return <li key={item.branchId} className={styles.aggregateBranch}><span>{branch?.name ?? `شعبه ${item.branchId.slice(0, 8)}`}</span><strong>{item.count.toLocaleString('fa-IR')}</strong><span className={styles.aggregateBar} aria-hidden="true"><i style={{ width: `${aggregateStats.total ? Math.max(3, item.count / aggregateStats.total * 100) : 0}%` }} /></span></li>;
        })}</ul>
        <div className={styles.statusSummary}>{Object.entries(responseStatusLabels).map(([status, label]) => <span key={status}>{label}: {aggregateStats.byStatus[status as ResponseStatus] ?? 0}</span>)}</div>
      </section>}

      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label="فهرست فرم‌ها">
          <div className={styles.sideHeading}><h3>فرم‌های این محدوده</h3><span>{forms.length.toLocaleString('fa-IR')}</span></div>
          {loading ? <p role="status">در حال دریافت…</p> : capabilities?.canRead ? forms.length === 0 ? <p>فرمی وجود ندارد.</p> : (
            <ul className={styles.formList}>{forms.map((form) => <li key={form.id}>
              <button type="button" className={selectedForm?.id === form.id ? styles.formItemActive : styles.formItem} onClick={() => void openForm(form.id)}>
                <strong>{form.title}</strong><span><Badge tone={form.status === 'published' ? 'success' : form.status === 'paused' ? 'warning' : 'neutral'}>{formStatusLabels[form.status]}</Badge><small>{form.responseCount.toLocaleString('fa-IR')} پاسخ</small></span>
              </button>
            </li>)}</ul>
          ) : <p>برای دیدن فرم‌ها مجوز forms.read لازم است.</p>}
          {capabilities?.canManage && <form className={styles.createForm} onSubmit={(event) => void createForm(event)}>
            <h4>ساخت فرم</h4>
            {scope.type === 'organization' ? (
              <label>شعبه<select required value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">انتخاب شعبه</option>{branches.map((item) => item.scope.type === 'branch' ? <option key={item.scope.branchId} value={item.scope.branchId}>{item.branch?.name ?? item.scope.branchId}</option> : null)}</select></label>
            ) : <p className={styles.helper}>شعبه: {branches[0]?.branch?.name ?? 'محدوده‌ی فعلی'}</p>}
            <label>عنوان<input required value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={160} /></label>
            <label>قالب شروع<select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}><option value="">فرم خالی</option>{templates.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <Button type="submit" disabled={saving || !branchId || !newTitle.trim()}>{saving ? 'در حال ساخت…' : 'ایجاد پیش‌نویس'}</Button>
          </form>}
        </aside>

        <div className={styles.editor}>
          {!selectedForm || !definition ? <div className={styles.empty}><h3>یک فرم را انتخاب کنید</h3><p>از فهرست کنار صفحه فرم را باز کنید یا یک پیش‌نویس تازه بسازید.</p><p>فیلدهای بارگذاری تصویر/فایل، امضا و محاسباتی تا آماده‌شدن قرارداد ذخیره‌سازی در دسترس نیستند.</p></div> : <>
            <div className={styles.formHeading}>
              <div><h3>{selectedForm.title}</h3><p>شناسه‌ی نسخه‌ی منتشرشده: {selectedForm.currentVersion ?? 'هنوز منتشر نشده'}</p></div>
              <div className={styles.tabs} role="group" aria-label="بخش‌های فرم">
                <Button type="button" tone={activeTab === 'builder' ? 'primary' : 'ghost'} aria-pressed={activeTab === 'builder'} onClick={() => setActiveTab('builder')}>سازنده</Button>
                <Button type="button" tone={activeTab === 'responses' ? 'primary' : 'ghost'} aria-pressed={activeTab === 'responses'} disabled={!capabilities?.canReadResponses} onClick={() => void openResponses()}>پاسخ‌ها</Button>
              </div>
            </div>
            {activeTab === 'builder' ? <>
              <div className={styles.historyActions}>
                <Button type="button" tone="ghost" disabled={!undoStack.length} onClick={undo}>واگرد</Button>
                <Button type="button" tone="ghost" disabled={!redoStack.length} onClick={redo}>ازنو</Button>
                <Button type="button" tone="secondary" disabled={saving || !draftDirty} onClick={() => void saveDraftNow()}>ذخیره‌ی پیش‌نویس</Button>
                <Button type="button" tone="ghost" disabled={saving} onClick={() => void duplicateForm()}>ساخت نسخه</Button>
                <Button type="button" tone="ghost" disabled={saving} onClick={() => void copyPublicLink()}>کپی پیوند فرم</Button>
              </div>
              <div className={styles.builderGrid}>
                <div className={styles.builder}>
                  <label>عنوان فرم<input value={definition.title} onChange={(event) => commitDefinition((current) => ({ ...current, title: event.target.value }))} maxLength={160} /></label>
                  <label>توضیح فرم<textarea rows={3} value={definition.description} onChange={(event) => commitDefinition((current) => ({ ...current, description: event.target.value }))} maxLength={1500} /></label>
                  <div className={styles.twoColumns}>
                    <label>عنوان خوش‌آمدگویی<input value={definition.welcomeTitle} onChange={(event) => commitDefinition((current) => ({ ...current, welcomeTitle: event.target.value }))} maxLength={160} /></label>
                    <label>پیام خوش‌آمدگویی<input value={definition.welcomeMessage} onChange={(event) => commitDefinition((current) => ({ ...current, welcomeMessage: event.target.value }))} maxLength={1000} /></label>
                  </div>
                  <label>پیام پس از ثبت<textarea rows={2} value={definition.successMessage} onChange={(event) => commitDefinition((current) => ({ ...current, successMessage: event.target.value }))} maxLength={1000} /></label>
                  <div className={styles.pageList}>
                    <div className={styles.sectionHeading}><h4>صفحه‌ها</h4><Button type="button" tone="ghost" onClick={() => commitDefinition(addPage)}>افزودن صفحه</Button></div>
                    {definition.pages.map((page, pageIndex) => <div className={styles.formPage} key={page.id} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-funtino-page-index')) event.preventDefault(); }} onDrop={(event) => {
                      if (!event.dataTransfer.types.includes('application/x-funtino-page-index')) return;
                      event.preventDefault();
                      const from = Number(event.dataTransfer.getData('application/x-funtino-page-index'));
                      if (Number.isInteger(from)) commitDefinition((current) => movePage(current, from, pageIndex));
                    }}>
                      <div className={styles.pageHeader} draggable onDragStart={(event) => {
                        event.dataTransfer.setData('application/x-funtino-page-index', String(pageIndex));
                        event.dataTransfer.effectAllowed = 'move';
                      }}>
                        <label>عنوان صفحه<input value={page.title} onChange={(event) => commitDefinition((current) => updatePage(current, pageIndex, { title: event.target.value }))} maxLength={160} /></label>
                        <div className={styles.inlineActions}>
                          <Button type="button" tone="ghost" disabled={pageIndex === 0} aria-label="انتقال صفحه به بالا" onClick={() => commitDefinition((current) => movePage(current, pageIndex, pageIndex - 1))}>↑</Button>
                          <Button type="button" tone="ghost" disabled={pageIndex === definition.pages.length - 1} aria-label="انتقال صفحه به پایین" onClick={() => commitDefinition((current) => movePage(current, pageIndex, pageIndex + 1))}>↓</Button>
                          <Button type="button" tone="ghost" disabled={definition.pages.length === 1} onClick={() => commitDefinition((current) => removePage(current, pageIndex))}>حذف صفحه</Button>
                        </div>
                      </div>
                      <label>توضیح صفحه<textarea rows={2} value={page.description} onChange={(event) => commitDefinition((current) => updatePage(current, pageIndex, { description: event.target.value }))} maxLength={1000} /></label>
                      <PageConditionEditor
                        definition={definition}
                        pageIndex={pageIndex}
                        condition={page.condition}
                        onChange={(condition) => commitDefinition((current) => updatePage(current, pageIndex, { condition }))}
                      />
                      <div className={styles.fieldList}>
                        {page.fields.map((field, fieldIndex) => <FieldEditor
                          key={field.id}
                          field={field}
                          pageIndex={pageIndex}
                          fieldIndex={fieldIndex}
                          definition={definition}
                          onUpdate={(patch) => commitDefinition((current) => updateField(current, pageIndex, fieldIndex, patch))}
                          onMove={(to) => commitDefinition((current) => moveField(current, pageIndex, fieldIndex, to))}
                          onDuplicate={() => commitDefinition((current) => duplicateField(current, pageIndex, fieldIndex))}
                          onDelete={() => commitDefinition((current) => removeField(current, field.id))}
                        />)}
                      </div>
                      <div className={styles.addFieldRow}>
                        <label>نوع پرسش<select id={`field-type-${page.id}`} defaultValue="short_text">{formFieldTypes.map((type) => <option key={type} value={type}>{fieldLabels[type]}</option>)}</select></label>
                        <Button type="button" tone="secondary" onClick={() => {
                          const select = document.getElementById(`field-type-${page.id}`) as HTMLSelectElement | null;
                          if (select) commitDefinition((current) => addField(current, pageIndex, select.value as FormFieldType));
                        }}>افزودن پرسش</Button>
                      </div>
                    </div>)}
                  </div>
                  <section className={styles.themeSettings} aria-labelledby="form-theme-heading">
                    <h4 id="form-theme-heading">ظاهر فرم</h4>
                    <div className={styles.twoColumns}>
                      <label>رنگ اصلی<input type="color" value={definition.theme.primaryColor} onChange={(event) => commitDefinition((current) => ({ ...current, theme: { ...current.theme, primaryColor: event.target.value } }))} /></label>
                      <label>رنگ تأکیدی<input type="color" value={definition.theme.accentColor} onChange={(event) => commitDefinition((current) => ({ ...current, theme: { ...current.theme, accentColor: event.target.value } }))} /></label>
                      <label>پس‌زمینه<input type="color" value={definition.theme.backgroundColor} onChange={(event) => commitDefinition((current) => ({ ...current, theme: { ...current.theme, backgroundColor: event.target.value } }))} /></label>
                      <label>سطح کارت<input type="color" value={definition.theme.surfaceColor} onChange={(event) => commitDefinition((current) => ({ ...current, theme: { ...current.theme, surfaceColor: event.target.value } }))} /></label>
                      <label>فونت امن<select value={definition.theme.font} onChange={(event) => commitDefinition((current) => ({ ...current, theme: { ...current.theme, font: event.target.value as FormDefinition['theme']['font'] } }))}><option value="estedad">استعداد</option><option value="vazirmatn">وزیرمتن</option></select></label>
                      <label>گردی گوشه‌ها<select value={definition.theme.cornerStyle} onChange={(event) => commitDefinition((current) => ({ ...current, theme: { ...current.theme, cornerStyle: event.target.value as FormDefinition['theme']['cornerStyle'] } }))}><option value="soft">ملایم</option><option value="rounded">گرد</option><option value="pill">کپسولی</option></select></label>
                      <label>چیدمان<select value={definition.theme.layout} onChange={(event) => commitDefinition((current) => ({ ...current, theme: { ...current.theme, layout: event.target.value as FormDefinition['theme']['layout'] } }))}><option value="paged">مرحله‌ای</option><option value="single">یک‌صفحه‌ای</option></select></label>
                      <label className={styles.checkbox}><input type="checkbox" checked={definition.theme.showProgress} onChange={(event) => commitDefinition((current) => ({ ...current, theme: { ...current.theme, showProgress: event.target.checked } }))} />نمایش نوار پیشرفت</label>
                    </div>
                  </section>
                  <section className={styles.settings} aria-labelledby="form-settings-heading">
                    <h4 id="form-settings-heading">دسترسی و انتشار</h4>
                    <div className={styles.twoColumns}>
                      <label>دسترسی پاسخ‌گویی<select value={settingsDraft.accessMode} onChange={(event) => setSettingsDraft({ ...settingsDraft, accessMode: event.target.value as FormSettingsDraft['accessMode'] })}><option value="guest">مهمان</option><option value="optional_auth">ورود اختیاری</option><option value="auth_required">ورود الزامی</option></select></label>
                      <label className={styles.checkbox}><input type="checkbox" checked={settingsDraft.linkEnabled} onChange={(event) => setSettingsDraft({ ...settingsDraft, linkEnabled: event.target.checked })} />پیوند عمومی فعال باشد</label>
                      <label>شروع دسترسی<input type="datetime-local" value={settingsDraft.startsAt} onChange={(event) => setSettingsDraft({ ...settingsDraft, startsAt: event.target.value })} /></label>
                      <label>پایان دسترسی<input type="datetime-local" value={settingsDraft.endsAt} onChange={(event) => setSettingsDraft({ ...settingsDraft, endsAt: event.target.value })} /></label>
                      <label>سقف پاسخ‌ها<input type="number" min="1" value={settingsDraft.responseLimit} onChange={(event) => setSettingsDraft({ ...settingsDraft, responseLimit: event.target.value })} placeholder="بدون سقف" /></label>
                    </div>
                    <Button type="button" tone="secondary" disabled={saving || !capabilities?.canManage} onClick={() => void saveSettings()}>ذخیره‌ی تنظیمات</Button>
                    <label className={styles.reason}>دلیل تغییر وضعیت<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} /></label>
                    <div className={styles.inlineActions}>
                      <Button type="button" disabled={saving || !capabilities?.canPublish || reason.trim().length < 8 || draftDirty} onClick={() => void changeFormState('publish')}>انتشار نسخه‌ی تازه</Button>
                      {selectedForm.status === 'published' && <Button type="button" tone="secondary" disabled={saving || !capabilities?.canPublish || reason.trim().length < 8} onClick={() => void changeFormState('pause')}>توقف فرم</Button>}
                      {selectedForm.status !== 'archived' && <Button type="button" tone="ghost" disabled={saving || !capabilities?.canPublish || reason.trim().length < 8} onClick={() => void changeFormState('archive')}>بایگانی</Button>}
                    </div>
                    {!capabilities?.canManage && <p className={styles.helper}>برای ویرایش فرم مجوز forms.manage لازم است.</p>}
                    {!capabilities?.canPublish && <p className={styles.helper}>برای انتشار یا تغییر وضعیت مجوز forms.publish لازم است.</p>}
                  </section>
                  {capabilities?.canManageTemplates && <form className={styles.templateSave} onSubmit={(event) => void createTemplate(event)}>
                    <h4>ذخیره‌ی قالب در محدوده‌ی فعلی</h4>
                    <label>نام قالب<input required value={templateName} onChange={(event) => setTemplateName(event.target.value)} maxLength={120} /></label>
                    <label>توضیح<textarea rows={2} value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} maxLength={500} /></label>
                    <Button type="submit" tone="ghost" disabled={saving || !templateName.trim()}>ذخیره به‌عنوان قالب</Button>
                  </form>}
                </div>
                <div className={`${styles.previewColumn} ${previewViewport === 'mobile' ? styles.previewMobile : ''}`}>
                  <div className={styles.sectionHeading}><h4>پیش‌نمایش زنده</h4><div className={styles.inlineActions}><Button type="button" tone={previewViewport === 'desktop' ? 'primary' : 'ghost'} aria-pressed={previewViewport === 'desktop'} onClick={() => setPreviewViewport('desktop')}>دسکتاپ</Button><Button type="button" tone={previewViewport === 'mobile' ? 'primary' : 'ghost'} aria-pressed={previewViewport === 'mobile'} onClick={() => setPreviewViewport('mobile')}>موبایل</Button><Button type="button" tone="ghost" onClick={() => { setPreviewAnswers({}); setPreviewPage(0); }}>بازنشانی</Button></div></div>
                  <FormRenderer definition={definition} answers={previewAnswers} onAnswerChange={(id, value) => setPreviewAnswers((current) => ({ ...current, [id]: value }))} pageIndex={previewPage} onPageChange={setPreviewPage} mode="preview" />
                  <p className={styles.helper}>بارگذاری فایل/تصویر، امضا و فیلد محاسباتی تا تصمیم ذخیره‌سازی و قرارداد دانلود ارائه نمی‌شوند.</p>
                </div>
              </div>
            </> : <ResponseManagement
              form={selectedForm}
              scope={formScope!}
              capabilities={capabilities}
              responses={responses}
              stats={responseStats}
              loading={responsesLoading}
              nextCursor={responseNextCursor}
              selectedResponse={selectedResponse}
              responseStatusFilter={responseStatusFilter}
              responseFrom={responseFrom}
              responseTo={responseTo}
              searchFieldId={searchFieldId}
              searchableFields={searchableFields}
              responseSearch={responseSearch}
              responseStatusDraft={responseStatusDraft}
              responseReason={responseReason}
              noteDraft={noteDraft}
              tagsDraft={tagsDraft}
              includeSensitive={includeSensitive}
              showSensitiveDetail={showSensitiveDetail}
              showStepUp={showStepUp}
              mfaStepUpUntil={mfaStepUpUntil}
              onMfaStepUp={(validUntil) => { onMfaStepUp(validUntil); void refreshForms(); }}
              onSessionExpired={onSessionExpired}
              onLoadResponses={(cursor) => void loadResponses(Boolean(cursor), cursor ?? undefined)}
              onOpenResponse={(id, sensitive) => void openResponse(id, sensitive)}
              onStatusFilter={setResponseStatusFilter}
              onDateFilter={(from, to) => { setResponseFrom(from); setResponseTo(to); }}
              onSearchField={setSearchFieldId}
              onSearch={setResponseSearch}
              onResponseStatus={setResponseStatusDraft}
              onResponseReason={setResponseReason}
              onNote={setNoteDraft}
              onTags={setTagsDraft}
              onIncludeSensitive={setIncludeSensitive}
              onShowStepUp={setShowStepUp}
              onApplyFilters={() => void loadResponses(false)}
              onExport={() => void exportCsv()}
              onUpdateStatus={(event) => void updateResponseStatus(event)}
              onCorrectResponse={(version, changes, reason) => correctResponse(version, changes, reason)}
              onAddNote={(event) => void addNote(event)}
              onSaveTags={() => void saveTags()}
              saving={saving}
            />}
          </>}
        </div>
      </div>
    </section>
  );
}

type ResponseManagementProps = {
  form: OperationsForm;
  scope: OperationsScope;
  capabilities: OperationsFormsCapabilities | null;
  responses: OperationsFormResponse[];
  stats: { total: number; byStatus: Partial<Record<ResponseStatus, number>> } | null;
  loading: boolean;
  nextCursor: string | null;
  selectedResponse: OperationsFormResponseDetail | null;
  responseStatusFilter: string;
  responseFrom: string;
  responseTo: string;
  searchFieldId: string;
  searchableFields: FormField[];
  responseSearch: string;
  responseStatusDraft: ResponseStatus;
  responseReason: string;
  noteDraft: string;
  tagsDraft: string;
  includeSensitive: boolean;
  showSensitiveDetail: boolean;
  showStepUp: boolean;
  mfaStepUpUntil: number | null;
  onMfaStepUp: (validUntil: number) => void;
  onSessionExpired: () => void;
  onLoadResponses: (cursor: string | null) => void;
  onOpenResponse: (id: string, sensitive: boolean) => void;
  onStatusFilter: (status: string) => void;
  onDateFilter: (from: string, to: string) => void;
  onSearchField: (id: string) => void;
  onSearch: (search: string) => void;
  onResponseStatus: (status: ResponseStatus) => void;
  onResponseReason: (reason: string) => void;
  onNote: (note: string) => void;
  onTags: (tags: string) => void;
  onIncludeSensitive: (include: boolean) => void;
  onShowStepUp: (show: boolean) => void;
  onApplyFilters: () => void;
  onExport: () => void;
  onUpdateStatus: (event: FormEvent<HTMLFormElement>) => void;
  onCorrectResponse: (expectedVersion: number, changes: Array<{ fieldId: string; value: unknown }>, reason: string) => Promise<void>;
  onAddNote: (event: FormEvent<HTMLFormElement>) => void;
  onSaveTags: () => void;
  saving: boolean;
};

function ResponseManagement(props: ResponseManagementProps) {
  const {
    form, capabilities, responses, stats, loading, nextCursor, selectedResponse,
    responseStatusFilter, responseFrom, responseTo, searchFieldId, searchableFields, responseSearch,
    responseStatusDraft, responseReason, noteDraft, tagsDraft, includeSensitive, showSensitiveDetail, showStepUp, mfaStepUpUntil,
    onMfaStepUp, onSessionExpired, onLoadResponses, onOpenResponse, onStatusFilter, onDateFilter,
    onSearchField, onSearch, onResponseStatus, onResponseReason, onNote, onTags, onIncludeSensitive,
    onShowStepUp, onApplyFilters, onExport, onUpdateStatus, onCorrectResponse, onAddNote, onSaveTags, saving,
  } = props;
  const [fromDraft, setFromDraft] = useState(responseFrom);
  const [toDraft, setToDraft] = useState(responseTo);
  const [editingCorrection, setEditingCorrection] = useState(false);
  const [answerDraft, setAnswerDraft] = useState<FormAnswers>({});
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionError, setCorrectionError] = useState('');
  useEffect(() => {
    setEditingCorrection(false);
    setAnswerDraft(selectedResponse?.answers ?? {});
    setCorrectionReason('');
    setCorrectionError('');
  }, [selectedResponse?.id, selectedResponse?.correctionVersion]);

  async function saveCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedResponse || !capabilities?.canCorrectResponses || correctionReason.trim().length < 8) return;
    const fields = selectedResponse.definition.pages.flatMap((page) => page.fields);
    const changes = fields
      .filter((field) => !['heading', 'paragraph', 'hidden'].includes(field.type))
      .filter((field) => JSON.stringify(correctionComparable(answerDraft[field.id])) !== JSON.stringify(correctionComparable(selectedResponse.answers[field.id])))
      .map((field) => ({ fieldId: field.id, value: answerDraft[field.id] === undefined ? null : answerDraft[field.id] }));
    if (changes.length === 0) {
      setCorrectionError('مقدار تازه‌ای برای ثبت وجود ندارد.');
      return;
    }
    setCorrectionError('');
    try {
      await onCorrectResponse(selectedResponse.correctionVersion, changes, correctionReason.trim());
      setEditingCorrection(false);
      setCorrectionReason('');
    } catch {
      // The parent displays the request error; retain the draft so it can be revised or retried.
    }
  }

  const correctionDefinition = selectedResponse ? buildCorrectionDefinition(
    selectedResponse.definition,
    showSensitiveDetail && capabilities?.canReadSensitiveResponses === true,
  ) : null;
  return (
    <div className={styles.responses}>
      <div className={styles.sectionHeading}><div><h4>پاسخ‌ها</h4><p>نمایش و خروجی پاسخ‌ها بر اساس مجوزهای همین محدوده کنترل می‌شود.</p></div><Badge tone="neutral">{stats?.total.toLocaleString('fa-IR') ?? '—'} پاسخ</Badge></div>
      {stats && <div className={styles.statusSummary}>{Object.entries(responseStatusLabels).map(([status, label]) => <span key={status}>{label}: {stats.byStatus[status as ResponseStatus] ?? 0}</span>)}</div>}
      {!capabilities?.canReadResponses ? <p className={styles.helper}>برای دیدن پاسخ‌ها مجوز forms.responses.read لازم است.</p> : <>
        <div className={styles.responseFilters}>
          <label>وضعیت<select value={responseStatusFilter} onChange={(event) => onStatusFilter(event.target.value)}><option value="">همه</option>{Object.entries(responseStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>از تاریخ<input type="date" value={fromDraft} onChange={(event) => { setFromDraft(event.target.value); onDateFilter(event.target.value, toDraft); }} /></label>
          <label>تا تاریخ<input type="date" value={toDraft} onChange={(event) => { setToDraft(event.target.value); onDateFilter(fromDraft, event.target.value); }} /></label>
          <label>جست‌وجوی مجاز<select value={searchFieldId} onChange={(event) => onSearchField(event.target.value)}><option value="">بدون جست‌وجو</option>{searchableFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
          <label>متن جست‌وجو<input value={responseSearch} onChange={(event) => onSearch(event.target.value)} maxLength={100} disabled={!searchFieldId} /></label>
          <Button type="button" tone="secondary" disabled={loading} onClick={onApplyFilters}>اعمال فیلتر</Button>
          <Button type="button" tone="ghost" disabled={saving || !capabilities.canExportResponses} onClick={onExport}>خروجی CSV</Button>
        </div>
        {capabilities.canReadSensitiveResponses && <label className={styles.checkbox}><input type="checkbox" checked={includeSensitive} onChange={(event) => onIncludeSensitive(event.target.checked)} />در خروجی، فیلدهای حساس هم باشد</label>}
        {capabilities.sensitiveStepUpRequired && <div className={styles.piiNotice}><p>نمایش یا خروجی داده‌ی حساس به تأیید MFA کوتاه‌مدت نیاز دارد.</p><Button type="button" tone="secondary" onClick={() => onShowStepUp(!showStepUp)}>{showStepUp ? 'بستن تأیید MFA' : 'تأیید MFA'}</Button></div>}
        {showStepUp && <OperationsMfaStepUpPanel idPrefix="forms-pii" mfaStepUpUntil={mfaStepUpUntil} onMfaStepUp={onMfaStepUp} onSessionExpired={onSessionExpired} />}
        <div className={styles.responseSplit}>
          <div className={styles.responseList} aria-busy={loading}>
            {loading && <p role="status">در حال دریافت پاسخ‌ها…</p>}
            {!loading && responses.length === 0 && <p>پاسخی با این فیلتر پیدا نشد.</p>}
            <ul>{responses.map((response) => <li key={response.id}>
              <button type="button" className={selectedResponse?.id === response.id ? styles.responseActive : styles.responseItem} onClick={() => onOpenResponse(response.id, false)}>
                <strong>{new Date(response.submittedAt).toLocaleString('fa-IR')}</strong>
                <span><Badge tone={response.status === 'closed' ? 'neutral' : response.status === 'spam' ? 'warning' : 'success'}>{responseStatusLabels[response.status]}</Badge>{response.hasSensitive && <small>داده‌ی حساس دارد</small>}</span>
              </button>
            </li>)}</ul>
            {nextCursor && <Button type="button" tone="ghost" disabled={loading} onClick={() => onLoadResponses(nextCursor)}>پاسخ‌های بعدی</Button>}
          </div>
          <div className={styles.responseDetail}>
            {!selectedResponse ? <p>برای دیدن پاسخ، یک مورد را انتخاب کنید.</p> : <>
              <div className={styles.detailHeading}><h5>پاسخ {selectedResponse.id.slice(0, 8)}</h5><time dateTime={selectedResponse.submittedAt}>{new Date(selectedResponse.submittedAt).toLocaleString('fa-IR')}</time></div>
              {selectedResponse.hasSensitive && <div className={styles.piiNotice}><p>{showSensitiveDetail ? 'نمایش داده‌ی حساس ثبت و ممیزی می‌شود.' : 'فیلدهای حساس در این نما پنهان‌اند.'}</p>{capabilities.canReadSensitiveResponses ? <Button type="button" tone="ghost" onClick={() => onOpenResponse(selectedResponse.id, !showSensitiveDetail)}>{showSensitiveDetail ? 'پنهان‌کردن داده‌ی حساس' : 'نمایش داده‌ی حساس'}</Button> : capabilities.sensitiveStepUpRequired ? <Button type="button" tone="secondary" onClick={() => onShowStepUp(true)}>تأیید MFA</Button> : <span>مجوز داده‌ی حساس ندارید.</span>}</div>}
              {capabilities.canCorrectResponses && !editingCorrection && <Button type="button" tone="secondary" disabled={saving} onClick={() => { setAnswerDraft(selectedResponse.answers); setEditingCorrection(true); setCorrectionError(''); }}>اصلاح پاسخ با ثبت سابقه</Button>}
              {editingCorrection && correctionDefinition ? <form className={styles.correctionEditor} onSubmit={(event) => void saveCorrection(event)}>
                <p className={styles.helper}>فقط فیلدهای تغییرکرده ارسال می‌شوند. اصلاح با دلیل، زمان و شناسه‌ی مدیر در سابقه‌ی ممیزی باقی می‌ماند.</p>
                <FormRenderer definition={correctionDefinition} answers={answerDraft} onAnswerChange={(fieldId, value) => setAnswerDraft((current) => ({ ...current, [fieldId]: value }))} mode="response" readOnly={false} />
                {!showSensitiveDetail && selectedResponse.hasSensitive && <p className={styles.helper}>فیلدهای حساس تا زمان نمایش مجاز داده‌ی حساس وارد ویرایش نمی‌شوند.</p>}
                <label>دلیل اصلاح، حداقل ۸ نویسه<input required minLength={8} maxLength={500} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
                {correctionError && <p role="alert" className={styles.error}>{correctionError}</p>}
                <div className={styles.inlineActions}><Button type="submit" disabled={saving || correctionReason.trim().length < 8}>ثبت اصلاح</Button><Button type="button" tone="ghost" disabled={saving} onClick={() => { setEditingCorrection(false); setAnswerDraft(selectedResponse.answers); setCorrectionReason(''); setCorrectionError(''); }}>انصراف</Button></div>
              </form> : !editingCorrection ? <dl className={styles.answerList}>{selectedResponse.definition.pages.flatMap((page) => page.fields).filter((field) => !['heading', 'paragraph', 'hidden'].includes(field.type)).map((field) => {
                const value = selectedResponse.answers[field.id];
                if (value === undefined) return null;
                return <div key={field.id}><dt>{field.label}{field.sensitive && <small>حساس</small>}</dt><dd>{formatAnswer(field, value)}</dd></div>;
              })}</dl> : null}
              {selectedResponse.corrections.length > 0 && <section className={styles.notes}><h6>سابقه‌ی اصلاح پاسخ</h6><ol className={styles.correctionHistory}>{selectedResponse.corrections.map((correction) => {
                const field = selectedResponse.definition.pages.flatMap((page) => page.fields).find((item) => item.id === correction.fieldId);
                return <li key={correction.id}><strong>{field?.label ?? 'فیلد حذف‌شده'} · نسخهٔ {correction.correctionVersion.toLocaleString('fa-IR')}</strong><p>{correction.reason}</p><dl><div><dt>پیشین</dt><dd>{correction.redacted ? 'مقدار حساس پنهان است' : correction.previousPresent && field ? formatAnswer(field, correction.previousValue) : 'بدون مقدار'}</dd></div><div><dt>جدید</dt><dd>{correction.redacted ? 'مقدار حساس پنهان است' : correction.newPresent && field ? formatAnswer(field, correction.newValue) : 'بدون مقدار'}</dd></div></dl><small>{new Date(correction.createdAt).toLocaleString('fa-IR')} · مدیر {correction.actorUserId.slice(0, 8)}</small></li>;
              })}</ol></section>}
              {capabilities.canManageResponses && <>
                <form className={styles.responseMutation} onSubmit={onUpdateStatus}>
                  <label>وضعیت<select value={responseStatusDraft} onChange={(event) => onResponseStatus(event.target.value as ResponseStatus)}>{Object.entries(responseStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  <label>دلیل تغییر وضعیت<input required minLength={8} value={responseReason} onChange={(event) => onResponseReason(event.target.value)} maxLength={500} /></label>
                  <Button type="submit" disabled={saving || responseReason.trim().length < 8}>ذخیره‌ی وضعیت</Button>
                </form>
                <div className={styles.responseMutation}>
                  <label>برچسب‌ها، جداشده با ویرگول<input value={tagsDraft} onChange={(event) => onTags(event.target.value)} maxLength={500} /></label>
                  <Button type="button" tone="secondary" disabled={saving} onClick={onSaveTags}>ذخیره‌ی برچسب‌ها</Button>
                </div>
                <form className={styles.responseMutation} onSubmit={onAddNote}>
                  <label>یادداشت داخلی<textarea rows={3} value={noteDraft} onChange={(event) => onNote(event.target.value)} maxLength={2000} /></label>
                  <Button type="submit" tone="secondary" disabled={saving || !noteDraft.trim()}>افزودن یادداشت</Button>
                </form>
              </>}
              {selectedResponse.notes.length > 0 && <section className={styles.notes}><h6>یادداشت‌های داخلی</h6><ul>{selectedResponse.notes.map((note) => <li key={note.id}><p>{note.body}</p><time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString('fa-IR')}</time></li>)}</ul></section>}
            </>}
          </div>
        </div>
      </>}
      <p className={styles.retention}>پاسخ‌ها به‌صورت خودکار حذف نمی‌شوند تا سیاست مصوب نگهداری تعیین شود.</p>
      <small className={styles.helper}>فرم: {form.title}</small>
    </div>
  );
}

function FieldEditor({
  field,
  pageIndex,
  fieldIndex,
  definition,
  onUpdate,
  onMove,
  onDuplicate,
  onDelete,
}: {
  field: FormField;
  pageIndex: number;
  fieldIndex: number;
  definition: FormDefinition;
  onUpdate: (patch: Partial<FormField>) => void;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const previousFields = definition.pages.slice(0, pageIndex + 1).flatMap((page, index) => page.fields.slice(0, index === pageIndex ? fieldIndex : undefined));
  const choices = field.options ?? [];
  const rows = field.rows ?? [];
  const supportsOptions = ['single_choice', 'multiple_choice', 'dropdown', 'ranking', 'matrix'].includes(field.type);
  const labelOptions = field.type === 'matrix' ? rows : choices;
  const setOption = (index: number, label: string) => {
    if (field.type === 'matrix') onUpdate({ rows: rows.map((item, current) => current === index ? { ...item, label } : item) });
    else onUpdate({ options: choices.map((item, current) => current === index ? { ...item, label } : item) });
  };
  const addOption = () => {
    const next = { id: crypto.randomUUID(), label: `گزینه‌ی ${labelOptions.length + 1}` };
    if (field.type === 'matrix') onUpdate({ rows: [...rows, next] });
    else onUpdate({ options: [...choices, next] });
  };
  const removeOption = (index: number) => {
    if (labelOptions.length <= (field.type === 'matrix' ? 1 : 2)) return;
    if (field.type === 'matrix') onUpdate({ rows: rows.filter((_, current) => current !== index) });
    else onUpdate({ options: choices.filter((_, current) => current !== index) });
  };
  return (
    <fieldset className={styles.fieldEditor} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(fieldIndex))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(from)) onMove(from); }}>
      <legend>{fieldLabels[field.type]} · {field.label}</legend>
      <div className={styles.fieldTopline}>
        <span className={styles.dragHandle} aria-hidden="true">⠿</span>
        <div className={styles.inlineActions}>
          <Button type="button" tone="ghost" disabled={fieldIndex === 0} aria-label="انتقال پرسش به بالا" onClick={() => onMove(fieldIndex - 1)}>↑</Button>
          <Button type="button" tone="ghost" disabled={fieldIndex >= definition.pages[pageIndex]!.fields.length - 1} aria-label="انتقال پرسش به پایین" onClick={() => onMove(fieldIndex + 1)}>↓</Button>
          <Button type="button" tone="ghost" onClick={onDuplicate}>تکرار</Button>
          <Button type="button" tone="ghost" onClick={onDelete}>حذف پرسش</Button>
        </div>
      </div>
      <div className={styles.twoColumns}>
        <label>برچسب<input value={field.label} onChange={(event) => onUpdate({ label: event.target.value })} maxLength={160} /></label>
        <label>نوع<select value={field.type} onChange={(event) => onUpdate(makeTypePatch(field, event.target.value as FormFieldType))}>{formFieldTypes.map((type) => <option key={type} value={type}>{fieldLabels[type]}</option>)}</select></label>
      </div>
      <div className={styles.twoColumns}>
        <label>توضیح<textarea rows={2} value={field.description} onChange={(event) => onUpdate({ description: event.target.value })} maxLength={1000} /></label>
        <label>راهنما<textarea rows={2} value={field.helpText} onChange={(event) => onUpdate({ helpText: event.target.value })} maxLength={500} /></label>
      </div>
      <div className={styles.twoColumns}>
        <label>متن راهنما در ورودی<input value={field.placeholder} onChange={(event) => onUpdate({ placeholder: event.target.value })} maxLength={160} /></label>
        <label className={styles.checkbox}><input type="checkbox" checked={field.required} onChange={(event) => onUpdate({ required: event.target.checked })} />پاسخ الزامی</label>
      </div>
      <div className={styles.twoColumns}>
        <label className={styles.checkbox}><input type="checkbox" checked={field.sensitive} onChange={(event) => onUpdate({ sensitive: event.target.checked, searchable: event.target.checked ? false : field.searchable })} />داده‌ی حساس</label>
        <label className={styles.checkbox}><input type="checkbox" checked={field.searchable} disabled={field.sensitive || !['short_text', 'long_text'].includes(field.type)} onChange={(event) => onUpdate({ searchable: event.target.checked })} />قابل جست‌وجو در پاسخ‌ها</label>
      </div>
      {renderDefaultValueEditor(field, onUpdate)}
      {field.type === 'hidden' && <label>پارامتر مجاز<select value={field.prefillKey ?? 'source'} onChange={(event) => onUpdate({ prefillKey: event.target.value as 'source' | 'campaign' | 'ref' })}><option value="source">source</option><option value="campaign">campaign</option><option value="ref">ref</option></select></label>}
      {supportsOptions && <div className={styles.optionsEditor}>
        <h5>{field.type === 'matrix' ? 'ردیف‌ها' : 'گزینه‌ها'}</h5>
        {labelOptions.map((option, index) => <div key={option.id} className={styles.optionRow}>
          <label>{field.type === 'matrix' ? `ردیف ${index + 1}` : `گزینه ${index + 1}`}<input value={option.label} onChange={(event) => setOption(index, event.target.value)} maxLength={120} /></label>
          <Button type="button" tone="ghost" disabled={labelOptions.length <= (field.type === 'matrix' ? 1 : 2)} aria-label={`حذف ${option.label}`} onClick={() => removeOption(index)}>حذف</Button>
        </div>)}
        <Button type="button" tone="ghost" onClick={addOption}>{field.type === 'matrix' ? 'افزودن ردیف' : 'افزودن گزینه'}</Button>
        {field.type === 'matrix' && <p className={styles.helper}>ستون‌های ماتریس از گزینه‌های بالا تعریف می‌شوند.</p>}
      </div>}
      {['short_text', 'long_text', 'full_name', 'phone', 'email', 'number', 'money', 'slider', 'rating'].includes(field.type) && <div className={styles.twoColumns}>
        <label>حداقل<input type="number" value={field.validation.min ?? ''} onChange={(event) => onUpdate({ validation: { ...field.validation, min: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label>
        <label>حداکثر<input type="number" value={field.validation.max ?? (field.type === 'rating' ? 5 : '')} onChange={(event) => onUpdate({ validation: { ...field.validation, max: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label>
      </div>}
      {['short_text', 'long_text', 'full_name', 'phone', 'email'].includes(field.type) && <div className={styles.twoColumns}>
        <label>کمترین طول<input type="number" min="0" max="4000" value={field.validation.minLength ?? ''} onChange={(event) => onUpdate({ validation: { ...field.validation, minLength: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label>
        <label>بیشترین طول<input type="number" min="1" max="4000" value={field.validation.maxLength ?? ''} onChange={(event) => onUpdate({ validation: { ...field.validation, maxLength: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label>
      </div>}
      <label>پیام خطای اعتبارسنجی<input value={field.validation.errorMessage ?? ''} onChange={(event) => onUpdate({ validation: { ...field.validation, errorMessage: event.target.value || undefined } })} maxLength={240} /></label>
      {previousFields.length > 0 && <ConditionEditor
        heading="نمایش شرطی پرسش (اختیاری)"
        condition={field.condition}
        fields={previousFields}
        onChange={(condition) => onUpdate({ condition })}
      />}
    </fieldset>
  );
}

function PageConditionEditor({
  definition,
  pageIndex,
  condition,
  onChange,
}: {
  definition: FormDefinition;
  pageIndex: number;
  condition: FormDefinition['pages'][number]['condition'];
  onChange: (condition: FormCondition | undefined) => void;
}) {
  const previousFields = definition.pages.slice(0, pageIndex).flatMap((page) => page.fields);
  return <ConditionEditor heading="نمایش شرطی صفحه (اختیاری)" condition={condition} fields={previousFields} onChange={onChange} />;
}

function ConditionEditor({
  heading,
  condition,
  fields,
  onChange,
}: {
  heading: string;
  condition: FormCondition | undefined;
  fields: FormField[];
  onChange: (condition: FormCondition | undefined) => void;
}) {
  const usableFields = fields.filter((field) => !['heading', 'paragraph'].includes(field.type));
  if (usableFields.length === 0) return null;
  const selectedField = usableFields.find((field) => field.id === condition?.fieldId);
  const operators = selectedField ? conditionOperators(selectedField) : [];
  return (
    <div className={styles.conditionEditor}>
      <h5>{heading}</h5>
      <div className={styles.twoColumns}>
        <label>وابسته به پرسش<select value={condition?.fieldId ?? ''} onChange={(event) => {
          const field = usableFields.find((item) => item.id === event.target.value);
          onChange(field ? { fieldId: field.id, operator: 'answered' } : undefined);
        }}><option value="">بدون شرط</option>{usableFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
        {condition && selectedField && <label>قاعده<select value={condition.operator} onChange={(event) => {
          const operator = event.target.value as FormCondition['operator'];
          onChange({ fieldId: condition.fieldId, operator, ...(operator === 'answered' ? {} : { value: condition.value ?? initialConditionValue(selectedField) }) });
        }}>{operators.map((operator) => <option key={operator} value={operator}>{conditionOperatorLabels[operator]}</option>)}</select></label>}
      </div>
      {condition && selectedField && condition.operator !== 'answered' && <label>مقدار شرط{conditionValueControl(selectedField, condition.value, (value) => onChange({ ...condition, value }))}</label>}
    </div>
  );
}

const conditionOperatorLabels: Record<FormCondition['operator'], string> = {
  answered: 'پاسخ داده شده', equals: 'برابر باشد با', not_equals: 'برابر نباشد با', contains: 'شامل باشد',
  greater_than: 'بزرگ‌تر از', less_than: 'کوچک‌تر از',
};

function conditionOperators(field: FormField): FormCondition['operator'][] {
  if (['number', 'money', 'rating', 'nps', 'slider'].includes(field.type)) return ['answered', 'equals', 'not_equals', 'greater_than', 'less_than'];
  if (['short_text', 'long_text', 'full_name', 'phone', 'email', 'hidden'].includes(field.type)) return ['answered', 'equals', 'not_equals', 'contains'];
  if (field.type === 'multiple_choice' || field.type === 'ranking') return ['answered', 'contains'];
  if (field.type === 'single_choice' || field.type === 'dropdown' || field.type === 'yes_no' || field.type === 'consent') return ['answered', 'equals', 'not_equals'];
  return ['answered'];
}

function initialConditionValue(field: FormField): unknown {
  if (['number', 'money', 'rating', 'nps', 'slider'].includes(field.type)) return 0;
  if (field.type === 'yes_no' || field.type === 'consent') return true;
  return field.options?.[0]?.id ?? '';
}

function conditionValueControl(field: FormField, value: unknown, onChange: (value: unknown) => void) {
  if (['number', 'money', 'rating', 'nps', 'slider'].includes(field.type)) {
    return <input type="number" value={typeof value === 'number' ? value : ''} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} />;
  }
  if (field.type === 'yes_no' || field.type === 'consent') {
    return <select value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">انتخاب کنید</option><option value="true">بله</option><option value="false">خیر</option></select>;
  }
  if (field.options?.length) {
    return <select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || undefined)}><option value="">انتخاب کنید</option>{field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>;
  }
  const inputType = field.type === 'date' || field.type === 'time' ? field.type : 'text';
  return <input type={inputType} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} maxLength={160} />;
}

function renderDefaultValueEditor(field: FormField, onUpdate: (patch: Partial<FormField>) => void) {
  if (['number', 'money', 'rating', 'nps', 'slider'].includes(field.type)) {
    return <label>مقدار پیش‌فرض<input type="number" value={typeof field.defaultValue === 'number' ? field.defaultValue : ''} onChange={(event) => onUpdate({ defaultValue: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>;
  }
  if (field.type === 'yes_no' || field.type === 'consent') {
    return <label>مقدار پیش‌فرض<select value={field.defaultValue === true ? 'true' : field.defaultValue === false ? 'false' : ''} onChange={(event) => onUpdate({ defaultValue: event.target.value === '' ? undefined : event.target.value === 'true' })}><option value="">بدون مقدار</option><option value="true">بله</option><option value="false">خیر</option></select></label>;
  }
  if (field.type === 'single_choice' || field.type === 'dropdown') {
    return <label>مقدار پیش‌فرض<select value={typeof field.defaultValue === 'string' ? field.defaultValue : ''} onChange={(event) => onUpdate({ defaultValue: event.target.value || undefined })}><option value="">بدون مقدار</option>{(field.options ?? []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
  }
  if (field.type === 'multiple_choice') {
    const selected = Array.isArray(field.defaultValue) ? field.defaultValue.map(String) : [];
    return <label>مقادیر پیش‌فرض<select multiple value={selected} onChange={(event) => onUpdate({ defaultValue: Array.from(event.target.selectedOptions, (option) => option.value) })}>{(field.options ?? []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
  }
  if (['short_text', 'long_text', 'full_name', 'phone', 'email', 'date', 'time'].includes(field.type)) {
    const inputType = field.type === 'date' || field.type === 'time' ? field.type : 'text';
    const value = typeof field.defaultValue === 'string' ? field.defaultValue : '';
    return field.type === 'long_text'
      ? <label>مقدار پیش‌فرض<textarea rows={2} value={value} onChange={(event) => onUpdate({ defaultValue: event.target.value || undefined })} maxLength={4000} /></label>
      : <label>مقدار پیش‌فرض<input type={inputType} value={value} onChange={(event) => onUpdate({ defaultValue: event.target.value || undefined })} maxLength={4000} /></label>;
  }
  return null;
}

function emptyDefinition(title: string): FormDefinition {
  return {
    schemaVersion: 1, title, description: '', welcomeTitle: '', welcomeMessage: '',
    successMessage: 'پاسخ شما ثبت شد. از همراهی‌تان ممنونیم.',
    pages: [{ id: crypto.randomUUID(), title: 'پرسش‌های اصلی', description: '', fields: [] }],
    theme: { primaryColor: '#12a89d', accentColor: '#f2a13a', backgroundColor: '#f3f7f8', surfaceColor: '#ffffff', font: 'estedad', cornerStyle: 'rounded', layout: 'paged', showProgress: true },
  };
}

function makeTypePatch(field: FormField, type: FormFieldType): Partial<FormField> {
  const sensitive = ['full_name', 'phone', 'email'].includes(type);
  const options = ['single_choice', 'multiple_choice', 'dropdown', 'ranking', 'matrix'].includes(type)
    ? field.options?.length ? field.options : [{ id: crypto.randomUUID(), label: 'گزینه‌ی اول' }, { id: crypto.randomUUID(), label: 'گزینه‌ی دوم' }]
    : field.options;
  const rows = type === 'matrix' ? field.rows?.length ? field.rows : [{ id: crypto.randomUUID(), label: 'پرسش نخست' }] : field.rows;
  return {
    type, sensitive: sensitive || field.sensitive, searchable: sensitive ? false : field.searchable,
    options, rows, prefillKey: type === 'hidden' ? field.prefillKey ?? 'source' : undefined,
    validation: type === 'rating' ? { ...field.validation, max: 5 } : field.validation,
  };
}

function addPage(definition: FormDefinition): FormDefinition {
  return { ...definition, pages: [...definition.pages, { id: crypto.randomUUID(), title: `صفحه‌ی ${definition.pages.length + 1}`, description: '', fields: [] }] };
}

function updatePage(definition: FormDefinition, index: number, patch: Partial<FormDefinition['pages'][number]>): FormDefinition {
  return { ...definition, pages: definition.pages.map((page, current) => current === index ? { ...page, ...patch } : page) };
}

function removePage(definition: FormDefinition, index: number): FormDefinition {
  return normalizeDefinition({ ...definition, pages: definition.pages.filter((_, current) => current !== index) });
}

function movePage(definition: FormDefinition, from: number, to: number): FormDefinition {
  if (to < 0 || to >= definition.pages.length) return definition;
  const pages = [...definition.pages];
  const [page] = pages.splice(from, 1);
  if (page) pages.splice(to, 0, page);
  return normalizeDefinition({ ...definition, pages });
}

function addField(definition: FormDefinition, pageIndex: number, type: FormFieldType): FormDefinition {
  const field = makeNewField(type);
  return { ...definition, pages: definition.pages.map((page, current) => current === pageIndex ? { ...page, fields: [...page.fields, field] } : page) };
}

function makeNewField(type: FormFieldType): FormField {
  const sensitive = ['full_name', 'phone', 'email'].includes(type);
  const options = ['single_choice', 'multiple_choice', 'dropdown', 'ranking', 'matrix'].includes(type)
    ? [{ id: crypto.randomUUID(), label: 'گزینه‌ی اول' }, { id: crypto.randomUUID(), label: 'گزینه‌ی دوم' }]
    : undefined;
  const rows = type === 'matrix' ? [{ id: crypto.randomUUID(), label: 'پرسش نخست' }] : undefined;
  return {
    id: crypto.randomUUID(), type, label: fieldLabels[type], description: '', helpText: '', placeholder: '', required: false,
    sensitive, searchable: false, ...(options ? { options } : {}), ...(rows ? { rows } : {}),
    ...(type === 'hidden' ? { prefillKey: 'source' as const } : {}),
    validation: type === 'rating' ? { max: 5 } : {},
  };
}

function updateField(definition: FormDefinition, pageIndex: number, fieldIndex: number, patch: Partial<FormField>): FormDefinition {
  return { ...definition, pages: definition.pages.map((page, currentPage) => currentPage !== pageIndex ? page : {
    ...page, fields: page.fields.map((field, currentField) => currentField === fieldIndex ? { ...field, ...patch } : field),
  }) };
}

function moveField(definition: FormDefinition, pageIndex: number, from: number, to: number): FormDefinition {
  const page = definition.pages[pageIndex];
  if (!page || to < 0 || to >= page.fields.length) return definition;
  const fields = [...page.fields];
  const [field] = fields.splice(from, 1);
  if (field) fields.splice(to, 0, field);
  return normalizeDefinition({ ...definition, pages: definition.pages.map((item, index) => index === pageIndex ? { ...item, fields } : item) });
}

function duplicateField(definition: FormDefinition, pageIndex: number, fieldIndex: number): FormDefinition {
  const page = definition.pages[pageIndex];
  const field = page?.fields[fieldIndex];
  if (!page || !field) return definition;

  const optionIds = new Map<string, string>();
  const options = field.options?.map((option) => {
    const id = crypto.randomUUID();
    optionIds.set(option.id, id);
    return { ...option, id };
  });
  const rowIds = new Map<string, string>();
  const rows = field.rows?.map((row) => {
    const id = crypto.randomUUID();
    rowIds.set(row.id, id);
    return { ...row, id };
  });
  let defaultValue = field.defaultValue;
  if (typeof defaultValue === 'string' && optionIds.has(defaultValue)) defaultValue = optionIds.get(defaultValue);
  else if (Array.isArray(defaultValue)) defaultValue = defaultValue.map((value) => optionIds.get(String(value)) ?? value);
  else if (field.type === 'matrix' && defaultValue !== null && typeof defaultValue === 'object') {
    defaultValue = Object.fromEntries(Object.entries(defaultValue as Record<string, unknown>).map(([rowId, value]) => [
      rowIds.get(rowId) ?? rowId,
      optionIds.get(String(value)) ?? value,
    ]));
  }

  const duplicateLabel = ' (نسخه)';
  const duplicate: FormField = {
    ...field,
    id: crypto.randomUUID(),
    label: `${field.label.slice(0, 160 - duplicateLabel.length)}${duplicateLabel}`,
    ...(options ? { options } : {}),
    ...(rows ? { rows } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };
  const fields = [...page.fields];
  fields.splice(fieldIndex + 1, 0, duplicate);
  return normalizeDefinition({
    ...definition,
    pages: definition.pages.map((item, index) => index === pageIndex ? { ...item, fields } : item),
  });
}

function removeField(definition: FormDefinition, fieldId: string): FormDefinition {
  return normalizeDefinition({ ...definition, pages: definition.pages.map((page) => ({ ...page, fields: page.fields.filter((field) => field.id !== fieldId) })) });
}

function normalizeDefinition(definition: FormDefinition): FormDefinition {
  const priorIds = new Set<string>();
  const pages = definition.pages.map((page) => {
    const condition = page.condition && priorIds.has(page.condition.fieldId) ? page.condition : undefined;
    const fields = page.fields.map((field) => {
      const next = { ...field, condition: field.condition && priorIds.has(field.condition.fieldId) ? field.condition : undefined };
      priorIds.add(field.id);
      return next;
    });
    return { ...page, condition, fields };
  });
  const parsed = formDefinitionSchema.safeParse({ ...definition, pages });
  return parsed.success ? parsed.data : { ...definition, pages };
}

function settingsFromForm(form: OperationsForm): FormSettingsDraft {
  const local = (value: string | null) => value ? new Date(value).toISOString().slice(0, 16) : '';
  return {
    accessMode: form.accessMode,
    linkEnabled: form.linkEnabled,
    startsAt: local(form.startsAt),
    endsAt: local(form.endsAt),
    responseLimit: form.responseLimit === null ? '' : String(form.responseLimit),
  };
}

function correctionComparable(value: unknown): unknown {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  if (Array.isArray(value)) return value.map(correctionComparable);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, correctionComparable(item)]));
  }
  return value;
}

function buildCorrectionDefinition(definition: FormDefinition, includeSensitive: boolean): FormDefinition {
  const fields = definition.pages.flatMap((page) => page.fields);
  const omittedIds = new Set(fields.filter((field) => field.type === 'hidden' || (field.sensitive && !includeSensitive)).map((field) => field.id));
  let updated = true;
  while (updated) {
    updated = false;
    for (const field of fields) {
      if (field.condition && omittedIds.has(field.condition.fieldId) && !omittedIds.has(field.id)) {
        omittedIds.add(field.id);
        updated = true;
      }
    }
  }
  return {
    ...definition,
    theme: { ...definition.theme, layout: 'single' },
    pages: definition.pages
      .filter((page) => !page.condition || !omittedIds.has(page.condition.fieldId))
      .map((page) => ({
        ...page,
        fields: page.fields.filter((field) => !omittedIds.has(field.id)),
      })),
  };
}

function formatAnswer(field: FormField, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
  const lookup = new Map((field.options ?? []).map((option) => [option.id, option.label]));
  if (Array.isArray(value)) return value.map((item) => lookup.get(String(item)) ?? String(item)).join('، ');
  if (typeof value === 'string') return lookup.get(value) ?? value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value === undefined || value === null ? '—' : String(value);
}

function errorMessage(failure: unknown, onSessionExpired?: () => void): string {
  if (failure instanceof ApiRequestError && failure.status === 401) {
    onSessionExpired?.();
    return 'نشست شما پایان یافته است؛ دوباره وارد شوید.';
  }
  if (failure instanceof ApiRequestError && failure.status === 403) return failure.message || 'مجوز لازم برای این عملیات را ندارید.';
  if (failure instanceof ApiRequestError && failure.status === 409) return 'وضعیت فرم هم‌زمان تغییر کرده است؛ فرم را دوباره باز کنید.';
  return failure instanceof Error ? failure.message : 'عملیات فرم انجام نشد؛ دوباره تلاش کنید.';
}
