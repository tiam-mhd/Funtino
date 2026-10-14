'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { LoadingSkeleton } from '../../components/system-shell/LoadingSkeleton';
import { SystemPageHeader } from '../../components/system-shell/SystemPageHeader';
import styles from './OrganizationsManagement.module.css';

type ResourceStatus = 'active' | 'suspended' | 'archived';
type Organization = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: ResourceStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type Day = 'saturday' | 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
type OpeningHours = Record<Day, { open: string; close: string } | null>;
type Branch = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  address: string;
  city: string;
  timezone: string;
  status: ResourceStatus;
  openingHours: Partial<OpeningHours>;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type Page<T> = { items: T[]; nextCursor: string | null };
type OrganizationDraft = { name: string; slug: string; timezone: string; reason: string };
type BranchDraft = {
  name: string;
  slug: string;
  address: string;
  city: string;
  timezone: string;
  openingHours: OpeningHours;
  reason: string;
};

function withoutReason<T extends { reason: string }>(
  value: T,
): Omit<T, 'reason'> & { reason?: string } {
  const { reason, ...fields } = value;
  return { ...fields, ...(reason.trim() ? { reason: reason.trim() } : {}) };
}
type BranchPageState = {
  items: Branch[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
};
type StatusTarget =
  | { kind: 'organization'; organization: Organization; status: 'active' | 'suspended' }
  | {
      kind: 'branch';
      organizationId: string;
      branch: Branch;
      status: 'active' | 'suspended';
    };
type Feedback = { kind: 'success' | 'error'; message: string; showMfaLink?: boolean };

const days: Array<{ key: Day; label: string }> = [
  { key: 'saturday', label: 'شنبه' },
  { key: 'sunday', label: 'یکشنبه' },
  { key: 'monday', label: 'دوشنبه' },
  { key: 'tuesday', label: 'سه‌شنبه' },
  { key: 'wednesday', label: 'چهارشنبه' },
  { key: 'thursday', label: 'پنجشنبه' },
  { key: 'friday', label: 'جمعه' },
];

function emptyOpeningHours(): OpeningHours {
  return {
    saturday: null,
    sunday: null,
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
  };
}

function emptyOrganizationDraft(): OrganizationDraft {
  return { name: '', slug: '', timezone: 'Asia/Tehran', reason: '' };
}

function emptyBranchDraft(timezone = 'Asia/Tehran'): BranchDraft {
  return {
    name: '',
    slug: '',
    address: '',
    city: '',
    timezone,
    openingHours: emptyOpeningHours(),
    reason: '',
  };
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function statusLabel(status: ResourceStatus): string {
  if (status === 'active') return 'فعال';
  if (status === 'suspended') return 'تعلیق‌شده';
  return 'آرشیوشده · برگشت‌ناپذیر';
}

function statusTone(status: ResourceStatus): 'success' | 'warning' | 'neutral' {
  if (status === 'active') return 'success';
  return status === 'suspended' ? 'warning' : 'neutral';
}

function requestError(error: unknown, mayRequireStepUp = false): Feedback {
  if (error instanceof ApiRequestError) {
    if (error.status === 403) {
      return {
        kind: 'error',
        message: mayRequireStepUp
          ? 'مجوز این عملیات وجود ندارد؛ این فرمان ممکن است به تأیید دومرحله‌ای تازه نیاز داشته باشد.'
          : 'مجوز یا محدوده‌ی لازم برای این عملیات وجود ندارد.',
        ...(mayRequireStepUp ? { showMfaLink: true } : {}),
      };
    }
    if (error.status === 409) {
      return {
        kind: 'error',
        message:
          'داده هم‌زمان تغییر کرده یا شناسه‌ی یکتا تکراری است؛ فهرست را تازه کنید و فرم را دوباره باز کنید.',
      };
    }
    if (error.status === 401) {
      return { kind: 'error', message: 'نشست شما معتبر نیست؛ دوباره وارد پنل شوید.' };
    }
    return { kind: 'error', message: error.message };
  }
  return {
    kind: 'error',
    message: 'ارتباط با سرویس برقرار نشد. وضعیت داده ممکن است تازه نباشد؛ دوباره تلاش کنید.',
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'نامشخص';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function actionHeaders(idempotencyKey: string, version?: number): Record<string, string> {
  return {
    'Idempotency-Key': idempotencyKey,
    ...(version === undefined ? {} : { 'If-Match': `"${version}"` }),
  };
}

function mergeById<T extends { id: string }>(...groups: T[][]): T[] {
  const seen = new Set<string>();
  return groups.flat().filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function OrganizationsManagement() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationCursor, setOrganizationCursor] = useState<string | null>(null);
  const [organizationsLoading, setOrganizationsLoading] = useState(true);
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);
  const [branchesByOrganization, setBranchesByOrganization] = useState<
    Record<string, BranchPageState>
  >({});
  const [expandedOrganizationId, setExpandedOrganizationId] = useState<string | null>(null);
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [organizationDraft, setOrganizationDraft] =
    useState<OrganizationDraft>(emptyOrganizationDraft);
  const [organizationDraftKey, setOrganizationDraftKey] = useState(newIdempotencyKey);
  const [editingOrganizationId, setEditingOrganizationId] = useState<string | null>(null);
  const [organizationEditDraft, setOrganizationEditDraft] =
    useState<OrganizationDraft>(emptyOrganizationDraft);
  const [organizationEditKey, setOrganizationEditKey] = useState(newIdempotencyKey);
  const [organizationEditVersion, setOrganizationEditVersion] = useState<number | null>(null);
  const [creatingBranchFor, setCreatingBranchFor] = useState<string | null>(null);
  const [branchDraft, setBranchDraft] = useState<BranchDraft>(emptyBranchDraft);
  const [branchDraftKey, setBranchDraftKey] = useState(newIdempotencyKey);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [branchEditDraft, setBranchEditDraft] = useState<BranchDraft>(emptyBranchDraft);
  const [branchEditKey, setBranchEditKey] = useState(newIdempotencyKey);
  const [branchEditVersion, setBranchEditVersion] = useState<number | null>(null);
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusKey, setStatusKey] = useState(newIdempotencyKey);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const organizationsRequestInFlight = useRef(false);
  const branchRequestsInFlight = useRef(new Set<string>());

  const loadOrganizations = useCallback(async (cursor?: string, append = false) => {
    if (organizationsRequestInFlight.current) return;
    organizationsRequestInFlight.current = true;
    setOrganizationsLoading(true);
    setOrganizationsError(null);
    try {
      const query = new URLSearchParams({ pageSize: '25' });
      if (cursor) query.set('cursor', cursor);
      const page = await apiRequest<Page<Organization>>(
        `/api/v1/system/organizations?${query.toString()}`,
      );
      setOrganizations((current) => (append ? mergeById(current, page.items) : page.items));
      setOrganizationCursor(page.nextCursor);
      setOrganizationsLoaded(true);
    } catch (error) {
      const failure = requestError(error);
      setOrganizationsError(failure.message);
    } finally {
      organizationsRequestInFlight.current = false;
      setOrganizationsLoading(false);
    }
  }, []);

  const loadBranches = useCallback(
    async (organizationId: string, cursor?: string, append = false) => {
      if (branchRequestsInFlight.current.has(organizationId)) return;
      branchRequestsInFlight.current.add(organizationId);
      setBranchesByOrganization((current) => ({
        ...current,
        [organizationId]: {
          items: current[organizationId]?.items ?? [],
          nextCursor: current[organizationId]?.nextCursor ?? null,
          loading: true,
          error: null,
        },
      }));
      try {
        const query = new URLSearchParams({ pageSize: '25' });
        if (cursor) query.set('cursor', cursor);
        const page = await apiRequest<Page<Branch>>(
          `/api/v1/system/organizations/${encodeURIComponent(organizationId)}/branches?${query.toString()}`,
        );
        setBranchesByOrganization((current) => ({
          ...current,
          [organizationId]: {
            items: append
              ? mergeById(current[organizationId]?.items ?? [], page.items)
              : page.items,
            nextCursor: page.nextCursor,
            loading: false,
            error: null,
          },
        }));
      } catch (error) {
        const failure = requestError(error);
        setBranchesByOrganization((current) => ({
          ...current,
          [organizationId]: {
            items: current[organizationId]?.items ?? [],
            nextCursor: current[organizationId]?.nextCursor ?? null,
            loading: false,
            error: failure.message,
          },
        }));
      } finally {
        branchRequestsInFlight.current.delete(organizationId);
      }
    },
    [],
  );

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  function openOrganizationCreate() {
    setEditingOrganizationId(null);
    setOrganizationEditVersion(null);
    setCreatingBranchFor(null);
    setEditingBranchId(null);
    setBranchEditVersion(null);
    setStatusTarget(null);
    setOrganizationDraft(emptyOrganizationDraft());
    setOrganizationDraftKey(newIdempotencyKey());
    setCreatingOrganization(true);
    setFeedback(null);
  }

  function updateOrganizationDraft(field: keyof OrganizationDraft, value: string) {
    setOrganizationDraft((current) => ({ ...current, [field]: value }));
    setOrganizationDraftKey(newIdempotencyKey());
  }

  function beginOrganizationEdit(organization: Organization) {
    setCreatingOrganization(false);
    setCreatingBranchFor(null);
    setEditingBranchId(null);
    setBranchEditVersion(null);
    setStatusTarget(null);
    setEditingOrganizationId(organization.id);
    setOrganizationEditVersion(organization.version);
    setOrganizationEditDraft({
      name: organization.name,
      slug: organization.slug,
      timezone: organization.timezone,
      reason: '',
    });
    setOrganizationEditKey(newIdempotencyKey());
    setFeedback(null);
  }

  function updateOrganizationEdit(field: keyof OrganizationDraft, value: string) {
    setOrganizationEditDraft((current) => ({ ...current, [field]: value }));
    setOrganizationEditKey(newIdempotencyKey());
  }

  async function submitOrganizationCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyAction) return;
    setBusyAction('organization-create');
    setFeedback(null);
    try {
      const created = await apiRequest<Organization>('/api/v1/system/organizations', {
        method: 'POST',
        body: {
          ...withoutReason(organizationDraft),
          name: organizationDraft.name.trim(),
        },
        headers: actionHeaders(organizationDraftKey),
      });
      setOrganizations((current) => mergeById([created], current));
      setCreatingOrganization(false);
      setFeedback({
        kind: 'success',
        message: 'مجموعه ایجاد شد و وضعیت آن از سرویس مالک دریافت می‌شود.',
      });
    } catch (error) {
      setFeedback(requestError(error, true));
    } finally {
      setBusyAction(null);
    }
  }

  async function submitOrganizationEdit(
    event: FormEvent<HTMLFormElement>,
    organization: Organization,
  ) {
    event.preventDefault();
    if (busyAction) return;
    setBusyAction(`organization-edit:${organization.id}`);
    setFeedback(null);
    try {
      const updated = await apiRequest<Organization>(
        `/api/v1/system/organizations/${encodeURIComponent(organization.id)}`,
        {
          method: 'PATCH',
          body: {
            ...withoutReason(organizationEditDraft),
            name: organizationEditDraft.name.trim(),
          },
          headers: actionHeaders(
            organizationEditKey,
            organizationEditVersion ?? organization.version,
          ),
        },
      );
      setOrganizations((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingOrganizationId(null);
      setOrganizationEditVersion(null);
      setFeedback({ kind: 'success', message: 'اطلاعات مجموعه ذخیره شد.' });
    } catch (error) {
      setFeedback(requestError(error));
    } finally {
      setBusyAction(null);
    }
  }

  function openBranchCreate(organization: Organization) {
    setCreatingOrganization(false);
    setEditingOrganizationId(null);
    setOrganizationEditVersion(null);
    setStatusTarget(null);
    setBranchDraft(emptyBranchDraft(organization.timezone));
    setBranchDraftKey(newIdempotencyKey());
    setCreatingBranchFor(organization.id);
    setEditingBranchId(null);
    setBranchEditVersion(null);
    setFeedback(null);
  }

  function updateBranchDraft(field: Exclude<keyof BranchDraft, 'openingHours'>, value: string) {
    setBranchDraft((current) => ({ ...current, [field]: value }));
    setBranchDraftKey(newIdempotencyKey());
  }

  function updateBranchDraftHours(day: Day, value: { open: string; close: string } | null) {
    setBranchDraft((current) => ({
      ...current,
      openingHours: { ...current.openingHours, [day]: value },
    }));
    setBranchDraftKey(newIdempotencyKey());
  }

  async function submitBranchCreate(event: FormEvent<HTMLFormElement>, organization: Organization) {
    event.preventDefault();
    if (busyAction) return;
    setBusyAction(`branch-create:${organization.id}`);
    setFeedback(null);
    try {
      const created = await apiRequest<Branch>(
        `/api/v1/system/organizations/${encodeURIComponent(organization.id)}/branches`,
        {
          method: 'POST',
          body: {
            ...withoutReason(branchDraft),
            name: branchDraft.name.trim(),
            address: branchDraft.address.trim(),
            city: branchDraft.city.trim(),
          },
          headers: actionHeaders(branchDraftKey),
        },
      );
      setBranchesByOrganization((current) => {
        const existing = current[organization.id] ?? {
          items: [],
          nextCursor: null,
          loading: false,
          error: null,
        };
        return {
          ...current,
          [organization.id]: { ...existing, items: mergeById([created], existing.items) },
        };
      });
      setCreatingBranchFor(null);
      setFeedback({ kind: 'success', message: 'شعبه ایجاد شد.' });
    } catch (error) {
      setFeedback(requestError(error));
    } finally {
      setBusyAction(null);
    }
  }

  function beginBranchEdit(branch: Branch) {
    setCreatingOrganization(false);
    setEditingOrganizationId(null);
    setOrganizationEditVersion(null);
    setStatusTarget(null);
    const opening = emptyOpeningHours();
    for (const day of days) opening[day.key] = branch.openingHours[day.key] ?? null;
    setBranchEditDraft({
      name: branch.name,
      slug: branch.slug,
      address: branch.address,
      city: branch.city,
      timezone: branch.timezone,
      openingHours: opening,
      reason: '',
    });
    setBranchEditKey(newIdempotencyKey());
    setBranchEditVersion(branch.version);
    setEditingBranchId(branch.id);
    setCreatingBranchFor(null);
    setFeedback(null);
  }

  function updateBranchEdit(field: Exclude<keyof BranchDraft, 'openingHours'>, value: string) {
    setBranchEditDraft((current) => ({ ...current, [field]: value }));
    setBranchEditKey(newIdempotencyKey());
  }

  function updateBranchEditHours(day: Day, value: { open: string; close: string } | null) {
    setBranchEditDraft((current) => ({
      ...current,
      openingHours: { ...current.openingHours, [day]: value },
    }));
    setBranchEditKey(newIdempotencyKey());
  }

  async function submitBranchEdit(
    event: FormEvent<HTMLFormElement>,
    organizationId: string,
    branch: Branch,
  ) {
    event.preventDefault();
    if (busyAction) return;
    setBusyAction(`branch-edit:${branch.id}`);
    setFeedback(null);
    try {
      const updated = await apiRequest<Branch>(
        `/api/v1/system/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branch.id)}`,
        {
          method: 'PATCH',
          body: {
            ...withoutReason(branchEditDraft),
            name: branchEditDraft.name.trim(),
            address: branchEditDraft.address.trim(),
            city: branchEditDraft.city.trim(),
          },
          headers: actionHeaders(branchEditKey, branchEditVersion ?? branch.version),
        },
      );
      setBranchesByOrganization((current) => ({
        ...current,
        [organizationId]: {
          ...current[organizationId],
          items: (current[organizationId]?.items ?? []).map((item) =>
            item.id === updated.id ? updated : item,
          ),
        },
      }));
      setEditingBranchId(null);
      setBranchEditVersion(null);
      setFeedback({ kind: 'success', message: 'اطلاعات شعبه ذخیره شد.' });
    } catch (error) {
      setFeedback(requestError(error));
    } finally {
      setBusyAction(null);
    }
  }

  function openStatusConfirmation(target: StatusTarget) {
    setCreatingOrganization(false);
    setEditingOrganizationId(null);
    setOrganizationEditVersion(null);
    setEditingBranchId(null);
    setBranchEditVersion(null);
    setCreatingBranchFor(null);
    setStatusTarget(target);
    setStatusReason('');
    setStatusKey(newIdempotencyKey());
    setFeedback(null);
  }

  async function submitStatusChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusTarget || busyAction) return;
    const resourceLabel = statusTarget.kind === 'organization' ? 'مجموعه' : 'شعبه';
    const actionId =
      statusTarget.kind === 'organization'
        ? `organization-status:${statusTarget.organization.id}`
        : `branch-status:${statusTarget.branch.id}`;
    setBusyAction(actionId);
    setFeedback(null);
    try {
      if (statusTarget.kind === 'organization') {
        const { organization, status } = statusTarget;
        const updated = await apiRequest<Organization>(
          `/api/v1/system/organizations/${encodeURIComponent(organization.id)}/status`,
          {
            method: 'POST',
            body: { status, ...(statusReason.trim() ? { reason: statusReason.trim() } : {}) },
            headers: actionHeaders(statusKey, organization.version),
          },
        );
        setOrganizations((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      } else {
        const { organizationId, branch, status } = statusTarget;
        const updated = await apiRequest<Branch>(
          `/api/v1/system/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branch.id)}/status`,
          {
            method: 'POST',
            body: { status, ...(statusReason.trim() ? { reason: statusReason.trim() } : {}) },
            headers: actionHeaders(statusKey, branch.version),
          },
        );
        setBranchesByOrganization((current) => ({
          ...current,
          [organizationId]: {
            ...current[organizationId],
            items: (current[organizationId]?.items ?? []).map((item) =>
              item.id === updated.id ? updated : item,
            ),
          },
        }));
      }
      setStatusTarget(null);
      setFeedback({
        kind: 'success',
        message:
          statusTarget.status === 'suspended'
            ? `${resourceLabel} تعلیق شد.`
            : `${resourceLabel} دوباره فعال شد.`,
      });
    } catch (error) {
      setFeedback(
        requestError(error, statusTarget.kind === 'branch' && statusTarget.status === 'suspended'),
      );
    } finally {
      setBusyAction(null);
    }
  }

  function expandOrganization(organizationId: string) {
    if (expandedOrganizationId === organizationId) {
      setExpandedOrganizationId(null);
      return;
    }
    setExpandedOrganizationId(organizationId);
    if (!branchesByOrganization[organizationId]) void loadBranches(organizationId);
  }

  function reloadCurrentData() {
    void loadOrganizations();
    if (expandedOrganizationId) void loadBranches(expandedOrganizationId);
  }

  const stale = Boolean(organizationsError && organizations.length > 0);
  const activeCount = organizations.filter(
    (organization) => organization.status === 'active',
  ).length;
  const suspendedCount = organizations.filter(
    (organization) => organization.status === 'suspended',
  ).length;

  return (
    <main className={styles.app}>
      <div className={styles.page}>
        <SystemPageHeader
          eyebrow="عملیات سامانه · ساختار سازمانی"
          title="مجموعه‌ها و شعب"
          description="مجموعه را ایجاد کنید، شعبه‌هایش را مدیریت کنید و وضعیت و آخرین نسخهٔ ثبت‌شده را ببینید."
          actions={
            <>
              <Button
                type="button"
                tone="secondary"
                onClick={reloadCurrentData}
                disabled={
                  organizationsLoading ||
                  busyAction !== null ||
                  creatingOrganization ||
                  editingOrganizationId !== null ||
                  statusTarget !== null
                }
              >
                {organizationsLoading ? 'در حال دریافت…' : 'به‌روزرسانی'}
              </Button>
              <Button
                type="button"
                onClick={openOrganizationCreate}
                disabled={busyAction !== null || organizationsLoading}
              >
                ایجاد مجموعه
              </Button>
            </>
          }
        />

        <div className={styles.policyNote} role="note">
          <span aria-hidden="true">ⓘ</span>
          <p>
            همه‌ی عملیات در سرور با مجوز IAM، محدوده‌ی سازمان/شعبه، actor و نسخه‌ی رکورد کنترل و
            ممیزی می‌شوند. دلیل اختیاری است؛ «تعلیق» قابل‌بازگشت است و آرشیوکردن از این صفحه انجام
            نمی‌شود.
          </p>
        </div>

        {organizationsLoaded && (
          <div className={styles.summary} aria-label="خلاصه‌ی فهرست مجموعه‌ها">
            <div>
              <strong>{organizations.length.toLocaleString('fa-IR')}</strong>
              <span>مجموعه در فهرست فعلی</span>
            </div>
            <div>
              <strong>{activeCount.toLocaleString('fa-IR')}</strong>
              <span>فعال</span>
            </div>
            <div>
              <strong>{suspendedCount.toLocaleString('fa-IR')}</strong>
              <span>تعلیق‌شده</span>
            </div>
          </div>
        )}

        {feedback && (
          <div
            className={feedback.kind === 'success' ? styles.success : styles.error}
            role={feedback.kind === 'error' ? 'alert' : 'status'}
          >
            <span>{feedback.message}</span>
            {feedback.showMfaLink && <a href="/fa/security/mfa">بررسی یا انجام تأیید دومرحله‌ای</a>}
            {feedback.kind === 'error' &&
              (feedback.message.includes('تازه') || feedback.message.includes('تغییر کرده')) && (
                <button type="button" onClick={reloadCurrentData}>
                  تازه‌سازی داده
                </button>
              )}
          </div>
        )}

        {creatingOrganization && (
          <OrganizationEditor
            title="ایجاد مجموعه‌ی جدید"
            submitLabel="ایجاد مجموعه"
            draft={organizationDraft}
            busy={busyAction === 'organization-create' || organizationsLoading}
            idPrefix="create-organization"
            onChange={updateOrganizationDraft}
            onCancel={() => setCreatingOrganization(false)}
            onSubmit={submitOrganizationCreate}
          />
        )}

        <section
          className={styles.section}
          aria-labelledby="organizations-heading"
          aria-busy={organizationsLoading}
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>منبع: Organization &amp; Branch</p>
              <h2 id="organizations-heading">فهرست مجموعه‌ها</h2>
              {organizationsLoaded && (
                <small>{organizations.length.toLocaleString('fa-IR')} مجموعه در فهرست فعلی</small>
              )}
            </div>
          </div>

          {organizationsError && (
            <div className={styles.error} role="alert">
              <span>
                {stale
                  ? `نمایش داده‌ی آخرین دریافت؛ تازه نیست. ${organizationsError}`
                  : organizationsError}
              </span>
              <button
                type="button"
                onClick={() => void loadOrganizations()}
                disabled={organizationsLoading}
              >
                تلاش دوباره
              </button>
            </div>
          )}
          {organizationsLoading && organizations.length === 0 && (
            <LoadingSkeleton label="در حال دریافت مجموعه‌ها" rows={4} />
          )}
          {!organizationsLoading && !organizationsError && organizations.length === 0 && (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true">
                ▦
              </span>
              <h3>هنوز مجموعه‌ای ثبت نشده است</h3>
              <p>پس از ایجاد نخستین مجموعه، شعبه‌های آن را از همین صفحه مدیریت کنید.</p>
              <Button
                type="button"
                onClick={openOrganizationCreate}
                disabled={organizationsLoading}
              >
                ایجاد نخستین مجموعه
              </Button>
            </div>
          )}

          <div className={styles.organizationList}>
            {organizations.map((organization) => {
              const branchPage = branchesByOrganization[organization.id];
              const expanded = expandedOrganizationId === organization.id;
              const editing = editingOrganizationId === organization.id;
              const orgStatusPending =
                statusTarget?.kind === 'organization' &&
                statusTarget.organization.id === organization.id;
              return (
                <Surface className={styles.organizationCard} key={organization.id}>
                  <div className={styles.resourceHeader}>
                    <div className={styles.resourceTitle}>
                      <span className={styles.resourceIcon} aria-hidden="true">
                        ▦
                      </span>
                      <div>
                        <h3>{organization.name}</h3>
                        <p>
                          <bdi>{organization.slug}</bdi> <span aria-hidden="true">·</span>{' '}
                          <bdi>{organization.timezone}</bdi>
                        </p>
                      </div>
                    </div>
                    <Badge tone={statusTone(organization.status)}>
                      {statusLabel(organization.status)}
                    </Badge>
                  </div>
                  <div className={styles.metadata}>
                    <span>
                      شناسه <bdi>{organization.id}</bdi>
                    </span>
                    <span>نسخه {organization.version.toLocaleString('fa-IR')}</span>
                    <span>
                      آخرین تغییر{' '}
                      <time dateTime={organization.updatedAt}>
                        {formatDate(organization.updatedAt)}
                      </time>
                    </span>
                  </div>
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      tone="secondary"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'بستن' : 'مشاهده‌ی'} شعبه‌های ${organization.name}`}
                      onClick={() => expandOrganization(organization.id)}
                    >
                      {expanded ? 'بستن شعبه‌ها' : 'مشاهده‌ی شعبه‌ها'}
                    </Button>
                    {organization.status !== 'archived' && (
                      <>
                        <Button
                          type="button"
                          tone="ghost"
                          onClick={() =>
                            editing
                              ? setEditingOrganizationId(null)
                              : beginOrganizationEdit(organization)
                          }
                          disabled={busyAction !== null || organizationsLoading}
                        >
                          ویرایش مجموعه
                        </Button>
                        <Button
                          type="button"
                          tone={organization.status === 'active' ? 'danger' : 'secondary'}
                          onClick={() =>
                            openStatusConfirmation({
                              kind: 'organization',
                              organization,
                              status: organization.status === 'active' ? 'suspended' : 'active',
                            })
                          }
                          disabled={busyAction !== null || organizationsLoading}
                        >
                          {organization.status === 'active' ? 'تعلیق مجموعه' : 'فعال‌سازی مجدد'}
                        </Button>
                      </>
                    )}
                  </div>

                  {editing && (
                    <OrganizationEditor
                      title={`ویرایش ${organization.name}`}
                      submitLabel="ذخیره‌ی تغییرات"
                      draft={organizationEditDraft}
                      busy={
                        busyAction === `organization-edit:${organization.id}` ||
                        organizationsLoading
                      }
                      idPrefix={`edit-organization-${organization.id}`}
                      onChange={updateOrganizationEdit}
                      onCancel={() => setEditingOrganizationId(null)}
                      onSubmit={(event) => void submitOrganizationEdit(event, organization)}
                    />
                  )}
                  {orgStatusPending && statusTarget.kind === 'organization' && (
                    <StatusConfirmation
                      resourceLabel={`مجموعه‌ی «${organization.name}»`}
                      nextStatus={statusTarget.status}
                      reason={statusReason}
                      busy={busyAction === `organization-status:${organization.id}`}
                      onReasonChange={(value) => {
                        setStatusReason(value);
                        setStatusKey(newIdempotencyKey());
                      }}
                      onCancel={() => setStatusTarget(null)}
                      onSubmit={submitStatusChange}
                    />
                  )}

                  {expanded && (
                    <section
                      id={`branches-${organization.id}`}
                      className={styles.branchSection}
                      aria-label={`شعبه‌های ${organization.name}`}
                      aria-busy={branchPage?.loading ?? false}
                    >
                      <div className={styles.branchHeading}>
                        <div>
                          <h4>شعبه‌ها</h4>
                          <p>
                            {organization.status === 'suspended'
                              ? 'مجموعه تعلیق است؛ شعبه‌ها در داده‌ی مالک وضعیت مستقل خود را دارند.'
                              : 'وضعیت هر شعبه مستقیماً از سرویس مالک خوانده می‌شود.'}
                          </p>
                        </div>
                        {organization.status === 'active' && (
                          <Button
                            type="button"
                            onClick={() => openBranchCreate(organization)}
                            disabled={busyAction !== null || !branchPage || branchPage.loading}
                          >
                            ایجاد شعبه
                          </Button>
                        )}
                        {organization.status === 'suspended' && (
                          <span className={styles.mutedNotice}>
                            برای ایجاد شعبه، ابتدا مجموعه را فعال کنید.
                          </span>
                        )}
                      </div>

                      {creatingBranchFor === organization.id && (
                        <BranchEditor
                          title={`ایجاد شعبه برای ${organization.name}`}
                          submitLabel="ایجاد شعبه"
                          draft={branchDraft}
                          busy={busyAction === `branch-create:${organization.id}`}
                          idPrefix={`create-branch-${organization.id}`}
                          onChange={updateBranchDraft}
                          onHoursChange={updateBranchDraftHours}
                          onCancel={() => setCreatingBranchFor(null)}
                          onSubmit={(event) => void submitBranchCreate(event, organization)}
                        />
                      )}

                      {branchPage?.loading && branchPage.items.length === 0 && (
                        <div className={styles.loading} role="status">
                          <span className={styles.spinner} aria-hidden="true" />
                          در حال دریافت شعبه‌ها…
                        </div>
                      )}
                      {branchPage?.loading && branchPage.items.length > 0 && (
                        <p className={styles.refreshing} role="status">
                          در حال به‌روزرسانی فهرست شعبه‌ها…
                        </p>
                      )}
                      {branchPage?.error && (
                        <div className={styles.error} role="alert">
                          <span>
                            {branchPage.items.length
                              ? `فهرست شعبه‌ها تازه نیست. ${branchPage.error}`
                              : branchPage.error}
                          </span>
                          <button
                            type="button"
                            onClick={() => void loadBranches(organization.id)}
                            disabled={
                              branchPage.loading ||
                              busyAction !== null ||
                              statusTarget !== null ||
                              editingBranchId !== null
                            }
                          >
                            تلاش دوباره
                          </button>
                        </div>
                      )}
                      {branchPage &&
                        !branchPage.loading &&
                        !branchPage.error &&
                        branchPage.items.length === 0 && (
                          <p className={styles.branchEmpty}>
                            برای این مجموعه شعبه‌ای ثبت نشده است.
                          </p>
                        )}

                      <div className={styles.branchList}>
                        {branchPage?.items.map((branch) => {
                          const branchEditing = editingBranchId === branch.id;
                          const branchStatusPending =
                            statusTarget?.kind === 'branch' && statusTarget.branch.id === branch.id;
                          return (
                            <article className={styles.branchCard} key={branch.id}>
                              <div className={styles.resourceHeader}>
                                <div className={styles.resourceTitle}>
                                  <span
                                    className={`${styles.resourceIcon} ${styles.branchIcon}`}
                                    aria-hidden="true"
                                  >
                                    ⌖
                                  </span>
                                  <div>
                                    <h5>{branch.name}</h5>
                                    <p>
                                      <bdi>{branch.slug}</bdi> <span aria-hidden="true">·</span>{' '}
                                      {branch.city}
                                    </p>
                                  </div>
                                </div>
                                <Badge tone={statusTone(branch.status)}>
                                  {statusLabel(branch.status)}
                                </Badge>
                              </div>
                              <div className={styles.branchDetails}>
                                <p>{branch.address}</p>
                                <span>
                                  منطقه‌ی زمانی: <bdi>{branch.timezone}</bdi>
                                </span>
                                <span>
                                  نسخه {branch.version.toLocaleString('fa-IR')} · آخرین تغییر{' '}
                                  {formatDate(branch.updatedAt)}
                                </span>
                                <span>{openingHoursSummary(branch.openingHours)}</span>
                              </div>
                              {branch.status !== 'archived' &&
                                organization.status !== 'archived' && (
                                  <div className={styles.actions}>
                                    <Button
                                      type="button"
                                      tone="ghost"
                                      onClick={() =>
                                        branchEditing
                                          ? setEditingBranchId(null)
                                          : beginBranchEdit(branch)
                                      }
                                      disabled={busyAction !== null || branchPage?.loading}
                                    >
                                      ویرایش شعبه
                                    </Button>
                                    <Button
                                      type="button"
                                      tone={branch.status === 'active' ? 'danger' : 'secondary'}
                                      onClick={() =>
                                        openStatusConfirmation({
                                          kind: 'branch',
                                          organizationId: organization.id,
                                          branch,
                                          status:
                                            branch.status === 'active' ? 'suspended' : 'active',
                                        })
                                      }
                                      disabled={
                                        busyAction !== null ||
                                        branchPage?.loading ||
                                        (branch.status === 'suspended' &&
                                          organization.status !== 'active')
                                      }
                                    >
                                      {branch.status === 'active' ? 'تعلیق شعبه' : 'فعال‌سازی مجدد'}
                                    </Button>
                                  </div>
                                )}
                              {branch.status === 'suspended' &&
                                organization.status === 'suspended' && (
                                  <p className={styles.mutedNotice}>
                                    برای فعال‌سازی این شعبه، ابتدا مجموعه را فعال کنید.
                                  </p>
                                )}
                              {branchEditing && (
                                <BranchEditor
                                  title={`ویرایش ${branch.name}`}
                                  submitLabel="ذخیره‌ی تغییرات"
                                  draft={branchEditDraft}
                                  busy={
                                    busyAction === `branch-edit:${branch.id}` ||
                                    Boolean(branchPage?.loading)
                                  }
                                  idPrefix={`edit-branch-${branch.id}`}
                                  onChange={updateBranchEdit}
                                  onHoursChange={updateBranchEditHours}
                                  onCancel={() => setEditingBranchId(null)}
                                  onSubmit={(event) =>
                                    void submitBranchEdit(event, organization.id, branch)
                                  }
                                />
                              )}
                              {branchStatusPending && statusTarget.kind === 'branch' && (
                                <StatusConfirmation
                                  resourceLabel={`شعبه‌ی «${branch.name}»`}
                                  nextStatus={statusTarget.status}
                                  reason={statusReason}
                                  busy={busyAction === `branch-status:${branch.id}`}
                                  onReasonChange={(value) => {
                                    setStatusReason(value);
                                    setStatusKey(newIdempotencyKey());
                                  }}
                                  onCancel={() => setStatusTarget(null)}
                                  onSubmit={submitStatusChange}
                                />
                              )}
                            </article>
                          );
                        })}
                      </div>

                      {branchPage?.nextCursor && (
                        <Button
                          type="button"
                          tone="secondary"
                          disabled={
                            branchPage.loading ||
                            busyAction !== null ||
                            creatingBranchFor !== null ||
                            editingBranchId !== null ||
                            statusTarget !== null
                          }
                          onClick={() =>
                            void loadBranches(
                              organization.id,
                              branchPage.nextCursor ?? undefined,
                              true,
                            )
                          }
                        >
                          {branchPage.loading ? 'در حال دریافت…' : 'دریافت شعبه‌های بیشتر'}
                        </Button>
                      )}
                    </section>
                  )}
                </Surface>
              );
            })}
          </div>
          {organizationCursor && !organizationsLoading && (
            <div className={styles.loadMore}>
              <Button
                type="button"
                tone="secondary"
                disabled={busyAction !== null}
                onClick={() => void loadOrganizations(organizationCursor, true)}
              >
                دریافت مجموعه‌های بیشتر
              </Button>
            </div>
          )}
        </section>

        <p className={styles.footerNote}>
          شناسه‌ی نسخه برای جلوگیری از بازنویسی تغییر هم‌زمان استفاده می‌شود. رخدادهای ایجاد، ویرایش
          و تغییر وضعیت در سرویس مالک همراه با actor و audit ثبت می‌شوند؛ دلیل در صورت ورود ثبت
          می‌شود.
        </p>
      </div>
    </main>
  );
}

function OrganizationEditor({
  title,
  submitLabel,
  draft,
  busy,
  idPrefix,
  onChange,
  onCancel,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  draft: OrganizationDraft;
  busy: boolean;
  idPrefix: string;
  onChange: (field: keyof OrganizationDraft, value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className={styles.editor} onSubmit={onSubmit}>
      <h3>{title}</h3>
      <div className={styles.formGrid}>
        <label htmlFor={`${idPrefix}-name`}>
          نام مجموعه
          <input
            id={`${idPrefix}-name`}
            autoFocus
            value={draft.name}
            onChange={(event) => onChange('name', event.target.value)}
            minLength={2}
            maxLength={160}
            required
          />
        </label>
        <label htmlFor={`${idPrefix}-slug`}>
          شناسه‌ی نشانی (slug)
          <input
            id={`${idPrefix}-slug`}
            dir="ltr"
            autoCapitalize="none"
            autoCorrect="off"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={draft.slug}
            onChange={(event) => onChange('slug', event.target.value)}
            minLength={2}
            maxLength={80}
            required
          />
          <small>فقط حروف کوچک انگلیسی، عدد و خط تیره.</small>
        </label>
        <label htmlFor={`${idPrefix}-timezone`}>
          منطقه‌ی زمانی
          <input
            id={`${idPrefix}-timezone`}
            dir="ltr"
            list={`${idPrefix}-timezones`}
            value={draft.timezone}
            onChange={(event) => onChange('timezone', event.target.value)}
            maxLength={64}
            required
          />
          <datalist id={`${idPrefix}-timezones`}>
            <option value="Asia/Tehran" />
            <option value="UTC" />
          </datalist>
          <small>شناسه‌ی معتبر IANA؛ نمونه: Asia/Tehran</small>
        </label>
        <label className={styles.fullField} htmlFor={`${idPrefix}-reason`}>
          دلیل تغییر برای ممیزی (اختیاری)
          <textarea
            id={`${idPrefix}-reason`}
            value={draft.reason}
            onChange={(event) => onChange('reason', event.target.value)}
            maxLength={500}
            rows={2}
          />
        </label>
      </div>
      <div className={styles.formActions}>
        <Button type="submit" disabled={busy}>
          {busy ? 'در حال ذخیره…' : submitLabel}
        </Button>
        <Button type="button" tone="ghost" onClick={onCancel} disabled={busy}>
          انصراف
        </Button>
      </div>
    </form>
  );
}

function BranchEditor({
  title,
  submitLabel,
  draft,
  busy,
  idPrefix,
  onChange,
  onHoursChange,
  onCancel,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  draft: BranchDraft;
  busy: boolean;
  idPrefix: string;
  onChange: (field: Exclude<keyof BranchDraft, 'openingHours'>, value: string) => void;
  onHoursChange: (day: Day, value: { open: string; close: string } | null) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className={styles.editor} onSubmit={onSubmit}>
      <h3>{title}</h3>
      <div className={styles.formGrid}>
        <label htmlFor={`${idPrefix}-name`}>
          نام شعبه
          <input
            id={`${idPrefix}-name`}
            autoFocus
            value={draft.name}
            onChange={(event) => onChange('name', event.target.value)}
            minLength={2}
            maxLength={160}
            required
          />
        </label>
        <label htmlFor={`${idPrefix}-slug`}>
          شناسه‌ی نشانی (slug)
          <input
            id={`${idPrefix}-slug`}
            dir="ltr"
            autoCapitalize="none"
            autoCorrect="off"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={draft.slug}
            onChange={(event) => onChange('slug', event.target.value)}
            minLength={2}
            maxLength={80}
            required
          />
        </label>
        <label htmlFor={`${idPrefix}-city`}>
          شهر
          <input
            id={`${idPrefix}-city`}
            value={draft.city}
            onChange={(event) => onChange('city', event.target.value)}
            minLength={2}
            maxLength={120}
            required
          />
        </label>
        <label htmlFor={`${idPrefix}-timezone`}>
          منطقه‌ی زمانی
          <input
            id={`${idPrefix}-timezone`}
            dir="ltr"
            list={`${idPrefix}-timezones`}
            value={draft.timezone}
            onChange={(event) => onChange('timezone', event.target.value)}
            maxLength={64}
            required
          />
          <datalist id={`${idPrefix}-timezones`}>
            <option value="Asia/Tehran" />
            <option value="UTC" />
          </datalist>
        </label>
        <label className={styles.fullField} htmlFor={`${idPrefix}-address`}>
          نشانی کامل
          <textarea
            id={`${idPrefix}-address`}
            value={draft.address}
            onChange={(event) => onChange('address', event.target.value)}
            minLength={3}
            maxLength={500}
            rows={2}
            required
          />
        </label>
        <fieldset className={`${styles.hours} ${styles.fullField}`}>
          <legend>ساعت کاری هفتگی</legend>
          <p>روزهای بسته را خاموش بگذارید. ساعت‌ها بر اساس منطقه‌ی زمانی همین شعبه ثبت می‌شوند.</p>
          <div className={styles.hoursGrid}>
            {days.map((day) => {
              const hours = draft.openingHours[day.key];
              return (
                <div className={styles.dayRow} key={day.key}>
                  <label className={styles.dayToggle} htmlFor={`${idPrefix}-${day.key}-open`}>
                    <input
                      id={`${idPrefix}-${day.key}-open`}
                      type="checkbox"
                      checked={hours !== null}
                      onChange={(event) =>
                        onHoursChange(
                          day.key,
                          event.target.checked ? { open: '', close: '' } : null,
                        )
                      }
                    />
                    <span>{day.label}</span>
                  </label>
                  <label className={styles.timeField} htmlFor={`${idPrefix}-${day.key}-from`}>
                    از
                    <input
                      id={`${idPrefix}-${day.key}-from`}
                      type="time"
                      value={hours?.open ?? ''}
                      disabled={!hours}
                      required={Boolean(hours)}
                      onChange={(event) =>
                        onHoursChange(day.key, {
                          open: event.target.value,
                          close: hours?.close ?? '',
                        })
                      }
                    />
                  </label>
                  <label className={styles.timeField} htmlFor={`${idPrefix}-${day.key}-to`}>
                    تا
                    <input
                      id={`${idPrefix}-${day.key}-to`}
                      type="time"
                      value={hours?.close ?? ''}
                      disabled={!hours}
                      required={Boolean(hours)}
                      onChange={(event) =>
                        onHoursChange(day.key, {
                          open: hours?.open ?? '',
                          close: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>
        <label className={styles.fullField} htmlFor={`${idPrefix}-reason`}>
          دلیل تغییر برای ممیزی (اختیاری)
          <textarea
            id={`${idPrefix}-reason`}
            value={draft.reason}
            onChange={(event) => onChange('reason', event.target.value)}
            maxLength={500}
            rows={2}
          />
        </label>
      </div>
      <div className={styles.formActions}>
        <Button type="submit" disabled={busy}>
          {busy ? 'در حال ذخیره…' : submitLabel}
        </Button>
        <Button type="button" tone="ghost" onClick={onCancel} disabled={busy}>
          انصراف
        </Button>
      </div>
    </form>
  );
}

function StatusConfirmation({
  resourceLabel,
  nextStatus,
  reason,
  busy,
  onReasonChange,
  onCancel,
  onSubmit,
}: {
  resourceLabel: string;
  nextStatus: 'active' | 'suspended';
  reason: string;
  busy: boolean;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const suspending = nextStatus === 'suspended';
  return (
    <form className={styles.confirmation} onSubmit={onSubmit}>
      <strong>{suspending ? 'تأیید تعلیق' : 'تأیید فعال‌سازی مجدد'}</strong>
      <p>
        {suspending
          ? `${resourceLabel} از حالت فعال خارج می‌شود؛ سابقه و اطلاعات آن حذف نمی‌شود.`
          : `${resourceLabel} دوباره فعال می‌شود.`}
      </p>
      <label htmlFor="status-change-reason">
        دلیل این اقدام (اختیاری)
        <textarea
          id="status-change-reason"
          autoFocus
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          maxLength={500}
          rows={2}
        />
      </label>
      <div className={styles.formActions}>
        <Button type="submit" tone={suspending ? 'danger' : 'primary'} disabled={busy}>
          {busy ? 'در حال ثبت…' : suspending ? 'تأیید تعلیق' : 'تأیید فعال‌سازی'}
        </Button>
        <Button type="button" tone="ghost" onClick={onCancel} disabled={busy}>
          انصراف
        </Button>
      </div>
    </form>
  );
}

function openingHoursSummary(openingHours: Partial<OpeningHours>): string {
  const openDays = days.flatMap(({ key, label }) => {
    const hours = openingHours[key];
    return hours ? [`${label} ${hours.open} تا ${hours.close}`] : [];
  });
  return openDays.length
    ? `ساعت کاری: ${openDays.join('، ')}`
    : 'ساعت کاری ثبت نشده یا همه‌ی روزها تعطیل هستند.';
}
