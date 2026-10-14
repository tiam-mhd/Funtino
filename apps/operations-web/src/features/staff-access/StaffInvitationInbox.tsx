'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  acceptMyStaffInvitation,
  freshIdempotencyKey,
  listMyStaffInvitations,
  type MyStaffInvitation,
} from '../../lib/api/operations-staff';
import styles from './StaffAccessManager.module.css';

type StaffInvitationInboxProps = {
  onAccepted: () => Promise<void>;
  onSessionExpired: () => void;
  forceVisible?: boolean;
};

export function StaffInvitationInbox({
  onAccepted,
  onSessionExpired,
  forceVisible = false,
}: StaffInvitationInboxProps) {
  const [invitations, setInvitations] = useState<MyStaffInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const retryKeys = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await listMyStaffInvitations();
      setInvitations(result.data);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) {
        onSessionExpired();
        return;
      }
      setLoadError(messageFor(failure));
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function accept(invitation: MyStaffInvitation) {
    setAcceptingId(invitation.id);
    setActionError('');
    setNotice('');
    const key = retryKeys.current.get(invitation.id) ?? freshIdempotencyKey();
    retryKeys.current.set(invitation.id, key);
    try {
      await acceptMyStaffInvitation(invitation.id, key);
      retryKeys.current.delete(invitation.id);
      setNotice('دعوت پذیرفته شد. برای ورود به آن، محدوده‌ی مجاز را جداگانه انتخاب کنید.');
      await refresh();
      await onAccepted();
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) {
        onSessionExpired();
        return;
      }
      setActionError(messageFor(failure));
      if (
        failure instanceof ApiRequestError &&
        (failure.status === 404 || failure.status === 409)
      ) {
        await refresh();
      }
    } finally {
      setAcceptingId(null);
    }
  }

  if (
    !forceVisible &&
    !loading &&
    invitations.length === 0 &&
    !loadError &&
    !actionError &&
    !notice
  )
    return null;

  return (
    <Surface className={styles.inbox} aria-labelledby="my-staff-invitations-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>دعوت‌های خطاب به شماره‌ی تأییدشده</p>
          <h2 id="my-staff-invitations-title">دعوت‌های کاری من</h2>
        </div>
        <Button disabled={loading} onClick={() => void refresh()} tone="ghost" type="button">
          {loading ? 'در حال بررسی…' : 'به‌روزرسانی'}
        </Button>
      </div>

      <p className={styles.explainer}>
        دعوت‌ها فقط برای شماره‌ای بازیابی می‌شوند که در همین نشست با OTP تأیید شده است. پذیرش، عضویت
        را فعال می‌کند اما محدوده‌ی کاری را خودکار انتخاب نمی‌کند.
      </p>

      {loadError && (
        <p className={styles.error} role="alert">
          {loadError}
        </p>
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
      {!loading && invitations.length === 0 && !loadError && (
        <p className={styles.empty}>دعوت فعالی برای شماره‌ی تأییدشده‌ی شما پیدا نشد.</p>
      )}

      {invitations.map((invitation) => {
        const expired = Date.parse(invitation.expiresAt) <= Date.now();
        const cannotAccept =
          expired || invitation.roleChanged || invitation.scopeStatus !== 'active';
        return (
          <article className={styles.invitationCard} key={invitation.id}>
            <div className={styles.invitationDetails}>
              <strong>{invitation.role.name}</strong>
              <span>
                {invitation.scope.type === 'branch' ? (
                  <>
                    شعبه: {invitation.branchName ?? 'نامشخص'} · مجموعه:{' '}
                    {invitation.organizationName ?? 'نامشخص'} ·{' '}
                  </>
                ) : invitation.scope.type === 'organization' ? (
                  <>مجموعه: {invitation.organizationName ?? 'نامشخص'} · </>
                ) : (
                  <>سراسری · </>
                )}
                شماره‌ی مقصد <bdi dir="ltr">{invitation.maskedPhone}</bdi>
              </span>
              <time dateTime={invitation.expiresAt}>
                اعتبار تا {new Date(invitation.expiresAt).toLocaleString('fa-IR')}
              </time>
              {expired && <span className={styles.warning}>این دعوت منقضی شده است.</span>}
              {invitation.roleChanged && (
                <span className={styles.warning}>
                  نقش دعوت پس از صدور تغییر کرده؛ برای امنیت، از مدیر بخواهید دعوت تازه بفرستد.
                </span>
              )}
              {invitation.scopeStatus === 'inactive' && (
                <span className={styles.warning}>
                  مجموعه یا شعبه‌ی مقصد فعال نیست؛ این دعوت قابل پذیرش نیست.
                </span>
              )}
              {invitation.scopeStatus === 'unavailable' && (
                <span className={styles.warning}>
                  scope مقصد از سرویس مالک تأیید نشد؛ این دعوت تا رفع وضعیت قابل پذیرش نیست.
                </span>
              )}
              {invitation.scopeStatus === 'system_only' && (
                <span className={styles.warning}>
                  دعوت سراسری از پنل عملیات پذیرفته نمی‌شود؛ برای این دعوت از پنل مدیریت سامانه
                  استفاده کنید.
                </span>
              )}
            </div>
            <Button
              disabled={acceptingId !== null || cannotAccept}
              onClick={() => void accept(invitation)}
              type="button"
            >
              {acceptingId === invitation.id ? 'در حال پذیرش…' : 'پذیرش دعوت'}
            </Button>
          </article>
        );
      })}
    </Surface>
  );
}

function messageFor(failure: unknown): string {
  if (failure instanceof ApiRequestError) return failure.message;
  if (failure instanceof Error && failure.message) return failure.message;
  return 'ارتباط با سرویس دعوت‌ها برقرار نشد؛ دوباره تلاش کنید.';
}
