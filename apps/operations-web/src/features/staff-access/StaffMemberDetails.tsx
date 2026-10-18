'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  getOperationsStaffMember,
  listOperationsPermissions,
  listOperationsStaff,
  listStaffPermissionOverrides,
  type OperationsAccessRole,
  type OperationsPermission,
  type OperationsStaffMember,
  type PermissionOverride,
} from '../../lib/api/operations-staff';
import { scopeKey } from '../../lib/auth/operations-access';
import { useOperationsWorkspace } from '../branch-scope/OperationsWorkspaceContext';
import { operationsRolePermissionLabel, operationsRoleScopeLabel } from './role-display';
import {
  operationsStaffMemberName,
  operationsStaffScopeLabel,
  operationsStaffStatusLabel,
  operationsStaffStatusTone,
} from './staff-member-display';
import styles from './StaffMemberDetails.module.css';

export function StaffMemberDetails({ membershipId }: { membershipId: string }) {
  const { activeScope, scopeOptions, onSessionExpired } = useOperationsWorkspace();
  const scope = activeScope.scope;
  const staffScopeView = scope.type === 'organization' ? 'organizationTree' : 'exact';
  const requestKey = JSON.stringify([scopeKey(scope), membershipId, staffScopeView]);
  const activeRequestKey = useRef(requestKey);
  const requestSequence = useRef(0);
  const peersSequence = useRef(0);
  activeRequestKey.current = requestKey;
  const [member, setMember] = useState<OperationsStaffMember | null>(null);
  const [peers, setPeers] = useState<OperationsStaffMember[]>([]);
  const [peersCursor, setPeersCursor] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<OperationsPermission[]>([]);
  const [overrides, setOverrides] = useState<PermissionOverride[]>([]);
  const [overridesForbidden, setOverridesForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [peersLoading, setPeersLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');
  const [loadError, setLoadError] = useState('');
  const [peersError, setPeersError] = useState('');
  const [peersForbidden, setPeersForbidden] = useState(false);

  const load = useCallback(async () => {
    const expectedKey = requestKey;
    const sequence = ++requestSequence.current;
    const isCurrent = () =>
      requestSequence.current === sequence && activeRequestKey.current === expectedKey;
    setLoading(true);
    setLoadError('');
    setPeersError('');
    setPeersForbidden(false);
    setOverridesForbidden(false);
    const [memberResult, permissionsResult, overridesResult] = await Promise.allSettled([
      getOperationsStaffMember(scope, membershipId, staffScopeView),
      listOperationsPermissions(),
      listStaffPermissionOverrides(membershipId),
    ]);
    let peersResult: PromiseSettledResult<Awaited<ReturnType<typeof listOperationsStaff>>> | null = null;
    if (memberResult.status === 'fulfilled') {
      [peersResult] = await Promise.allSettled([
        listOperationsStaff(scope, undefined, memberResult.value.role.id, { staffScopeView }),
      ]);
    }
    if (!isCurrent()) return;

    if (memberResult.status === 'fulfilled') {
      setMember(memberResult.value);
    } else {
      if (memberResult.reason instanceof ApiRequestError && memberResult.reason.status === 401) {
        onSessionExpired();
      }
      setMember(null);
      setLoadError(errorMessage(memberResult.reason));
    }
    if (permissionsResult.status === 'fulfilled') setPermissions(permissionsResult.value);
    else setPermissions([]);
    if (overridesResult.status === 'fulfilled') setOverrides(overridesResult.value.data);
    else {
      setOverrides([]);
      setOverridesForbidden(
        overridesResult.reason instanceof ApiRequestError && overridesResult.reason.status === 403,
      );
      if (overridesResult.reason instanceof ApiRequestError && overridesResult.reason.status === 401) {
        onSessionExpired();
      }
    }
    if (peersResult?.status === 'fulfilled') {
      setPeers(peersResult.value.data);
      setPeersCursor(peersResult.value.nextCursor);
    } else if (peersResult?.status === 'rejected') {
      if (peersResult.reason instanceof ApiRequestError && peersResult.reason.status === 401) {
        onSessionExpired();
      }
      setPeersForbidden(peersResult.reason instanceof ApiRequestError && peersResult.reason.status === 403);
      setPeersError(errorMessage(peersResult.reason));
      setPeers([]);
      setPeersCursor(null);
    } else {
      setPeers([]);
      setPeersCursor(null);
    }
    setLoadedKey(expectedKey);
    setLoading(false);
  }, [membershipId, onSessionExpired, requestKey, scope, staffScopeView]);

  useEffect(() => {
    setMember(null);
    setPeers([]);
    setPeersCursor(null);
    setPermissions([]);
    setOverrides([]);
    setLoadedKey('');
    void load();
    return () => {
      requestSequence.current += 1;
      peersSequence.current += 1;
    };
  }, [load]);

  async function loadMorePeers() {
    if (!member || !peersCursor || peersLoading) return;
    const expectedKey = requestKey;
    const sequence = ++peersSequence.current;
    setPeersLoading(true);
    setPeersError('');
    setPeersForbidden(false);
    try {
      const page = await listOperationsStaff(scope, peersCursor, member.role.id, { staffScopeView });
      if (activeRequestKey.current !== expectedKey || peersSequence.current !== sequence) return;
      setPeers((current) => mergeById(current, page.data));
      setPeersCursor(page.nextCursor);
    } catch (failure) {
      if (activeRequestKey.current !== expectedKey || peersSequence.current !== sequence) return;
      setPeersForbidden(failure instanceof ApiRequestError && failure.status === 403);
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      setPeersError(errorMessage(failure));
    } finally {
      if (activeRequestKey.current === expectedKey && peersSequence.current === sequence) {
        setPeersLoading(false);
      }
    }
  }

  if (loadedKey !== requestKey || (loading && !member)) {
    return <Surface className={styles.state} role="status" aria-live="polite">در حال دریافت پرونده‌ی عضو…</Surface>;
  }

  if (!member) {
    return (
      <Surface className={styles.state}>
        <p className={styles.error} role="alert">
          {loadError || 'این عضو در محدوده‌ی فعلی پیدا نشد یا مجوز مشاهده ندارید.'}
        </p>
        <div className={styles.actions}>
          <Button onClick={() => void load()} type="button" tone="ghost">تلاش دوباره</Button>
          <Link className={styles.backLink} href="/staff">بازگشت به اعضا</Link>
        </div>
      </Surface>
    );
  }

  const name = operationsStaffMemberName(member);
  const permissionByKey = new Map(permissions.map((permission) => [permission.key, permission]));
  const role = member.role as OperationsAccessRole;
  return (
    <section className={styles.page} aria-labelledby="staff-member-360-title">
      <h1 className={styles.visuallyHidden} id="staff-member-360-title">پرونده‌ی عضو</h1>
      <div className={styles.topLine}>
        <Link className={styles.backLink} href="/staff">بازگشت به اعضا</Link>
        <Badge tone={operationsStaffStatusTone(member.status)}>{operationsStaffStatusLabel(member.status)}</Badge>
      </div>

      <Surface className={styles.summary}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">{initials(name)}</span>
          <div className={styles.identityText}>
            <p className={styles.eyebrow}>پرونده‌ی عضویت</p>
            <h2>{name}</h2>
            <p>{role.name.trim() || 'نقش بدون نام نمایشی'}</p>
          </div>
        </div>
        <dl className={styles.facts}>
          <Fact label="محدوده‌ی عضویت" value={operationsStaffScopeLabel(member.scope, scopeOptions)} />
          <Fact label="شماره‌ی ثبت‌شده" value={member.maskedPhone || member.invitation?.maskedPhone || 'شماره‌ی پوشیده در دسترس نیست'} />
          <Fact label="نقش در این محدوده" value={operationsRoleScopeLabel(role.scope, scopeOptions)} />
          <Fact label="آخرین به‌روزرسانی" value={dateTimeLabel(member.updatedAt)} />
        </dl>
      </Surface>

      <div className={styles.columns}>
        <Surface className={styles.panel} aria-labelledby="member-lifecycle-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>چرخه‌ی عضویت</p>
              <h2 id="member-lifecycle-title">وضعیت و زمان‌بندی</h2>
            </div>
            <Badge tone={operationsStaffStatusTone(member.status)}>{operationsStaffStatusLabel(member.status)}</Badge>
          </div>
          <dl className={styles.detailsGrid}>
            <Fact label="زمان ایجاد عضویت" value={dateTimeLabel(member.createdAt)} />
            <Fact label="وضعیت دعوت" value={invitationStatus(member)} />
            <Fact label="زمان ارسال دعوت" value={member.invitation ? dateTimeLabel(member.invitation.createdAt) : 'برای این عضویت دعوتی ثبت نشده'} />
            <Fact label="مهلت پذیرش" value={member.invitation ? dateTimeLabel(member.invitation.expiresAt) : 'ثبت نشده'} />
            <Fact label="پذیرفته‌شده در" value={member.invitation?.acceptedAt ? dateTimeLabel(member.invitation.acceptedAt) : 'هنوز پذیرفته نشده'} />
            <Fact label="لغوشده در" value={member.invitation?.revokedAt ? dateTimeLabel(member.invitation.revokedAt) : 'لغو نشده'} />
          </dl>
        </Surface>

        <Surface className={styles.panel} aria-labelledby="member-role-permissions-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>دسترسی‌های نقش</p>
              <h2 id="member-role-permissions-title">مجوزهای واگذارشده</h2>
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

        <Surface className={styles.panel} aria-labelledby="member-overrides-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>مجوزهای استثنایی</p>
              <h2 id="member-overrides-title">تغییرهای مستقیم دسترسی</h2>
            </div>
            {!overridesForbidden && <Badge tone="neutral">{overrides.length.toLocaleString('fa-IR')}</Badge>}
          </div>
          {overridesForbidden ? (
            <p className={styles.empty}>برای مشاهده‌ی تغییرهای مستقیم دسترسی، مجوز access.role.read لازم است.</p>
          ) : overrides.length === 0 ? (
            <p className={styles.empty}>برای این عضو مجوز استثنایی فعالی ثبت نشده است.</p>
          ) : (
            <ul className={styles.overrideList}>
              {overrides.map((override) => (
                <li className={styles.override} key={override.id}>
                  <div>
                    <strong>{operationsRolePermissionLabel(override.permissionKey, 0)}</strong>
                    <span>{override.effect === 'allow' ? 'افزوده‌شده' : 'محدودشده'} · {operationsRoleScopeLabel(override.scope, scopeOptions)}</span>
                  </div>
                  <div className={styles.overrideMeta}>
                    <span>{override.revokedAt ? `لغوشده در ${dateTimeLabel(override.revokedAt)}` : 'فعال'}</span>
                    <span>{override.expiresAt ? `پایان اعتبار ${dateTimeLabel(override.expiresAt)}` : 'بدون تاریخ پایان'}</span>
                    {override.resource?.type && <span>منبع: {override.resource.type}</span>}
                    {override.reason && <span>دلیل: {override.reason}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Surface>

        <Surface className={styles.panel} aria-labelledby="member-peers-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>توزیع نقش</p>
              <h2 id="member-peers-title">اعضای دارای همین نقش</h2>
            </div>
            <Badge tone="neutral">{peers.length.toLocaleString('fa-IR')} دریافت‌شده</Badge>
          </div>
          {peersError ? (
            <div className={styles.errorBlock}>
              <p className={styles.error} role="alert">
                {peersForbidden ? 'برای مشاهده‌ی همکاران، مجوز staff.read لازم است.' : peersError}
              </p>
              <Button disabled={peersLoading} onClick={() => void load()} type="button" tone="ghost">تلاش دوباره</Button>
            </div>
          ) : peers.length === 0 ? (
            <p className={styles.empty}>عضو دیگری با این نقش پیدا نشد.</p>
          ) : (
            <ul className={styles.peerList}>
              {peers.map((peer) => (
                <li className={styles.peer} key={peer.membershipId}>
                  <Link href={`/staff/members/${encodeURIComponent(peer.membershipId)}`}>
                    <strong>{operationsStaffMemberName(peer)}</strong>
                    <span>{peer.role.name.trim() || 'نقش بدون نام نمایشی'} · {operationsStaffScopeLabel(peer.scope, scopeOptions)}</span>
                  </Link>
                  <Badge tone={operationsStaffStatusTone(peer.status)}>{operationsStaffStatusLabel(peer.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
          {peersCursor && !peersError && (
            <Button disabled={peersLoading} onClick={() => void loadMorePeers()} type="button" tone="ghost">
              {peersLoading ? 'در حال دریافت…' : 'نمایش اعضای بیشتر'}
            </Button>
          )}
        </Surface>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function invitationStatus(member: OperationsStaffMember): string {
  const invitation = member.invitation;
  if (!invitation) return 'دعوتی ثبت نشده';
  if (invitation.status === 'pending' && Date.parse(invitation.expiresAt) <= Date.now()) return 'مهلت دعوت پایان‌یافته';
  if (invitation.status === 'pending') return 'در انتظار پذیرش';
  if (invitation.status === 'accepted') return 'پذیرفته‌شده';
  if (invitation.status === 'expired') return 'منقضی‌شده';
  return 'لغوشده';
}

function dateTimeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'ثبت نشده' : date.toLocaleString('fa-IR');
}

function scopeName(scope: 'global' | 'organization' | 'branch'): string {
  if (scope === 'global') return 'سراسری';
  return scope === 'organization' ? 'مجموعه' : 'شعبه';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : parts[0]?.slice(0, 2) ?? 'ع').toLocaleUpperCase('fa-IR');
}

function mergeById<T extends { membershipId: string }>(current: T[], next: T[]) {
  const merged = new Map(current.map((item) => [item.membershipId, item]));
  for (const item of next) merged.set(item.membershipId, item);
  return [...merged.values()];
}

function errorMessage(failure: unknown): string {
  if (failure instanceof ApiRequestError && failure.status === 403) {
    return 'مجوز staff.read برای مشاهده‌ی این عضو در محدوده‌ی فعلی لازم است.';
  }
  if (failure instanceof ApiRequestError && failure.status === 404) {
    return 'این عضو در محدوده‌ی فعلی پیدا نشد.';
  }
  return failure instanceof Error ? failure.message : 'دریافت اطلاعات عضو با خطا روبه‌رو شد.';
}
