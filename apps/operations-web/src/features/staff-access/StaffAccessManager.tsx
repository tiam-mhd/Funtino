'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import { OperationsManagementList } from '../../components/workspace-shell/OperationsManagementList';
import {
  normalizeDigits,
  normalizePhone,
  scopeKey,
  type OperationsScope,
  type OperationsScopeOption,
} from '../../lib/auth/operations-access';
import {
  confirmOperationsMfaEnrollment,
  createOperationsRole,
  deleteOperationsRole,
  freshIdempotencyKey,
  getOperationsMfaStatus,
  inviteOperationsStaff,
  listOperationsPermissions,
  listOperationsRoles,
  listOperationsStaff,
  listScopedStaffInvitations,
  revokeScopedStaffInvitation,
  restoreOperationsRole,
  startOperationsMfaEnrollment,
  verifyOperationsMfaStepUp,
  updateOperationsRole,
  type OperationsAccessRole,
  type OperationsMfaEnrollment,
  type OperationsMfaRecoveryCodes,
  type OperationsMfaStatus,
  type OperationsPage,
  type OperationsPermission,
  type OperationsRoleFilters,
  type OperationsStaffInvitation,
  type OperationsStaffMember,
} from '../../lib/api/operations-staff';
import { StaffMemberCard } from './StaffMemberCard';
import {
  groupOperationsRoles,
  operationsRolePermissionLabel,
  operationsRoleScopeLabel,
} from './role-display';
import styles from './StaffAccessManager.module.css';

type StaffAccessManagerProps = {
  scope: OperationsScope;
  scopeOptions: OperationsScopeOption[];
  onSessionExpired: () => void;
  view?: 'roster' | 'invitations' | 'roles';
};

type PendingMutation = { label: string; run: () => Promise<void> };
type MfaStage = 'verify' | 'start-enrollment' | 'confirm-enrollment' | 'save-recovery';
type RosterFilter = 'all' | OperationsStaffMember['status'];
type RoleLifecycleFilter = 'all' | 'active' | 'disabled' | 'deleted';
type RoleKindFilter = 'all' | 'custom' | 'system';
type RoleDialogMode = 'create' | 'edit' | 'delete' | 'restore' | null;

export function StaffAccessManager({
  scope,
  scopeOptions,
  onSessionExpired,
  view,
}: StaffAccessManagerProps) {
  const [staff, setStaff] = useState<OperationsStaffMember[]>([]);
  const [staffCursor, setStaffCursor] = useState<string | null>(null);
  const [roles, setRoles] = useState<OperationsAccessRole[]>([]);
  const [rolesCursor, setRolesCursor] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<OperationsStaffInvitation[]>([]);
  const [invitationsCursor, setInvitationsCursor] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<OperationsPermission[]>([]);
  const [mfaStatus, setMfaStatus] = useState<OperationsMfaStatus | null>(null);
  const [mfaStatusError, setMfaStatusError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadedContextKey, setLoadedContextKey] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadMoreBusy, setLoadMoreBusy] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'roster' | 'invitations'>('roster');
  const [roleSearchInput, setRoleSearchInput] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [roleFilters, setRoleFilters] = useState<{
    lifecycle: RoleLifecycleFilter;
    kind: RoleKindFilter;
  }>({ lifecycle: 'all', kind: 'all' });
  const [roleFilterDraft, setRoleFilterDraft] = useState(roleFilters);
  const [roleDialog, setRoleDialog] = useState<RoleDialogMode>(null);
  const [roleTarget, setRoleTarget] = useState<OperationsAccessRole | null>(null);
  const [roleName, setRoleName] = useState('');
  const [roleStatus, setRoleStatus] = useState<'active' | 'disabled'>('active');
  const [rolePermissionKeys, setRolePermissionKeys] = useState<string[]>([]);
  const [roleReason, setRoleReason] = useState('');
  const [search, setSearch] = useState('');
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>('all');
  const [sortBy, setSortBy] = useState<'member' | 'role'>('member');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviteReason, setInviteReason] = useState('');
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const [mfaStage, setMfaStage] = useState<MfaStage | null>(null);
  const [mfaError, setMfaError] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaCheckBusy, setMfaCheckBusy] = useState(false);
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'recovery'>('totp');
  const [mfaCode, setMfaCode] = useState('');
  const [enrollment, setEnrollment] = useState<OperationsMfaEnrollment | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<OperationsMfaRecoveryCodes | null>(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const stepUpUntil = useRef(0);
  const inviteRetry = useRef<{ fingerprint: string; key: string } | null>(null);
  const roleDialogRef = useRef<HTMLDialogElement>(null);

  const currentScopeKey = scopeKey(scope);
  const roleApiFilters = useMemo<OperationsRoleFilters>(
    () => ({
      search: roleSearch || undefined,
      lifecycle: roleFilters.lifecycle === 'all' ? undefined : roleFilters.lifecycle,
      kind: roleFilters.kind === 'all' ? undefined : roleFilters.kind,
      roleScopeView:
        view === 'roles'
          ? scope.type === 'organization'
            ? 'organizationTree'
            : 'exact'
          : undefined,
    }),
    [roleFilters.kind, roleFilters.lifecycle, roleSearch, scope.type, view],
  );
  const loadContextKey = JSON.stringify([currentScopeKey, view ?? 'roster', roleApiFilters]);
  const loadContextRef = useRef(loadContextKey);
  const loadSequence = useRef(0);
  loadContextRef.current = loadContextKey;
  const pageLoading = loading || loadedContextKey !== loadContextKey;
  const displayedLoadError = loadedContextKey === loadContextKey ? loadError : '';

  useEffect(() => {
    const timeout = window.setTimeout(() => setRoleSearch(roleSearchInput.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [roleSearchInput]);

  useEffect(() => {
    const dialog = roleDialogRef.current;
    if (roleDialog && dialog && !dialog.open) dialog.showModal();
    if (!roleDialog && dialog?.open) dialog.close();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [roleDialog]);

  const loadData = useCallback(
    async (showSpinner = true) => {
      const requestContext = loadContextKey;
      if (loadContextRef.current !== requestContext) return;
      const requestSequence = ++loadSequence.current;
      const isCurrentRequest = () =>
        loadSequence.current === requestSequence && loadContextRef.current === requestContext;
      if (showSpinner) setLoading(true);
      setLoadError('');
      if (view === 'roles') {
        const [rolesResult, permissionsResult, mfaResult] = await Promise.allSettled([
          listOperationsRoles(scope, undefined, roleApiFilters),
          listOperationsPermissions(),
          getOperationsMfaStatus(),
        ]);
        if (!isCurrentRequest()) return;
        if (
          rolesResult.status === 'rejected' &&
          rolesResult.reason instanceof ApiRequestError &&
          rolesResult.reason.status === 401
        ) {
          onSessionExpired();
          setLoading(false);
          return;
        }
        if (rolesResult.status === 'rejected') {
          setLoadError(messageFor(rolesResult.reason));
          setRoles([]);
          setRolesCursor(null);
        } else {
          setRoles(rolesResult.value.data);
          setRolesCursor(rolesResult.value.nextCursor);
        }
        if (permissionsResult.status === 'fulfilled') setPermissions(permissionsResult.value);
        else setPermissions([]);
        if (mfaResult.status === 'fulfilled') {
          setMfaStatus(mfaResult.value);
          setMfaStatusError('');
        } else {
          setMfaStatus(null);
          setMfaStatusError(messageFor(mfaResult.reason));
        }
        setLoadedContextKey(requestContext);
        setLoading(false);
        return;
      }
      const results = await Promise.allSettled([
        listOperationsStaff(scope),
        listScopedStaffInvitations(scope),
        listOperationsRoles(scope),
        listOperationsPermissions(),
        getOperationsMfaStatus(),
      ]);
      if (!isCurrentRequest()) return;
      const [staffResult, invitationsResult, rolesResult, permissionsResult, mfaResult] = results;
      const required = [staffResult, invitationsResult, rolesResult, permissionsResult];
      const unauthorized = results.find(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof ApiRequestError &&
          result.reason.status === 401,
      );
      if (unauthorized?.status === 'rejected') {
        onSessionExpired();
        setLoading(false);
        return;
      }

      const failedRequired = required.find((result) => result.status === 'rejected');
      if (failedRequired?.status === 'rejected') {
        setLoadError(messageFor(failedRequired.reason));
      } else {
        const staffPage = (
          staffResult as PromiseFulfilledResult<OperationsPage<OperationsStaffMember>>
        ).value;
        const invitationPage = (
          invitationsResult as PromiseFulfilledResult<OperationsPage<OperationsStaffInvitation>>
        ).value;
        const rolePage = (
          rolesResult as PromiseFulfilledResult<{
            data: OperationsAccessRole[];
            nextCursor: string | null;
          }>
        ).value;
        const permissionList = (permissionsResult as PromiseFulfilledResult<OperationsPermission[]>)
          .value;
        setStaff(staffPage.data);
        setStaffCursor(staffPage.nextCursor);
        setInvitations(invitationPage.data);
        setInvitationsCursor(invitationPage.nextCursor);
        setRoles(rolePage.data);
        setRolesCursor(rolePage.nextCursor);
        setPermissions(permissionList);
      }

      if (mfaResult.status === 'fulfilled') {
        setMfaStatus(mfaResult.value);
        setMfaStatusError('');
      } else {
        setMfaStatus(null);
        setMfaStatusError(messageFor(mfaResult.reason));
      }
      setLoadedContextKey(requestContext);
      setLoading(false);
    },
    [loadContextKey, onSessionExpired, roleApiFilters, scope, view],
  );

  useEffect(() => {
    setStaff([]);
    setStaffCursor(null);
    setRoles([]);
    setRolesCursor(null);
    setInvitations([]);
    setInvitationsCursor(null);
    setPermissions([]);
    setLoadedContextKey('');
    setLoadMoreBusy('');
    setLoadError('');
    setActionError('');
    setNotice('');
    setTab(view === 'invitations' ? 'invitations' : 'roster');
    setLoading(true);
    void loadData();
    return () => {
      loadSequence.current += 1;
    };
  }, [currentScopeKey, loadData, view]);

  const performMutation = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setActionBusy(true);
      setActionError('');
      setNotice('');
      try {
        await action();
        setNotice(label);
        await loadData(false);
      } catch (failure) {
        if (failure instanceof ApiRequestError && failure.status === 401) {
          onSessionExpired();
        } else {
          if (failure instanceof ApiRequestError && failure.status === 403) stepUpUntil.current = 0;
          if (
            failure instanceof ApiRequestError &&
            (failure.status === 409 || failure.status === 412)
          ) {
            await loadData(false);
          }
          setActionError(messageFor(failure));
        }
      } finally {
        setActionBusy(false);
      }
    },
    [loadData, onSessionExpired],
  );

  const requestSensitiveAction = useCallback(
    async (label: string, run: () => Promise<void>, requiresStepUp = true) => {
      setActionError('');
      setNotice('');
      if (!requiresStepUp) {
        await performMutation(label, run);
        return;
      }
      setMfaCheckBusy(true);
      try {
        let currentStatus = mfaStatus;
        if (!currentStatus) {
          try {
            currentStatus = await getOperationsMfaStatus();
            setMfaStatus(currentStatus);
            setMfaStatusError('');
          } catch (failure) {
            if (failure instanceof ApiRequestError && failure.status === 401) {
              onSessionExpired();
            } else {
              setMfaStatusError(messageFor(failure));
            }
            return;
          }
        }

        if (currentStatus.enabled && stepUpUntil.current > Date.now() + 5_000) {
          await performMutation(label, run);
          return;
        }
        setPendingMutation({ label, run });
        setMfaError('');
        setMfaStage(currentStatus.enabled ? 'verify' : 'start-enrollment');
      } finally {
        setMfaCheckBusy(false);
      }
    },
    [mfaStatus, onSessionExpired, performMutation],
  );

  const filteredStaff = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return staff
      .filter((member) => rosterFilter === 'all' || member.status === rosterFilter)
      .filter(
        (member) =>
          !normalizedSearch ||
          `${safeMemberName(member)} ${member.maskedPhone ?? ''} ${member.role.name}`
            .toLocaleLowerCase()
            .includes(normalizedSearch),
      )
      .sort((left, right) => {
        const first =
          sortBy === 'role'
            ? left.role.name.localeCompare(right.role.name, 'fa')
            : safeMemberName(left).localeCompare(safeMemberName(right), 'fa');
        return first || left.membershipId.localeCompare(right.membershipId);
      });
  }, [rosterFilter, search, sortBy, staff]);

  const assignableRoles = roles.filter((role) => role.status === 'active' && !role.systemManaged);
  const actionsDisabled =
    actionBusy || mfaCheckBusy || mfaStage !== null || pendingMutation !== null;
  const roleTargetScope = roleTarget?.scope ?? scope;
  const roleAuthorizationChanged = Boolean(
    roleTarget &&
      (roleStatus !== roleTarget.status ||
        !sameRoleKeys(rolePermissionKeys, roleTarget.permissionKeys)),
  );
  const roleReasonRequired = roleDialog === 'create' || roleAuthorizationChanged;
  const rolePermissionOptions = permissions.filter((permission) =>
    permission.scopes.includes(roleTargetScope.type),
  );

  function inviteKey(fingerprint: string): string {
    if (inviteRetry.current?.fingerprint === fingerprint) return inviteRetry.current.key;
    const key = freshIdempotencyKey();
    inviteRetry.current = { fingerprint, key };
    return key;
  }

  function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPhone = normalizePhone(invitePhone);
    const reason = inviteReason.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone) || !inviteRoleId) {
      setActionError('شماره‌ی E.164 معتبر و نقش فعال انتخاب کنید.');
      return;
    }
    const input = {
      phoneE164: normalizedPhone,
      scope,
      roleId: inviteRoleId,
      ...(reason ? { reason } : {}),
    };
    const key = inviteKey(JSON.stringify(input));
    void requestSensitiveAction(
      'دعوت ثبت شد؛ فعال‌سازی فقط پس از پذیرش صریح با شماره‌ی تأییدشده انجام می‌شود.',
      async () => {
        await inviteOperationsStaff(input, key);
        inviteRetry.current = null;
        setInvitePhone('');
        setInviteRoleId('');
        setInviteReason('');
        setTab('invitations');
      },
      false,
    );
  }

  async function loadMore(kind: 'staff' | 'roles' | 'invitations') {
    const requestContext = loadContextKey;
    const requestSequence = loadSequence.current;
    const cursor =
      kind === 'staff' ? staffCursor : kind === 'roles' ? rolesCursor : invitationsCursor;
    if (!cursor || loadMoreBusy) return;
    setLoadMoreBusy(kind);
    setLoadError('');
    try {
      if (kind === 'staff') {
        const page = await listOperationsStaff(scope, cursor);
        if (loadContextRef.current !== requestContext || loadSequence.current !== requestSequence)
          return;
        setStaff((current) => mergeById(current, page.data, (item) => item.membershipId));
        setStaffCursor(page.nextCursor);
      } else if (kind === 'roles') {
        const page = await listOperationsRoles(scope, cursor, roleApiFilters);
        if (loadContextRef.current !== requestContext || loadSequence.current !== requestSequence)
          return;
        setRoles((current) => mergeById(current, page.data, (item) => item.id));
        setRolesCursor(page.nextCursor);
      } else {
        const page = await listScopedStaffInvitations(scope, cursor);
        if (loadContextRef.current !== requestContext || loadSequence.current !== requestSequence)
          return;
        setInvitations((current) => mergeById(current, page.data, (item) => item.id));
        setInvitationsCursor(page.nextCursor);
      }
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else if (
        loadContextRef.current === requestContext &&
        loadSequence.current === requestSequence
      ) {
        setLoadError(messageFor(failure));
      }
    } finally {
      if (loadContextRef.current === requestContext && loadSequence.current === requestSequence) {
        setLoadMoreBusy('');
      }
    }
  }

  async function startEnrollment() {
    setMfaBusy(true);
    setMfaError('');
    try {
      const result = await startOperationsMfaEnrollment();
      setEnrollment(result);
      setEnrollmentCode('');
      setMfaStage('confirm-enrollment');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeDigits(enrollmentCode).replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) {
      setMfaError('کد برنامه‌ی رمزساز باید ۶ رقم باشد.');
      return;
    }
    setMfaBusy(true);
    setMfaError('');
    try {
      const result = await confirmOperationsMfaEnrollment(code);
      setRecoveryCodes(result);
      setCodesSaved(false);
      stepUpUntil.current = Date.parse(result.validUntil);
      setMfaStatus({
        enabled: true,
        enrollmentPending: false,
        recoveryCodesRemaining: result.recoveryCodes.length,
      });
      setEnrollment(null);
      setEnrollmentCode('');
      setMfaStage('save-recovery');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function verifyStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code =
      mfaMethod === 'totp'
        ? normalizeDigits(mfaCode).replace(/\D/g, '')
        : normalizeDigits(mfaCode).trim().toUpperCase();
    if (
      mfaMethod === 'totp' ? !/^\d{6}$/.test(code) : !/^[0-9A-F]{8}(?:-[0-9A-F]{8}){3}$/.test(code)
    ) {
      setMfaError(
        mfaMethod === 'totp'
          ? 'کد برنامه‌ی رمزساز باید ۶ رقم باشد.'
          : 'قالب کد بازیابی معتبر نیست.',
      );
      return;
    }
    setMfaBusy(true);
    setMfaError('');
    try {
      const result = await verifyOperationsMfaStepUp({ method: mfaMethod, code });
      stepUpUntil.current = Date.parse(result.validUntil);
      setMfaCode('');
      setMfaStatus((current) => (current ? { ...current, enabled: true } : current));
      const next = pendingMutation;
      setPendingMutation(null);
      setMfaStage(null);
      if (next) await performMutation(next.label, next.run);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function continueAfterRecoveryCodes() {
    if (!codesSaved || !pendingMutation) return;
    const next = pendingMutation;
    setRecoveryCodes(null);
    setPendingMutation(null);
    setMfaStage(null);
    setMfaError('');
    await performMutation(next.label, next.run);
  }

  function cancelMfa() {
    setPendingMutation(null);
    setMfaStage(null);
    setMfaError('');
    setMfaCode('');
    setEnrollment(null);
    setEnrollmentCode('');
    setRecoveryCodes(null);
    setCodesSaved(false);
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.recoveryCodes.join('\n'));
    } catch {
      setMfaError('کپی در دسترس نیست؛ کدها را پیش از ادامه در محل امن ذخیره کنید.');
    }
  }

  function revokeInvitation(invitation: OperationsStaffInvitation, reason: string, key: string) {
    void requestSensitiveAction(
      'دعوت لغو شد و دیگر قابل پذیرش نیست.',
      async () => {
        await revokeScopedStaffInvitation(invitation.id, reason || undefined, key);
      },
      false,
    );
  }

  function openRoleEditor(role?: OperationsAccessRole) {
    setActionError('');
    setRoleTarget(role ?? null);
    setRoleName(role?.name ?? '');
    setRoleStatus(role?.status ?? 'active');
    setRolePermissionKeys(role?.permissionKeys ?? []);
    setRoleReason('');
    setRoleDialog(role ? 'edit' : 'create');
  }

  function openRoleLifecycleDialog(mode: 'delete' | 'restore', role: OperationsAccessRole) {
    setActionError('');
    setRoleTarget(role);
    setRoleReason('');
    setRoleDialog(mode);
  }

  function closeRoleDialog() {
    if (!actionsDisabled) setRoleDialog(null);
  }

  function submitRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roleDialog || !['create', 'edit'].includes(roleDialog)) return;
    const name = roleName.trim();
    const reason = roleReason.trim();
    const targetRole = roleTarget;
    const mode = roleDialog;
    const permissionsToSave = [...new Set(rolePermissionKeys)].sort();
    if (
      name.length < 2 ||
      permissionsToSave.length === 0 ||
      reason.length > 500 ||
      (roleReasonRequired && reason.length < 8)
    ) {
      setActionError(
        roleReasonRequired
          ? 'نام نقش، دست‌کم یک مجوز و دلیل ۸ تا ۵۰۰ نویسه‌ای لازم است.'
          : 'نام نقش و دست‌کم یک مجوز لازم است.',
      );
      return;
    }
    if (mode === 'edit' && targetRole) {
      const updates: {
        name?: string;
        permissionKeys?: string[];
        status?: 'active' | 'disabled';
        reason?: string;
      } = {};
      if (name !== targetRole.name) updates.name = name;
      if (!sameRoleKeys(permissionsToSave, targetRole.permissionKeys)) {
        updates.permissionKeys = permissionsToSave;
      }
      if (roleStatus !== targetRole.status) updates.status = roleStatus;
      if (
        updates.name === undefined &&
        updates.permissionKeys === undefined &&
        updates.status === undefined
      ) {
        setActionError('تغییری برای ذخیره وجود ندارد.');
        return;
      }
      if (reason) updates.reason = reason;
      const authorizationChanged =
        updates.permissionKeys !== undefined || updates.status !== undefined;
      if (authorizationChanged && reason.length < 8) {
        setActionError('برای تغییر دسترسی یا وضعیت نقش، دلیل ۸ نویسه‌ای لازم است.');
        return;
      }
      const idempotencyKey = freshIdempotencyKey();
      setRoleDialog(null);
      void requestSensitiveAction(
        'نقش به‌روزرسانی شد.',
        async () => updateOperationsRole(targetRole, updates, idempotencyKey).then(() => undefined),
        true,
      );
      return;
    }
    if (mode !== 'create') return;
    const idempotencyKey = freshIdempotencyKey();
    setRoleDialog(null);
    void requestSensitiveAction(
      'نقش جدید ساخته شد.',
      async () => {
        await createOperationsRole(
          { name, scope, permissionKeys: permissionsToSave, reason },
          idempotencyKey,
        );
      },
      true,
    );
  }

  function confirmRoleLifecycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const role = roleTarget;
    const reason = roleReason.trim();
    const mode = roleDialog;
    if (!role || (mode !== 'delete' && mode !== 'restore')) return;
    if (reason.length < 8) {
      setActionError('برای این تغییر دلیل ۸ نویسه‌ای لازم است.');
      return;
    }
    const idempotencyKey = freshIdempotencyKey();
    setRoleDialog(null);
    void requestSensitiveAction(
      mode === 'delete'
        ? 'نقش حذف نرم شد و در فهرست حذف‌شده‌ها باقی ماند.'
        : 'نقش بازیابی شد و غیرفعال باقی ماند.',
      async () => {
        if (mode === 'delete') await deleteOperationsRole(role, reason, idempotencyKey);
        else await restoreOperationsRole(role, reason, idempotencyKey);
      },
      true,
    );
  }

  return (
    <section
      className={styles.manager}
      aria-labelledby={view === 'roles' ? 'operations-list-title' : 'staff-access-title'}
    >
      <header className={styles.managerHeader}>
        {view !== 'roles' && (
          <div>
            <p className={styles.eyebrow}>مدیریت محدوده‌ی فعال</p>
            <h2 id="staff-access-title">{view === 'invitations' ? 'دعوت‌های صادرشده' : 'اعضا'}</h2>
            <p className={styles.explainer}>
              عضویت‌ها، دعوت‌ها و استثناها از IAM خوانده می‌شوند. هر درخواست دوباره در سرور و در
              همین محدوده مجوزسنجی می‌شود.
            </p>
          </div>
        )}
        <div className={styles.managerActions}>
          {mfaStatus ? (
            <Badge tone={mfaStatus.enabled ? 'success' : 'warning'}>
              MFA {mfaStatus.enabled ? 'فعال' : 'نیازمند راه‌اندازی'}
            </Badge>
          ) : (
            <Badge tone="neutral">MFA بررسی‌نشده</Badge>
          )}
          <Button disabled={pageLoading} onClick={() => void loadData()} tone="ghost" type="button">
            {pageLoading ? 'در حال دریافت…' : 'به‌روزرسانی'}
          </Button>
        </div>
      </header>

      {mfaStatusError && !mfaStatus && (
        <p className={styles.warning} role="status">
          وضعیت MFA دریافت نشد؛ تغییر حساس تا تأیید وضعیت متوقف می‌ماند. {mfaStatusError}
        </p>
      )}
      {displayedLoadError && (
        <div className={styles.errorBlock}>
          <p className={styles.error} role="alert">
            {displayedLoadError}
          </p>
          <Button disabled={pageLoading} onClick={() => void loadData()} type="button" tone="ghost">
            تلاش دوباره
          </Button>
        </div>
      )}
      {actionError && (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {mfaStage && (
        <Surface className={styles.mfaPanel} aria-labelledby="staff-mfa-panel-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>تأیید نشست مدیریتی</p>
              <h3 id="staff-mfa-panel-title">{pendingMutation?.label ?? 'تأیید دومرحله‌ای'}</h3>
            </div>
            <Button
              disabled={mfaBusy || (mfaStage === 'save-recovery' && !codesSaved)}
              onClick={cancelMfa}
              tone="ghost"
              type="button"
            >
              انصراف
            </Button>
          </div>
          <p className={styles.explainer}>
            ورود پیامکی جایگزین MFA نیست. اثبات این مرحله فقط در نشست سمت‌سرور ثبت می‌شود و حداکثر ۵
            دقیقه اعتبار دارد.
          </p>
          {mfaError && (
            <p className={styles.error} role="alert">
              {mfaError}
            </p>
          )}

          {mfaStage === 'verify' && (
            <form className={styles.form} onSubmit={(event) => void verifyStepUp(event)}>
              <label className={styles.field}>
                روش تأیید
                <select
                  disabled={mfaBusy}
                  onChange={(event) =>
                    setMfaMethod(event.currentTarget.value as 'totp' | 'recovery')
                  }
                  value={mfaMethod}
                >
                  <option value="totp">کد برنامه‌ی رمزساز</option>
                  <option value="recovery">کد بازیابی یک‌بارمصرف</option>
                </select>
              </label>
              <label className={styles.field}>
                {mfaMethod === 'totp' ? 'کد ۶ رقمی' : 'کد بازیابی'}
                <input
                  autoComplete="one-time-code"
                  dir="ltr"
                  disabled={mfaBusy}
                  inputMode={mfaMethod === 'totp' ? 'numeric' : 'text'}
                  maxLength={mfaMethod === 'totp' ? 6 : 35}
                  onChange={(event) => setMfaCode(event.currentTarget.value)}
                  required
                  value={mfaCode}
                />
              </label>
              <Button disabled={mfaBusy} type="submit">
                {mfaBusy ? 'در حال تأیید…' : 'تأیید و ادامه‌ی عملیات'}
              </Button>
            </form>
          )}

          {mfaStage === 'start-enrollment' && (
            <div className={styles.form}>
              <p className={styles.explainer}>
                برای انجام این تغییر حساس، ابتدا یک برنامه‌ی رمزساز را متصل کنید. کلید فقط در همین
                نشست نمایش داده می‌شود.
              </p>
              <Button disabled={mfaBusy} onClick={() => void startEnrollment()} type="button">
                {mfaBusy
                  ? 'در حال آماده‌سازی…'
                  : mfaStatus?.enrollmentPending
                    ? 'ادامه‌ی راه‌اندازی MFA'
                    : 'راه‌اندازی MFA'}
              </Button>
            </div>
          )}

          {mfaStage === 'confirm-enrollment' && enrollment && (
            <form className={styles.form} onSubmit={(event) => void confirmEnrollment(event)}>
              <p className={styles.explainer}>
                کلید را در برنامه‌ی رمزساز وارد کنید؛ سپس کد شش‌رقمی همان برنامه را برای تأیید
                بنویسید. این کلید را با کسی به اشتراک نگذارید.
              </p>
              <code className={styles.secretCode} dir="ltr">
                {enrollment.secret}
              </code>
              <p className={styles.mfaExpiry}>
                مهلت راه‌اندازی: {new Date(enrollment.expiresAt).toLocaleString('fa-IR')}
              </p>
              <label className={styles.field}>
                کد برنامه‌ی رمزساز
                <input
                  autoComplete="one-time-code"
                  dir="ltr"
                  disabled={mfaBusy}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setEnrollmentCode(event.currentTarget.value)}
                  required
                  value={enrollmentCode}
                />
              </label>
              <Button disabled={mfaBusy} type="submit">
                {mfaBusy ? 'در حال فعال‌سازی…' : 'فعال‌سازی و دریافت کدهای بازیابی'}
              </Button>
            </form>
          )}

          {mfaStage === 'save-recovery' && recoveryCodes && (
            <div className={styles.form}>
              <p className={styles.warning} role="status">
                MFA فعال شد. این ۱۰ کد بازیابی فقط یک‌بار نمایش داده می‌شوند؛ پیش از ادامه آن‌ها را
                در محل امن ذخیره کنید.
              </p>
              <ol className={styles.recoveryCodes} dir="ltr">
                {recoveryCodes.recoveryCodes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ol>
              <Button onClick={() => void copyRecoveryCodes()} tone="secondary" type="button">
                کپی کدهای بازیابی
              </Button>
              <label className={styles.checkField}>
                <input
                  checked={codesSaved}
                  onChange={(event) => setCodesSaved(event.currentTarget.checked)}
                  type="checkbox"
                />
                کدها را در محل امن ذخیره کردم.
              </label>
              <Button
                disabled={!codesSaved || mfaBusy}
                onClick={() => void continueAfterRecoveryCodes()}
                type="button"
              >
                ادامه و اجرای عملیات حساس
              </Button>
            </div>
          )}
        </Surface>
      )}

      {!displayedLoadError && (
        <>
          {!view && (
            <div className={styles.tabs} role="group" aria-label="بخش مدیریت کارکنان">
              <Button
                aria-pressed={tab === 'roster'}
                onClick={() => setTab('roster')}
                type="button"
                tone={tab === 'roster' ? 'primary' : 'ghost'}
              >
                فهرست کارکنان و دعوت
              </Button>
              <Button
                aria-pressed={tab === 'invitations'}
                onClick={() => setTab('invitations')}
                type="button"
                tone={tab === 'invitations' ? 'primary' : 'ghost'}
              >
                دعوت‌های صادرشده ({invitations.length})
              </Button>
            </div>
          )}

          {pageLoading ? (
            <Surface className={styles.loadingState} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              {view === 'roles'
                ? 'در حال دریافت نقش‌های همین محدوده…'
                : 'در حال دریافت اعضا، نقش‌ها و دعوت‌های همین محدوده…'}
            </Surface>
          ) : view === 'roles' ? (
            <StaffRoleList
              actionsDisabled={actionsDisabled}
              filterDraft={roleFilterDraft}
              filterCount={
                (roleFilters.lifecycle === 'all' ? 0 : 1) + (roleFilters.kind === 'all' ? 0 : 1)
              }
              loadMoreBusy={loadMoreBusy === 'roles'}
              onApplyFilters={() => setRoleFilters(roleFilterDraft)}
              onClearFilters={() => {
                const cleared = { lifecycle: 'all' as const, kind: 'all' as const };
                setRoleFilterDraft(cleared);
                setRoleFilters(cleared);
              }}
              onCreate={() => openRoleEditor()}
              onEdit={openRoleEditor}
              onDelete={(role) => openRoleLifecycleDialog('delete', role)}
              onRestore={(role) => openRoleLifecycleDialog('restore', role)}
              onFilterDraftChange={setRoleFilterDraft}
              onLoadMore={() => void loadMore('roles')}
              onSearchChange={setRoleSearchInput}
              roles={roles}
              rolesCursor={rolesCursor}
              scope={scope}
              scopeOptions={scopeOptions}
              search={roleSearchInput}
            />
          ) : tab === 'roster' ? (
            <div className={styles.rosterLayout}>
              <Surface className={styles.inviteFormPanel}>
                <p className={styles.eyebrow}>دعوت تازه · فقط شماره‌ی E.164</p>
                <h3>افزودن کارمند به محدوده</h3>
                <p className={styles.explainer}>
                  دعوت به همین مجموعه/شعبه فرستاده می‌شود؛ عضویت تا ورود با OTP همان شماره و پذیرش
                  صریح فعال نخواهد شد.
                </p>
                <form className={styles.form} onSubmit={submitInvitation}>
                  <label className={styles.field}>
                    شماره‌ی همراه (ایرانی یا E.164)
                    <input
                      autoComplete="tel"
                      dir="ltr"
                      disabled={actionsDisabled}
                      inputMode="tel"
                      onChange={(event) => setInvitePhone(event.currentTarget.value)}
                      placeholder="۰۹۱۲۱۲۳۴۵۶۷"
                      required
                      type="tel"
                      value={invitePhone}
                    />
                  </label>
                  <label className={styles.field}>
                    نقش فعال و قابل واگذاری
                    <select
                      disabled={actionsDisabled || assignableRoles.length === 0}
                      onChange={(event) => setInviteRoleId(event.currentTarget.value)}
                      required
                      value={inviteRoleId}
                    >
                      <option value="">انتخاب نقش</option>
                      {assignableRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {assignableRoles.length === 0 && (
                    <p className={styles.warning}>
                      نقش سفارشی فعال و قابل واگذاری در این محدوده پیدا نشد. نقش‌های سیستمی از این
                      فرم تخصیص داده نمی‌شوند.
                    </p>
                  )}
                  {rolesCursor && (
                    <Button
                      disabled={Boolean(loadMoreBusy)}
                      onClick={() => void loadMore('roles')}
                      tone="ghost"
                      type="button"
                    >
                      {loadMoreBusy === 'roles'
                        ? 'در حال دریافت نقش‌ها…'
                        : 'بارگذاری نقش‌های بیشتر'}
                    </Button>
                  )}
                  <label className={styles.field}>
                    دلیل دعوت
                    <textarea
                      disabled={actionsDisabled}
                      maxLength={500}
                      onChange={(event) => setInviteReason(event.currentTarget.value)}
                      rows={3}
                      value={inviteReason}
                    />
                  </label>
                  <Button disabled={actionsDisabled || assignableRoles.length === 0} type="submit">
                    صدور دعوت‌نامه
                  </Button>
                </form>
              </Surface>

              <section className={styles.rosterSection} aria-labelledby="roster-heading">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>فهرست مبتنی بر عضویت‌های IAM</p>
                    <h3 id="roster-heading">کارکنان · {staff.length} مورد دریافت‌شده</h3>
                  </div>
                </div>
                <div className={styles.filters}>
                  <label className={styles.field}>
                    جست‌وجو در شماره‌ی پوشیده یا نقش‌های دریافت‌شده
                    <input
                      onChange={(event) => setSearch(event.currentTarget.value)}
                      value={search}
                    />
                  </label>
                  <label className={styles.field}>
                    وضعیت
                    <select
                      onChange={(event) =>
                        setRosterFilter(event.currentTarget.value as RosterFilter)
                      }
                      value={rosterFilter}
                    >
                      <option value="all">همه</option>
                      <option value="active">فعال</option>
                      <option value="pending">در انتظار پذیرش</option>
                      <option value="suspended">معلق</option>
                      <option value="revoked">لغوشده</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    مرتب‌سازی
                    <select
                      onChange={(event) =>
                        setSortBy(event.currentTarget.value as 'member' | 'role')
                      }
                      value={sortBy}
                    >
                      <option value="member">شماره / شناسه</option>
                      <option value="role">نام نقش</option>
                    </select>
                  </label>
                </div>
                <p className={styles.explainer}>
                  جست‌وجو، فیلتر و مرتب‌سازی روی موارد دریافت‌شده اعمال می‌شود؛ برای بررسی فهرست
                  کامل، صفحه‌های بعدی را هم بارگذاری کنید.
                </p>
                {filteredStaff.length === 0 ? (
                  <Surface className={styles.emptyState}>
                    {staff.length === 0
                      ? 'در این محدوده عضوی ثبت نشده است.'
                      : 'در موارد دریافت‌شده نتیجه‌ای پیدا نشد؛ برای بررسی ادامه‌ی فهرست صفحه‌های بعدی را بارگذاری کنید.'}
                  </Surface>
                ) : (
                  <div className={styles.memberList}>
                    {filteredStaff.map((member) => (
                      <StaffMemberCard
                        actionsDisabled={actionsDisabled}
                        key={member.membershipId}
                        member={member}
                        onSensitiveAction={(label, action, requiresStepUp) =>
                          void requestSensitiveAction(label, action, requiresStepUp)
                        }
                        onSessionExpired={onSessionExpired}
                        permissions={permissions}
                        roles={roles}
                        scope={scope}
                      />
                    ))}
                  </div>
                )}
                {staffCursor && (
                  <Button
                    className={styles.loadMore}
                    disabled={Boolean(loadMoreBusy)}
                    onClick={() => void loadMore('staff')}
                    type="button"
                    tone="ghost"
                  >
                    {loadMoreBusy === 'staff' ? 'در حال دریافت…' : 'نمایش کارکنان بیشتر'}
                  </Button>
                )}
              </section>
            </div>
          ) : (
            <section
              className={styles.scopedInvitations}
              aria-labelledby="issued-invitations-heading"
            >
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>شماره‌ها به‌شکل پوشیده نمایش داده می‌شوند</p>
                  <h3 id="issued-invitations-heading">
                    دعوت‌های صادرشده · {invitations.length} مورد دریافت‌شده
                  </h3>
                </div>
              </div>
              {invitations.length === 0 ? (
                <Surface className={styles.emptyState}>
                  دعوتی برای این محدوده در دسترس نیست.
                </Surface>
              ) : (
                <div className={styles.memberList}>
                  {invitations.map((invitation) => (
                    <ScopedInvitationCard
                      actionsDisabled={actionsDisabled}
                      invitation={invitation}
                      key={invitation.id}
                      onRevoke={revokeInvitation}
                    />
                  ))}
                </div>
              )}
              {invitationsCursor && (
                <Button
                  className={styles.loadMore}
                  disabled={Boolean(loadMoreBusy)}
                  onClick={() => void loadMore('invitations')}
                  type="button"
                  tone="ghost"
                >
                  {loadMoreBusy === 'invitations' ? 'در حال دریافت…' : 'نمایش دعوت‌های بیشتر'}
                </Button>
              )}
            </section>
          )}
        </>
      )}

      {roleDialog && (
        <dialog
          aria-labelledby="staff-role-dialog-title"
          className={styles.roleDialog}
          onCancel={(event) => {
            if (actionsDisabled) event.preventDefault();
            else setRoleDialog(null);
          }}
          onClose={() => setRoleDialog(null)}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !actionsDisabled) setRoleDialog(null);
          }}
          ref={roleDialogRef}
        >
          <div className={styles.roleDialogBody}>
            <header className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>مدیریت نقش در محدوده‌ی فعال</p>
                <h3 id="staff-role-dialog-title">
                  {roleDialog === 'create'
                    ? 'افزودن نقش'
                    : roleDialog === 'edit'
                      ? 'ویرایش نقش'
                      : roleDialog === 'delete'
                        ? 'تأیید حذف نقش'
                        : 'بازیابی نقش'}
                </h3>
              </div>
              <button
                aria-label="بستن پنجره"
                className={styles.roleDialogClose}
                disabled={actionsDisabled}
                onClick={() => setRoleDialog(null)}
                type="button"
              >
                ×
              </button>
            </header>

            {(roleDialog === 'create' || roleDialog === 'edit') && (
              <form className={styles.roleForm} onSubmit={submitRole}>
                <label className={styles.field}>
                  نام نقش
                  <input
                    autoComplete="off"
                    disabled={actionsDisabled}
                    maxLength={80}
                    minLength={2}
                    onChange={(event) => setRoleName(event.currentTarget.value)}
                    required
                    value={roleName}
                  />
                </label>
                <p className={styles.roleScopeText}>
                  محدوده: {operationsRoleScopeLabel(roleTargetScope, scopeOptions)}
                </p>
                {roleDialog === 'edit' && (
                  <label className={styles.field}>
                    وضعیت
                    <select
                      disabled={actionsDisabled}
                      onChange={(event) =>
                        setRoleStatus(event.currentTarget.value as 'active' | 'disabled')
                      }
                      value={roleStatus}
                    >
                      <option value="active">فعال</option>
                      <option value="disabled">غیرفعال</option>
                    </select>
                  </label>
                )}
                <fieldset className={styles.rolePermissionFieldset}>
                  <legend>دسترسی‌های نقش</legend>
                  {rolePermissionOptions.length === 0 ? (
                    <p className={styles.warning}>
                      فهرست کاتالوگ مجوزها دریافت نشد یا برای این محدوده مجوزی موجود نیست.
                    </p>
                  ) : (
                    <div className={styles.rolePermissionList}>
                      {rolePermissionOptions.map((permission, index) => (
                        <label className={styles.rolePermission} key={permission.key}>
                          <input
                            checked={rolePermissionKeys.includes(permission.key)}
                            disabled={actionsDisabled}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setRolePermissionKeys((current) =>
                                checked
                                  ? [...current, permission.key]
                                  : current.filter((key) => key !== permission.key),
                              );
                            }}
                            type="checkbox"
                          />
                          <span>{operationsRolePermissionLabel(permission.key, index)}</span>
                          <small>
                            {permission.stepUp ? 'تغییر حساس' : 'عادی'}
                            {permission.delegable ? ' · قابل واگذاری' : ' · غیرقابل واگذاری'}
                          </small>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
                <label className={styles.field}>
                  دلیل تغییر (حداقل ۸ نویسه)
                  <textarea
                    disabled={actionsDisabled}
                    maxLength={500}
                    minLength={roleReasonRequired ? 8 : undefined}
                    onChange={(event) => setRoleReason(event.currentTarget.value)}
                    required={roleReasonRequired}
                    rows={3}
                    value={roleReason}
                  />
                </label>
                {actionError && (
                  <p className={styles.error} role="alert">
                    {actionError}
                  </p>
                )}
                <footer className={styles.roleDialogActions}>
                  <Button
                    disabled={actionsDisabled}
                    onClick={closeRoleDialog}
                    type="button"
                    tone="ghost"
                  >
                    انصراف
                  </Button>
                  <Button
                    disabled={actionsDisabled || rolePermissionOptions.length === 0}
                    type="submit"
                  >
                    {roleDialog === 'create' ? 'افزودن نقش' : 'ذخیره‌ی تغییرات'}
                  </Button>
                </footer>
              </form>
            )}

            {(roleDialog === 'delete' || roleDialog === 'restore') && roleTarget && (
              <form className={styles.roleForm} onSubmit={confirmRoleLifecycle}>
                <p className={styles.roleConfirmText}>
                  {roleDialog === 'delete'
                    ? `نقش «${roleTarget.name}» به‌صورت قابل‌بازیابی حذف و غیرفعال می‌شود. حذف در صورت داشتن عضو فعال یا دعوت معتبر انجام نمی‌شود.`
                    : `نقش «${roleTarget.name}» بازیابی می‌شود و برای اعطای دسترسی باید جداگانه فعال شود.`}
                </p>
                <label className={styles.field}>
                  دلیل {roleDialog === 'delete' ? 'حذف' : 'بازیابی'} (حداقل ۸ نویسه)
                  <textarea
                    autoFocus
                    disabled={actionsDisabled}
                    maxLength={500}
                    minLength={8}
                    onChange={(event) => setRoleReason(event.currentTarget.value)}
                    required
                    rows={3}
                    value={roleReason}
                  />
                </label>
                {actionError && (
                  <p className={styles.error} role="alert">
                    {actionError}
                  </p>
                )}
                <footer className={styles.roleDialogActions}>
                  <Button
                    disabled={actionsDisabled}
                    onClick={closeRoleDialog}
                    type="button"
                    tone="ghost"
                  >
                    انصراف
                  </Button>
                  <Button
                    disabled={actionsDisabled}
                    type="submit"
                    tone={roleDialog === 'delete' ? 'danger' : 'primary'}
                  >
                    {roleDialog === 'delete' ? 'تأیید حذف' : 'بازیابی نقش'}
                  </Button>
                </footer>
              </form>
            )}
          </div>
        </dialog>
      )}
    </section>
  );
}

function StaffRoleList({
  roles,
  rolesCursor,
  search,
  filterDraft,
  filterCount,
  actionsDisabled,
  loadMoreBusy,
  onSearchChange,
  onFilterDraftChange,
  onApplyFilters,
  onClearFilters,
  onCreate,
  onEdit,
  onDelete,
  onRestore,
  onLoadMore,
  scope,
  scopeOptions,
}: {
  roles: OperationsAccessRole[];
  rolesCursor: string | null;
  scope: OperationsScope;
  scopeOptions: OperationsScopeOption[];
  search: string;
  filterDraft: { lifecycle: RoleLifecycleFilter; kind: RoleKindFilter };
  filterCount: number;
  actionsDisabled: boolean;
  loadMoreBusy: boolean;
  onSearchChange: (value: string) => void;
  onFilterDraftChange: (value: { lifecycle: RoleLifecycleFilter; kind: RoleKindFilter }) => void;
  onApplyFilters: () => void;
  onClearFilters: () => void;
  onCreate: () => void;
  onEdit: (role: OperationsAccessRole) => void;
  onDelete: (role: OperationsAccessRole) => void;
  onRestore: (role: OperationsAccessRole) => void;
  onLoadMore: () => void;
}) {
  const roleGroups = groupOperationsRoles(roles, scope, scopeOptions);
  return (
    <OperationsManagementList
      appliedFilterCount={filterCount}
      description=""
      filterFields={
        <>
          <label className={styles.field}>
            وضعیت نقش
            <select
              onChange={(event) =>
                onFilterDraftChange({
                  ...filterDraft,
                  lifecycle: event.currentTarget.value as RoleLifecycleFilter,
                })
              }
              value={filterDraft.lifecycle}
            >
              <option value="all">همه‌ی نقش‌های جاری</option>
              <option value="active">فعال</option>
              <option value="disabled">غیرفعال</option>
              <option value="deleted">حذف‌شده‌ها</option>
            </select>
          </label>
          <label className={styles.field}>
            نوع نقش
            <select
              onChange={(event) =>
                onFilterDraftChange({
                  ...filterDraft,
                  kind: event.currentTarget.value as RoleKindFilter,
                })
              }
              value={filterDraft.kind}
            >
              <option value="all">همه</option>
              <option value="custom">سفارشی</option>
              <option value="system">سیستمی</option>
            </select>
          </label>
        </>
      }
      onApplyFilters={onApplyFilters}
      onClearFilters={onClearFilters}
      onSearchChange={onSearchChange}
      pagination={{
        hasMore: Boolean(rolesCursor),
        busy: loadMoreBusy,
        onLoadMore,
      }}
      searchLabel="جست‌وجوی نام نقش"
      searchPlaceholder="نام نقش را جست‌وجو کنید"
      searchValue={search}
      showHeading={false}
      title="نقش‌ها"
      toolbarActions={
        <Button disabled={actionsDisabled} onClick={onCreate} type="button">
          <RoleIcon kind="add" />
          افزودن نقش
        </Button>
      }
    >
      {roles.length === 0 ? (
        <Surface className={styles.roleEmpty}>
          {search || filterCount > 0
            ? 'با جست‌وجو و فیلترهای انتخاب‌شده نقشی پیدا نشد.'
            : 'در این محدوده هنوز نقشی ثبت نشده است.'}
        </Surface>
      ) : (
        <div className={styles.roleGroups}>
          {roleGroups.map((group) => (
            <section
              aria-label={group.heading ?? undefined}
              className={styles.roleGroup}
              key={group.key}
            >
              {group.heading && <h3 className={styles.roleGroupTitle}>{group.heading}</h3>}
              <div className={styles.roleList}>
                {group.roles.map((role) => (
                  <Surface className={styles.roleCard} key={role.id}>
                    <div className={styles.roleCardMain}>
                      <div className={styles.roleTitleLine}>
                        <h3>{role.name}</h3>
                        <Badge
                          tone={
                            role.deletedAt
                              ? 'danger'
                              : role.status === 'active'
                                ? 'success'
                                : 'neutral'
                          }
                        >
                          {role.deletedAt
                            ? 'حذف‌شده'
                            : role.status === 'active'
                              ? 'فعال'
                              : 'غیرفعال'}
                        </Badge>
                      </div>
                      <p className={styles.roleMeta}>
                        {role.systemManaged ? 'نقش سیستمی' : 'نقش سفارشی'} ·{' '}
                        {operationsRoleScopeLabel(role.scope, scopeOptions)} ·{' '}
                        {role.permissionKeys.length.toLocaleString('fa-IR')} مجوز
                      </p>
                    </div>
                    <div className={styles.roleActions} aria-label={`عملیات نقش ${role.name}`}>
                      <Link
                        aria-label={`جزئیات نقش ${role.name}`}
                        className={styles.roleIconButton}
                        href={`/staff/roles/${encodeURIComponent(role.id)}`}
                        title="جزئیات"
                      >
                        <RoleIcon kind="details" />
                      </Link>
                      {!role.systemManaged && !role.deletedAt && (
                        <>
                          <button
                            aria-label={`ویرایش نقش ${role.name}`}
                            className={styles.roleIconButton}
                            disabled={actionsDisabled}
                            onClick={() => onEdit(role)}
                            title="ویرایش"
                            type="button"
                          >
                            <RoleIcon kind="edit" />
                          </button>
                          <button
                            aria-label={`حذف نقش ${role.name}`}
                            className={`${styles.roleIconButton} ${styles.roleDangerAction}`}
                            disabled={actionsDisabled}
                            onClick={() => onDelete(role)}
                            title="حذف"
                            type="button"
                          >
                            <RoleIcon kind="delete" />
                          </button>
                        </>
                      )}
                      {!role.systemManaged && role.deletedAt && (
                        <button
                          aria-label={`بازیابی نقش ${role.name}`}
                          className={styles.roleIconButton}
                          disabled={actionsDisabled}
                          onClick={() => onRestore(role)}
                          title="بازیابی"
                          type="button"
                        >
                          <RoleIcon kind="restore" />
                        </button>
                      )}
                    </div>
                  </Surface>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </OperationsManagementList>
  );
}

function RoleIcon({ kind }: { kind: 'add' | 'details' | 'edit' | 'delete' | 'restore' }) {
  if (kind === 'add') {
    return (
      <svg aria-hidden="true" className={styles.roleIcon} viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (kind === 'details') {
    return (
      <svg aria-hidden="true" className={styles.roleIcon} viewBox="0 0 24 24">
        <path d="M2.8 12s3.3-6 9.2-6 9.2 6 9.2 6-3.3 6-9.2 6-9.2-6-9.2-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }
  if (kind === 'edit') {
    return (
      <svg aria-hidden="true" className={styles.roleIcon} viewBox="0 0 24 24">
        <path d="m4 16.8-.8 4 4-.8L19 8.2 15.8 5 4 16.8Z" />
        <path d="m13.8 7 3.2 3.2" />
      </svg>
    );
  }
  if (kind === 'delete') {
    return (
      <svg aria-hidden="true" className={styles.roleIcon} viewBox="0 0 24 24">
        <path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className={styles.roleIcon} viewBox="0 0 24 24">
      <path d="M4 11a8 8 0 1 1 2.3 5.7M4 5v6h6" />
      <path d="M12 8v4l2.5 1.5" />
    </svg>
  );
}

function sameRoleKeys(left: string[], right: string[]): boolean {
  const leftKeys = [...new Set(left)].sort();
  const rightKeys = [...new Set(right)].sort();
  return (
    leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index])
  );
}

function ScopedInvitationCard({
  invitation,
  actionsDisabled,
  onRevoke,
}: {
  invitation: OperationsStaffInvitation;
  actionsDisabled: boolean;
  onRevoke: (invitation: OperationsStaffInvitation, reason: string, key: string) => void;
}) {
  const [reason, setReason] = useState('');
  const retryKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const expired = invitation.isExpired || Date.parse(invitation.expiresAt) <= Date.now();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanReason = reason.trim();
    if (expired) return;
    const fingerprint = JSON.stringify({ invitationId: invitation.id, reason: cleanReason });
    if (retryKey.current?.fingerprint !== fingerprint) {
      retryKey.current = { fingerprint, key: freshIdempotencyKey() };
    }
    const key = retryKey.current.key;
    onRevoke(invitation, cleanReason, key);
  }

  return (
    <Surface className={styles.invitationCard}>
      <div className={styles.invitationHeading}>
        <div>
          <strong>{invitation.maskedPhone}</strong>
          <span>
            {invitation.role.name} · مقصد در سطح{' '}
            {invitation.scope.type === 'branch' ? 'شعبه' : 'مجموعه'}
          </span>
        </div>
        <span
          className={`${styles.statusBadge} ${expired || invitation.roleChanged ? styles.status_suspended : styles.status_pending}`}
        >
          {expired ? 'منقضی‌شده' : invitation.roleChanged ? 'نیازمند دعوت تازه' : 'در انتظار پذیرش'}
        </span>
      </div>
      <time dateTime={invitation.expiresAt}>
        اعتبار تا {new Date(invitation.expiresAt).toLocaleString('fa-IR')}
      </time>
      {invitation.roleChanged && (
        <p className={styles.warning}>نقش پس از صدور تغییر کرده است؛ این دعوت قابل پذیرش نیست.</p>
      )}
      {!expired && (
        <details className={styles.revokeInvitation}>
          <summary>لغو دعوت</summary>
          <form className={styles.inlineForm} onSubmit={submit}>
            <label className={styles.field}>
              دلیل لغو
              <textarea
                disabled={actionsDisabled}
                maxLength={500}
                onChange={(event) => setReason(event.currentTarget.value)}
                rows={2}
                value={reason}
              />
            </label>
            <Button disabled={actionsDisabled} tone="danger" type="submit">
              لغو دعوت‌نامه
            </Button>
          </form>
        </details>
      )}
    </Surface>
  );
}

function mergeById<T>(existing: T[], incoming: T[], idOf: (item: T) => string): T[] {
  const items = new Map(existing.map((item) => [idOf(item), item]));
  for (const item of incoming) items.set(idOf(item), item);
  return [...items.values()];
}

function safeMemberName(member: OperationsStaffMember): string {
  const identityName =
    member.identity?.displayName?.trim() ||
    [member.identity?.firstName, member.identity?.lastName].filter(Boolean).join(' ').trim();
  return identityName || member.maskedPhone || 'کارمند · شماره پنهان';
}

function messageFor(failure: unknown): string {
  if (failure instanceof ApiRequestError) return failure.message;
  if (failure instanceof Error && failure.message) return failure.message;
  return 'ارتباط با سرویس مدیریت کارکنان برقرار نشد.';
}
