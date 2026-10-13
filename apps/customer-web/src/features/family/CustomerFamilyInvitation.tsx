'use client';

import { useEffect, useState } from 'react';
import { Button, Surface } from '@funtino/design-system';
import {
  acceptCustomerFamilyInvitation,
  linkCustomerFamilyInvitation,
  previewCustomerFamilyInvitation,
} from '../../lib/customer-api';
import styles from './CustomerFamily.module.css';

type Preview =
  | {
      valid: true;
      invitationId: string;
      householdName: string;
      memberName: string;
      kind: 'adult_account' | 'dependent_claim';
      expiresAt: string | null;
    }
  | { valid: false };

export function CustomerFamilyInvitation() {
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const inviteToken = window.location.hash.slice(1);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!inviteToken) {
      setPreview({ valid: false });
      setLoading(false);
      return;
    }
    setToken(inviteToken);
    void previewCustomerFamilyInvitation(inviteToken)
      .then(setPreview)
      .catch(() => setPreview({ valid: false }))
      .finally(() => setLoading(false));
  }, []);

  async function accept() {
    if (!token || !preview?.valid) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const invitation = await acceptCustomerFamilyInvitation({ token });
      setToken('');
      if (invitation.kind === 'adult_account' && invitation.status === 'accepted') {
        await linkCustomerFamilyInvitation(invitation.id);
        setNotice('دعوت پذیرفته شد و حساب شما به خانواده پیوند خورد.');
      } else if (invitation.kind === 'adult_account' && invitation.status === 'linked') {
        setNotice('دعوت پذیرفته شد و حساب شما به خانواده پیوند خورد.');
      } else if (invitation.status === 'claim_pending') {
        setNotice('درخواست ثبت شد. پس از تأیید سرپرست، پیوند حساب فعال می‌شود.');
      }
      setPreview({ valid: false });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'پذیرش دعوت انجام نشد؛ دوباره تلاش کن.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`customer-page ${styles.page}`}>
      <Surface className={styles.state} aria-busy={loading || busy}>
        {loading ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            <p role="status">در حال بررسی دعوت…</p>
          </>
        ) : preview?.valid ? (
          <>
            <span className={styles.sectionHeading}>دعوت‌نامه‌ی فانتینو</span>
            <h2>پیوستن به خانواده‌ی {preview.householdName}</h2>
            <p>
              این دعوت برای ثبت عضویت «{preview.memberName}» است. با پذیرش، پیوند حساب به رضایت خودت
              ثبت می‌شود.
            </p>
            <p>
              {preview.expiresAt
                ? `این پیوند تا ${new Intl.DateTimeFormat('fa-IR').format(new Date(preview.expiresAt))} معتبر است.`
                : 'این دعوت پس از پذیرش صریح تو منقضی نمی‌شود.'}
            </p>
            {preview.kind === 'dependent_claim' && (
              <p>پیوند حساب وابسته بعد از تأیید سرپرست فعال خواهد شد.</p>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {notice ? (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            ) : (
              <Button disabled={busy} onClick={() => void accept()} type="button">
                {busy ? 'در حال ثبت…' : 'پذیرش دعوت'}
              </Button>
            )}
          </>
        ) : (
          <>
            <h2>{notice ? 'دعوت بررسی شد' : 'این دعوت در دسترس نیست'}</h2>
            <p role={notice ? 'status' : undefined}>
              {notice ||
                'پیوند نامعتبر، استفاده‌شده، لغوشده یا منقضی است. از فرستنده بخواه دعوت تازه‌ای ایجاد کند.'}
            </p>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </Surface>
    </main>
  );
}
