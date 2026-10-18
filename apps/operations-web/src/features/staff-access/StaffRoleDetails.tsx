'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import { scopeKey } from '../../lib/auth/operations-access';
import {
  getOperationsRole,
  listOperationsPermissions,
  listOperationsStaff,
  type OperationsAccessRole,
  type OperationsPermission,
  type OperationsStaffMember,
} from '../../lib/api/operations-staff';
import { useOperationsWorkspace } from '../branch-scope/OperationsWorkspaceContext';
import { operationsRolePermissionLabel, operationsRoleScopeLabel } from './role-display';
import styles from './StaffRoleDetails.module.css';

export function StaffRoleDetails({ roleId }: { roleId: string }) {
  const { activeScope, scopeOptions, onSessionExpired } = useOperationsWorkspace();
  const scope = activeScope.scope;
  const queryKey = JSON.stringify([scopeKey(scope), roleId]);
  const activeQueryKey = useRef(queryKey);
  const requestSequence = useRef(0);
  const membersRequestSequence = useRef(0);
  activeQueryKey.current = queryKey;
  const [role, setRole] = useState<OperationsAccessRole | null>(null);
  const [members, setMembers] = useState<OperationsStaffMember[]>([]);
  const [membersCursor, setMembersCursor] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<OperationsPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedQueryKey, setLoadedQueryKey] = useState('');
  const [membersLoading, setMembersLoading] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [membersError, setMembersError] = useState('');
  const [membersForbidden, setMembersForbidden] = useState(false);

  const load = useCallback(async () => {
    const requestKey = queryKey;
    const sequence = ++requestSequence.current;
    const isCurrentRequest = () =>
      requestSequence.current === sequence && activeQueryKey.current === requestKey;
    setLoading(true);
    setRoleError('');
    setMembersError('');
    setMembersForbidden(false);
    const roleScopeView = scope.type === 'organization' ? 'organizationTree' : 'exact';
    const [roleResult, permissionsResult] = await Promise.allSettled([
      getOperationsRole(scope, roleId, roleScopeView),
      listOperationsPermissions(),
    ]);
    let membersResult: PromiseSettledResult<
      Awaited<ReturnType<typeof listOperationsStaff>>
    > | null = null;
    if (roleResult.status === 'fulfilled') {
      const [result] = await Promise.allSettled([
        listOperationsStaff(roleResult.value.scope, undefined, roleId),
      ]);
      membersResult = result;
    }
    if (!isCurrentRequest()) return;
    if (roleResult.status === 'fulfilled') {
      setRole(roleResult.value);
    } else {
      if (roleResult.reason instanceof ApiRequestError && roleResult.reason.status === 401) {
        onSessionExpired();
      }
      setRole(null);
      setRoleError(messageFor(roleResult.reason));
    }
    if (membersResult?.status === 'fulfilled') {
      setMembers(membersResult.value.data);
      setMembersCursor(membersResult.value.nextCursor);
    } else if (membersResult?.status === 'rejected') {
      setMembersForbidden(
        membersResult.reason instanceof ApiRequestError && membersResult.reason.status === 403,
      );
      if (membersResult.reason instanceof ApiRequestError && membersResult.reason.status === 401) {
        onSessionExpired();
      }
      setMembers([]);
      setMembersCursor(null);
      setMembersError(messageFor(membersResult.reason));
    } else {
      setMembers([]);
      setMembersCursor(null);
    }
    if (permissionsResult.status === 'fulfilled') setPermissions(permissionsResult.value);
    setLoadedQueryKey(requestKey);
    setLoading(false);
  }, [onSessionExpired, queryKey, roleId, scope]);

  useEffect(() => {
    setRole(null);
    setMembers([]);
    setMembersCursor(null);
    setPermissions([]);
    setLoadedQueryKey('');
    void load();
    return () => {
      requestSequence.current += 1;
      membersRequestSequence.current += 1;
    };
  }, [load]);

  async function loadMoreMembers() {
    if (!membersCursor || membersLoading) return;
    const requestKey = queryKey;
    const sequence = ++membersRequestSequence.current;
    setMembersLoading(true);
    setMembersError('');
    setMembersForbidden(false);
    try {
      const page = await listOperationsStaff(role?.scope ?? scope, membersCursor, roleId);
      if (activeQueryKey.current !== requestKey || membersRequestSequence.current !== sequence)
        return;
      setMembers((current) => mergeById(current, page.data));
      setMembersCursor(page.nextCursor);
    } catch (failure) {
      if (activeQueryKey.current !== requestKey || membersRequestSequence.current !== sequence)
        return;
      setMembersForbidden(failure instanceof ApiRequestError && failure.status === 403);
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      setMembersError(messageFor(failure));
    } finally {
      if (activeQueryKey.current === requestKey && membersRequestSequence.current === sequence) {
        setMembersLoading(false);
      }
    }
  }

  if (loadedQueryKey !== queryKey || (loading && !role)) {
    return (
      <Surface className={styles.state} role="status" aria-live="polite">
        در حال دریافت جزئیات نقش…
      </Surface>
    );
  }

  if (!role) {
    return (
      <Surface className={styles.state}>
        <p className={styles.error} role="alert">
          {roleError || 'جزئیات این نقش در دسترس نیست.'}
        </p>
        <div className={styles.actions}>
          <Button onClick={() => void load()} type="button" tone="ghost">
            تلاش دوباره
          </Button>
          <Link className={styles.backLink} href="/staff/roles">
            بازگشت به نقش‌ها
          </Link>
        </div>
      </Surface>
    );
  }

  const permissionByKey = new Map(permissions.map((permission) => [permission.key, permission]));
  return (
    <section className={styles.page} aria-labelledby="staff-role-details-title">
      <div className={styles.topLine}>
        <Link className={styles.backLink} href="/staff/roles">
          ← بازگشت به نقش‌ها
        </Link>
        <Badge tone={role.deletedAt ? 'danger' : role.status === 'active' ? 'success' : 'neutral'}>
          {role.deletedAt ? 'حذف‌شده' : role.status === 'active' ? 'فعال' : 'غیرفعال'}
        </Badge>
      </div>

      <Surface className={styles.summary}>
        <p className={styles.eyebrow}>نمای کامل نقش</p>
        <h2 id="staff-role-details-title">{role.name}</h2>
        <dl className={styles.facts}>
          <div>
            <dt>محدوده</dt>
            <dd>{operationsRoleScopeLabel(role.scope, scopeOptions)}</dd>
          </div>
          <div>
            <dt>نوع نقش</dt>
            <dd>{role.systemManaged ? 'سیستمی' : 'سفارشی'}</dd>
          </div>
          <div>
            <dt>وضعیت</dt>
            <dd>
              {role.deletedAt
                ? 'حذف‌شده و قابل‌بازیابی'
                : role.status === 'active'
                  ? 'فعال'
                  : 'غیرفعال'}
            </dd>
          </div>
          <div>
            <dt>نسخه</dt>
            <dd>{role.version.toLocaleString('fa-IR')}</dd>
          </div>
        </dl>
      </Surface>

      <div className={styles.columns}>
        <Surface className={styles.panel} aria-labelledby="role-permissions-heading">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>دسترسی‌های واگذارشده</p>
              <h3 id="role-permissions-heading">مجوزهای این نقش</h3>
            </div>
            <Badge tone="neutral">{role.permissionKeys.length.toLocaleString('fa-IR')}</Badge>
          </div>
          {role.permissionKeys.length === 0 ? (
            <p className={styles.empty}>برای این نقش مجوزی ثبت نشده است.</p>
          ) : (
            <ul className={styles.permissionList}>
              {role.permissionKeys.map((key, index) => {
                const definition = permissionByKey.get(key);
                return (
                  <li className={styles.permission} key={key}>
                    <strong>{operationsRolePermissionLabel(key, index)}</strong>
                    <span>
                      {definition
                        ? `محدوده‌های مجاز: ${definition.scopes.map(scopeName).join('، ')}${definition.delegable ? ' · قابل واگذاری' : ''}${definition.stepUp ? ' · نیازمند تأیید دوباره' : ''}`
                        : 'جزئیات کاتالوگ این مجوز دریافت نشد.'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Surface>

        <Surface className={styles.panel} aria-labelledby="role-members-heading">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>عضویت‌های IAM</p>
              <h3 id="role-members-heading">اعضای دارای این نقش</h3>
            </div>
            <Badge tone="neutral">{members.length.toLocaleString('fa-IR')} دریافت‌شده</Badge>
          </div>
          {membersError ? (
            <div className={styles.errorBlock}>
              <p className={styles.error} role="alert">
                {membersError}
                {membersForbidden ? ' برای مشاهده‌ی اعضا مجوز staff.read لازم است.' : ''}
              </p>
              <Button
                disabled={membersLoading}
                onClick={() => void load()}
                type="button"
                tone="ghost"
              >
                تلاش دوباره
              </Button>
            </div>
          ) : members.length === 0 ? (
            <p className={styles.empty}>عضوی با این نقش پیدا نشد.</p>
          ) : (
            <ul className={styles.memberList}>
              {members.map((member) => (
                <li className={styles.member} key={member.membershipId}>
                  <div>
                    <strong>{memberDisplayName(member)}</strong>
                    <span>
                      {member.maskedPhone || 'شماره‌ی پوشیده در دسترس نیست'} ·{' '}
                      {operationsRoleScopeLabel(member.scope, scopeOptions)}
                    </span>
                  </div>
                  <Badge
                    tone={
                      member.status === 'active'
                        ? 'success'
                        : member.status === 'revoked'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {memberStatus(member.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {membersCursor && !membersError && (
            <Button
              disabled={membersLoading}
              onClick={() => void loadMoreMembers()}
              type="button"
              tone="ghost"
            >
              {membersLoading ? 'در حال دریافت…' : 'نمایش اعضای بیشتر'}
            </Button>
          )}
        </Surface>
      </div>
    </section>
  );
}

function mergeById<T extends { membershipId: string }>(current: T[], next: T[]) {
  const merged = new Map(current.map((item) => [item.membershipId, item]));
  for (const item of next) merged.set(item.membershipId, item);
  return [...merged.values()];
}

function memberDisplayName(member: OperationsStaffMember): string {
  return (
    member.identity?.displayName?.trim() ||
    [member.identity?.firstName, member.identity?.lastName].filter(Boolean).join(' ').trim() ||
    'عضو بدون نام نمایشی'
  );
}

function scopeName(scope: 'global' | 'organization' | 'branch'): string {
  return scope === 'global' ? 'سراسری' : scope === 'organization' ? 'مجموعه' : 'شعبه';
}

function memberStatus(status: OperationsStaffMember['status']): string {
  return status === 'active'
    ? 'فعال'
    : status === 'pending'
      ? 'در انتظار'
      : status === 'suspended'
        ? 'معلق'
        : 'لغوشده';
}

function messageFor(failure: unknown): string {
  if (failure instanceof ApiRequestError && failure.status === 403) {
    return 'دسترسی لازم برای مشاهده‌ی این بخش در محدوده‌ی فعال را ندارید.';
  }
  return failure instanceof Error ? failure.message : 'دریافت اطلاعات با خطا روبه‌رو شد.';
}
