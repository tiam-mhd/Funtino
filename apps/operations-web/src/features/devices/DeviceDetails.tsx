'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import { scopeKey } from '../../lib/auth/operations-access';
import {
  listOperationsDeviceBranches,
  listOperationsDevices,
  type OperationsDevice,
} from '../../lib/api/operations-devices';
import { useOperationsWorkspace } from '../branch-scope/OperationsWorkspaceContext';
import styles from './DeviceDetails.module.css';

const healthLabels: Record<OperationsDevice['healthState'], string> = {
  unknown: 'بدون مشاهده‌ی معتبر',
  online: 'آنلاین',
  degraded: 'دارای اختلال',
  stale: 'داده‌ی کهنه',
  offline: 'آفلاین',
};

const lifecycleLabels: Record<OperationsDevice['status'], string> = {
  active: 'فعال',
  suspended: 'تعلیق‌شده',
  retired: 'بازنشسته',
};

const typeLabels: Record<OperationsDevice['deviceType'], string> = {
  rfid_reader: 'کارت‌خوان RFID',
  terminal: 'پایانه',
  access_gate: 'گیت دسترسی',
  other: 'سایر دستگاه‌ها',
};

export function DeviceDetails({ deviceId }: { deviceId: string }) {
  const { activeScope, onSessionExpired } = useOperationsWorkspace();
  const scope = activeScope.scope;
  const requestKey = JSON.stringify([scopeKey(scope), deviceId]);
  const activeRequestKey = useRef(requestKey);
  const requestSequence = useRef(0);
  const [device, setDevice] = useState<OperationsDevice | null>(null);
  const [branchName, setBranchName] = useState('نام شعبه در دسترس نیست');
  const [loading, setLoading] = useState(true);
  const [loadedRequestKey, setLoadedRequestKey] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  activeRequestKey.current = requestKey;

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const isCurrent = () =>
      requestSequence.current === sequence && activeRequestKey.current === requestKey;
    setDevice(null);
    setBranchName(
      scope.type === 'branch'
        ? activeScope.branch?.name.trim() || 'شعبه بدون نام نمایشی'
        : 'نام شعبه در دسترس نیست',
    );
    setError('');
    setLoading(true);
    setLoadedRequestKey('');

    async function load() {
      try {
        let cursor: string | undefined;
        let found: OperationsDevice | undefined;
        let canReadBranches = false;
        do {
          const page = await listOperationsDevices(scope, cursor);
          canReadBranches = page.capabilities.canReadBranches;
          found = page.data.find((item) => item.id === deviceId);
          if (found || !page.nextCursor) break;
          cursor = page.nextCursor;
        } while (isCurrent());

        if (!isCurrent()) return;
        if (!found) {
          setError('این دستگاه در محدوده‌ی فعال در دسترس نیست یا دیگر ثبت نشده است.');
          setLoadedRequestKey(requestKey);
          setLoading(false);
          return;
        }
        setDevice(found);
        setLoadedRequestKey(requestKey);

        if (scope.type === 'organization' && canReadBranches) {
          try {
            let branchCursor: string | undefined;
            let resolvedBranchName = '';
            do {
              const branchPage = await listOperationsDeviceBranches(
                scope.organizationId,
                branchCursor,
              );
              const branch = branchPage.data.find((item) => item.id === found?.branchId);
              if (branch) {
                resolvedBranchName = branch.name.trim();
                break;
              }
              branchCursor = branchPage.nextCursor ?? undefined;
            } while (branchCursor && isCurrent());
            if (isCurrent() && resolvedBranchName) setBranchName(resolvedBranchName);
          } catch (failure) {
            if (failure instanceof ApiRequestError && failure.status === 401) {
              onSessionExpired();
              return;
            }
          }
        }
      } catch (failure) {
        if (!isCurrent()) return;
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        setError(messageFor(failure));
        setLoadedRequestKey(requestKey);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }

    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [activeScope.branch?.name, deviceId, onSessionExpired, requestKey, retry, scope, activeScope]);

  if (loading || loadedRequestKey !== requestKey) {
    return (
      <Surface className={styles.state} role="status" aria-live="polite">
        <span className={styles.spinner} aria-hidden="true" />
        در حال دریافت جزئیات دستگاه از فهرست مجاز این محدوده…
      </Surface>
    );
  }

  if (!device) {
    return (
      <Surface className={styles.state}>
        <p className={styles.error} role="alert">
          {error || 'جزئیات دستگاه در دسترس نیست.'}
        </p>
        <div className={styles.actions}>
          <Button type="button" tone="ghost" onClick={() => setRetry((current) => current + 1)}>
            تلاش دوباره
          </Button>
          <Link className={styles.backLink} href="/devices">
            بازگشت به دستگاه‌ها
          </Link>
        </div>
      </Surface>
    );
  }

  const displayName = device.displayName.trim() || 'دستگاه بدون نام نمایشی';
  const reportedState = device.latestReportedState
    ? healthLabels[device.latestReportedState]
    : 'بدون گزارش معتبر';
  const scopeName = activeScope.organization.name.trim() || 'مجموعه بدون نام نمایشی';

  return (
    <section className={styles.page} aria-labelledby="device-details-title">
      <Link className={styles.backLink} href="/devices">
        بازگشت به فهرست دستگاه‌ها
      </Link>
      <Surface className={styles.summary}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>نمای کامل دستگاه در محدوده‌ی فعال</p>
            <h2 id="device-details-title">{displayName}</h2>
            <p>
              {typeLabels[device.deviceType]} · {branchName}
            </p>
          </div>
          <div className={styles.badges}>
            <Badge tone={healthTone(device.healthState)}>{healthLabels[device.healthState]}</Badge>
            <Badge
              tone={
                device.status === 'active'
                  ? 'success'
                  : device.status === 'suspended'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {lifecycleLabels[device.status]}
            </Badge>
          </div>
        </div>
        {device.healthState === 'unknown' && (
          <p className={styles.note}>
            هنوز مشاهده‌ی معتبر از این دستگاه دریافت نشده؛ وضعیت آنلاین برای آن فرض نمی‌شود.
          </p>
        )}
        {error && (
          <p className={styles.note} role="status">
            {error}
          </p>
        )}
      </Surface>

      <div className={styles.grid}>
        <Surface className={styles.panel}>
          <h3>مشخصات و محدوده</h3>
          <dl className={styles.details}>
            <Detail label="نام دستگاه" value={displayName} />
            <Detail label="نوع دستگاه" value={typeLabels[device.deviceType]} />
            <Detail label="مجموعه" value={scopeName} />
            <Detail label="شعبه" value={branchName} />
            <Detail label="چرخه‌عمر" value={lifecycleLabels[device.status]} />
            <Detail label="نسخه‌ی تغییرات" value={formatNumber(device.version)} />
          </dl>
        </Surface>

        <Surface className={styles.panel}>
          <h3>سلامت و تازگی داده</h3>
          <dl className={styles.details}>
            <Detail label="سلامت محاسبه‌شده" value={healthLabels[device.healthState]} />
            <Detail label="آخرین وضعیت گزارش‌شده" value={reportedState} />
            <Detail
              label="آخرین مشاهده‌ی معتبر"
              value={
                device.latestObservedAt
                  ? formatDate(device.latestObservedAt)
                  : 'هنوز مشاهده‌ی معتبری ثبت نشده'
              }
            />
            <Detail
              label="تازگی مشاهده"
              value={
                device.freshnessSeconds === null ? 'نامشخص' : formatAge(device.freshnessSeconds)
              }
            />
          </dl>
          {['degraded', 'stale', 'offline'].includes(device.healthState) && (
            <p className={styles.note}>
              این وضعیت از گزارش معتبر و آستانه‌ی تازگی داده محاسبه شده است. سلامت دستی در پنل قابل
              تنظیم نیست.
            </p>
          )}
        </Surface>

        <Surface className={styles.panel}>
          <h3>زمان‌های ثبت</h3>
          <dl className={styles.details}>
            <Detail label="زمان ایجاد" value={formatDate(device.createdAt)} />
            <Detail label="آخرین به‌روزرسانی" value={formatDate(device.updatedAt)} />
          </dl>
          <p className={styles.helper}>
            این نما جزئیات جاری‌ای را نشان می‌دهد که API مجاز دستگاه ارائه می‌کند؛ تاریخچه‌ی رخدادها
            در این قرارداد موجود نیست.
          </p>
        </Surface>
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function healthTone(state: OperationsDevice['healthState']) {
  if (state === 'online') return 'success';
  if (state === 'degraded' || state === 'stale') return 'warning';
  if (state === 'offline') return 'danger';
  return 'neutral';
}

function messageFor(failure: unknown) {
  if (failure instanceof ApiRequestError && failure.status === 403) {
    return 'مجوز مشاهده‌ی دستگاه‌های این محدوده را ندارید.';
  }
  if (failure instanceof ApiRequestError && failure.status === 503) {
    return 'سرویس دستگاه‌ها در دسترس نیست؛ بعداً دوباره تلاش کنید.';
  }
  return 'دریافت جزئیات دستگاه انجام نشد. دوباره تلاش کنید.';
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fa-IR').format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'زمان نامعتبر';
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(date);
}

function formatAge(seconds: number) {
  if (seconds < 60) return `${formatNumber(seconds)} ثانیه پیش`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${formatNumber(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${formatNumber(hours)} ساعت پیش`;
  return `${formatNumber(Math.floor(hours / 24))} روز پیش`;
}
