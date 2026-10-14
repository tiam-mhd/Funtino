'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Button } from '@funtino/design-system';
import { FormRenderer } from '@funtino/forms-renderer';
import {
  createEmptyFormDefinition,
  ensureJourneyPages,
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
  short_text: 'متن کوتاه',
  long_text: 'متن بلند',
  full_name: 'نام کامل',
  phone: 'شماره تلفن',
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
  nps: 'NPS',
  slider: 'مقیاس',
  ranking: 'رتبه‌بندی',
  matrix: 'ماتریس',
  consent: 'رضایت',
  heading: 'عنوان',
  paragraph: 'توضیح',
  hidden: 'فیلد پنهان',
};
const responseStatusLabels: Record<ResponseStatus, string> = {
  new: 'جدید',
  in_review: 'در حال بررسی',
  followed_up: 'پیگیری‌شده',
  closed: 'بسته',
  spam: 'نامعتبر',
};
const formStatusLabels: Record<FormStatus, string> = {
  draft: 'پیش‌نویس',
  published: 'منتشرشده',
  paused: 'متوقف',
  archived: 'بایگانی',
};
const fieldGroups: Array<{ label: string; types: FormFieldType[] }> = [
  {
    label: 'متن و اطلاعات پایه',
    types: [
      'short_text',
      'long_text',
      'full_name',
      'phone',
      'email',
      'number',
      'money',
      'date',
      'time',
    ],
  },
  {
    label: 'انتخاب و رضایت',
    types: ['single_choice', 'multiple_choice', 'dropdown', 'yes_no', 'consent'],
  },
  { label: 'امتیاز و اولویت', types: ['rating', 'nps', 'slider', 'ranking', 'matrix'] },
  { label: 'چیدمان و داده‌ی تکمیلی', types: ['heading', 'paragraph', 'hidden'] },
];

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

type FormEditorValidationIssue = {
  message: string;
  pageId?: string;
  fieldId?: string;
  severity: 'error' | 'warning';
};

const emptySettings: FormSettingsDraft = {
  accessMode: 'guest',
  linkEnabled: false,
  startsAt: '',
  endsAt: '',
  responseLimit: '',
};

export function OperationsForms({
  scope,
  scopeOptions,
  onSessionExpired,
  mfaStepUpUntil,
  onMfaStepUp,
}: Props) {
  const [forms, setForms] = useState<OperationsForm[]>([]);
  const [templates, setTemplates] = useState<OperationsFormTemplate[]>([]);
  const [capabilities, setCapabilities] = useState<OperationsFormsCapabilities | null>(null);
  const [selectedForm, setSelectedForm] = useState<OperationsForm | null>(null);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const definitionRef = useRef<FormDefinition | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const formsRequestId = useRef(0);
  const [undoStack, setUndoStack] = useState<FormDefinition[]>([]);
  const [redoStack, setRedoStack] = useState<FormDefinition[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<FormSettingsDraft>(emptySettings);
  const [branchId, setBranchId] = useState(scope.type === 'branch' ? scope.branchId : '');
  const [newTitle, setNewTitle] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [reason, setReason] = useState('');
  const [activeTab, setActiveTab] = useState<'builder' | 'settings' | 'preview' | 'responses'>(
    'builder',
  );
  const [previewAnswers, setPreviewAnswers] = useState<FormAnswers>({});
  const [previewPageId, setPreviewPageId] = useState<string>();
  const [previewCompleted, setPreviewCompleted] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'tablet' | 'mobile'>(
    'desktop',
  );
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [validationIssueDetails, setValidationIssueDetails] = useState<FormEditorValidationIssue[]>(
    [],
  );
  const [formQueryDraft, setFormQueryDraft] = useState('');
  const [formQuery, setFormQuery] = useState('');
  const [formStatusFilter, setFormStatusFilter] = useState<FormStatus | ''>('');
  const [formsNextCursor, setFormsNextCursor] = useState<string | null>(null);
  const [formsLoadingMore, setFormsLoadingMore] = useState(false);
  const [responses, setResponses] = useState<OperationsFormResponse[]>([]);
  const [responseNextCursor, setResponseNextCursor] = useState<string | null>(null);
  const [responseStats, setResponseStats] = useState<{
    total: number;
    byStatus: Partial<Record<ResponseStatus, number>>;
  } | null>(null);
  const [aggregateStats, setAggregateStats] = useState<{
    total: number;
    byStatus: Partial<Record<ResponseStatus, number>>;
    byBranch: Array<{ branchId: string; count: number }>;
  } | null>(null);
  const [responseStatusFilter, setResponseStatusFilter] = useState('');
  const [responseFrom, setResponseFrom] = useState('');
  const [responseTo, setResponseTo] = useState('');
  const [searchFieldId, setSearchFieldId] = useState('');
  const [responseSearch, setResponseSearch] = useState('');
  const [selectedResponse, setSelectedResponse] = useState<OperationsFormResponseDetail | null>(
    null,
  );
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
    if (scope.type === 'branch')
      return scopeOptions.filter(
        (item) => item.scope.type === 'branch' && item.scope.branchId === scope.branchId,
      );
    return scopeOptions.filter(
      (item) => item.scope.type === 'branch' && item.scope.organizationId === scope.organizationId,
    );
  }, [scope, scopeOptions]);

  const formScope = useMemo<OperationsScope | null>(
    () =>
      selectedForm
        ? {
            type: 'branch',
            organizationId: selectedForm.organizationId,
            branchId: selectedForm.branchId,
          }
        : null,
    [selectedForm],
  );
  const activePage =
    definition?.pages.find((page) => page.id === activePageId) ?? definition?.pages[0] ?? null;
  const activePageIndex =
    activePage && definition ? definition.pages.findIndex((page) => page.id === activePage.id) : -1;
  const selectedField = activePage?.fields.find((field) => field.id === selectedFieldId) ?? null;
  const selectedFieldIndex =
    activePage?.fields.findIndex((field) => field.id === selectedField?.id) ?? -1;
  const totalFieldCount =
    definition?.pages.reduce((total, page) => total + page.fields.length, 0) ?? 0;
  const settingsDirty = selectedForm
    ? JSON.stringify(settingsDraft) !== JSON.stringify(settingsFromForm(selectedForm))
    : false;
  const formListKey = JSON.stringify({ scope, query: formQuery, status: formStatusFilter });
  const formListKeyRef = useRef(formListKey);
  formListKeyRef.current = formListKey;
  const searchableFields = useMemo(
    () =>
      definition?.pages
        .flatMap((page) => page.fields)
        .filter((field) => field.searchable && !field.sensitive) ?? [],
    [definition],
  );

  const refreshForms = useCallback(async () => {
    const requestId = ++formsRequestId.current;
    setFormsLoadingMore(false);
    const [permissionSet] = await Promise.all([getOperationsFormsCapabilities(scope)]);
    if (requestId !== formsRequestId.current) return;
    setCapabilities(permissionSet);
    setAggregateStats(null);
    if (scope.type === 'organization' && permissionSet.canReadResponses) {
      const stats = await getOperationsFormAggregateStats(scope);
      if (requestId !== formsRequestId.current) return;
      setAggregateStats(stats);
    }
    if (permissionSet.canRead) {
      const page = await getOperationsForms(scope, {
        pageSize: 50,
        query: formQuery.trim() || undefined,
        status: formStatusFilter || undefined,
      });
      if (requestId !== formsRequestId.current) return;
      setForms(page.items);
      setFormsNextCursor(page.nextCursor);
    } else {
      setForms([]);
      setFormsNextCursor(null);
    }
    if (permissionSet.canRead) {
      const templateScope =
        scope.type === 'branch'
          ? scope
          : branchId
            ? { type: 'branch' as const, organizationId: scope.organizationId, branchId }
            : scope;
      const availableTemplates = await getOperationsFormTemplates(templateScope);
      if (requestId !== formsRequestId.current) return;
      setTemplates(availableTemplates);
    } else {
      setTemplates([]);
    }
    return permissionSet;
  }, [branchId, formQuery, formStatusFilter, scope]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void refreshForms()
      .catch((failure: unknown) => {
        if (active) {
          setError(errorMessage(failure, onSessionExpired));
          if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshForms, onSessionExpired]);

  async function loadMoreForms() {
    if (!formsNextCursor || formsLoadingMore || !capabilities?.canRead) return;
    const requestId = formsRequestId.current;
    const filterKey = formListKey;
    setFormsLoadingMore(true);
    try {
      const page = await getOperationsForms(scope, {
        pageSize: 50,
        cursor: formsNextCursor,
        query: formQuery.trim() || undefined,
        status: formStatusFilter || undefined,
      });
      if (requestId !== formsRequestId.current || filterKey !== formListKeyRef.current) return;
      setForms((current) => [...current, ...page.items]);
      setFormsNextCursor(page.nextCursor);
    } catch (failure) {
      if (requestId === formsRequestId.current && filterKey === formListKeyRef.current) {
        setError(errorMessage(failure, onSessionExpired));
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      }
    } finally {
      if (requestId === formsRequestId.current) setFormsLoadingMore(false);
    }
  }

  async function retryRefreshForms() {
    setLoading(true);
    setError('');
    try {
      await refreshForms();
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (scope.type === 'branch') {
      setBranchId(scope.branchId);
      return;
    }
    setBranchId((current) =>
      branches.some((item) => item.scope.type === 'branch' && item.scope.branchId === current)
        ? current
        : branches[0]?.scope.type === 'branch'
          ? branches[0].scope.branchId
          : '',
    );
  }, [scope, branches]);

  useEffect(() => {
    if (!selectedForm || !definition || !draftDirty || selectedForm.status === 'archived') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const snapshot = definition;
    const formId = selectedForm.id;
    const targetScope = formScope;
    if (!targetScope) return;
    saveTimer.current = setTimeout(() => {
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          const parsed = formDefinitionSchema.safeParse(snapshot);
          if (!parsed.success) {
            setValidationIssues(
              parsed.error.issues
                .slice(0, 5)
                .map((issue) => formatDefinitionIssue(issue.path, snapshot)),
            );
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
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [definition, draftDirty, formScope, onSessionExpired, selectedForm]);

  async function openForm(formId: string, rowOverride?: OperationsForm) {
    const row = rowOverride ?? forms.find((item) => item.id === formId);
    if (!row) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const targetScope: OperationsScope = {
        type: 'branch',
        organizationId: row.organizationId,
        branchId: row.branchId,
      };
      const [form, permissionSet] = await Promise.all([
        getOperationsForm(row.id, targetScope),
        getOperationsFormsCapabilities(targetScope),
      ]);
      const nextDefinition = formDefinitionSchema.parse(form.draftSchema);
      setCapabilities(permissionSet);
      setSelectedForm(form);
      setDefinition(nextDefinition);
      definitionRef.current = nextDefinition;
      setActivePageId(nextDefinition.pages[0]?.id ?? null);
      setSelectedFieldId(nextDefinition.pages[0]?.fields[0]?.id ?? null);
      setUndoStack([]);
      setRedoStack([]);
      setDraftDirty(false);
      setValidationIssues([]);
      setValidationIssueDetails([]);
      setReorderAnnouncement('');
      setSettingsDraft(settingsFromForm(form));
      setPreviewAnswers({});
      setPreviewPageId(
        nextDefinition.pages.find((page) => page.kind === 'start')?.id ??
          nextDefinition.pages.find((page) => page.kind === 'questions')?.id,
      );
      setPreviewCompleted(false);
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
    setValidationIssues([]);
    setValidationIssueDetails([]);
    setError('');
  }

  function openValidationIssue(index: number) {
    const issue = validationIssueDetails[index];
    if (!issue) return;
    setActiveTab('builder');
    if (issue.pageId) {
      setActivePageId(issue.pageId);
      setSelectedFieldId(
        issue.fieldId ??
          definition?.pages.find((page) => page.id === issue.pageId)?.fields[0]?.id ??
          null,
      );
      requestAnimationFrame(() => {
        const heading = document.getElementById('active-page-heading');
        heading?.focus();
        heading?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
  }

  function requestPublish() {
    if (!definition) return;
    const issues = collectPublishIssues(definition);
    setValidationIssueDetails(issues);
    setValidationIssues(issues.map((issue) => issue.message));
    if (issues.some((issue) => issue.severity === 'error')) {
      setActiveTab('builder');
      setError('موارد فهرست‌شده را پیش از انتشار اصلاح کنید.');
      return;
    }
    void changeFormState('publish');
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

  function moveActivePage(from: number, to: number) {
    const page = definition?.pages[from];
    if (!page) return;
    commitDefinition((current) => movePage(current, from, to));
    setReorderAnnouncement(`صفحه‌ی «${page.title}» به جایگاه ${to + 1} منتقل شد.`);
  }

  function moveActiveField(from: number, to: number) {
    const field = activePage?.fields[from];
    if (!field || activePageIndex < 0) return;
    commitDefinition((current) => moveField(current, activePageIndex, from, to));
    setReorderAnnouncement(`پرسش «${field.label}» به جایگاه ${to + 1} منتقل شد.`);
  }

  async function returnToLibrary() {
    if (saving) return;
    if (draftDirty && !(await saveDraftNow())) return;
    setSelectedForm(null);
    setDefinition(null);
    definitionRef.current = null;
    setSelectedFieldId(null);
    setActivePageId(null);
    setActiveTab('builder');
  }

  async function createForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const branchAllowed =
      scope.type === 'branch'
        ? branchId === scope.branchId
        : branches.some((item) => item.scope.type === 'branch' && item.scope.branchId === branchId);
    if (!branchAllowed || !newTitle.trim() || !capabilities?.canManage) return;
    setSaving(true);
    setError('');
    try {
      const targetScope: OperationsScope = {
        type: 'branch',
        organizationId: scope.organizationId,
        branchId,
      };
      const created = await createOperationsForm({
        organizationId: scope.organizationId,
        branchId,
        title: newTitle.trim(),
      });
      const template = templates.find((item) => item.id === selectedTemplateId && item.enabled);
      const definition = template
        ? ensureJourneyPages(
            normalizeDefinition({
              ...(JSON.parse(JSON.stringify(template.definition)) as FormDefinition),
              title: newTitle.trim(),
            }),
          )
        : emptyDefinition(newTitle.trim());
      const saved = await saveOperationsFormDraft(created.id, targetScope, definition);
      setNewTitle('');
      setNotice(template ? 'فرم از روی قالب ساخته شد.' : 'فرم تازه ساخته شد.');
      const page = await getOperationsForms(scope, { pageSize: 50 });
      setForms(page.items);
      setFormsNextCursor(page.nextCursor);
      setSelectedForm(saved);
      setDefinition(formDefinitionSchema.parse(saved.draftSchema));
      definitionRef.current = formDefinitionSchema.parse(saved.draftSchema);
      setActivePageId(saved.draftSchema?.pages[0]?.id ?? null);
      setSelectedFieldId(saved.draftSchema?.pages[0]?.fields[0]?.id ?? null);
      const savedDefinition = formDefinitionSchema.parse(saved.draftSchema);
      setPreviewPageId(
        savedDefinition.pages.find((page) => page.kind === 'start')?.id ??
          savedDefinition.pages.find((page) => page.kind === 'questions')?.id,
      );
      setPreviewCompleted(false);
      setSettingsDraft(settingsFromForm(saved));
      setUndoStack([]);
      setRedoStack([]);
      setDraftDirty(false);
      setValidationIssues([]);
      setValidationIssueDetails([]);
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
      setValidationIssues(
        parsed.error.issues
          .slice(0, 5)
          .map((issue) => formatDefinitionIssue(issue.path, definition)),
      );
      setError('پیش‌نویس معتبر نیست؛ موارد ناقص را اصلاح کنید.');
      return false;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await saveOperationsFormDraft(selectedForm.id, formScope, parsed.data);
      setSelectedForm(updated);
      setDraftDirty(false);
      setValidationIssues([]);
      setValidationIssueDetails([]);
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
    const startsAt = settingsDraft.startsAt ? new Date(settingsDraft.startsAt) : null;
    const endsAt = settingsDraft.endsAt ? new Date(settingsDraft.endsAt) : null;
    const responseLimit = settingsDraft.responseLimit ? Number(settingsDraft.responseLimit) : null;
    if (
      (startsAt && !Number.isFinite(startsAt.getTime())) ||
      (endsAt && !Number.isFinite(endsAt.getTime()))
    ) {
      setError('تاریخ دسترسی معتبر نیست.');
      return;
    }
    if (startsAt && endsAt && endsAt <= startsAt) {
      setError('زمان پایان باید بعد از زمان شروع باشد.');
      return;
    }
    if (responseLimit !== null && (!Number.isInteger(responseLimit) || responseLimit < 1)) {
      setError('سقف پاسخ باید یک عدد صحیح مثبت باشد.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await saveOperationsFormSettings(selectedForm.id, formScope, {
        accessMode: settingsDraft.accessMode,
        linkEnabled: settingsDraft.linkEnabled,
        startsAt: startsAt?.toISOString() ?? null,
        endsAt: endsAt?.toISOString() ?? null,
        responseLimit,
      });
      setSelectedForm((current) =>
        current?.id === updated.id ? { ...current, ...updated } : current,
      );
      setNotice('تنظیمات فرم ذخیره شد.');
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  async function changeFormState(action: 'publish' | 'pause' | 'archive') {
    if (
      !selectedForm ||
      !formScope ||
      !capabilities?.canPublish ||
      (action === 'archive' && reason.trim().length < 8)
    )
      return;
    if (action === 'publish' && settingsDirty) {
      setActiveTab('settings');
      setError('پیش از انتشار، تنظیم‌های دسترسی را ذخیره کنید.');
      return;
    }
    if (action === 'publish' && definition) {
      const parsed = formDefinitionSchema.safeParse(definition);
      if (!parsed.success) {
        const issues = parsed.error.issues;
        setValidationIssues(
          issues.slice(0, 5).map((issue) => formatDefinitionIssue(issue.path, definition)),
        );
        const firstIssue = issues[0];
        const pageIndex =
          firstIssue?.path[0] === 'pages' && typeof firstIssue.path[1] === 'number'
            ? firstIssue.path[1]
            : -1;
        const fieldIndex =
          firstIssue?.path[2] === 'fields' && typeof firstIssue.path[3] === 'number'
            ? firstIssue.path[3]
            : -1;
        const page = definition.pages[pageIndex];
        if (page) {
          setActivePageId(page.id);
          setSelectedFieldId(page.fields[fieldIndex]?.id ?? null);
        }
        setActiveTab('builder');
        setError('فرم پیش از انتشار به اصلاح نیاز دارد.');
        return;
      }
      setValidationIssues([]);
      setValidationIssueDetails([]);
    }
    if (
      action === 'archive' &&
      !window.confirm('فرم بایگانی می‌شود و پیوند عمومی آن غیرفعال خواهد شد. ادامه می‌دهید؟')
    )
      return;
    setSaving(true);
    setError('');
    try {
      if (draftDirty && !(await saveDraftNow())) return;
      const updated = await changeOperationsFormState(
        selectedForm.id,
        formScope,
        action,
        reason.trim() || undefined,
      );
      setSelectedForm((current) =>
        current?.id === updated.id ? { ...current, ...updated } : current,
      );
      setReason('');
      setNotice(
        action === 'publish'
          ? `نسخه‌ی ${updated.currentVersion ?? ''} منتشر شد.`
          : action === 'pause'
            ? 'فرم متوقف شد.'
            : 'فرم بایگانی شد.',
      );
      await refreshForms();
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  async function duplicateForm() {
    if (!selectedForm || !formScope || !capabilities?.canManage || saving) return;
    if (draftDirty && !(await saveDraftNow())) return;
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
      const link = new URL(
        `/fa/forms/${encodeURIComponent(selectedForm.slug)}`,
        configured,
      ).toString();
      await navigator.clipboard.writeText(link);
      setNotice('پیوند عمومی فرم کپی شد.');
    } catch {
      setError('کپی پیوند ممکن نشد؛ دسترسی Clipboard مرورگر را بررسی کنید.');
    }
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedForm || !definition || !capabilities?.canManageTemplates || !templateName.trim())
      return;
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
        status: responseStatusFilter ? (responseStatusFilter as ResponseStatus) : undefined,
        from,
        to,
        searchFieldId: searchFieldId || undefined,
        search: responseSearch.trim() || undefined,
        cursor,
        pageSize: 50,
      });
      setResponses((current) => (append ? [...current, ...page.items] : page.items));
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
      setError('برای نمایش داده‌های حساس مجوز forms.responses.pii.read لازم است.');
      return;
    }
    setError('');
    try {
      const detail = await getOperationsFormResponse(
        selectedForm.id,
        responseId,
        formScope,
        revealSensitive,
      );
      setSelectedResponse(detail);
      setShowSensitiveDetail(revealSensitive);
      setResponseStatusDraft(detail.status);
      setTagsDraft(detail.tags.join(', '));
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      setError(errorMessage(failure, onSessionExpired));
    }
  }

  async function updateResponseStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedForm || !selectedResponse || !formScope || !capabilities?.canManageResponses)
      return;
    setSaving(true);
    try {
      await updateOperationsResponseStatus(
        selectedForm.id,
        selectedResponse.id,
        formScope,
        responseStatusDraft,
        responseReason.trim() || undefined,
      );
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
    if (!selectedForm || !selectedResponse || !formScope || !capabilities?.canCorrectResponses)
      return;
    setSaving(true);
    try {
      await correctOperationsFormResponse(selectedForm.id, selectedResponse.id, formScope, {
        expectedVersion,
        changes,
        reason,
      });
      await openResponse(selectedResponse.id, showSensitiveDetail);
      setNotice('اصلاح پاسخ ثبت شد و در سابقه باقی می‌ماند.');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 403) {
        const updatedCapabilities = await refreshForms().catch(() => null);
        if (updatedCapabilities?.correctionStepUpRequired) setShowStepUp(true);
      }
      setError(errorMessage(failure, onSessionExpired));
      throw failure;
    } finally {
      setSaving(false);
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedForm ||
      !selectedResponse ||
      !formScope ||
      !capabilities?.canManageResponses ||
      !noteDraft.trim()
    )
      return;
    setSaving(true);
    try {
      await addOperationsResponseNote(
        selectedForm.id,
        selectedResponse.id,
        formScope,
        noteDraft.trim(),
      );
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
    if (!selectedForm || !selectedResponse || !formScope || !capabilities?.canManageResponses)
      return;
    setSaving(true);
    try {
      await updateOperationsResponseTags(
        selectedForm.id,
        selectedResponse.id,
        formScope,
        tagsDraft
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      );
      await openResponse(selectedResponse.id, showSensitiveDetail);
      setNotice('برچسب‌های پاسخ ذخیره شد.');
    } catch (failure) {
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  async function exportCsv() {
    if (!selectedForm || !formScope || !capabilities) return;
    if (!capabilities.canExportResponses) {
      if (capabilities.exportStepUpRequired) setShowStepUp(true);
      return;
    }
    if (includeSensitive && !capabilities.canReadSensitiveResponses) {
      setError('برای خروجی شامل داده‌ی حساس مجوز forms.responses.pii.read لازم است.');
      return;
    }
    setSaving(true);
    try {
      const file = await exportOperationsFormResponses(selectedForm.id, formScope, {
        status: responseStatusFilter ? (responseStatusFilter as ResponseStatus) : undefined,
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
      setNotice(
        `${file.exportedCount.toLocaleString('fa-IR')} پاسخ خروجی گرفته شد${file.truncated ? '؛ خروجی به سقف ۵۰۰۰ ردیف رسید.' : '.'}`,
      );
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 403) {
        const updatedCapabilities = await refreshForms().catch(() => null);
        if (updatedCapabilities?.exportStepUpRequired) setShowStepUp(true);
      }
      setError(errorMessage(failure, onSessionExpired));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.page} aria-labelledby="operations-forms-heading" aria-busy={loading}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>مدیریت مشتریان · فرم‌ساز</p>
          <h2 id="operations-forms-heading">
            {selectedForm && definition ? definition.title || 'فرم بدون عنوان' : 'فرم‌ها'}
          </h2>
          <p>
            {selectedForm
              ? `نسخه‌ی منتشرشده: ${selectedForm.currentVersion ?? 'هنوز منتشر نشده'}`
              : 'پیش‌نویس‌ها جدا از نسخه‌های منتشرشده ذخیره می‌شوند؛ هر انتشار نسخه‌ی تازه‌ای می‌سازد.'}
          </p>
        </div>
        <div className={styles.actions}>
          {selectedForm ? (
            <Badge
              tone={
                selectedForm.status === 'published'
                  ? 'success'
                  : selectedForm.status === 'paused'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {formStatusLabels[selectedForm.status]}
            </Badge>
          ) : (
            <Badge tone="neutral">{forms.length.toLocaleString('fa-IR')} فرم</Badge>
          )}
        </div>
      </header>
      {error && (
        <div className={styles.error} role="alert">
          {error}
          {selectedForm && draftDirty && (
            <Button
              type="button"
              tone="ghost"
              disabled={saving}
              onClick={() => void saveDraftNow()}
            >
              تلاش دوباره برای ذخیره
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {!selectedForm &&
        scope.type === 'organization' &&
        capabilities?.canReadResponses &&
        aggregateStats && (
          <section
            className={styles.aggregateReport}
            aria-labelledby="forms-branch-comparison-heading"
          >
            <div className={styles.sectionHeading}>
              <div>
                <h3 id="forms-branch-comparison-heading">مقایسه‌ی پاسخ شعب</h3>
                <p>تجمیع فرم‌های همین مجموعه؛ متن پاسخ‌ها در این گزارش نمایش داده نمی‌شود.</p>
              </div>
              <Badge tone="neutral">{aggregateStats.total.toLocaleString('fa-IR')} پاسخ</Badge>
            </div>
            <ul className={styles.aggregateBranches}>
              {aggregateStats.byBranch.map((item) => {
                const branch = branches.find(
                  (option) =>
                    option.scope.type === 'branch' && option.scope.branchId === item.branchId,
                )?.branch;
                return (
                  <li key={item.branchId} className={styles.aggregateBranch}>
                    <span>{branch?.name ?? `شعبه ${item.branchId.slice(0, 8)}`}</span>
                    <strong>{item.count.toLocaleString('fa-IR')}</strong>
                    <span className={styles.aggregateBar} aria-hidden="true">
                      <i
                        style={{
                          width: `${aggregateStats.total ? Math.max(3, (item.count / aggregateStats.total) * 100) : 0}%`,
                        }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className={styles.statusSummary}>
              {Object.entries(responseStatusLabels).map(([status, label]) => (
                <span key={status}>
                  {label}: {aggregateStats.byStatus[status as ResponseStatus] ?? 0}
                </span>
              ))}
            </div>
          </section>
        )}

      <div
        className={selectedForm && definition ? styles.editorWorkspace : styles.libraryWorkspace}
      >
        {!selectedForm || !definition ? (
          <>
            <section className={styles.libraryMain} aria-labelledby="forms-library-heading">
              <div className={styles.libraryHeading}>
                <div>
                  <p className={styles.eyebrow}>کتابخانه‌ی فرم‌ها</p>
                  <h3 id="forms-library-heading">فرم‌های این محدوده</h3>
                  <p>پیش‌نویس‌ها ذخیره می‌شوند و هر انتشار یک نسخه‌ی جداگانه می‌سازد.</p>
                </div>
                <Badge tone="neutral">
                  {forms.length.toLocaleString('fa-IR')}{' '}
                  {formsNextCursor ? 'فرم در این صفحه' : 'فرم'}
                </Badge>
              </div>
              <form
                className={styles.libraryFilters}
                onSubmit={(event) => {
                  event.preventDefault();
                  setFormQuery(formQueryDraft.trim());
                }}
              >
                <label>
                  جست‌وجو در فرم‌ها
                  <input
                    type="search"
                    value={formQueryDraft}
                    onChange={(event) => setFormQueryDraft(event.target.value)}
                    maxLength={120}
                    placeholder="عنوان فرم را بنویسید"
                  />
                </label>
                <label>
                  وضعیت
                  <select
                    value={formStatusFilter}
                    onChange={(event) => setFormStatusFilter(event.target.value as FormStatus | '')}
                  >
                    <option value="">همه‌ی وضعیت‌ها</option>
                    {Object.entries(formStatusLabels).map(([status, label]) => (
                      <option key={status} value={status}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.libraryFilterActions}>
                  <Button type="submit" tone="secondary" disabled={loading}>
                    جست‌وجو
                  </Button>
                  {(formQuery || formStatusFilter) && (
                    <Button
                      type="button"
                      tone="ghost"
                      disabled={loading}
                      onClick={() => {
                        setFormQueryDraft('');
                        setFormQuery('');
                        setFormStatusFilter('');
                      }}
                    >
                      پاک‌کردن فیلترها
                    </Button>
                  )}
                </div>
              </form>

              {!capabilities?.canRead && !loading ? (
                <div className={styles.emptyState} role="status">
                  <span className={styles.emptyIcon} aria-hidden="true">
                    ◎
                  </span>
                  <h4>دسترسی نمایش فرم‌ها فعال نیست</h4>
                  <p>برای مشاهده‌ی فرم‌های این محدوده، مجوز forms.read لازم است.</p>
                </div>
              ) : loading ? (
                <div
                  className={styles.formCardGrid}
                  aria-label="در حال دریافت فرم‌ها"
                  aria-busy="true"
                >
                  {Array.from({ length: 4 }, (_, index) => (
                    <div className={styles.formSkeleton} key={index}>
                      <span />
                      <span />
                      <span />
                    </div>
                  ))}
                  <p className={styles.srOnly} role="status">
                    در حال دریافت فرم‌ها…
                  </p>
                </div>
              ) : forms.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon} aria-hidden="true">
                    ▤
                  </span>
                  <h4>
                    {formQuery || formStatusFilter
                      ? 'فرمی با این فیلترها پیدا نشد'
                      : 'هنوز فرمی ساخته نشده'}
                  </h4>
                  <p>
                    {formQuery || formStatusFilter
                      ? 'عبارت جست‌وجو یا وضعیت انتخاب‌شده را تغییر دهید.'
                      : 'برای شروع، یک پیش‌نویس خالی بسازید یا از یکی از قالب‌های در دسترس استفاده کنید.'}
                  </p>
                  {(formQuery || formStatusFilter) && (
                    <Button
                      type="button"
                      tone="ghost"
                      onClick={() => {
                        setFormQueryDraft('');
                        setFormQuery('');
                        setFormStatusFilter('');
                      }}
                    >
                      نمایش همه‌ی فرم‌ها
                    </Button>
                  )}
                  {!formQuery && !formStatusFilter && capabilities?.canManage && (
                    <a className={styles.inlineLink} href="#forms-create-card">
                      رفتن به ساخت فرم
                    </a>
                  )}
                </div>
              ) : (
                <ul className={styles.formCardGrid} aria-label="فرم‌های ذخیره‌شده">
                  {forms.map((form) => {
                    const branch = branches.find(
                      (item) =>
                        item.scope.type === 'branch' && item.scope.branchId === form.branchId,
                    )?.branch;
                    return (
                      <li key={form.id}>
                        <button
                          type="button"
                          className={styles.formCard}
                          onClick={() => void openForm(form.id)}
                        >
                          <span className={styles.formCardTop}>
                            <Badge
                              tone={
                                form.status === 'published'
                                  ? 'success'
                                  : form.status === 'paused'
                                    ? 'warning'
                                    : 'neutral'
                              }
                            >
                              {formStatusLabels[form.status]}
                            </Badge>
                            <span className={styles.formCardArrow} aria-hidden="true">
                              ←
                            </span>
                          </span>
                          <strong className={styles.formCardTitle}>{form.title}</strong>
                          <span className={styles.formCardDescription}>
                            {form.description || 'بدون توضیح'}
                          </span>
                          <span className={styles.formCardMeta}>
                            <span>{branch?.name ?? 'محدوده‌ی فعلی'}</span>
                            <span>{form.responseCount.toLocaleString('fa-IR')} پاسخ</span>
                          </span>
                          <span className={styles.formCardMeta}>
                            <span>
                              {form.currentVersion
                                ? 'نسخه‌ی ' + form.currentVersion.toLocaleString('fa-IR')
                                : 'هنوز منتشر نشده'}
                            </span>
                            <time dateTime={form.createdAt}>
                              {new Date(form.createdAt).toLocaleDateString('fa-IR')}
                            </time>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {error && !loading && (
                <Button type="button" tone="secondary" onClick={() => void retryRefreshForms()}>
                  تلاش دوباره
                </Button>
              )}
              {formsNextCursor && !loading && (
                <div className={styles.loadMoreRow}>
                  <Button
                    type="button"
                    tone="ghost"
                    disabled={formsLoadingMore}
                    onClick={() => void loadMoreForms()}
                  >
                    {formsLoadingMore ? 'در حال دریافت…' : 'فرم‌های بیشتر'}
                  </Button>
                </div>
              )}
            </section>

            <aside
              className={styles.createCard}
              id="forms-create-card"
              aria-labelledby="forms-create-heading"
            >
              {loading ? (
                <div className={styles.emptyState} role="status">
                  <span className={styles.createIcon} aria-hidden="true">
                    ＋
                  </span>
                  <p>در حال آماده‌سازی ساخت فرم…</p>
                </div>
              ) : capabilities?.canManage ? (
                <form className={styles.createForm} onSubmit={(event) => void createForm(event)}>
                  <div className={styles.createCardHeading}>
                    <span className={styles.createIcon} aria-hidden="true">
                      ＋
                    </span>
                    <div>
                      <p className={styles.eyebrow}>شروع تازه</p>
                      <h3 id="forms-create-heading">ساخت فرم</h3>
                    </div>
                  </div>
                  <p className={styles.helper}>
                    یک عنوان و محدوده انتخاب کنید؛ پیش‌نویس پس از ساخت در ویرایشگر باز می‌شود.
                  </p>
                  {scope.type === 'organization' ? (
                    <label>
                      شعبه
                      <select
                        required
                        value={branchId}
                        onChange={(event) => setBranchId(event.target.value)}
                      >
                        <option value="">انتخاب شعبه</option>
                        {branches.map((item) =>
                          item.scope.type === 'branch' ? (
                            <option key={item.scope.branchId} value={item.scope.branchId}>
                              {item.branch?.name ?? item.scope.branchId}
                            </option>
                          ) : null,
                        )}
                      </select>
                    </label>
                  ) : (
                    <p className={styles.scopeChip}>
                      شعبه: {branches[0]?.branch?.name ?? 'محدوده‌ی فعلی'}
                    </p>
                  )}
                  <label>
                    عنوان فرم
                    <input
                      required
                      value={newTitle}
                      onChange={(event) => setNewTitle(event.target.value)}
                      maxLength={160}
                      placeholder="مثلاً ثبت‌نام کارگاه نقاشی"
                    />
                  </label>
                  <fieldset className={styles.templatePicker}>
                    <legend>از کجا شروع کنیم؟</legend>
                    <label className={styles.templateChoice}>
                      <input
                        type="radio"
                        name="forms-template"
                        value=""
                        checked={!selectedTemplateId}
                        onChange={() => setSelectedTemplateId('')}
                      />
                      <span>
                        <strong>فرم خالی</strong>
                        <small>ساختار و پرسش‌ها را خودتان اضافه کنید.</small>
                      </span>
                    </label>
                    {templates
                      .filter((item) => item.enabled)
                      .map((template) => (
                        <label className={styles.templateChoice} key={template.id}>
                          <input
                            type="radio"
                            name="forms-template"
                            value={template.id}
                            checked={selectedTemplateId === template.id}
                            onChange={() => setSelectedTemplateId(template.id)}
                          />
                          <span>
                            <strong>{template.name}</strong>
                            <small>
                              {template.description ||
                                template.definition.pages.length.toLocaleString('fa-IR') + ' صفحه'}
                            </small>
                          </span>
                        </label>
                      ))}
                    {templates.filter((item) => item.enabled).length === 0 && (
                      <p className={styles.helper}>قالب فعالی در این محدوده ثبت نشده است.</p>
                    )}
                  </fieldset>
                  <Button type="submit" disabled={saving || !branchId || !newTitle.trim()}>
                    {saving ? 'در حال ساخت…' : 'ساخت پیش‌نویس'}
                  </Button>
                </form>
              ) : (
                <div className={styles.emptyState}>
                  <span className={styles.createIcon} aria-hidden="true">
                    ＋
                  </span>
                  <h3 id="forms-create-heading">ساخت فرم</h3>
                  <p>برای ایجاد یا ویرایش فرم، مجوز forms.manage لازم است.</p>
                </div>
              )}
            </aside>
          </>
        ) : (
          <>
            <div className={styles.editorToolbar}>
              <div className={styles.editorIdentity}>
                <Button
                  type="button"
                  tone="ghost"
                  disabled={saving}
                  onClick={() => void returnToLibrary()}
                >
                  بازگشت به فرم‌ها
                </Button>
                <div>
                  <p className={styles.eyebrow}>
                    {branches.find(
                      (item) =>
                        item.scope.type === 'branch' &&
                        item.scope.branchId === selectedForm.branchId,
                    )?.branch?.name ?? 'فرم محدوده‌ی فعلی'}
                  </p>
                  <h3>{definition.title || selectedForm.title}</h3>
                </div>
              </div>
              <div className={styles.editorToolbarActions}>
                <Badge tone={draftDirty ? 'warning' : saving ? 'neutral' : 'success'}>
                  {draftDirty ? 'تغییر ذخیره‌نشده' : saving ? 'در حال ذخیره' : 'ذخیره شد'}
                </Badge>
                <Button
                  type="button"
                  tone="ghost"
                  disabled={saving || !undoStack.length || !capabilities?.canManage}
                  onClick={undo}
                >
                  واگرد
                </Button>
                <Button
                  type="button"
                  tone="ghost"
                  disabled={saving || !redoStack.length || !capabilities?.canManage}
                  onClick={redo}
                >
                  ازنو
                </Button>
                <Button
                  type="button"
                  tone="secondary"
                  disabled={saving || !draftDirty || !capabilities?.canManage}
                  onClick={() => void saveDraftNow()}
                >
                  ذخیره‌ی پیش‌نویس
                </Button>
                <Button
                  type="button"
                  tone="ghost"
                  disabled={saving || !capabilities?.canManage}
                  onClick={() => void duplicateForm()}
                >
                  ساخت نسخه
                </Button>
              </div>
            </div>

            <nav className={styles.editorNav} aria-label="بخش‌های ویرایش فرم">
              <Button
                type="button"
                tone={activeTab === 'builder' ? 'primary' : 'ghost'}
                aria-current={activeTab === 'builder' ? 'page' : undefined}
                onClick={() => setActiveTab('builder')}
              >
                ساختار فرم
              </Button>
              <Button
                type="button"
                tone={activeTab === 'settings' ? 'primary' : 'ghost'}
                aria-current={activeTab === 'settings' ? 'page' : undefined}
                onClick={() => setActiveTab('settings')}
              >
                تنظیمات و انتشار
              </Button>
              <Button
                type="button"
                tone={activeTab === 'preview' ? 'primary' : 'ghost'}
                aria-current={activeTab === 'preview' ? 'page' : undefined}
                onClick={() => setActiveTab('preview')}
              >
                پیش‌نمایش
              </Button>
              <Button
                type="button"
                tone={activeTab === 'responses' ? 'primary' : 'ghost'}
                aria-current={activeTab === 'responses' ? 'page' : undefined}
                disabled={!capabilities?.canReadResponses}
                onClick={() => void openResponses()}
              >
                پاسخ‌ها
              </Button>
            </nav>

            {validationIssues.length > 0 && (
              <section
                className={styles.validationSummary}
                aria-labelledby="form-validation-heading"
              >
                <h4 id="form-validation-heading">موارد لازم برای تکمیل فرم</h4>
                <ul>
                  {validationIssues.map((item, index) => (
                    <li key={index + '-' + item}>
                      {validationIssueDetails[index]?.pageId ? (
                        <button type="button" onClick={() => openValidationIssue(index)}>
                          {item}
                        </button>
                      ) : (
                        <span>{item}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {activeTab === 'builder' ? (
              <div className={styles.builderGrid}>
                <main className={styles.builderCanvas} aria-label="ساختار فرم">
                  <section className={styles.formMetaCard} aria-labelledby="form-meta-heading">
                    <div className={styles.sectionHeading}>
                      <div>
                        <h4 id="form-meta-heading">معرفی فرم</h4>
                        <p>عنوان فرم و متنی که پاسخ‌دهنده پیش از شروع می‌بیند.</p>
                      </div>
                      <Badge tone="neutral">
                        {totalFieldCount.toLocaleString('fa-IR')} از ۱۰۰ پرسش
                      </Badge>
                    </div>
                    <fieldset
                      disabled={!capabilities?.canManage || selectedForm.status === 'archived'}
                      className={styles.formMetaFields}
                    >
                      <label>
                        عنوان فرم
                        <input
                          value={definition.title}
                          onChange={(event) =>
                            commitDefinition((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                          maxLength={160}
                        />
                      </label>
                      <label>
                        توضیح فرم
                        <textarea
                          rows={2}
                          value={definition.description}
                          onChange={(event) =>
                            commitDefinition((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          maxLength={1500}
                        />
                      </label>
                      <details className={styles.formCopyDetails}>
                        <summary>متن خوش‌آمدگویی و پیام پس از ثبت</summary>
                        <div className={styles.twoColumns}>
                          <label>
                            عنوان خوش‌آمدگویی
                            <input
                              value={definition.welcomeTitle}
                              onChange={(event) =>
                                commitDefinition((current) => ({
                                  ...current,
                                  welcomeTitle: event.target.value,
                                }))
                              }
                              maxLength={160}
                            />
                          </label>
                          <label>
                            پیام خوش‌آمدگویی
                            <textarea
                              rows={2}
                              value={definition.welcomeMessage}
                              onChange={(event) =>
                                commitDefinition((current) => ({
                                  ...current,
                                  welcomeMessage: event.target.value,
                                }))
                              }
                              maxLength={1000}
                            />
                          </label>
                          <label>
                            پیام پس از ثبت
                            <textarea
                              rows={2}
                              value={definition.successMessage}
                              onChange={(event) =>
                                commitDefinition((current) => ({
                                  ...current,
                                  successMessage: event.target.value,
                                }))
                              }
                              maxLength={1000}
                            />
                          </label>
                        </div>
                      </details>
                      <details className={styles.formCopyDetails}>
                        <summary>ظاهر کلی فرم و کارت‌ها</summary>
                        <div className={styles.themeForm}>
                          <div className={styles.twoColumns}>
                            <label>
                              رنگ اصلی
                              <input
                                type="color"
                                value={definition.theme.primaryColor}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: { ...current.theme, primaryColor: event.target.value },
                                  }))
                                }
                              />
                            </label>
                            <label>
                              رنگ تأکیدی
                              <input
                                type="color"
                                value={definition.theme.accentColor}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: { ...current.theme, accentColor: event.target.value },
                                  }))
                                }
                              />
                            </label>
                            <label>
                              پس‌زمینه‌ی فرم
                              <input
                                type="color"
                                value={definition.theme.backgroundColor}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: {
                                      ...current.theme,
                                      backgroundColor: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </label>
                            <label>
                              سطح فیلدها
                              <input
                                type="color"
                                value={definition.theme.surfaceColor}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: { ...current.theme, surfaceColor: event.target.value },
                                  }))
                                }
                              />
                            </label>
                            <label>
                              فونت
                              <select
                                value={definition.theme.font}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: {
                                      ...current.theme,
                                      font: event.target.value as FormDefinition['theme']['font'],
                                    },
                                  }))
                                }
                              >
                                <option value="estedad">استعداد</option>
                                <option value="vazirmatn">وزیرمتن</option>
                              </select>
                            </label>
                            <label>
                              چیدمان
                              <select
                                value={definition.theme.layout}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: {
                                      ...current.theme,
                                      layout: event.target
                                        .value as FormDefinition['theme']['layout'],
                                    },
                                  }))
                                }
                              >
                                <option value="paged">مرحله‌ای</option>
                                <option value="single">یک‌صفحه‌ای</option>
                              </select>
                            </label>
                            <label>
                              تراکم فیلدها
                              <select
                                value={definition.theme.density}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: {
                                      ...current.theme,
                                      density: event.target
                                        .value as FormDefinition['theme']['density'],
                                    },
                                  }))
                                }
                              >
                                <option value="comfortable">معمولی</option>
                                <option value="compact">فشرده</option>
                              </select>
                            </label>
                            <label>
                              سبک دکمه‌ها
                              <select
                                value={definition.theme.buttonStyle}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: {
                                      ...current.theme,
                                      buttonStyle: event.target
                                        .value as FormDefinition['theme']['buttonStyle'],
                                    },
                                  }))
                                }
                              >
                                <option value="solid">پررنگ</option>
                                <option value="outlined">خط‌دار</option>
                              </select>
                            </label>
                          </div>
                          <label>
                            حداکثر عرض کارت
                            <select
                              value={definition.theme.cardStyle.maxWidth}
                              onChange={(event) =>
                                commitDefinition((current) => ({
                                  ...current,
                                  theme: {
                                    ...current.theme,
                                    cardStyle: {
                                      ...current.theme.cardStyle,
                                      maxWidth: event.target
                                        .value as FormDefinition['theme']['cardStyle']['maxWidth'],
                                    },
                                  },
                                }))
                              }
                            >
                              <option value="narrow">باریک</option>
                              <option value="medium">متوسط</option>
                              <option value="wide">عریض</option>
                              <option value="full">تمام‌عرض</option>
                            </select>
                          </label>
                          <div className={styles.twoColumns}>
                            <label>
                              فاصله‌ی داخلی کارت
                              <input
                                type="number"
                                min="8"
                                max="40"
                                value={definition.theme.cardStyle.padding}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: {
                                      ...current.theme,
                                      cardStyle: {
                                        ...current.theme.cardStyle,
                                        padding: Number(event.target.value),
                                      },
                                    },
                                  }))
                                }
                              />
                            </label>
                            <label>
                              فاصله‌ی پرسش‌ها
                              <input
                                type="number"
                                min="6"
                                max="32"
                                value={definition.theme.cardStyle.gap}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: {
                                      ...current.theme,
                                      cardStyle: {
                                        ...current.theme.cardStyle,
                                        gap: Number(event.target.value),
                                      },
                                    },
                                  }))
                                }
                              />
                            </label>
                            <label>
                              گردی کارت
                              <input
                                type="number"
                                min="0"
                                max="36"
                                value={definition.theme.cardStyle.radius}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: {
                                      ...current.theme,
                                      cardStyle: {
                                        ...current.theme.cardStyle,
                                        radius: Number(event.target.value),
                                      },
                                    },
                                  }))
                                }
                              />
                            </label>
                            <label>
                              سایه
                              <select
                                value={definition.theme.cardStyle.shadow}
                                onChange={(event) =>
                                  commitDefinition((current) => ({
                                    ...current,
                                    theme: {
                                      ...current.theme,
                                      cardStyle: {
                                        ...current.theme.cardStyle,
                                        shadow: event.target
                                          .value as FormDefinition['theme']['cardStyle']['shadow'],
                                      },
                                    },
                                  }))
                                }
                              >
                                <option value="none">بدون سایه</option>
                                <option value="soft">ملایم</option>
                                <option value="raised">برجسته</option>
                              </select>
                            </label>
                          </div>
                          <label className={styles.checkbox}>
                            <input
                              type="checkbox"
                              checked={definition.theme.showProgress}
                              onChange={(event) =>
                                commitDefinition((current) => ({
                                  ...current,
                                  theme: { ...current.theme, showProgress: event.target.checked },
                                }))
                              }
                            />
                            نمایش پیشرفت پاسخ‌گویی
                          </label>
                        </div>
                      </details>
                    </fieldset>
                  </section>

                  <section className={styles.formMetaCard} aria-labelledby="journey-pages-heading">
                    <div className={styles.sectionHeading}>
                      <div>
                        <h4 id="journey-pages-heading">صفحه‌های شروع و پایان</h4>
                        <p>
                          این صفحه‌ها جدا از پرسش‌ها هستند؛ پایان فقط پس از ثبت موفق نمایش داده
                          می‌شود.
                        </p>
                      </div>
                    </div>
                    <div className={styles.twoColumns}>
                      <label className={styles.checkbox}>
                        <input
                          type="checkbox"
                          checked={definition.pages.some((page) => page.kind === 'start')}
                          disabled={
                            !capabilities?.canManage ||
                            selectedForm.status === 'archived' ||
                            (!definition.pages.some((page) => page.kind === 'start') &&
                              definition.pages.length >= 20)
                          }
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            if (
                              !enabled &&
                              !window.confirm(
                                'صفحه‌ی شروع حذف شود؟ فرم از نخستین پرسش آغاز خواهد شد.',
                              )
                            )
                              return;
                            const next = toggleJourneyPage(definition, 'start', enabled);
                            commitDefinition(() => next);
                            const active = next.pages.find((page) => page.id === activePageId);
                            if (!active) setActivePageId(next.pages[0]?.id ?? null);
                          }}
                        />
                        صفحه‌ی شروع فعال باشد
                      </label>
                      <label className={styles.checkbox}>
                        <input
                          type="checkbox"
                          checked={definition.pages.some((page) => page.kind === 'end')}
                          disabled={
                            !capabilities?.canManage ||
                            selectedForm.status === 'archived' ||
                            (!definition.pages.some((page) => page.kind === 'end') &&
                              definition.pages.length >= 20)
                          }
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            if (
                              !enabled &&
                              !window.confirm(
                                'صفحه‌ی پایان حذف شود؟ پس از ثبت، پیام موفقیت عمومی نمایش داده می‌شود.',
                              )
                            )
                              return;
                            const next = toggleJourneyPage(definition, 'end', enabled);
                            commitDefinition(() => next);
                            const active = next.pages.find((page) => page.id === activePageId);
                            if (!active) setActivePageId(next.pages[0]?.id ?? null);
                          }}
                        />
                        صفحه‌ی پایان فعال باشد
                      </label>
                    </div>
                  </section>

                  <section className={styles.pageBuilder} aria-labelledby="form-pages-heading">
                    <div className={styles.sectionHeading}>
                      <div>
                        <h4 id="form-pages-heading">صفحه‌ها و پرسش‌ها</h4>
                        <p>
                          صفحه‌ی فعال را انتخاب کنید و ترتیب را با دسته‌گیره یا دکمه‌های جابه‌جایی
                          تغییر دهید.
                        </p>
                      </div>
                      <Button
                        type="button"
                        tone="secondary"
                        disabled={
                          !capabilities?.canManage ||
                          selectedForm.status === 'archived' ||
                          definition.pages.length >= 20
                        }
                        onClick={() => {
                          const next = addPage(definition);
                          const page = [...next.pages]
                            .reverse()
                            .find((item) => item.kind === 'questions');
                          commitDefinition(() => next);
                          setActivePageId(page?.id ?? null);
                          setPreviewPageId(page?.id);
                          setSelectedFieldId(null);
                        }}
                      >
                        افزودن صفحه
                      </Button>
                    </div>
                    <div className={styles.pageTabList} role="group" aria-label="انتخاب صفحه">
                      {definition.pages.map((page, pageIndex) => (
                        <div
                          className={styles.pageTabItem}
                          key={page.id}
                          onDragOver={(event) => {
                            if (
                              event.dataTransfer.types.includes('application/x-funtino-page-index')
                            )
                              event.preventDefault();
                          }}
                          onDrop={(event) => {
                            if (
                              !event.dataTransfer.types.includes('application/x-funtino-page-index')
                            )
                              return;
                            event.preventDefault();
                            const from = Number(
                              event.dataTransfer.getData('application/x-funtino-page-index'),
                            );
                            if (
                              Number.isInteger(from) &&
                              definition.pages[from]?.kind === 'questions' &&
                              page.kind === 'questions'
                            )
                              moveActivePage(from, pageIndex);
                          }}
                        >
                          <span
                            className={styles.pageDragHandle}
                            draggable={page.kind === 'questions'}
                            aria-label={'جابجایی صفحه‌ی ' + page.title}
                            title={
                              page.kind === 'questions'
                                ? 'برای جابه‌جایی بکشید'
                                : 'جایگاه صفحه‌ی شروع و پایان ثابت است'
                            }
                            onDragStart={(event) => {
                              event.dataTransfer.setData(
                                'application/x-funtino-page-index',
                                String(pageIndex),
                              );
                              event.dataTransfer.effectAllowed = 'move';
                            }}
                          >
                            ⠿
                          </span>
                          <button
                            type="button"
                            className={
                              activePage?.id === page.id ? styles.pageTabActive : styles.pageTab
                            }
                            aria-pressed={activePage?.id === page.id}
                            onClick={() => {
                              setActivePageId(page.id);
                              setPreviewPageId(page.id);
                              setSelectedFieldId(page.fields[0]?.id ?? null);
                            }}
                          >
                            <span>
                              {page.kind === 'start'
                                ? 'شروع'
                                : page.kind === 'end'
                                  ? 'پایان'
                                  : (pageIndex + 1).toLocaleString('fa-IR')}
                            </span>
                            <strong>{page.title || 'بدون عنوان'}</strong>
                            <small>
                              {page.kind === 'questions'
                                ? page.fields.length.toLocaleString('fa-IR') + ' پرسش'
                                : page.kind === 'start'
                                  ? 'پیش از پاسخ‌گویی'
                                  : 'پس از ثبت موفق'}
                            </small>
                          </button>
                        </div>
                      ))}
                    </div>
                    {activePage && activePageIndex >= 0 && (
                      <section
                        className={styles.activePagePanel}
                        aria-labelledby="active-page-heading"
                      >
                        <div className={styles.activePageHeading}>
                          <div>
                            <p className={styles.eyebrow}>
                              {activePage.kind === 'start'
                                ? 'صفحه‌ی شروع'
                                : activePage.kind === 'end'
                                  ? 'صفحه‌ی پایان'
                                  : 'صفحه‌ی پرسش ' + (activePageIndex + 1).toLocaleString('fa-IR')}
                            </p>
                            <h5 id="active-page-heading" tabIndex={-1}>
                              {activePage.title || 'صفحه‌ی بدون عنوان'}
                            </h5>
                          </div>
                          <div className={styles.inlineActions}>
                            <Button
                              type="button"
                              tone="ghost"
                              disabled={
                                !capabilities?.canManage ||
                                activePage.kind !== 'questions' ||
                                definition.pages[activePageIndex - 1]?.kind !== 'questions'
                              }
                              aria-label="انتقال صفحه به بالا"
                              onClick={() => moveActivePage(activePageIndex, activePageIndex - 1)}
                            >
                              ↑
                            </Button>
                            <Button
                              type="button"
                              tone="ghost"
                              disabled={
                                !capabilities?.canManage ||
                                activePage.kind !== 'questions' ||
                                definition.pages[activePageIndex + 1]?.kind !== 'questions'
                              }
                              aria-label="انتقال صفحه به پایین"
                              onClick={() => moveActivePage(activePageIndex, activePageIndex + 1)}
                            >
                              ↓
                            </Button>
                            <Button
                              type="button"
                              tone="ghost"
                              disabled={
                                !capabilities?.canManage ||
                                activePage.kind !== 'questions' ||
                                selectedForm.status === 'archived'
                              }
                              onClick={() => {
                                const next = removePage(definition, activePageIndex);
                                commitDefinition(() => next);
                                const nextPage =
                                  next.pages[Math.min(activePageIndex, next.pages.length - 1)];
                                setActivePageId(nextPage?.id ?? null);
                                setSelectedFieldId(nextPage?.fields[0]?.id ?? null);
                              }}
                            >
                              حذف صفحه
                            </Button>
                          </div>
                        </div>
                        <fieldset
                          disabled={!capabilities?.canManage || selectedForm.status === 'archived'}
                          className={styles.pageMetaFields}
                        >
                          <label>
                            عنوان صفحه
                            <input
                              value={activePage.title}
                              onChange={(event) =>
                                commitDefinition((current) =>
                                  updatePage(current, activePageIndex, {
                                    title: event.target.value,
                                  }),
                                )
                              }
                              maxLength={160}
                            />
                          </label>
                          <details className={styles.formCopyDetails}>
                            <summary>توضیح و شرط نمایش صفحه</summary>
                            <label>
                              توضیح صفحه
                              <textarea
                                rows={2}
                                value={activePage.description}
                                onChange={(event) =>
                                  commitDefinition((current) =>
                                    updatePage(current, activePageIndex, {
                                      description: event.target.value,
                                    }),
                                  )
                                }
                                maxLength={1000}
                              />
                            </label>
                            {activePage.kind === 'questions' && (
                              <PageConditionEditor
                                definition={definition}
                                pageIndex={activePageIndex}
                                condition={activePage.condition}
                                onChange={(condition) =>
                                  commitDefinition((current) =>
                                    updatePage(current, activePageIndex, { condition }),
                                  )
                                }
                              />
                            )}
                          </details>
                          <details className={styles.formCopyDetails}>
                            <summary>پس‌زمینه و کارت این صفحه</summary>
                            <label>
                              رنگ پس‌زمینه‌ی صفحه
                              <input
                                type="color"
                                value={
                                  activePage.backgroundColor ?? definition.theme.backgroundColor
                                }
                                onChange={(event) =>
                                  commitDefinition((current) =>
                                    updatePage(current, activePageIndex, {
                                      backgroundColor: event.target.value,
                                    }),
                                  )
                                }
                              />
                            </label>
                            <div className={styles.inlineActions}>
                              <span className={styles.helper}>
                                {activePage.cardStyle
                                  ? 'ظاهر اختصاصی همین صفحه فعال است.'
                                  : 'تنظیم‌های کارت از ظاهر کلی فرم به ارث می‌رسند.'}
                              </span>
                              {activePage.cardStyle && (
                                <Button
                                  type="button"
                                  tone="ghost"
                                  onClick={() =>
                                    commitDefinition((current) =>
                                      updatePage(current, activePageIndex, {
                                        cardStyle: undefined,
                                      }),
                                    )
                                  }
                                >
                                  بازنشانی به ظاهر کلی
                                </Button>
                              )}
                            </div>
                            <div className={styles.twoColumns}>
                              <label>
                                عرض کارت
                                <select
                                  value={
                                    activePage.cardStyle?.maxWidth ??
                                    definition.theme.cardStyle.maxWidth
                                  }
                                  onChange={(event) =>
                                    commitDefinition((current) =>
                                      updatePage(current, activePageIndex, {
                                        cardStyle: {
                                          ...current.pages[activePageIndex]!.cardStyle,
                                          maxWidth: event.target
                                            .value as FormDefinition['theme']['cardStyle']['maxWidth'],
                                        },
                                      }),
                                    )
                                  }
                                >
                                  <option value="narrow">باریک</option>
                                  <option value="medium">متوسط</option>
                                  <option value="wide">عریض</option>
                                  <option value="full">تمام‌عرض</option>
                                </select>
                              </label>
                              <label>
                                رنگ کارت
                                <input
                                  type="color"
                                  value={
                                    activePage.cardStyle?.backgroundColor ??
                                    definition.theme.cardStyle.backgroundColor
                                  }
                                  onChange={(event) =>
                                    commitDefinition((current) =>
                                      updatePage(current, activePageIndex, {
                                        cardStyle: {
                                          ...current.pages[activePageIndex]!.cardStyle,
                                          backgroundColor: event.target.value,
                                        },
                                      }),
                                    )
                                  }
                                />
                              </label>
                              <label>
                                فاصله‌ی داخلی
                                <input
                                  type="number"
                                  min="8"
                                  max="40"
                                  value={
                                    activePage.cardStyle?.padding ??
                                    definition.theme.cardStyle.padding
                                  }
                                  onChange={(event) =>
                                    commitDefinition((current) =>
                                      updatePage(current, activePageIndex, {
                                        cardStyle: {
                                          ...current.pages[activePageIndex]!.cardStyle,
                                          padding: Number(event.target.value),
                                        },
                                      }),
                                    )
                                  }
                                />
                              </label>
                              <label>
                                گردی کارت
                                <input
                                  type="number"
                                  min="0"
                                  max="36"
                                  value={
                                    activePage.cardStyle?.radius ??
                                    definition.theme.cardStyle.radius
                                  }
                                  onChange={(event) =>
                                    commitDefinition((current) =>
                                      updatePage(current, activePageIndex, {
                                        cardStyle: {
                                          ...current.pages[activePageIndex]!.cardStyle,
                                          radius: Number(event.target.value),
                                        },
                                      }),
                                    )
                                  }
                                />
                              </label>
                              <label>
                                رنگ حاشیه
                                <input
                                  type="color"
                                  value={
                                    activePage.cardStyle?.borderColor ??
                                    definition.theme.cardStyle.borderColor
                                  }
                                  onChange={(event) =>
                                    commitDefinition((current) =>
                                      updatePage(current, activePageIndex, {
                                        cardStyle: {
                                          ...current.pages[activePageIndex]!.cardStyle,
                                          borderColor: event.target.value,
                                        },
                                      }),
                                    )
                                  }
                                />
                              </label>
                              <label>
                                ضخامت حاشیه
                                <input
                                  type="number"
                                  min="0"
                                  max="4"
                                  value={
                                    activePage.cardStyle?.borderWidth ??
                                    definition.theme.cardStyle.borderWidth
                                  }
                                  onChange={(event) =>
                                    commitDefinition((current) =>
                                      updatePage(current, activePageIndex, {
                                        cardStyle: {
                                          ...current.pages[activePageIndex]!.cardStyle,
                                          borderWidth: Number(event.target.value),
                                        },
                                      }),
                                    )
                                  }
                                />
                              </label>
                            </div>
                          </details>
                        </fieldset>

                        <section
                          className={styles.formMetaCard}
                          aria-labelledby="page-media-heading"
                        >
                          <div className={styles.sectionHeading}>
                            <div>
                              <h6 id="page-media-heading">رسانه و پس‌زمینه‌ی تصویری</h6>
                              <p>
                                بارگذاری و کتابخانه‌ی رسانه تا انتخاب زیرساخت امن ذخیره‌سازی و
                                دانلود غیرفعال‌اند.
                              </p>
                            </div>
                          </div>
                          <div className={styles.inlineActions}>
                            <Button
                              type="button"
                              tone="ghost"
                              disabled
                              aria-describedby="page-media-limit"
                            >
                              بارگذاری تصویر یا ویدیو
                            </Button>
                            <p id="page-media-limit" className={styles.helper}>
                              فایل یا preview ساختگی ذخیره نمی‌شود؛ رنگ پس‌زمینه و تنظیم‌های کارت
                              همین صفحه فعال‌اند.
                            </p>
                          </div>
                        </section>

                        {activePage.kind === 'questions' ? (
                          <div className={styles.fieldBuilder}>
                            <section className={styles.fieldListPanel} aria-label="پرسش‌های صفحه">
                              <div className={styles.sectionHeading}>
                                <div>
                                  <h6>پرسش‌های این صفحه</h6>
                                  <p>یک پرسش را انتخاب کنید تا تنظیماتش در پنل کناری باز شود.</p>
                                </div>
                                <Badge tone="neutral">
                                  {activePage.fields.length.toLocaleString('fa-IR')}
                                </Badge>
                              </div>
                              {activePage.fields.length === 0 ? (
                                <p className={styles.emptyFieldList}>
                                  هنوز پرسشی در این صفحه نیست؛ از فهرست نوع پرسش‌ها یک مورد اضافه
                                  کنید.
                                </p>
                              ) : (
                                <ul className={styles.fieldList}>
                                  {activePage.fields.map((field, fieldIndex) => (
                                    <li
                                      className={styles.fieldListItem}
                                      key={field.id}
                                      onDragOver={(event) => {
                                        if (
                                          event.dataTransfer.types.includes(
                                            'application/x-funtino-field-index',
                                          )
                                        )
                                          event.preventDefault();
                                      }}
                                      onDrop={(event) => {
                                        if (
                                          !event.dataTransfer.types.includes(
                                            'application/x-funtino-field-index',
                                          )
                                        )
                                          return;
                                        event.preventDefault();
                                        const from = Number(
                                          event.dataTransfer.getData(
                                            'application/x-funtino-field-index',
                                          ),
                                        );
                                        if (Number.isInteger(from))
                                          moveActiveField(from, fieldIndex);
                                      }}
                                    >
                                      <span
                                        className={styles.dragHandle}
                                        draggable
                                        aria-hidden="true"
                                        title="برای جابه‌جایی بکشید"
                                        onDragStart={(event) => {
                                          event.dataTransfer.setData(
                                            'application/x-funtino-field-index',
                                            String(fieldIndex),
                                          );
                                          event.dataTransfer.effectAllowed = 'move';
                                        }}
                                      >
                                        ⠿
                                      </span>
                                      <button
                                        type="button"
                                        className={
                                          selectedField?.id === field.id
                                            ? styles.fieldSelectActive
                                            : styles.fieldSelect
                                        }
                                        aria-pressed={selectedField?.id === field.id}
                                        onClick={() => setSelectedFieldId(field.id)}
                                      >
                                        <span className={styles.fieldSelectTop}>
                                          <Badge tone="neutral">{fieldLabels[field.type]}</Badge>
                                          {field.required && <small>الزامی</small>}
                                          {field.sensitive && <small>حساس</small>}
                                        </span>
                                        <strong>{field.label || 'پرسش بدون برچسب'}</strong>
                                        {field.description && <span>{field.description}</span>}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <div
                                className={styles.liveAnnouncement}
                                aria-live="polite"
                                aria-atomic="true"
                              >
                                {reorderAnnouncement}
                              </div>
                            </section>
                            <aside
                              className={styles.fieldInspector}
                              aria-label="تنظیمات پرسش انتخاب‌شده"
                            >
                              {selectedField && selectedFieldIndex >= 0 ? (
                                <FieldEditor
                                  field={selectedField}
                                  pageIndex={activePageIndex}
                                  fieldIndex={selectedFieldIndex}
                                  definition={definition}
                                  disabled={
                                    !capabilities?.canManage || selectedForm.status === 'archived'
                                  }
                                  onUpdate={(patch) =>
                                    commitDefinition((current) =>
                                      updateField(
                                        current,
                                        activePageIndex,
                                        selectedFieldIndex,
                                        patch,
                                      ),
                                    )
                                  }
                                  onMove={(to) => moveActiveField(selectedFieldIndex, to)}
                                  onDuplicate={() =>
                                    commitDefinition((current) =>
                                      duplicateField(current, activePageIndex, selectedFieldIndex),
                                    )
                                  }
                                  onDelete={() => {
                                    const next = removeField(definition, selectedField.id);
                                    commitDefinition(() => next);
                                    setSelectedFieldId(
                                      activePage.fields[Math.max(0, selectedFieldIndex - 1)]?.id ??
                                        null,
                                    );
                                  }}
                                />
                              ) : (
                                <div className={styles.inspectorEmpty}>
                                  <span aria-hidden="true">⚙</span>
                                  <h6>پرسشی انتخاب نشده</h6>
                                  <p>
                                    برای ویرایش برچسب، گزینه‌ها، شرط‌ها و اعتبارسنجی، یک پرسش را
                                    انتخاب کنید.
                                  </p>
                                </div>
                              )}
                            </aside>
                            <section
                              className={styles.fieldPalette}
                              aria-labelledby="field-palette-heading"
                            >
                              <div className={styles.sectionHeading}>
                                <div>
                                  <h6 id="field-palette-heading">افزودن پرسش</h6>
                                  <p>
                                    {totalFieldCount >= 100
                                      ? 'حداکثر ۱۰۰ پرسش برای هر فرم مجاز است.'
                                      : 'نوع داده را از دسته‌ی مناسب انتخاب کنید.'}
                                  </p>
                                </div>
                                <Badge tone="neutral">
                                  {totalFieldCount.toLocaleString('fa-IR')} / ۱۰۰
                                </Badge>
                              </div>
                              <fieldset
                                disabled={
                                  !capabilities?.canManage ||
                                  selectedForm.status === 'archived' ||
                                  totalFieldCount >= 100
                                }
                                className={styles.fieldGroups}
                              >
                                {fieldGroups.map((group) => (
                                  <div className={styles.fieldGroup} key={group.label}>
                                    <h6>{group.label}</h6>
                                    <div className={styles.fieldTypeGrid}>
                                      {group.types.map((type) => (
                                        <Button
                                          key={type}
                                          type="button"
                                          tone="ghost"
                                          onClick={() => {
                                            const next = addField(
                                              definition,
                                              activePageIndex,
                                              type,
                                            );
                                            const field =
                                              next.pages[activePageIndex]?.fields.at(-1);
                                            commitDefinition(() => next);
                                            setSelectedFieldId(field?.id ?? null);
                                          }}
                                        >
                                          {fieldLabels[type]}
                                        </Button>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </fieldset>
                              <p className={styles.helper}>
                                بارگذاری فایل یا تصویر، امضا و محاسبه‌ی خودکار تا آماده‌شدن قرارداد
                                ذخیره‌سازی و دانلود در دسترس نیست.
                              </p>
                            </section>
                          </div>
                        ) : (
                          <p className={styles.emptyFieldList}>
                            {activePage.kind === 'start'
                              ? 'این صفحه فقط معرفی فرم را نشان می‌دهد و دکمه‌ی «شروع فرم» دارد.'
                              : 'این صفحه پس از ثبت موفق نمایش داده می‌شود و دکمه‌ی مرحله‌ی بعد ندارد.'}
                          </p>
                        )}
                      </section>
                    )}
                  </section>
                </main>
                <aside className={styles.builderAside}>
                  <div className={styles.builderAsideCard}>
                    <Badge
                      tone={
                        selectedForm.status === 'published'
                          ? 'success'
                          : selectedForm.status === 'paused'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {formStatusLabels[selectedForm.status]}
                    </Badge>
                    <h4>نسخه‌ی منتشرشده</h4>
                    <strong>
                      {selectedForm.currentVersion
                        ? selectedForm.currentVersion.toLocaleString('fa-IR')
                        : 'هنوز نسخه‌ای منتشر نشده'}
                    </strong>
                    {selectedForm.publishedAt && (
                      <time dateTime={selectedForm.publishedAt}>
                        آخرین انتشار:{' '}
                        {new Date(selectedForm.publishedAt).toLocaleDateString('fa-IR')}
                      </time>
                    )}
                    <p>تغییرهای پیش‌نویس با انتشار بعدی به نسخه‌ی تازه تبدیل می‌شوند.</p>
                    <Button type="button" tone="secondary" onClick={() => setActiveTab('preview')}>
                      دیدن پیش‌نمایش
                    </Button>
                  </div>
                  <div className={styles.builderAsideCard}>
                    <h4>راهنمای وضعیت</h4>
                    <p>
                      تغییرها پس از مکث کوتاه خودکار ذخیره می‌شوند. انتشار به دلیل ثبت‌شده نیاز
                      دارد.
                    </p>
                    {!capabilities?.canManage && (
                      <p className={styles.helper}>برای ویرایش مجوز forms.manage لازم است.</p>
                    )}
                    {!capabilities?.canPublish && (
                      <p className={styles.helper}>برای انتشار مجوز forms.publish لازم است.</p>
                    )}
                  </div>
                </aside>
              </div>
            ) : activeTab === 'settings' ? (
              <div className={styles.settingsWorkspace}>
                <section className={styles.themeSettings} aria-labelledby="form-theme-heading">
                  <div className={styles.sectionHeading}>
                    <div>
                      <h4 id="form-theme-heading">ظاهر و تجربه‌ی فرم</h4>
                      <p>این تنظیم‌ها روی پیش‌نمایش و نسخه‌ی بعدی فرم اعمال می‌شوند.</p>
                    </div>
                  </div>
                  <fieldset
                    disabled={!capabilities?.canManage || selectedForm.status === 'archived'}
                    className={styles.settingsFields}
                  >
                    <div className={styles.twoColumns}>
                      <label>
                        رنگ اصلی
                        <input
                          type="color"
                          value={definition.theme.primaryColor}
                          onChange={(event) =>
                            commitDefinition((current) => ({
                              ...current,
                              theme: { ...current.theme, primaryColor: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <label>
                        رنگ تأکیدی
                        <input
                          type="color"
                          value={definition.theme.accentColor}
                          onChange={(event) =>
                            commitDefinition((current) => ({
                              ...current,
                              theme: { ...current.theme, accentColor: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <label>
                        پس‌زمینه
                        <input
                          type="color"
                          value={definition.theme.backgroundColor}
                          onChange={(event) =>
                            commitDefinition((current) => ({
                              ...current,
                              theme: { ...current.theme, backgroundColor: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <label>
                        سطح کارت
                        <input
                          type="color"
                          value={definition.theme.surfaceColor}
                          onChange={(event) =>
                            commitDefinition((current) => ({
                              ...current,
                              theme: { ...current.theme, surfaceColor: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <label>
                        فونت فرم
                        <select
                          value={definition.theme.font}
                          onChange={(event) =>
                            commitDefinition((current) => ({
                              ...current,
                              theme: {
                                ...current.theme,
                                font: event.target.value as FormDefinition['theme']['font'],
                              },
                            }))
                          }
                        >
                          <option value="estedad">استعداد</option>
                          <option value="vazirmatn">وزیرمتن</option>
                        </select>
                      </label>
                      <label>
                        گردی گوشه‌ها
                        <select
                          value={definition.theme.cornerStyle}
                          onChange={(event) =>
                            commitDefinition((current) => ({
                              ...current,
                              theme: {
                                ...current.theme,
                                cornerStyle: event.target
                                  .value as FormDefinition['theme']['cornerStyle'],
                              },
                            }))
                          }
                        >
                          <option value="soft">ملایم</option>
                          <option value="rounded">گرد</option>
                          <option value="pill">کپسولی</option>
                        </select>
                      </label>
                      <label>
                        چیدمان
                        <select
                          value={definition.theme.layout}
                          onChange={(event) =>
                            commitDefinition((current) => ({
                              ...current,
                              theme: {
                                ...current.theme,
                                layout: event.target.value as FormDefinition['theme']['layout'],
                              },
                            }))
                          }
                        >
                          <option value="paged">مرحله‌ای</option>
                          <option value="single">یک‌صفحه‌ای</option>
                        </select>
                      </label>
                      <label className={styles.checkbox}>
                        <input
                          type="checkbox"
                          checked={definition.theme.showProgress}
                          onChange={(event) =>
                            commitDefinition((current) => ({
                              ...current,
                              theme: { ...current.theme, showProgress: event.target.checked },
                            }))
                          }
                        />
                        نمایش نوار پیشرفت
                      </label>
                    </div>
                  </fieldset>
                </section>
                <section className={styles.settingsCard} aria-labelledby="form-settings-heading">
                  <div className={styles.sectionHeading}>
                    <div>
                      <h4 id="form-settings-heading">دسترسی و زمان‌بندی</h4>
                      <p>تنظیم‌های دسترسی پیش از انتشار یا توقف قابل تغییرند.</p>
                    </div>
                  </div>
                  <fieldset
                    disabled={!capabilities?.canManage || selectedForm.status === 'archived'}
                    className={styles.settingsFields}
                  >
                    <div className={styles.twoColumns}>
                      <label>
                        دسترسی پاسخ‌گویی
                        <select
                          value={settingsDraft.accessMode}
                          onChange={(event) =>
                            setSettingsDraft({
                              ...settingsDraft,
                              accessMode: event.target.value as FormSettingsDraft['accessMode'],
                            })
                          }
                        >
                          <option value="guest">بدون ورود</option>
                          <option value="optional_auth">ورود اختیاری</option>
                          <option value="auth_required">ورود الزامی</option>
                        </select>
                      </label>
                      <label className={styles.checkbox}>
                        <input
                          type="checkbox"
                          checked={settingsDraft.linkEnabled}
                          onChange={(event) =>
                            setSettingsDraft({
                              ...settingsDraft,
                              linkEnabled: event.target.checked,
                            })
                          }
                        />
                        فعال‌بودن پیوند عمومی
                      </label>
                      <label>
                        شروع دسترسی
                        <input
                          type="datetime-local"
                          value={settingsDraft.startsAt}
                          onChange={(event) =>
                            setSettingsDraft({ ...settingsDraft, startsAt: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        پایان دسترسی
                        <input
                          type="datetime-local"
                          value={settingsDraft.endsAt}
                          onChange={(event) =>
                            setSettingsDraft({ ...settingsDraft, endsAt: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        سقف پاسخ‌ها
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={settingsDraft.responseLimit}
                          onChange={(event) =>
                            setSettingsDraft({
                              ...settingsDraft,
                              responseLimit: event.target.value,
                            })
                          }
                          placeholder="بدون سقف"
                        />
                      </label>
                    </div>
                  </fieldset>
                  {settingsDirty && (
                    <p className={styles.helper} role="status">
                      تنظیم‌های دسترسی ذخیره نشده‌اند؛ پیش از انتشار آن‌ها را ذخیره کنید.
                    </p>
                  )}
                  <Button
                    type="button"
                    tone="secondary"
                    disabled={
                      saving ||
                      !settingsDirty ||
                      !capabilities?.canManage ||
                      selectedForm.status === 'archived'
                    }
                    onClick={() => void saveSettings()}
                  >
                    ذخیره‌ی تنظیمات دسترسی
                  </Button>
                  <div className={styles.sharePanel}>
                    <div>
                      <h5>پیوند فرم</h5>
                      <p>
                        {selectedForm.status === 'published' && selectedForm.linkEnabled
                          ? 'فرم منتشر شده و پیوند عمومی فعال است.'
                          : 'برای فعال‌شدن پیوند، فرم را منتشر کنید و دسترسی عمومی را روشن بگذارید.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      tone="ghost"
                      disabled={selectedForm.status !== 'published' || !selectedForm.linkEnabled}
                      onClick={() => void copyPublicLink()}
                    >
                      کپی پیوند عمومی
                    </Button>
                  </div>
                  <label className={styles.reason}>
                    دلیل (برای بایگانی اجباری است؛ برای انتشار و توقف اختیاری)
                    <input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      maxLength={500}
                    />
                  </label>
                  <div className={styles.publishPanel}>
                    <div>
                      <h5>انتشار و وضعیت فرم</h5>
                      <p>
                        هر انتشار نسخه‌ی تغییرناپذیر می‌سازد؛ دلیل در سابقه‌ی مدیریتی ثبت می‌شود.
                      </p>
                    </div>
                    <div className={styles.inlineActions}>
                      <Button
                        type="button"
                        disabled={saving || settingsDirty || !capabilities?.canPublish}
                        onClick={requestPublish}
                      >
                        {selectedForm.currentVersion ? 'انتشار نسخه‌ی تازه' : 'انتشار فرم'}
                      </Button>
                      {selectedForm.status === 'published' && (
                        <Button
                          type="button"
                          tone="secondary"
                          disabled={saving || !capabilities?.canPublish}
                          onClick={() => void changeFormState('pause')}
                        >
                          توقف فرم
                        </Button>
                      )}
                      {selectedForm.status !== 'archived' && (
                        <Button
                          type="button"
                          tone="ghost"
                          disabled={saving || !capabilities?.canPublish || reason.trim().length < 8}
                          onClick={() => void changeFormState('archive')}
                        >
                          بایگانی
                        </Button>
                      )}
                    </div>
                  </div>
                  {selectedForm.status === 'archived' && (
                    <p className={styles.helper}>فرم بایگانی‌شده قابل ویرایش نیست.</p>
                  )}
                  {!capabilities?.canManage && (
                    <p className={styles.helper}>برای ویرایش فرم مجوز forms.manage لازم است.</p>
                  )}
                  {!capabilities?.canPublish && (
                    <p className={styles.helper}>
                      برای انتشار یا تغییر وضعیت مجوز forms.publish لازم است.
                    </p>
                  )}
                </section>
                {capabilities?.canManageTemplates && (
                  <form
                    className={styles.templateSave}
                    onSubmit={(event) => void createTemplate(event)}
                  >
                    <div>
                      <h4>ذخیره به‌عنوان قالب</h4>
                      <p>از ساختار فعلی، یک قالب برای محدوده‌ی همین شعبه بسازید.</p>
                    </div>
                    <label>
                      نام قالب
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
                        rows={2}
                        value={templateDescription}
                        onChange={(event) => setTemplateDescription(event.target.value)}
                        maxLength={500}
                      />
                    </label>
                    <Button
                      type="submit"
                      tone="ghost"
                      disabled={
                        saving || !templateName.trim() || selectedForm.status === 'archived'
                      }
                    >
                      ذخیره‌ی قالب
                    </Button>
                  </form>
                )}
              </div>
            ) : activeTab === 'preview' ? (
              <div className={styles.previewWorkspace}>
                <div className={styles.previewHeading}>
                  <div>
                    <p className={styles.eyebrow}>پیش‌نمایش تعاملی</p>
                    <h4>نمای پاسخ‌دهنده</h4>
                    <p>پاسخ‌ها فقط در همین پیش‌نمایش نگه داشته می‌شوند و ارسال نمی‌شوند.</p>
                  </div>
                  <div className={styles.inlineActions}>
                    <Button
                      type="button"
                      tone={previewViewport === 'desktop' ? 'primary' : 'ghost'}
                      aria-pressed={previewViewport === 'desktop'}
                      onClick={() => setPreviewViewport('desktop')}
                    >
                      نمای دسکتاپ
                    </Button>
                    <Button
                      type="button"
                      tone={previewViewport === 'tablet' ? 'primary' : 'ghost'}
                      aria-pressed={previewViewport === 'tablet'}
                      onClick={() => setPreviewViewport('tablet')}
                    >
                      نمای تبلت
                    </Button>
                    <Button
                      type="button"
                      tone={previewViewport === 'mobile' ? 'primary' : 'ghost'}
                      aria-pressed={previewViewport === 'mobile'}
                      onClick={() => setPreviewViewport('mobile')}
                    >
                      نمای موبایل
                    </Button>
                    <Button
                      type="button"
                      tone="ghost"
                      onClick={() => {
                        setPreviewAnswers({});
                        setPreviewCompleted(false);
                        setPreviewPageId(
                          definition.pages.find((page) => page.kind === 'start')?.id ??
                            definition.pages.find((page) => page.kind === 'questions')?.id,
                        );
                      }}
                    >
                      بازنشانی پاسخ‌ها
                    </Button>
                  </div>
                </div>
                <div
                  className={
                    styles.previewFrame +
                    (previewViewport === 'mobile'
                      ? ' ' + styles.previewMobile
                      : previewViewport === 'tablet'
                        ? ' ' + styles.previewTablet
                        : '')
                  }
                >
                  <FormRenderer
                    definition={definition}
                    answers={previewAnswers}
                    onAnswerChange={(id, value) => {
                      setPreviewAnswers((current) => ({ ...current, [id]: value }));
                      setPreviewCompleted(false);
                    }}
                    pageId={previewPageId}
                    onPageIdChange={(id) => {
                      setPreviewPageId(id);
                      setActivePageId(id);
                    }}
                    completed={previewCompleted}
                    onComplete={() => {
                      setPreviewCompleted(true);
                      const endPage = definition.pages.find((page) => page.kind === 'end');
                      if (endPage) setActivePageId(endPage.id);
                    }}
                    mode="preview"
                  />
                </div>
                <p className={styles.helper}>
                  پیش‌نمایش از همین schema و renderer اپ مشتری استفاده می‌کند. ذخیره‌سازی رسانه تا
                  انتخاب provider امن هنوز غیرفعال است.
                </p>
              </div>
            ) : (
              <ResponseManagement
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
                onMfaStepUp={(validUntil) => {
                  setShowStepUp(false);
                  onMfaStepUp(validUntil);
                  void refreshForms();
                }}
                onSessionExpired={onSessionExpired}
                onLoadResponses={(cursor) =>
                  void loadResponses(Boolean(cursor), cursor ?? undefined)
                }
                onOpenResponse={(id, sensitive) => void openResponse(id, sensitive)}
                onStatusFilter={setResponseStatusFilter}
                onDateFilter={(from, to) => {
                  setResponseFrom(from);
                  setResponseTo(to);
                }}
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
                onCorrectResponse={(version, changes, reason) =>
                  correctResponse(version, changes, reason)
                }
                onAddNote={(event) => void addNote(event)}
                onSaveTags={() => void saveTags()}
                saving={saving}
              />
            )}
          </>
        )}
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
  onCorrectResponse: (
    expectedVersion: number,
    changes: Array<{ fieldId: string; value: unknown }>,
    reason: string,
  ) => Promise<void>;
  onAddNote: (event: FormEvent<HTMLFormElement>) => void;
  onSaveTags: () => void;
  saving: boolean;
};

function ResponseManagement(props: ResponseManagementProps) {
  const {
    form,
    capabilities,
    responses,
    stats,
    loading,
    nextCursor,
    selectedResponse,
    responseStatusFilter,
    responseFrom,
    responseTo,
    searchFieldId,
    searchableFields,
    responseSearch,
    responseStatusDraft,
    responseReason,
    noteDraft,
    tagsDraft,
    includeSensitive,
    showSensitiveDetail,
    showStepUp,
    mfaStepUpUntil,
    onMfaStepUp,
    onSessionExpired,
    onLoadResponses,
    onOpenResponse,
    onStatusFilter,
    onDateFilter,
    onSearchField,
    onSearch,
    onResponseStatus,
    onResponseReason,
    onNote,
    onTags,
    onIncludeSensitive,
    onShowStepUp,
    onApplyFilters,
    onExport,
    onUpdateStatus,
    onCorrectResponse,
    onAddNote,
    onSaveTags,
    saving,
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
  }, [selectedResponse?.answers, selectedResponse?.id, selectedResponse?.correctionVersion]);

  async function saveCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedResponse ||
      !capabilities?.canCorrectResponses ||
      correctionReason.trim().length < 8
    )
      return;
    const fields = selectedResponse.definition.pages.flatMap((page) => page.fields);
    const changes = fields
      .filter((field) => !['heading', 'paragraph', 'hidden'].includes(field.type))
      .filter(
        (field) =>
          JSON.stringify(correctionComparable(answerDraft[field.id])) !==
          JSON.stringify(correctionComparable(selectedResponse.answers[field.id])),
      )
      .map((field) => ({
        fieldId: field.id,
        value: answerDraft[field.id] === undefined ? null : answerDraft[field.id],
      }));
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

  const correctionDefinition = selectedResponse
    ? buildCorrectionDefinition(
        selectedResponse.definition,
        showSensitiveDetail && capabilities?.canReadSensitiveResponses === true,
      )
    : null;
  return (
    <div className={styles.responses}>
      <div className={styles.sectionHeading}>
        <div>
          <h4>پاسخ‌ها</h4>
          <p>نمایش و خروجی پاسخ‌ها بر اساس مجوزهای همین محدوده کنترل می‌شود.</p>
        </div>
        <Badge tone="neutral">{stats?.total.toLocaleString('fa-IR') ?? '—'} پاسخ</Badge>
      </div>
      {stats && (
        <div className={styles.statusSummary}>
          {Object.entries(responseStatusLabels).map(([status, label]) => (
            <span key={status}>
              {label}: {stats.byStatus[status as ResponseStatus] ?? 0}
            </span>
          ))}
        </div>
      )}
      {!capabilities?.canReadResponses ? (
        <p className={styles.helper}>برای دیدن پاسخ‌ها مجوز forms.responses.read لازم است.</p>
      ) : (
        <>
          <div className={styles.responseFilters}>
            <label>
              وضعیت
              <select
                value={responseStatusFilter}
                onChange={(event) => onStatusFilter(event.target.value)}
              >
                <option value="">همه</option>
                {Object.entries(responseStatusLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              از تاریخ
              <input
                type="date"
                value={fromDraft}
                onChange={(event) => {
                  setFromDraft(event.target.value);
                  onDateFilter(event.target.value, toDraft);
                }}
              />
            </label>
            <label>
              تا تاریخ
              <input
                type="date"
                value={toDraft}
                onChange={(event) => {
                  setToDraft(event.target.value);
                  onDateFilter(fromDraft, event.target.value);
                }}
              />
            </label>
            <label>
              جست‌وجوی مجاز
              <select value={searchFieldId} onChange={(event) => onSearchField(event.target.value)}>
                <option value="">بدون جست‌وجو</option>
                {searchableFields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              متن جست‌وجو
              <input
                value={responseSearch}
                onChange={(event) => onSearch(event.target.value)}
                maxLength={100}
                disabled={!searchFieldId}
              />
            </label>
            <Button type="button" tone="secondary" disabled={loading} onClick={onApplyFilters}>
              اعمال فیلتر
            </Button>
            <Button
              type="button"
              tone="ghost"
              disabled={
                saving || (!capabilities.canExportResponses && !capabilities.exportStepUpRequired)
              }
              onClick={onExport}
            >
              خروجی CSV
            </Button>
          </div>
          {capabilities.canReadSensitiveResponses && (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={includeSensitive}
                onChange={(event) => onIncludeSensitive(event.target.checked)}
              />
              در خروجی، فیلدهای حساس هم باشد
            </label>
          )}
          {showStepUp && (
            <div className={styles.piiNotice}>
              <p>این فرمان به تأیید MFA تازه نیاز دارد. پس از تأیید، فرمان را دوباره اجرا کنید.</p>
              <OperationsMfaStepUpPanel
                idPrefix="forms-high-risk-command"
                mfaStepUpUntil={mfaStepUpUntil}
                onMfaStepUp={onMfaStepUp}
                onSessionExpired={onSessionExpired}
              />
            </div>
          )}
          <div className={styles.responseSplit}>
            <div className={styles.responseList} aria-busy={loading}>
              {loading && <p role="status">در حال دریافت پاسخ‌ها…</p>}
              {!loading && responses.length === 0 && <p>پاسخی با این فیلتر پیدا نشد.</p>}
              <ul>
                {responses.map((response) => (
                  <li key={response.id}>
                    <button
                      type="button"
                      className={
                        selectedResponse?.id === response.id
                          ? styles.responseActive
                          : styles.responseItem
                      }
                      onClick={() => onOpenResponse(response.id, false)}
                    >
                      <strong>{new Date(response.submittedAt).toLocaleString('fa-IR')}</strong>
                      <span>
                        <Badge
                          tone={
                            response.status === 'closed'
                              ? 'neutral'
                              : response.status === 'spam'
                                ? 'warning'
                                : 'success'
                          }
                        >
                          {responseStatusLabels[response.status]}
                        </Badge>
                        {response.hasSensitive && <small>داده‌ی حساس دارد</small>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {nextCursor && (
                <Button
                  type="button"
                  tone="ghost"
                  disabled={loading}
                  onClick={() => onLoadResponses(nextCursor)}
                >
                  پاسخ‌های بعدی
                </Button>
              )}
            </div>
            <div className={styles.responseDetail}>
              {!selectedResponse ? (
                <p>برای دیدن پاسخ، یک مورد را انتخاب کنید.</p>
              ) : (
                <>
                  <div className={styles.detailHeading}>
                    <h5>پاسخ {selectedResponse.id.slice(0, 8)}</h5>
                    <time dateTime={selectedResponse.submittedAt}>
                      {new Date(selectedResponse.submittedAt).toLocaleString('fa-IR')}
                    </time>
                  </div>
                  {selectedResponse.hasSensitive && (
                    <div className={styles.piiNotice}>
                      <p>
                        {showSensitiveDetail
                          ? 'نمایش داده‌ی حساس ثبت و ممیزی می‌شود.'
                          : 'فیلدهای حساس در این نما پنهان‌اند.'}
                      </p>
                      {capabilities.canReadSensitiveResponses ? (
                        <Button
                          type="button"
                          tone="ghost"
                          onClick={() => onOpenResponse(selectedResponse.id, !showSensitiveDetail)}
                        >
                          {showSensitiveDetail ? 'پنهان‌کردن داده‌ی حساس' : 'نمایش داده‌ی حساس'}
                        </Button>
                      ) : (
                        <span>مجوز داده‌ی حساس ندارید.</span>
                      )}
                    </div>
                  )}
                  {capabilities.canCorrectResponses && !editingCorrection && (
                    <Button
                      type="button"
                      tone="secondary"
                      disabled={saving}
                      onClick={() => {
                        setAnswerDraft(selectedResponse.answers);
                        setEditingCorrection(true);
                        setCorrectionError('');
                      }}
                    >
                      اصلاح پاسخ با ثبت سابقه
                    </Button>
                  )}
                  {capabilities.correctionStepUpRequired && !editingCorrection && (
                    <Button type="button" tone="secondary" onClick={() => onShowStepUp(true)}>
                      تأیید MFA برای اصلاح پاسخ
                    </Button>
                  )}
                  {editingCorrection && correctionDefinition ? (
                    <form
                      className={styles.correctionEditor}
                      onSubmit={(event) => void saveCorrection(event)}
                    >
                      <p className={styles.helper}>
                        فقط فیلدهای تغییرکرده ارسال می‌شوند. اصلاح با دلیل، زمان و شناسه‌ی مدیر در
                        سابقه‌ی ممیزی باقی می‌ماند.
                      </p>
                      <FormRenderer
                        definition={correctionDefinition}
                        answers={answerDraft}
                        onAnswerChange={(fieldId, value) =>
                          setAnswerDraft((current) => ({ ...current, [fieldId]: value }))
                        }
                        mode="response"
                        readOnly={false}
                      />
                      {!showSensitiveDetail && selectedResponse.hasSensitive && (
                        <p className={styles.helper}>
                          فیلدهای حساس تا زمان نمایش مجاز داده‌ی حساس وارد ویرایش نمی‌شوند.
                        </p>
                      )}
                      <label>
                        دلیل اصلاح، حداقل ۸ نویسه
                        <input
                          required
                          minLength={8}
                          maxLength={500}
                          value={correctionReason}
                          onChange={(event) => setCorrectionReason(event.target.value)}
                        />
                      </label>
                      {correctionError && (
                        <p role="alert" className={styles.error}>
                          {correctionError}
                        </p>
                      )}
                      <div className={styles.inlineActions}>
                        <Button
                          type="submit"
                          disabled={saving || correctionReason.trim().length < 8}
                        >
                          ثبت اصلاح
                        </Button>
                        <Button
                          type="button"
                          tone="ghost"
                          disabled={saving}
                          onClick={() => {
                            setEditingCorrection(false);
                            setAnswerDraft(selectedResponse.answers);
                            setCorrectionReason('');
                            setCorrectionError('');
                          }}
                        >
                          انصراف
                        </Button>
                      </div>
                    </form>
                  ) : !editingCorrection ? (
                    <dl className={styles.answerList}>
                      {selectedResponse.definition.pages
                        .flatMap((page) => page.fields)
                        .filter((field) => !['heading', 'paragraph', 'hidden'].includes(field.type))
                        .map((field) => {
                          const value = selectedResponse.answers[field.id];
                          if (value === undefined) return null;
                          return (
                            <div key={field.id}>
                              <dt>
                                {field.label}
                                {field.sensitive && <small>حساس</small>}
                              </dt>
                              <dd>{formatAnswer(field, value)}</dd>
                            </div>
                          );
                        })}
                    </dl>
                  ) : null}
                  {selectedResponse.corrections.length > 0 && (
                    <section className={styles.notes}>
                      <h6>سابقه‌ی اصلاح پاسخ</h6>
                      <ol className={styles.correctionHistory}>
                        {selectedResponse.corrections.map((correction) => {
                          const field = selectedResponse.definition.pages
                            .flatMap((page) => page.fields)
                            .find((item) => item.id === correction.fieldId);
                          return (
                            <li key={correction.id}>
                              <strong>
                                {field?.label ?? 'فیلد حذف‌شده'} · نسخهٔ{' '}
                                {correction.correctionVersion.toLocaleString('fa-IR')}
                              </strong>
                              <p>{correction.reason}</p>
                              <dl>
                                <div>
                                  <dt>پیشین</dt>
                                  <dd>
                                    {correction.redacted
                                      ? 'مقدار حساس پنهان است'
                                      : correction.previousPresent && field
                                        ? formatAnswer(field, correction.previousValue)
                                        : 'بدون مقدار'}
                                  </dd>
                                </div>
                                <div>
                                  <dt>جدید</dt>
                                  <dd>
                                    {correction.redacted
                                      ? 'مقدار حساس پنهان است'
                                      : correction.newPresent && field
                                        ? formatAnswer(field, correction.newValue)
                                        : 'بدون مقدار'}
                                  </dd>
                                </div>
                              </dl>
                              <small>
                                {new Date(correction.createdAt).toLocaleString('fa-IR')} · مدیر{' '}
                                {correction.actorUserId.slice(0, 8)}
                              </small>
                            </li>
                          );
                        })}
                      </ol>
                    </section>
                  )}
                  {capabilities.canManageResponses && (
                    <>
                      <form className={styles.responseMutation} onSubmit={onUpdateStatus}>
                        <label>
                          وضعیت
                          <select
                            value={responseStatusDraft}
                            onChange={(event) =>
                              onResponseStatus(event.target.value as ResponseStatus)
                            }
                          >
                            {Object.entries(responseStatusLabels).map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          دلیل تغییر وضعیت
                          <input
                            value={responseReason}
                            onChange={(event) => onResponseReason(event.target.value)}
                            maxLength={500}
                          />
                        </label>
                        <Button type="submit" disabled={saving}>
                          ذخیره‌ی وضعیت
                        </Button>
                      </form>
                      <div className={styles.responseMutation}>
                        <label>
                          برچسب‌ها، جداشده با ویرگول
                          <input
                            value={tagsDraft}
                            onChange={(event) => onTags(event.target.value)}
                            maxLength={500}
                          />
                        </label>
                        <Button
                          type="button"
                          tone="secondary"
                          disabled={saving}
                          onClick={onSaveTags}
                        >
                          ذخیره‌ی برچسب‌ها
                        </Button>
                      </div>
                      <form className={styles.responseMutation} onSubmit={onAddNote}>
                        <label>
                          یادداشت داخلی
                          <textarea
                            rows={3}
                            value={noteDraft}
                            onChange={(event) => onNote(event.target.value)}
                            maxLength={2000}
                          />
                        </label>
                        <Button
                          type="submit"
                          tone="secondary"
                          disabled={saving || !noteDraft.trim()}
                        >
                          افزودن یادداشت
                        </Button>
                      </form>
                    </>
                  )}
                  {selectedResponse.notes.length > 0 && (
                    <section className={styles.notes}>
                      <h6>یادداشت‌های داخلی</h6>
                      <ul>
                        {selectedResponse.notes.map((note) => (
                          <li key={note.id}>
                            <p>{note.body}</p>
                            <time dateTime={note.createdAt}>
                              {new Date(note.createdAt).toLocaleString('fa-IR')}
                            </time>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
      <p className={styles.retention}>
        پاسخ‌ها به‌صورت خودکار حذف نمی‌شوند تا سیاست مصوب نگهداری تعیین شود.
      </p>
      <small className={styles.helper}>فرم: {form.title}</small>
    </div>
  );
}

function FieldEditor({
  field,
  pageIndex,
  fieldIndex,
  definition,
  disabled,
  onUpdate,
  onMove,
  onDuplicate,
  onDelete,
}: {
  field: FormField;
  pageIndex: number;
  fieldIndex: number;
  definition: FormDefinition;
  disabled: boolean;
  onUpdate: (patch: Partial<FormField>) => void;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const previousFields = definition.pages
    .slice(0, pageIndex + 1)
    .flatMap((page, index) => page.fields.slice(0, index === pageIndex ? fieldIndex : undefined));
  const choices = field.options ?? [];
  const rows = field.rows ?? [];
  const supportsOptions = [
    'single_choice',
    'multiple_choice',
    'dropdown',
    'ranking',
    'matrix',
  ].includes(field.type);
  const labelOptions = field.type === 'matrix' ? rows : choices;
  const setOption = (index: number, label: string) => {
    if (field.type === 'matrix')
      onUpdate({
        rows: rows.map((item, current) => (current === index ? { ...item, label } : item)),
      });
    else
      onUpdate({
        options: choices.map((item, current) => (current === index ? { ...item, label } : item)),
      });
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
    <fieldset className={styles.fieldEditor} disabled={disabled}>
      <legend>
        {fieldLabels[field.type]} · {field.label}
      </legend>
      <div className={styles.fieldTopline}>
        <span className={styles.dragHandle} aria-hidden="true">
          ⠿
        </span>
        <div className={styles.inlineActions}>
          <Button
            type="button"
            tone="ghost"
            disabled={fieldIndex === 0}
            aria-label="انتقال پرسش به بالا"
            onClick={() => onMove(fieldIndex - 1)}
          >
            ↑
          </Button>
          <Button
            type="button"
            tone="ghost"
            disabled={fieldIndex >= definition.pages[pageIndex]!.fields.length - 1}
            aria-label="انتقال پرسش به پایین"
            onClick={() => onMove(fieldIndex + 1)}
          >
            ↓
          </Button>
          <Button type="button" tone="ghost" onClick={onDuplicate}>
            تکرار
          </Button>
          <Button type="button" tone="ghost" onClick={onDelete}>
            حذف پرسش
          </Button>
        </div>
      </div>
      <div className={styles.twoColumns}>
        <label>
          برچسب
          <input
            value={field.label}
            onChange={(event) => onUpdate({ label: event.target.value })}
            maxLength={160}
          />
        </label>
        <label>
          نوع
          <select
            value={field.type}
            onChange={(event) =>
              onUpdate(makeTypePatch(field, event.target.value as FormFieldType))
            }
          >
            {formFieldTypes.map((type) => (
              <option key={type} value={type}>
                {fieldLabels[type]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.twoColumns}>
        <label>
          توضیح
          <textarea
            rows={2}
            value={field.description}
            onChange={(event) => onUpdate({ description: event.target.value })}
            maxLength={1000}
          />
        </label>
        <label>
          راهنما
          <textarea
            rows={2}
            value={field.helpText}
            onChange={(event) => onUpdate({ helpText: event.target.value })}
            maxLength={500}
          />
        </label>
      </div>
      <div className={styles.twoColumns}>
        <label>
          عرض در دسکتاپ
          <select
            value={field.presentation?.width ?? 'full'}
            onChange={(event) =>
              onUpdate({
                presentation: {
                  width: event.target.value as NonNullable<FormField['presentation']>['width'],
                  alignment: field.presentation?.alignment ?? 'start',
                },
              })
            }
          >
            <option value="full">تمام‌عرض</option>
            <option value="half">نیم‌عرض</option>
          </select>
        </label>
        <label>
          تراز متن
          <select
            value={field.presentation?.alignment ?? 'start'}
            onChange={(event) =>
              onUpdate({
                presentation: {
                  width: field.presentation?.width ?? 'full',
                  alignment: event.target.value as NonNullable<
                    FormField['presentation']
                  >['alignment'],
                },
              })
            }
          >
            <option value="start">راست‌چین</option>
            <option value="center">وسط‌چین</option>
            <option value="end">چپ‌چین</option>
          </select>
        </label>
      </div>
      <div className={styles.twoColumns}>
        <label>
          متن راهنما در ورودی
          <input
            value={field.placeholder}
            onChange={(event) => onUpdate({ placeholder: event.target.value })}
            maxLength={160}
          />
        </label>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) => onUpdate({ required: event.target.checked })}
          />
          پاسخ الزامی
        </label>
      </div>
      <div className={styles.twoColumns}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={field.sensitive}
            onChange={(event) =>
              onUpdate({
                sensitive: event.target.checked,
                searchable: event.target.checked ? false : field.searchable,
              })
            }
          />
          داده‌ی حساس
        </label>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={field.searchable}
            disabled={field.sensitive || !['short_text', 'long_text'].includes(field.type)}
            onChange={(event) => onUpdate({ searchable: event.target.checked })}
          />
          قابل جست‌وجو در پاسخ‌ها
        </label>
      </div>
      {renderDefaultValueEditor(field, onUpdate)}
      {field.type === 'hidden' && (
        <label>
          پارامتر مجاز
          <select
            value={field.prefillKey ?? 'source'}
            onChange={(event) =>
              onUpdate({ prefillKey: event.target.value as 'source' | 'campaign' | 'ref' })
            }
          >
            <option value="source">source</option>
            <option value="campaign">campaign</option>
            <option value="ref">ref</option>
          </select>
        </label>
      )}
      {supportsOptions && (
        <div className={styles.optionsEditor}>
          <h5>{field.type === 'matrix' ? 'ردیف‌ها' : 'گزینه‌ها'}</h5>
          {labelOptions.map((option, index) => (
            <div key={option.id} className={styles.optionRow}>
              <label>
                {field.type === 'matrix' ? `ردیف ${index + 1}` : `گزینه ${index + 1}`}
                <input
                  value={option.label}
                  onChange={(event) => setOption(index, event.target.value)}
                  maxLength={120}
                />
              </label>
              <Button
                type="button"
                tone="ghost"
                disabled={labelOptions.length <= (field.type === 'matrix' ? 1 : 2)}
                aria-label={`حذف ${option.label}`}
                onClick={() => removeOption(index)}
              >
                حذف
              </Button>
            </div>
          ))}
          <Button type="button" tone="ghost" onClick={addOption}>
            {field.type === 'matrix' ? 'افزودن ردیف' : 'افزودن گزینه'}
          </Button>
          {field.type === 'matrix' && (
            <p className={styles.helper}>ستون‌های ماتریس از گزینه‌های بالا تعریف می‌شوند.</p>
          )}
        </div>
      )}
      {[
        'short_text',
        'long_text',
        'full_name',
        'phone',
        'email',
        'number',
        'money',
        'slider',
        'rating',
      ].includes(field.type) && (
        <div className={styles.twoColumns}>
          <label>
            حداقل
            <input
              type="number"
              value={field.validation.min ?? ''}
              onChange={(event) =>
                onUpdate({
                  validation: {
                    ...field.validation,
                    min: event.target.value === '' ? undefined : Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            حداکثر
            <input
              type="number"
              value={field.validation.max ?? (field.type === 'rating' ? 5 : '')}
              onChange={(event) =>
                onUpdate({
                  validation: {
                    ...field.validation,
                    max: event.target.value === '' ? undefined : Number(event.target.value),
                  },
                })
              }
            />
          </label>
        </div>
      )}
      {['short_text', 'long_text', 'full_name', 'phone', 'email'].includes(field.type) && (
        <div className={styles.twoColumns}>
          <label>
            کمترین طول
            <input
              type="number"
              min="0"
              max="4000"
              value={field.validation.minLength ?? ''}
              onChange={(event) =>
                onUpdate({
                  validation: {
                    ...field.validation,
                    minLength: event.target.value === '' ? undefined : Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            بیشترین طول
            <input
              type="number"
              min="1"
              max="4000"
              value={field.validation.maxLength ?? ''}
              onChange={(event) =>
                onUpdate({
                  validation: {
                    ...field.validation,
                    maxLength: event.target.value === '' ? undefined : Number(event.target.value),
                  },
                })
              }
            />
          </label>
        </div>
      )}
      <label>
        پیام خطای اعتبارسنجی
        <input
          value={field.validation.errorMessage ?? ''}
          onChange={(event) =>
            onUpdate({
              validation: { ...field.validation, errorMessage: event.target.value || undefined },
            })
          }
          maxLength={240}
        />
      </label>
      {previousFields.length > 0 && (
        <ConditionEditor
          heading="نمایش شرطی پرسش (اختیاری)"
          condition={field.condition}
          fields={previousFields}
          onChange={(condition) => onUpdate({ condition })}
        />
      )}
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
  return (
    <ConditionEditor
      heading="نمایش شرطی صفحه (اختیاری)"
      condition={condition}
      fields={previousFields}
      onChange={onChange}
    />
  );
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
        <label>
          وابسته به پرسش
          <select
            value={condition?.fieldId ?? ''}
            onChange={(event) => {
              const field = usableFields.find((item) => item.id === event.target.value);
              onChange(field ? { fieldId: field.id, operator: 'answered' } : undefined);
            }}
          >
            <option value="">بدون شرط</option>
            {usableFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        {condition && selectedField && (
          <label>
            قاعده
            <select
              value={condition.operator}
              onChange={(event) => {
                const operator = event.target.value as FormCondition['operator'];
                onChange({
                  fieldId: condition.fieldId,
                  operator,
                  ...(operator === 'answered'
                    ? {}
                    : { value: condition.value ?? initialConditionValue(selectedField) }),
                });
              }}
            >
              {operators.map((operator) => (
                <option key={operator} value={operator}>
                  {conditionOperatorLabels[operator]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {condition && selectedField && condition.operator !== 'answered' && (
        <label>
          مقدار شرط
          {conditionValueControl(selectedField, condition.value, (value) =>
            onChange({ ...condition, value }),
          )}
        </label>
      )}
    </div>
  );
}

const conditionOperatorLabels: Record<FormCondition['operator'], string> = {
  answered: 'پاسخ داده شده',
  equals: 'برابر باشد با',
  not_equals: 'برابر نباشد با',
  contains: 'شامل باشد',
  greater_than: 'بزرگ‌تر از',
  less_than: 'کوچک‌تر از',
};

function conditionOperators(field: FormField): FormCondition['operator'][] {
  if (['number', 'money', 'rating', 'nps', 'slider'].includes(field.type))
    return ['answered', 'equals', 'not_equals', 'greater_than', 'less_than'];
  if (['short_text', 'long_text', 'full_name', 'phone', 'email', 'hidden'].includes(field.type))
    return ['answered', 'equals', 'not_equals', 'contains'];
  if (field.type === 'multiple_choice' || field.type === 'ranking') return ['answered', 'contains'];
  if (
    field.type === 'single_choice' ||
    field.type === 'dropdown' ||
    field.type === 'yes_no' ||
    field.type === 'consent'
  )
    return ['answered', 'equals', 'not_equals'];
  return ['answered'];
}

function initialConditionValue(field: FormField): unknown {
  if (['number', 'money', 'rating', 'nps', 'slider'].includes(field.type)) return 0;
  if (field.type === 'yes_no' || field.type === 'consent') return true;
  return field.options?.[0]?.id ?? '';
}

function conditionValueControl(
  field: FormField,
  value: unknown,
  onChange: (value: unknown) => void,
) {
  if (['number', 'money', 'rating', 'nps', 'slider'].includes(field.type)) {
    return (
      <input
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : Number(event.target.value))
        }
      />
    );
  }
  if (field.type === 'yes_no' || field.type === 'consent') {
    return (
      <select
        value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : event.target.value === 'true')
        }
      >
        <option value="">انتخاب کنید</option>
        <option value="true">بله</option>
        <option value="false">خیر</option>
      </select>
    );
  }
  if (field.options?.length) {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">انتخاب کنید</option>
        {field.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  const inputType = field.type === 'date' || field.type === 'time' ? field.type : 'text';
  return (
    <input
      type={inputType}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      maxLength={160}
    />
  );
}

function renderDefaultValueEditor(field: FormField, onUpdate: (patch: Partial<FormField>) => void) {
  if (['number', 'money', 'rating', 'nps', 'slider'].includes(field.type)) {
    return (
      <label>
        مقدار پیش‌فرض
        <input
          type="number"
          value={typeof field.defaultValue === 'number' ? field.defaultValue : ''}
          onChange={(event) =>
            onUpdate({
              defaultValue: event.target.value === '' ? undefined : Number(event.target.value),
            })
          }
        />
      </label>
    );
  }
  if (field.type === 'yes_no' || field.type === 'consent') {
    return (
      <label>
        مقدار پیش‌فرض
        <select
          value={field.defaultValue === true ? 'true' : field.defaultValue === false ? 'false' : ''}
          onChange={(event) =>
            onUpdate({
              defaultValue: event.target.value === '' ? undefined : event.target.value === 'true',
            })
          }
        >
          <option value="">بدون مقدار</option>
          <option value="true">بله</option>
          <option value="false">خیر</option>
        </select>
      </label>
    );
  }
  if (field.type === 'single_choice' || field.type === 'dropdown') {
    return (
      <label>
        مقدار پیش‌فرض
        <select
          value={typeof field.defaultValue === 'string' ? field.defaultValue : ''}
          onChange={(event) => onUpdate({ defaultValue: event.target.value || undefined })}
        >
          <option value="">بدون مقدار</option>
          {(field.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === 'multiple_choice') {
    const selected = Array.isArray(field.defaultValue) ? field.defaultValue.map(String) : [];
    return (
      <label>
        مقادیر پیش‌فرض
        <select
          multiple
          value={selected}
          onChange={(event) =>
            onUpdate({
              defaultValue: Array.from(event.target.selectedOptions, (option) => option.value),
            })
          }
        >
          {(field.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (
    ['short_text', 'long_text', 'full_name', 'phone', 'email', 'date', 'time'].includes(field.type)
  ) {
    const inputType = field.type === 'date' || field.type === 'time' ? field.type : 'text';
    const value = typeof field.defaultValue === 'string' ? field.defaultValue : '';
    return field.type === 'long_text' ? (
      <label>
        مقدار پیش‌فرض
        <textarea
          rows={2}
          value={value}
          onChange={(event) => onUpdate({ defaultValue: event.target.value || undefined })}
          maxLength={4000}
        />
      </label>
    ) : (
      <label>
        مقدار پیش‌فرض
        <input
          type={inputType}
          value={value}
          onChange={(event) => onUpdate({ defaultValue: event.target.value || undefined })}
          maxLength={4000}
        />
      </label>
    );
  }
  return null;
}

function emptyDefinition(title: string): FormDefinition {
  return createEmptyFormDefinition(title);
}

function makeTypePatch(field: FormField, type: FormFieldType): Partial<FormField> {
  const sensitive = ['full_name', 'phone', 'email'].includes(type);
  const options = ['single_choice', 'multiple_choice', 'dropdown', 'ranking', 'matrix'].includes(
    type,
  )
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
  return {
    type,
    sensitive: sensitive || field.sensitive,
    searchable: sensitive ? false : field.searchable,
    options,
    rows,
    prefillKey: type === 'hidden' ? (field.prefillKey ?? 'source') : undefined,
    validation: type === 'rating' ? { ...field.validation, max: 5 } : field.validation,
  };
}

function addPage(definition: FormDefinition): FormDefinition {
  const endIndex = definition.pages.findIndex((page) => page.kind === 'end');
  const page = {
    id: crypto.randomUUID(),
    kind: 'questions' as const,
    title: `صفحه‌ی ${definition.pages.filter((item) => item.kind === 'questions').length + 1}`,
    description: '',
    fields: [],
  };
  const pages = [...definition.pages];
  pages.splice(endIndex >= 0 ? endIndex : pages.length, 0, page);
  return { ...definition, pages };
}

function toggleJourneyPage(
  definition: FormDefinition,
  kind: 'start' | 'end',
  enabled: boolean,
): FormDefinition {
  const exists = definition.pages.some((page) => page.kind === kind);
  if (exists === enabled) return definition;
  if (!enabled)
    return normalizeDefinition({
      ...definition,
      pages: definition.pages.filter((page) => page.kind !== kind),
    });
  if (definition.pages.length >= 20) return definition;
  const page: FormDefinition['pages'][number] = {
    id: crypto.randomUUID(),
    kind,
    title: kind === 'start' ? 'شروع فرم' : 'با سپاس از همراهی شما',
    description:
      kind === 'start'
        ? 'برای پاسخ‌گویی، دکمه‌ی شروع را انتخاب کنید.'
        : 'پاسخ شما با موفقیت ثبت شد.',
    fields: [],
  };
  return normalizeDefinition({
    ...definition,
    pages: kind === 'start' ? [page, ...definition.pages] : [...definition.pages, page],
  });
}

function updatePage(
  definition: FormDefinition,
  index: number,
  patch: Partial<FormDefinition['pages'][number]>,
): FormDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page, current) =>
      current === index ? { ...page, ...patch } : page,
    ),
  };
}

function removePage(definition: FormDefinition, index: number): FormDefinition {
  return normalizeDefinition({
    ...definition,
    pages: definition.pages.filter((_, current) => current !== index),
  });
}

function movePage(definition: FormDefinition, from: number, to: number): FormDefinition {
  if (to < 0 || to >= definition.pages.length) return definition;
  const pages = [...definition.pages];
  const [page] = pages.splice(from, 1);
  if (page) pages.splice(to, 0, page);
  return normalizeDefinition({ ...definition, pages });
}

function addField(
  definition: FormDefinition,
  pageIndex: number,
  type: FormFieldType,
): FormDefinition {
  const field = makeNewField(type);
  return {
    ...definition,
    pages: definition.pages.map((page, current) =>
      current === pageIndex ? { ...page, fields: [...page.fields, field] } : page,
    ),
  };
}

function makeNewField(type: FormFieldType): FormField {
  const sensitive = ['full_name', 'phone', 'email'].includes(type);
  const options = ['single_choice', 'multiple_choice', 'dropdown', 'ranking', 'matrix'].includes(
    type,
  )
    ? [
        { id: crypto.randomUUID(), label: 'گزینه‌ی اول' },
        { id: crypto.randomUUID(), label: 'گزینه‌ی دوم' },
      ]
    : undefined;
  const rows = type === 'matrix' ? [{ id: crypto.randomUUID(), label: 'پرسش نخست' }] : undefined;
  return {
    id: crypto.randomUUID(),
    type,
    label: fieldLabels[type],
    description: '',
    helpText: '',
    placeholder: '',
    required: false,
    sensitive,
    searchable: false,
    ...(options ? { options } : {}),
    ...(rows ? { rows } : {}),
    ...(type === 'hidden' ? { prefillKey: 'source' as const } : {}),
    validation: type === 'rating' ? { max: 5 } : {},
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
              currentField === fieldIndex ? { ...field, ...patch } : field,
            ),
          },
    ),
  };
}

function moveField(
  definition: FormDefinition,
  pageIndex: number,
  from: number,
  to: number,
): FormDefinition {
  const page = definition.pages[pageIndex];
  if (!page || to < 0 || to >= page.fields.length) return definition;
  const fields = [...page.fields];
  const [field] = fields.splice(from, 1);
  if (field) fields.splice(to, 0, field);
  return normalizeDefinition({
    ...definition,
    pages: definition.pages.map((item, index) =>
      index === pageIndex ? { ...item, fields } : item,
    ),
  });
}

function duplicateField(
  definition: FormDefinition,
  pageIndex: number,
  fieldIndex: number,
): FormDefinition {
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
  if (typeof defaultValue === 'string' && optionIds.has(defaultValue))
    defaultValue = optionIds.get(defaultValue);
  else if (Array.isArray(defaultValue))
    defaultValue = defaultValue.map((value) => optionIds.get(String(value)) ?? value);
  else if (field.type === 'matrix' && defaultValue !== null && typeof defaultValue === 'object') {
    defaultValue = Object.fromEntries(
      Object.entries(defaultValue as Record<string, unknown>).map(([rowId, value]) => [
        rowIds.get(rowId) ?? rowId,
        optionIds.get(String(value)) ?? value,
      ]),
    );
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
    pages: definition.pages.map((item, index) =>
      index === pageIndex ? { ...item, fields } : item,
    ),
  });
}

function removeField(definition: FormDefinition, fieldId: string): FormDefinition {
  return normalizeDefinition({
    ...definition,
    pages: definition.pages.map((page) => ({
      ...page,
      fields: page.fields.filter((field) => field.id !== fieldId),
    })),
  });
}

function normalizeDefinition(definition: FormDefinition): FormDefinition {
  const priorIds = new Set<string>();
  const pages = definition.pages.map((page) => {
    const condition =
      page.condition && priorIds.has(page.condition.fieldId) ? page.condition : undefined;
    const fields = page.fields.map((field) => {
      const next = {
        ...field,
        condition:
          field.condition && priorIds.has(field.condition.fieldId) ? field.condition : undefined,
      };
      priorIds.add(field.id);
      return next;
    });
    return { ...page, condition, fields };
  });
  const parsed = formDefinitionSchema.safeParse({ ...definition, pages });
  return parsed.success ? parsed.data : { ...definition, pages };
}

function formatDefinitionIssue(path: Array<string | number>, definition: FormDefinition): string {
  const pageIndex = path[0] === 'pages' && typeof path[1] === 'number' ? path[1] : -1;
  const fieldIndex = path[2] === 'fields' && typeof path[3] === 'number' ? path[3] : -1;
  const page = definition.pages[pageIndex];
  const field = page?.fields[fieldIndex];
  const property = String(path.at(-1) ?? '');
  const propertyLabels: Record<string, string> = {
    title: 'عنوان',
    label: 'برچسب پرسش',
    description: 'توضیح',
    options: 'گزینه‌ها',
    rows: 'ردیف‌های ماتریس',
    condition: 'شرط نمایش',
    sensitive: 'تنظیم داده‌ی حساس',
    prefillKey: 'پارامتر مجاز',
    max: 'مقیاس امتیاز',
    minLength: 'کمترین طول',
    maxLength: 'بیشترین طول',
    pages: 'صفحه‌ها',
    theme: 'ظاهر فرم',
  };
  const subject = field
    ? `پرسش «${field.label || 'بدون برچسب'}»`
    : page
      ? `صفحه‌ی «${page.title}»`
      : 'فرم';
  const detail =
    property === 'options'
      ? 'حداقل دو گزینه وارد کنید.'
      : property === 'rows'
        ? 'ردیف‌های ماتریس و ستون‌های آن را تکمیل کنید.'
        : property === 'condition'
          ? 'شرط نمایش باید به پرسشی قبلی اشاره کند.'
          : `${propertyLabels[property] ?? 'اطلاعات این بخش'} را بررسی کنید.`;
  return `${subject}: ${detail}`;
}

function collectPublishIssues(definition: FormDefinition): FormEditorValidationIssue[] {
  const parsed = formDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return parsed.error.issues.slice(0, 8).map((issue) => {
      const pageIndex =
        issue.path[0] === 'pages' && typeof issue.path[1] === 'number' ? issue.path[1] : -1;
      const fieldIndex =
        issue.path[2] === 'fields' && typeof issue.path[3] === 'number' ? issue.path[3] : -1;
      const page = definition.pages[pageIndex];
      return {
        message: formatDefinitionIssue(issue.path, definition),
        ...(page ? { pageId: page.id } : {}),
        ...(page?.fields[fieldIndex] ? { fieldId: page.fields[fieldIndex]!.id } : {}),
        severity: 'error' as const,
      };
    });
  }

  const questionPages = parsed.data.pages.filter((page) => page.kind === 'questions');
  const answerable = questionPages.flatMap((page) =>
    page.fields.filter((field) => !['heading', 'paragraph', 'hidden'].includes(field.type)),
  );
  if (!answerable.length) {
    return [
      {
        message: 'برای انتشار، دست‌کم یک پرسش قابل پاسخ در صفحه‌ی پرسش‌ها اضافه کنید.',
        ...(questionPages[0] ? { pageId: questionPages[0].id } : {}),
        severity: 'error',
      },
    ];
  }

  const issues: FormEditorValidationIssue[] = [];
  for (const page of questionPages) {
    if (!page.fields.some((field) => !['heading', 'paragraph', 'hidden'].includes(field.type))) {
      issues.push({
        message: `صفحه‌ی «${page.title}» پرسش قابل پاسخ ندارد.`,
        pageId: page.id,
        severity: 'warning',
      });
    }
  }
  if (!parsed.data.pages.some((page) => page.kind === 'start')) {
    issues.push({
      message: 'صفحه‌ی شروع غیرفعال است؛ فرم با نخستین پرسش آغاز خواهد شد.',
      ...(questionPages[0] ? { pageId: questionPages[0].id } : {}),
      severity: 'warning',
    });
  }
  if (!parsed.data.pages.some((page) => page.kind === 'end')) {
    const finalQuestion = questionPages.at(-1);
    issues.push({
      message: 'صفحه‌ی پایان غیرفعال است؛ پیام عمومی موفقیت پس از ثبت نمایش داده می‌شود.',
      ...(finalQuestion ? { pageId: finalQuestion.id } : {}),
      severity: 'warning',
    });
  }
  return issues;
}

function settingsFromForm(form: OperationsForm): FormSettingsDraft {
  const local = (value: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = (part: number) => String(part).padStart(2, '0');
    return (
      date.getFullYear() +
      '-' +
      pad(date.getMonth() + 1) +
      '-' +
      pad(date.getDate()) +
      'T' +
      pad(date.getHours()) +
      ':' +
      pad(date.getMinutes())
    );
  };
  return {
    accessMode: form.accessMode,
    linkEnabled: form.linkEnabled,
    startsAt: local(form.startsAt),
    endsAt: local(form.endsAt),
    responseLimit: form.responseLimit === null ? '' : String(form.responseLimit),
  };
}

function correctionComparable(value: unknown): unknown {
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
    return null;
  if (Array.isArray(value)) return value.map(correctionComparable);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, correctionComparable(item)]),
    );
  }
  return value;
}

function buildCorrectionDefinition(
  definition: FormDefinition,
  includeSensitive: boolean,
): FormDefinition {
  const fields = definition.pages.flatMap((page) => page.fields);
  const omittedIds = new Set(
    fields
      .filter((field) => field.type === 'hidden' || (field.sensitive && !includeSensitive))
      .map((field) => field.id),
  );
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
  if (Array.isArray(value))
    return value.map((item) => lookup.get(String(item)) ?? String(item)).join('، ');
  if (typeof value === 'string') return lookup.get(value) ?? value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value === undefined || value === null ? '—' : String(value);
}

function errorMessage(failure: unknown, onSessionExpired?: () => void): string {
  if (failure instanceof ApiRequestError && failure.status === 401) {
    onSessionExpired?.();
    return 'نشست شما پایان یافته است؛ دوباره وارد شوید.';
  }
  if (failure instanceof ApiRequestError && failure.status === 403)
    return failure.message || 'مجوز لازم برای این عملیات را ندارید.';
  if (failure instanceof ApiRequestError && failure.status === 409)
    return 'وضعیت فرم هم‌زمان تغییر کرده است؛ فرم را دوباره باز کنید.';
  return failure instanceof Error ? failure.message : 'عملیات فرم انجام نشد؛ دوباره تلاش کنید.';
}
