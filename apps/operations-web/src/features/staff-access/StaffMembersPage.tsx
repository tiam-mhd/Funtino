'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Badge, Button, Surface } from '@funtino/design-system';
import { OperationsMfaStepUpPanel } from '../../components/forms/OperationsMfaStepUpPanel';
import { OperationsManagementList } from '../../components/workspace-shell/OperationsManagementList';
import { ApiRequestError } from '../../lib/api/client';
import {
  changeOperationsStaffRole,
  changeOperationsStaffStatus,
  freshIdempotencyKey,
  inviteOperationsStaff,
  listOperationsRoles,
  listOperationsStaff,
  revokeScopedStaffInvitation,
  type OperationsAccessRole,
  type OperationsPage,
  type OperationsStaffMember,
  type OperationsStaffFilters,
} from '../../lib/api/operations-staff';
import {
  normalizePhone,
  type OperationsScope,
  type OperationsScopeOption,
} from '../../lib/auth/operations-access';
import { useOperationsWorkspace } from '../branch-scope/OperationsWorkspaceContext';
import {
  groupOperationsStaff,
  isStaffRoleAssignable,
  operationsStaffMemberName,
  operationsStaffScopeLabel,
  operationsStaffStatusLabel,
  operationsStaffStatusTone,
} from './staff-member-display';
import styles from './StaffMembersPage.module.css';

type MemberFilter = {
  status: OperationsStaffMember['status'] | '';
  roleId: string;
  branchFilterId: string;
};

type Editor = { kind: 'invite' } | { kind: 'edit'; member: OperationsStaffMember };
type MemberAction = {
  member: OperationsStaffMember;
  action: 'revoke' | 'suspend' | 'reactivate';
};
type MfaJob = { label: string; run: () => Promise<void> };

const emptyFilter: MemberFilter = { status: '', roleId: '', branchFilterId: '' };

export function StaffMembersPage() {
  const {
    activeScope,
    scopeOptions,
    mfaStepUpUntil,
    onMfaStepUp,
    onSessionExpired,
  } = useOperationsWorkspace();
  const scope = activeScope.scope;
  const scopeKey = scopeValue(scope);
  const scopeView = scope.type === 'organization' ? 'organizationTree' : 'exact';
  const [members, setMembers] = useState<OperationsStaffMember[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<MemberFilter>(emptyFilter);
  const [filterDraft, setFilterDraft] = useState<MemberFilter>(emptyFilter);
  const [roles, setRoles] = useState<OperationsAccessRole[]>([]);
  const [rolesError, setRolesError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editRoleId, setEditRoleId] = useState('');
  const [editReason, setEditReason] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteReason, setInviteReason] = useState('');
  const [inviteScopeKey, setInviteScopeKey] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [action, setAction] = useState<MemberAction | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaJob, setMfaJob] = useState<MfaJob | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [loadedContext, setLoadedContext] = useState('');
  const requestSequence = useRef(0);
  const activeRequest = useRef('');
  const previousFilterScopeKey = useRef(scopeKey);
  const mfaJobRef = useRef<MfaJob | null>(null);
  const editorDialogRef = useRef<HTMLDialogElement>(null);
  const actionDialogRef = useRef<HTMLDialogElement>(null);
  const mfaDialogRef = useRef<HTMLDialogElement>(null);
  const branchOptions = useMemo(
    () =>
      scope.type === 'organization'
        ? scopeOptions.filter(
            (option) =>
              option.scope.type === 'branch' &&
              sameId(option.scope.organizationId, scope.organizationId),
          )
        : [],
    [scope, scopeOptions],
  );
  const inviteScopeOptions = useMemo(() => getInviteScopeOptions(scope, activeScope, scopeOptions), [
    activeScope,
    scope,
    scopeOptions,
  ]);
  const inviteScope = useMemo(
    () =>
      inviteScopeOptions.find((option) => scopeValue(option.scope) === inviteScopeKey)?.scope ??
      scope,
    [inviteScopeKey, inviteScopeOptions, scope],
  );
  const inviteRoles = useMemo(
    () => roles.filter((role) => isStaffRoleAssignable(role, inviteScope)),
    [inviteScope, roles],
  );
  const filterRoles = useMemo(
    () =>
      roles.filter((role) => {
        if (!sameId(role.scope.organizationId, scope.organizationId)) return false;
        if (scope.type === 'organization') {
          return role.scope.type === 'organization' || role.scope.type === 'branch';
        }
        return role.scope.type === 'branch' && sameId(role.scope.branchId, scope.branchId);
      }),
    [roles, scope],
  );
  const editRoles = useMemo(
    () => {
      if (editor?.kind !== 'edit') return [];
      const assignable = roles.filter((role) => isStaffRoleAssignable(role, editor.member.scope));
      return assignable.some((role) => role.id === editor.member.role.id)
        ? assignable
        : [editor.member.role, ...assignable];
    },
    [editor, roles],
  );
  const filterCount = Number(Boolean(filters.status)) + Number(Boolean(filters.roleId)) + Number(Boolean(filters.branchFilterId));

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (previousFilterScopeKey.current === scopeKey) return;
    previousFilterScopeKey.current = scopeKey;
    setFilters((current) => ({ ...current, roleId: '', branchFilterId: '' }));
    setFilterDraft((current) => ({ ...current, roleId: '', branchFilterId: '' }));
  }, [scopeKey]);

  useEffect(() => setFilterDraft(filters), [filters]);

  const loadFirstPage = useCallback(async () => {
    const requestKey = JSON.stringify([scope, filters, search]);
    const sequence = ++requestSequence.current;
    activeRequest.current = requestKey;
    setLoading(true);
    setLoadError('');
    setForbidden(false);
    setMembers([]);
    setCursor(null);
    setLoadedContext('');
    try {
      const page = await requestStaffPage(scope, filters, search, scopeView);
      if (activeRequest.current !== requestKey || requestSequence.current !== sequence) return;
      setMembers(page.data);
      setCursor(page.nextCursor);
      setLoadedContext(requestKey);
    } catch (failure) {
      if (activeRequest.current !== requestKey || requestSequence.current !== sequence) return;
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      setForbidden(failure instanceof ApiRequestError && failure.status === 403);
      setLoadError(errorMessage(failure));
    } finally {
      if (activeRequest.current === requestKey && requestSequence.current === sequence) {
        setLoading(false);
      }
    }
  }, [filters, onSessionExpired, scope, scopeView, search]);

  useEffect(() => {
    void loadFirstPage();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadFirstPage]);

  useEffect(() => {
    let cancelled = false;
    async function loadRoles() {
      setRolesError('');
      try {
        const result: OperationsAccessRole[] = [];
        let next: string | undefined;
        let pageCount = 0;
        do {
          const page = await listOperationsRoles(scope, next, {
            lifecycle: 'active',
            kind: 'custom',
            ...(scope.type === 'organization' ? { roleScopeView: 'organizationTree' as const } : {}),
          });
          result.push(...page.data);
          next = page.nextCursor ?? undefined;
          pageCount += 1;
        } while (next && pageCount < 20);
        if (!cancelled) setRoles(result);
      } catch (failure) {
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        if (!cancelled) setRolesError(errorMessage(failure));
      }
    }
    void loadRoles();
    return () => {
      cancelled = true;
    };
  }, [onSessionExpired, scope]);

  useEffect(() => syncDialog(editorDialogRef, Boolean(editor)), [editor]);
  useEffect(() => syncDialog(actionDialogRef, Boolean(action)), [action]);
  useEffect(() => syncDialog(mfaDialogRef, mfaOpen), [mfaOpen]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const requestKey = JSON.stringify([scope, filters, search]);
    setLoadingMore(true);
    setLoadError('');
    try {
      const page = await requestStaffPage(scope, filters, search, scopeView, cursor);
      if (activeRequest.current !== requestKey) return;
      setMembers((current) => mergeMembers(current, page.data));
      setCursor(page.nextCursor);
    } catch (failure) {
      if (activeRequest.current !== requestKey) return;
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      setForbidden(failure instanceof ApiRequestError && failure.status === 403);
      setLoadError(errorMessage(failure));
    } finally {
      if (activeRequest.current === requestKey) setLoadingMore(false);
    }
  }, [cursor, filters, loadingMore, onSessionExpired, scope, scopeView, search]);

  function openInvite() {
    setMutationError('');
    setInvitePhone('');
    setInviteReason('');
    const initialScope = scopeValue(scope);
    setInviteScopeKey(initialScope);
    setInviteRoleId('');
    setEditor({ kind: 'invite' });
  }

  function openEdit(member: OperationsStaffMember) {
    setMutationError('');
    setEditRoleId(member.role.id);
    setEditReason('');
    setEditor({ kind: 'edit', member });
  }

  function openMemberAction(member: OperationsStaffMember, nextAction: MemberAction['action']) {
    setMutationError('');
    setActionReason('');
    setAction({ member, action: nextAction });
  }

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMutationError('');
    if (busy) return;
    if (editor?.kind === 'invite') {
      const phoneE164 = normalizePhone(invitePhone);
      if (!/^\+[1-9]\d{7,14}$/.test(phoneE164) || !inviteRoleId) {
        setMutationError('شماره‌ی E.164 معتبر و نقش فعال انتخاب کنید.');
        return;
      }
      setBusy(true);
      try {
        await inviteOperationsStaff(
          {
            phoneE164,
            scope: inviteScope,
            roleId: inviteRoleId,
            ...(inviteReason.trim() ? { reason: inviteReason.trim() } : {}),
          },
          freshIdempotencyKey(),
        );
        setEditor(null);
        setNotice('دعوت ثبت شد؛ عضویت فقط پس از پذیرش با شماره‌ی تأییدشده فعال می‌شود.');
        await loadFirstPage();
      } catch (failure) {
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        setMutationError(errorMessage(failure));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (editor?.kind !== 'edit') return;
    const member = editor.member;
    if (editRoleId === member.role.id) {
      setEditor(null);
      return;
    }
    if (editReason.trim().length < 8) {
      setMutationError('برای تغییر نقش، دلیل دست‌کم ۸ نویسه‌ای وارد کنید.');
      return;
    }
    const reason = editReason.trim();
    const job = async () => {
      setBusy(true);
      try {
        await changeOperationsStaffRole(member, editRoleId, reason, freshIdempotencyKey());
        setEditor(null);
        setNotice('نقش عضو به‌روزرسانی شد.');
        await loadFirstPage();
      } catch (failure) {
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        setMutationError(errorMessage(failure));
        throw failure;
      } finally {
        setBusy(false);
      }
    };
    runWithStepUp('تأیید MFA برای تغییر نقش عضو', job);
  }

  async function confirmMemberAction() {
    if (!action || busy) return;
    setMutationError('');
    const { member, action: kind } = action;
    const reason = actionReason.trim();
    if (kind === 'revoke' && member.status !== 'pending' && reason.length < 8) {
      setMutationError('برای لغو عضویت فعال، دلیل دست‌کم ۸ نویسه‌ای لازم است.');
      return;
    }
    const job = async () => {
      setBusy(true);
      try {
        if (kind === 'revoke' && member.status === 'pending') {
          if (!member.invitation?.id) {
            throw new Error('برای این عضویت دعوت فعالی پیدا نشد و امکان لغو امن آن وجود ندارد.');
          }
          await revokeScopedStaffInvitation(
            member.invitation.id,
            reason || undefined,
            freshIdempotencyKey(),
          );
        } else {
          await changeOperationsStaffStatus(
            member.membershipId,
            kind,
            reason || undefined,
            freshIdempotencyKey(),
          );
        }
        setAction(null);
        setNotice(
          kind === 'revoke'
            ? member.status === 'pending'
              ? 'دعوت عضو لغو شد.'
              : 'عضویت لغو شد.'
            : kind === 'suspend'
              ? 'عضویت عضو معلق شد.'
              : 'عضویت عضو دوباره فعال شد.',
        );
        await loadFirstPage();
      } catch (failure) {
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        setMutationError(errorMessage(failure));
        throw failure;
      } finally {
        setBusy(false);
      }
    };
    if (kind === 'revoke' && member.status !== 'pending') {
      runWithStepUp('تأیید MFA برای لغو عضویت', job);
    } else {
      void job().catch(() => undefined);
    }
  }

  function runWithStepUp(label: string, run: () => Promise<void>) {
    if (mfaStepUpUntil && mfaStepUpUntil > Date.now()) {
      void run().catch(() => undefined);
      return;
    }
    const job = { label, run };
    mfaJobRef.current = job;
    setMfaJob(job);
    setMfaOpen(true);
  }

  async function completeMfaAction() {
    const job = mfaJobRef.current;
    if (!job || mfaBusy) return;
    mfaJobRef.current = null;
    setMfaBusy(true);
    try {
      await job.run();
      setMfaOpen(false);
      setMfaJob(null);
    } catch {
      // The action dialog keeps its error visible so the person can correct or retry.
    } finally {
      setMfaBusy(false);
    }
  }

  function applyFilters() {
    setFilters(filterDraft);
    setNotice('');
  }

  function clearFilters() {
    setFilters(emptyFilter);
    setFilterDraft(emptyFilter);
  }

  const groups = groupOperationsStaff(members, scope, scopeOptions);
  const currentRequestKey = JSON.stringify([scope, filters, search]);
  const loaded = loadedContext === currentRequestKey;

  return (
    <>
      <OperationsManagementList
        appliedFilterCount={filterCount}
        description=""
        filterDescription="وضعیت، نقش و در محدوده‌ی مجموعه شعبه را برای محدودکردن فهرست انتخاب کنید."
        filterFields={
          <>
            <label className={styles.field}>
              وضعیت عضویت
              <select
                onChange={(event) => setFilterDraft((current) => ({ ...current, status: event.currentTarget.value as MemberFilter['status'] }))}
                value={filterDraft.status}
              >
                <option value="">همه‌ی وضعیت‌ها</option>
                <option value="pending">در انتظار پذیرش</option>
                <option value="active">فعال</option>
                <option value="suspended">معلق</option>
                <option value="revoked">لغوشده</option>
              </select>
            </label>
            <label className={styles.field}>
              نقش
              <select
                onChange={(event) => setFilterDraft((current) => ({ ...current, roleId: event.currentTarget.value }))}
                value={filterDraft.roleId}
              >
                <option value="">همه‌ی نقش‌ها</option>
                {filterRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name.trim() || 'نقش بدون نام نمایشی'} · {operationsStaffScopeLabel(role.scope, scopeOptions)}
                  </option>
                ))}
              </select>
              {rolesError && <span className={styles.fieldHint}>فهرست نقش‌ها در دسترس نیست.</span>}
            </label>
            {scope.type === 'organization' && (
              <label className={styles.field}>
                شعبه
                <select
                  onChange={(event) => setFilterDraft((current) => ({ ...current, branchFilterId: event.currentTarget.value }))}
                  value={filterDraft.branchFilterId}
                >
                  <option value="">همه‌ی شعب</option>
                  {branchOptions.map((option) => (
                    <option key={scopeValue(option.scope)} value={option.scope.type === 'branch' ? option.scope.branchId : ''}>
                      {option.branch?.name.trim() || 'شعبه بدون نام نمایشی'}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        }
        filtersBusy={loading}
        loadMoreLabel={search ? 'ادامه‌ی جست‌وجو' : 'نمایش اعضای بیشتر'}
        onApplyFilters={applyFilters}
        onClearFilters={clearFilters}
        onSearchChange={setSearchInput}
        pagination={{ hasMore: Boolean(cursor), busy: loadingMore, onLoadMore: () => void loadMore() }}
        searchLabel="جست‌وجوی نام، نام خانوادگی، نقش یا شماره‌ی پوشیده"
        searchPlaceholder="نام، نقش یا شماره را جست‌وجو کنید"
        searchValue={searchInput}
        showHeading={false}
        title="اعضا"
        toolbarActions={
          <Button className={styles.addMemberButton} onClick={openInvite} type="button">
            <Icon kind="add" />
            افزودن عضو
          </Button>
        }
        toolbarLabel="جست‌وجو و فیلتر اعضا"
        filterTitle="فیلتر اعضا"
      >
        <div className={styles.results}>
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
          {(loading || !loaded) && (
            <Surface className={styles.state} role="status" aria-live="polite">
              در حال دریافت اعضای محدوده…
            </Surface>
          )}
          {!loading && loadError && (
            <Surface className={styles.state}>
              <p className={styles.error} role="alert">
                {forbidden ? 'مجوز staff.read برای مشاهده‌ی اعضای این محدوده لازم است.' : loadError}
              </p>
              <Button onClick={() => void loadFirstPage()} type="button" tone="ghost">
                تلاش دوباره
              </Button>
            </Surface>
          )}
          {!loading && !loadError && loaded && members.length === 0 && (
            <Surface className={styles.state}>
              <span className={styles.emptyIcon} aria-hidden="true">
                <Icon kind="staff" />
              </span>
              <h2>{search || filterCount ? 'عضوی با این مشخصات پیدا نشد' : 'هنوز عضوی ثبت نشده است'}</h2>
              <p>
                {search || filterCount
                  ? 'عبارت جست‌وجو یا فیلترها را تغییر دهید.'
                  : 'با افزودن عضو، دعوت برای شماره‌ی ثبت‌شده ارسال می‌شود.'}
              </p>
              {(search || filterCount > 0) && (
                <Button onClick={() => { setSearchInput(''); setSearch(''); clearFilters(); }} type="button" tone="ghost">
                  پاک‌کردن جست‌وجو و فیلترها
                </Button>
              )}
            </Surface>
          )}
          {!loading && loaded && !loadError && members.length > 0 && (
            <div className={styles.groups}>
              {groups.map((group) => (
                <section className={styles.group} key={group.key} aria-label={group.heading ?? 'اعضای شعبه'}>
                  {group.heading && <h2 className={styles.groupHeading}>{group.heading}</h2>}
                  <div className={styles.memberList}>
                    {group.members.map((member) => (
                      <MemberRow
                        key={member.membershipId}
                        member={member}
                        onEdit={() => openEdit(member)}
                        onAction={(nextAction) => openMemberAction(member, nextAction)}
                        scopeOptions={scopeOptions}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {cursor && loadingMore && <p className={styles.loadingMore} role="status">در حال دریافت ادامه‌ی فهرست…</p>}
        </div>
      </OperationsManagementList>

      <dialog
        aria-labelledby="staff-member-editor-title"
        className={styles.dialog}
        onCancel={(event) => { event.preventDefault(); setEditor(null); }}
        onClose={() => setEditor(null)}
        ref={editorDialogRef}
      >
        <div className={styles.dialogBody}>
          <header className={styles.dialogHeader}>
            <div>
              <p className={styles.eyebrow}>{editor?.kind === 'edit' ? 'ویرایش دسترسی' : 'عضویت تازه'}</p>
              <h2 id="staff-member-editor-title">{editor?.kind === 'edit' ? 'ویرایش نقش عضو' : 'افزودن عضو'}</h2>
              <p>{editor?.kind === 'edit' ? 'تغییر نقش بعد از ثبت، در سوابق مدیریتی ثبت می‌شود.' : 'دعوت فقط پس از پذیرش صریح و تأیید شماره فعال خواهد شد.'}</p>
            </div>
            <CloseButton label="بستن فرم" onClick={() => setEditor(null)} />
          </header>
          <form className={styles.form} onSubmit={(event) => void submitEditor(event)}>
            {editor?.kind === 'invite' ? (
              <>
                <label className={styles.field}>
                  شماره‌ی همراه
                  <input
                    autoComplete="tel"
                    dir="ltr"
                    inputMode="tel"
                    onChange={(event) => setInvitePhone(event.currentTarget.value)}
                    placeholder="۰۹۱۲۱۲۳۴۵۶۷"
                    required
                    type="tel"
                    value={invitePhone}
                  />
                  <span className={styles.fieldHint}>پس از نرمال‌سازی، شماره به قالب E.164 فرستاده می‌شود.</span>
                </label>
                {scope.type === 'organization' && (
                  <label className={styles.field}>
                    محل عضویت
                    <select onChange={(event) => { setInviteScopeKey(event.currentTarget.value); setInviteRoleId(''); }} value={inviteScopeKey}>
                      {inviteScopeOptions.map((option) => (
                        <option key={scopeValue(option.scope)} value={scopeValue(option.scope)}>
                          {operationsStaffScopeLabel(option.scope, scopeOptions)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={styles.field}>
                  نقش
                  <select disabled={Boolean(rolesError) || inviteRoles.length === 0} onChange={(event) => setInviteRoleId(event.currentTarget.value)} required value={inviteRoleId}>
                    <option value="">نقش را انتخاب کنید</option>
                    {inviteRoles.map((role) => (
                      <option key={role.id} value={role.id}>{role.name.trim() || 'نقش بدون نام نمایشی'}</option>
                    ))}
                  </select>
                  {rolesError && <span className={styles.fieldHint}>برای بارگذاری نقش‌های قابل واگذاری، مجوز مشاهده‌ی نقش‌ها لازم است.</span>}
                  {!rolesError && inviteRoles.length === 0 && <span className={styles.fieldHint}>نقش فعال و قابل واگذاری برای این محدوده پیدا نشد.</span>}
                </label>
                <label className={styles.field}>
                  توضیح دعوت <span className={styles.optional}>اختیاری</span>
                  <textarea maxLength={500} onChange={(event) => setInviteReason(event.currentTarget.value)} rows={3} value={inviteReason} />
                </label>
              </>
            ) : (
              <>
                <div className={styles.memberIdentity}>
                  <span className={styles.avatar} aria-hidden="true">{initials(editor?.member ? operationsStaffMemberName(editor.member) : '')}</span>
                  <div>
                    <strong>{editor?.member ? operationsStaffMemberName(editor.member) : ''}</strong>
                    <span>{editor?.member ? operationsStaffScopeLabel(editor.member.scope, scopeOptions) : ''}</span>
                  </div>
                </div>
                <label className={styles.field}>
                  نقش جدید
                  <select disabled={Boolean(rolesError) || editRoles.length === 0} onChange={(event) => setEditRoleId(event.currentTarget.value)} required value={editRoleId}>
                    {editRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name.trim() || 'نقش بدون نام نمایشی'}{editor?.kind === 'edit' && role.id === editor.member.role.id && role.status !== 'active' ? ' · نقش فعلی غیرفعال' : ''}
                      </option>
                    ))}
                  </select>
                  {rolesError && <span className={styles.fieldHint}>فهرست نقش‌ها دریافت نشد؛ امکان تغییر نقش فعلاً وجود ندارد.</span>}
                </label>
                <label className={styles.field}>
                  دلیل تغییر <span className={styles.required}>الزامی</span>
                  <textarea minLength={8} maxLength={500} onChange={(event) => setEditReason(event.currentTarget.value)} required rows={3} value={editReason} />
                </label>
              </>
            )}
            {mutationError && <p className={styles.error} role="alert">{mutationError}</p>}
            <footer className={styles.dialogActions}>
              <Button disabled={busy} onClick={() => setEditor(null)} type="button" tone="ghost">انصراف</Button>
              <Button disabled={busy || (editor?.kind === 'invite' && (Boolean(rolesError) || inviteRoles.length === 0))} type="submit">
                {busy ? 'در حال ثبت…' : editor?.kind === 'edit' ? 'ذخیره‌ی تغییرات' : 'ثبت و ارسال دعوت'}
              </Button>
            </footer>
          </form>
        </div>
      </dialog>

      <dialog
        aria-labelledby="staff-member-action-title"
        className={styles.dialog}
        onCancel={(event) => { event.preventDefault(); setAction(null); }}
        onClose={() => setAction(null)}
        ref={actionDialogRef}
      >
        <div className={styles.dialogBody}>
          <header className={styles.dialogHeader}>
            <div>
              <p className={styles.eyebrow}>تأیید عملیات</p>
              <h2 id="staff-member-action-title">{actionTitle(action)}</h2>
              <p>{actionDescription(action)}</p>
            </div>
            <CloseButton label="بستن تأیید" onClick={() => setAction(null)} />
          </header>
          {action && (
            <div className={styles.memberIdentity}>
              <span className={styles.avatar} aria-hidden="true">{initials(operationsStaffMemberName(action.member))}</span>
              <div>
                <strong>{operationsStaffMemberName(action.member)}</strong>
                <span>{operationsStaffScopeLabel(action.member.scope, scopeOptions)}</span>
              </div>
            </div>
          )}
          {action?.action !== 'revoke' && (
            <label className={styles.field}>
              توضیح <span className={styles.optional}>اختیاری</span>
              <textarea maxLength={500} onChange={(event) => setActionReason(event.currentTarget.value)} rows={3} value={actionReason} />
            </label>
          )}
          {action?.action === 'revoke' && action.member.status !== 'pending' && (
            <label className={styles.field}>
              دلیل لغو <span className={styles.required}>الزامی</span>
              <textarea minLength={8} maxLength={500} onChange={(event) => setActionReason(event.currentTarget.value)} required rows={3} value={actionReason} />
            </label>
          )}
          {mutationError && <p className={styles.error} role="alert">{mutationError}</p>}
          <footer className={styles.dialogActions}>
            <Button disabled={busy} onClick={() => setAction(null)} type="button" tone="ghost">انصراف</Button>
            <Button className={action?.action === 'revoke' ? styles.destructiveButton : undefined} disabled={busy} onClick={() => void confirmMemberAction()} type="button" tone={action?.action === 'revoke' ? 'secondary' : 'primary'}>
              {busy ? 'در حال انجام…' : action?.action === 'revoke' ? action.member.status === 'pending' ? 'لغو دعوت' : 'لغو عضویت' : action?.action === 'suspend' ? 'تعلیق عضو' : 'فعال‌سازی عضو'}
            </Button>
          </footer>
        </div>
      </dialog>

      <dialog
        aria-labelledby="staff-member-mfa-title"
        className={styles.mfaDialog}
        onCancel={(event) => { event.preventDefault(); if (!mfaBusy) { setMfaOpen(false); setMfaJob(null); mfaJobRef.current = null; } }}
        onClose={() => { if (!mfaBusy) { setMfaOpen(false); setMfaJob(null); mfaJobRef.current = null; } }}
        ref={mfaDialogRef}
      >
        <div className={styles.dialogBody}>
          {mfaJob && <h2 className={styles.visuallyHidden} id="staff-member-mfa-title">{mfaJob.label}</h2>}
          <OperationsMfaStepUpPanel
            idPrefix="staff-members-sensitive-action"
            mfaStepUpUntil={mfaStepUpUntil}
            onComplete={() => void completeMfaAction()}
            onMfaStepUp={onMfaStepUp}
            onSessionExpired={onSessionExpired}
          />
          {mfaBusy && <p role="status">در حال اجرای عملیات تأییدشده…</p>}
          <Button disabled={mfaBusy} onClick={() => { setMfaOpen(false); setMfaJob(null); mfaJobRef.current = null; }} type="button" tone="ghost">انصراف</Button>
        </div>
      </dialog>
    </>
  );

}

function MemberRow({
  member,
  onEdit,
  onAction,
  scopeOptions,
}: {
  member: OperationsStaffMember;
  onEdit: () => void;
  onAction: (action: MemberAction['action']) => void;
  scopeOptions: OperationsScopeOption[];
}) {
  const name = operationsStaffMemberName(member);
  const canEdit = member.status !== 'revoked';
  const action = member.status === 'active' ? 'suspend' : member.status === 'suspended' ? 'reactivate' : null;
  return (
    <Surface className={styles.memberCard}>
      <span className={styles.avatar} aria-hidden="true">{initials(name)}</span>
      <div className={styles.memberMain}>
        <div className={styles.memberTitle}>
          <strong>{name}</strong>
          <Badge tone={operationsStaffStatusTone(member.status)}>{operationsStaffStatusLabel(member.status)}</Badge>
        </div>
        <p>{member.role.name.trim() || 'نقش بدون نام نمایشی'}</p>
        <div className={styles.memberMeta}>
          <span>{operationsStaffScopeLabel(member.scope, scopeOptions)}</span>
          {member.maskedPhone && <span dir="ltr">{member.maskedPhone}</span>}
          <span>عضویت از {dateLabel(member.createdAt)}</span>
        </div>
      </div>
      <div className={styles.rowActions} aria-label={`عملیات ${name}`}>
        <Link className={styles.iconButton} href={`/staff/members/${encodeURIComponent(member.membershipId)}`} aria-label={`جزئیات ${name}`} title="جزئیات">
          <Icon kind="view" />
        </Link>
        <button className={styles.iconButton} disabled={!canEdit} onClick={onEdit} type="button" aria-label={`ویرایش نقش ${name}`} title="ویرایش نقش">
          <Icon kind="edit" />
        </button>
        {action && (
          <button className={styles.iconButton} onClick={() => onAction(action)} type="button" aria-label={`${action === 'suspend' ? 'تعلیق' : 'فعال‌سازی'} ${name}`} title={action === 'suspend' ? 'تعلیق' : 'فعال‌سازی'}>
            <Icon kind={action === 'suspend' ? 'pause' : 'play'} />
          </button>
        )}
        {member.status !== 'revoked' && (
          <button className={`${styles.iconButton} ${styles.dangerButton}`} onClick={() => onAction('revoke')} type="button" aria-label={`${member.status === 'pending' ? 'لغو دعوت' : 'لغو عضویت'} ${name}`} title={member.status === 'pending' ? 'لغو دعوت' : 'لغو عضویت'}>
            <Icon kind="delete" />
          </button>
        )}
      </div>
    </Surface>
  );
}

async function requestStaffPage(
  scope: OperationsScope,
  filters: MemberFilter,
  search: string,
  staffScopeView: OperationsStaffFilters['staffScopeView'],
  cursor?: string,
): Promise<OperationsPage<OperationsStaffMember>> {
  return listOperationsStaff(scope, cursor, filters.roleId || undefined, {
    search: search || undefined,
    status: filters.status || undefined,
    staffScopeView,
    branchFilterId: filters.branchFilterId || undefined,
  });
}

function getInviteScopeOptions(
  scope: OperationsScope,
  activeOption: OperationsScopeOption,
  options: OperationsScopeOption[],
): OperationsScopeOption[] {
  if (scope.type === 'branch') return [activeOption];
  const sameOrganization = options.filter((option) => sameId(option.scope.organizationId, scope.organizationId));
  const organizationOption = sameOrganization.find((option) => option.scope.type === 'organization') ?? activeOption;
  return [organizationOption, ...sameOrganization.filter((option) => option.scope.type === 'branch')];
}

function scopeValue(scope: OperationsScope): string {
  return scope.type === 'organization' ? `organization:${scope.organizationId}` : `branch:${scope.branchId}`;
}

function mergeMembers(current: OperationsStaffMember[], next: OperationsStaffMember[]) {
  const merged = new Map(current.map((member) => [member.membershipId, member]));
  for (const member of next) merged.set(member.membershipId, member);
  return [...merged.values()];
}

function syncDialog(ref: { current: HTMLDialogElement | null }, shouldOpen: boolean) {
  const dialog = ref.current;
  if (!dialog) return;
  if (shouldOpen && !dialog.open) dialog.showModal();
  if (!shouldOpen && dialog.open) dialog.close();
}

function sameId(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : parts[0]?.slice(0, 2) ?? 'ع').toLocaleUpperCase('fa-IR');
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'ثبت نشده' : date.toLocaleDateString('fa-IR');
}

function actionTitle(action: MemberAction | null): string {
  if (!action) return 'تأیید عملیات';
  if (action.action === 'revoke') return action.member.status === 'pending' ? 'لغو دعوت عضو' : 'لغو عضویت';
  return action.action === 'suspend' ? 'تعلیق عضویت' : 'فعال‌سازی دوباره‌ی عضویت';
}

function actionDescription(action: MemberAction | null): string {
  if (!action) return '';
  if (action.action === 'revoke') {
    return action.member.status === 'pending'
      ? 'دعوت لغو می‌شود و دیگر قابل پذیرش نخواهد بود.'
      : 'عضویت لغو می‌شود و این عملیات قابل بازگشت از همین صفحه نیست.';
  }
  return action.action === 'suspend'
    ? 'دسترسی عضو تا زمان فعال‌سازی دوباره متوقف می‌شود.'
    : 'دسترسی عضو دوباره فعال خواهد شد.';
}

function errorMessage(failure: unknown): string {
  if (failure instanceof ApiRequestError && failure.status === 403) {
    return 'دسترسی لازم برای انجام این کار در محدوده‌ی فعلی وجود ندارد.';
  }
  return failure instanceof Error ? failure.message : 'در ارتباط با سرویس خطایی رخ داد.';
}

function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button aria-label={label} className={styles.closeButton} onClick={onClick} type="button">×</button>;
}

function Icon({ kind }: { kind: 'add' | 'view' | 'edit' | 'delete' | 'pause' | 'play' | 'staff' }) {
  if (kind === 'add') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
  if (kind === 'view') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.6" /></svg>;
  if (kind === 'edit') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L19.8 7.7a2.2 2.2 0 0 0-3.1-3.1L4 16.5Z" /><path d="m14.9 6.4 3.1 3.1" /></svg>;
  if (kind === 'delete') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" /></svg>;
  if (kind === 'pause') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>;
  if (kind === 'play') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 20v-1.5a6 6 0 0 1 12 0V20M17 5.5a3 3 0 0 1 0 5.8M18 14a4 4 0 0 1 3 4v2" /></svg>;
}
