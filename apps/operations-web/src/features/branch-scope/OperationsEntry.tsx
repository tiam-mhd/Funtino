'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import { StaffInvitationInbox } from '../staff-access/StaffInvitationInbox';
import {
  OperationsWorkspaceShell,
  workspaceHref,
  workspaceSectionFromPath,
} from '../../components/workspace-shell/OperationsWorkspaceShell';
import { OperationsWorkspaceProvider } from './OperationsWorkspaceContext';
import {
  getOperationsScopes,
  getOperationsUser,
  logoutOperations,
  normalizeDigits,
  normalizePhone,
  requestOperationsOtp,
  scopeKey,
  selectOperationsScope,
  verifyOperationsOtp,
  verifyOperationsPassword,
  type OperationsScope,
  type OperationsScopeOption,
  type OperationsUser,
} from '../../lib/auth/operations-access';
import styles from './OperationsEntry.module.css';

type View =
  | 'loading'
  | 'sign-in'
  | 'password-required'
  | 'scope-picker'
  | 'active'
  | 'no-access'
  | 'unavailable';

export function OperationsEntry({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<View>('loading');
  const [user, setUser] = useState<OperationsUser | null>(null);
  const [scopes, setScopes] = useState<OperationsScopeOption[]>([]);
  const [activeScope, setActiveScope] = useState<OperationsScopeOption | null>(null);
  const [mfaStepUpUntil, setMfaStepUpUntil] = useState<number | null>(null);
  const [phone, setPhone] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [code, setCode] = useState('');
  const [managementPassword, setManagementPassword] = useState('');
  const [challenge, setChallenge] = useState<{
    challengeId: string;
    expiresAt: string;
    deliveryStatus?: 'confirmed' | 'unknown';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const resetToSignIn = useCallback(() => {
    setUser(null);
    setScopes([]);
    setActiveScope(null);
    setMfaStepUpUntil(null);
    setChallenge(null);
    setCode('');
    setManagementPassword('');
    setError('');
    setView('sign-in');
  }, []);

  const hydrate = useCallback(async () => {
    setView('loading');
    setError('');
    const currentUser = await getOperationsUser();
    setUser(currentUser);
    const access = await getOperationsScopes();
    setScopes(access.items);
    setActiveScope(null);
    setView(access.items.length > 0 ? 'scope-picker' : 'no-access');
  }, []);

  const handleHydrationFailure = useCallback(
    (failure: unknown) => {
      if (failure instanceof ApiRequestError && failure.status === 401) {
        resetToSignIn();
        return;
      }
      if (failure instanceof ApiRequestError && failure.status === 403) {
        setError(errorMessage(failure));
        setView('unavailable');
        return;
      }
      setError(errorMessage(failure));
      setView('unavailable');
    },
    [resetToSignIn],
  );

  useEffect(() => {
    let cancelled = false;
    void hydrate().catch((failure: unknown) => {
      if (!cancelled) handleHydrationFailure(failure);
    });
    return () => {
      cancelled = true;
    };
  }, [handleHydrationFailure, hydrate]);

  async function submitPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPhone = normalizePhone(phone);
    if (!/^\+?[1-9]\d{7,14}$/.test(normalizedPhone)) {
      setError('شماره‌ی همراه را با قالب معتبر وارد کنید.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const nextChallenge = await requestOperationsOtp(normalizedPhone);
      setLoginPhone(normalizedPhone);
      setPhone(normalizedPhone);
      setChallenge(nextChallenge);
      setCode('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    if (Date.parse(challenge.expiresAt) <= Date.now()) {
      setChallenge(null);
      setError('مهلت کد پایان یافته است. دوباره کد ورود بگیرید.');
      return;
    }

    const normalizedCode = normalizeDigits(code).replace(/\D/g, '');
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError('کد ورود باید ۶ رقم باشد.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const result = await verifyOperationsOtp({
        challengeId: challenge.challengeId,
        phone: loginPhone,
        code: normalizedCode,
      });
      if (result.requiresPassword) {
        setManagementPassword('');
        setView('password-required');
        return;
      }
      await hydrate();
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) {
        setError('کد ورود معتبر نیست یا مهلت آن پایان یافته است.');
      } else {
        setError(errorMessage(failure));
        setView('unavailable');
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitManagementPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await verifyOperationsPassword(managementPassword);
      setManagementPassword('');
      await hydrate();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function chooseScope(scope: OperationsScope) {
    const key = scopeKey(scope);
    setSelectingKey(key);
    setError('');
    try {
      const selected = await selectOperationsScope(scope);
      setActiveScope(selected);
      setScopes((current) => {
        const selectedKey = scopeKey(selected.scope);
        const existingIndex = current.findIndex((item) => scopeKey(item.scope) === selectedKey);
        if (existingIndex === -1) return [...current, selected];
        return current.map((item, index) => (index === existingIndex ? selected : item));
      });
      setView('active');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) {
        resetToSignIn();
      } else {
        setError(errorMessage(failure));
        if (failure instanceof ApiRequestError && failure.status === 403) {
          try {
            const refreshed = await getOperationsScopes();
            setScopes(refreshed.items);
            const activeStillAllowed = activeScope
              ? refreshed.items.some((item) => scopeKey(item.scope) === scopeKey(activeScope.scope))
              : false;
            if (!activeStillAllowed) {
              setActiveScope(null);
              setView(refreshed.items.length > 0 ? 'scope-picker' : 'no-access');
            }
          } catch (refreshFailure) {
            handleHydrationFailure(refreshFailure);
          }
        }
      }
    } finally {
      setSelectingKey(null);
    }
  }

  const refreshScopesAfterInvitation = useCallback(async () => {
    const refreshed = await getOperationsScopes();
    setScopes(refreshed.items);
    if (activeScope) {
      const stillAllowed = refreshed.items.find(
        (item) => scopeKey(item.scope) === scopeKey(activeScope.scope),
      );
      if (stillAllowed) {
        setActiveScope(stillAllowed);
        setView('active');
        return;
      }
    }
    setActiveScope(null);
    setView(refreshed.items.length > 0 ? 'scope-picker' : 'no-access');
  }, [activeScope]);

  async function logout() {
    setBusy(true);
    setError('');
    try {
      await logoutOperations();
      resetToSignIn();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const userLabel =
    user?.displayName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.phoneE164;
  const PageContainer = view === 'active' ? 'div' : 'main';
  const activeSection = workspaceSectionFromPath(pathname);

  return (
    <PageContainer className={`${styles.page} ${view === 'active' ? styles.pageActive : ''}`}>
      <div className={styles.ambient} aria-hidden="true" />
      {view !== 'active' && (
        <header className={styles.topbar}>
          <a className={styles.brand} href="/" aria-label="صفحه‌ی آغاز پنل فانتینو">
            <Image src="/brand/funtino-logo.png" alt="فانتینو" width={126} height={42} priority />
            <span>پنل عملیات</span>
          </a>
          {user && (
            <div className={styles.account}>
              <span className={styles.accountAvatar} aria-hidden="true">
                {(userLabel || 'ک').slice(0, 1)}
              </span>
              <span className={styles.accountLabel}>{userLabel}</span>
              <Button
                tone="ghost"
                type="button"
                onClick={logout}
                disabled={busy || selectingKey !== null}
              >
                خروج
              </Button>
            </div>
          )}
        </header>
      )}

      <div
        className={view === 'active' ? `${styles.content} ${styles.contentWide}` : styles.content}
      >
        {view === 'loading' && (
          <Surface className={styles.stateCard} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <strong>در حال بررسی نشست و دسترسی‌ها…</strong>
            <p>وضعیت حساب و محدوده‌ها مستقیماً از سرویس‌های فانتینو دریافت می‌شود.</p>
          </Surface>
        )}

        {view === 'sign-in' && (
          <Surface className={styles.authCard}>
            <div className={styles.eyebrow}>دسترسی امن کارکنان</div>
            <h1>ورود به پنل عملیات</h1>
            <p className={styles.intro}>
              با شماره‌ی همراه تأییدشده وارد شوید. اگر رمز مدیریت برای این حساب فعال باشد، پس از کد
              پیامکی آن را هم می‌پرسیم؛ scope و دسترسی بعد از ورود در سرور بررسی می‌شود.
            </p>

            {!challenge ? (
              <form className={styles.form} onSubmit={submitPhone}>
                <label htmlFor="operations-phone">شماره‌ی همراه</label>
                <input
                  autoComplete="tel"
                  dir="ltr"
                  id="operations-phone"
                  inputMode="tel"
                  onChange={(event) => setPhone(event.currentTarget.value)}
                  placeholder="۰۹۱۲۱۲۳۴۵۶۷"
                  required
                  type="tel"
                  value={phone}
                />
                <Button className={styles.submitButton} disabled={busy} type="submit">
                  {busy ? 'در حال ارسال…' : 'دریافت کد ورود'}
                </Button>
              </form>
            ) : (
              <form className={styles.form} onSubmit={submitCode}>
                <div className={styles.challengeInfo}>
                  <span>کد ارسال‌شده به</span>
                  <strong dir="ltr">{loginPhone}</strong>
                </div>
                {challenge.deliveryStatus === 'unknown' && (
                  <p className={styles.deliveryWarning} role="status">
                    درخواست ثبت شد، اما تحویل پیامک از سوی سرویس تأیید نشده است. اگر کد نرسید، پس از
                    ۳۰ ثانیه به مرحله‌ی قبل برگردید و دوباره درخواست دهید.
                  </p>
                )}
                <label htmlFor="operations-code">کد ۶ رقمی</label>
                <input
                  autoComplete="one-time-code"
                  dir="ltr"
                  id="operations-code"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setCode(event.currentTarget.value)}
                  pattern="[0-9۰-۹٠-٩]{6}"
                  placeholder="••••••"
                  required
                  type="text"
                  value={code}
                />
                <Button className={styles.submitButton} disabled={busy} type="submit">
                  {busy ? 'در حال بررسی…' : 'تأیید و ادامه'}
                </Button>
                <button
                  className={styles.textButton}
                  onClick={() => {
                    setPhone(loginPhone);
                    setChallenge(null);
                    setCode('');
                    setError('');
                  }}
                  type="button"
                >
                  بازگشت به مرحله‌ی شماره
                </button>
              </form>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <p className={styles.securityNote}>
              TOTP فقط برای فرمان‌های پرریسک درخواست می‌شود و برای ورود عادی لازم نیست.
            </p>
          </Surface>
        )}

        {view === 'password-required' && (
          <Surface className={styles.authCard} aria-labelledby="management-password-title">
            <div className={styles.eyebrow}>مرحله‌ی دوم ورود مدیریت</div>
            <h1 id="management-password-title">رمز مدیریت را وارد کنید</h1>
            <p className={styles.intro}>
              کد پیامکی تأیید شد. نشست مدیریتی پس از تأیید رمز ساخته می‌شود.
            </p>
            <form className={styles.form} onSubmit={submitManagementPassword}>
              <label htmlFor="operations-management-password">رمز مدیریت</label>
              <input
                autoComplete="current-password"
                dir="ltr"
                id="operations-management-password"
                maxLength={128}
                onChange={(event) => setManagementPassword(event.currentTarget.value)}
                required
                type="password"
                value={managementPassword}
              />
              <Button
                className={styles.submitButton}
                disabled={busy || managementPassword.length === 0}
                type="submit"
              >
                {busy ? 'در حال بررسی…' : 'تأیید و ورود'}
              </Button>
              <button
                className={styles.textButton}
                onClick={() => {
                  setChallenge(null);
                  setCode('');
                  setManagementPassword('');
                  setError('');
                  setView('sign-in');
                }}
                type="button"
              >
                بازگشت به ورود پیامکی
              </button>
            </form>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </Surface>
        )}

        {view === 'scope-picker' && (
          <section className={styles.scopeSection} aria-labelledby="scope-title">
            <div className={styles.eyebrow}>محدوده‌ی کاری</div>
            <h1 id="scope-title">مجموعه یا شعبه را انتخاب کنید</h1>
            <p className={styles.intro}>
              فقط عضویت‌های فعال و مجموعه‌ها و شعبه‌های فعال نمایش داده می‌شوند. انتخاب شما پیش از
              ادامه دوباره روی سرور اعتبارسنجی می‌شود.
            </p>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <StaffInvitationInbox
              onAccepted={refreshScopesAfterInvitation}
              onSessionExpired={resetToSignIn}
            />
            <ScopeOptions
              activeScope={null}
              busyKey={selectingKey}
              onChoose={chooseScope}
              options={scopes}
            />
          </section>
        )}

        {view === 'active' && activeScope && (
          <OperationsWorkspaceProvider
            value={{
              activeScope,
              scopeOptions: scopes,
              mfaStepUpUntil,
              onSessionExpired: resetToSignIn,
              onSelectScope: chooseScope,
              onMfaStepUp: setMfaStepUpUntil,
              refreshScopesAfterInvitation,
              navigate: (section) => router.push(workspaceHref(section)),
            }}
          >
            <OperationsWorkspaceShell
              activeSection={activeSection}
              activeScope={activeScope}
              scopeOptions={scopes}
              selectingScopeKey={selectingKey}
              scopeError={error}
              userLabel={userLabel || 'کاربر عملیاتی'}
              logoutBusy={busy}
              onLogout={() => void logout()}
              onSectionChange={() => setError('')}
              onSelectScope={chooseScope}
            >
              {children}
            </OperationsWorkspaceShell>
          </OperationsWorkspaceProvider>
        )}

        {view === 'no-access' && (
          <>
            <StaffInvitationInbox
              onAccepted={refreshScopesAfterInvitation}
              onSessionExpired={resetToSignIn}
            />
            <Surface className={styles.stateCard}>
              <span className={styles.stateIcon} aria-hidden="true">
                ⌕
              </span>
              <div className={styles.eyebrow}>حساب احراز هویت شد</div>
              <h1>دسترسی عملیاتی فعالی پیدا نشد</h1>
              <p>
                برای این شماره عضویت فعال در مجموعه یا شعبه‌ای وجود ندارد. اگر باید به پنل دسترسی
                داشته باشید، از مدیر مجموعه بخواهید دعوت‌نامه را به همین شماره ارسال کند.
              </p>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <Button onClick={logout} disabled={busy} type="button" tone="ghost">
                خروج از حساب
              </Button>
            </Surface>
          </>
        )}

        {view === 'unavailable' && (
          <Surface className={styles.stateCard}>
            <span className={styles.stateIcon} aria-hidden="true">
              ↻
            </span>
            <div className={styles.eyebrow}>بررسی دسترسی کامل نشد</div>
            <h1>فعلاً امکان ادامه وجود ندارد</h1>
            <p>
              وضعیت مجوز یا مجموعه از منبع اصلی تأیید نشد؛ برای حفظ امنیت هیچ محدوده‌ای فعال نشده
              است.
            </p>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.stateActions}>
              <Button onClick={() => void hydrate().catch(handleHydrationFailure)} type="button">
                تلاش دوباره
              </Button>
              {user && (
                <Button onClick={logout} disabled={busy} type="button" tone="ghost">
                  خروج از حساب
                </Button>
              )}
            </div>
          </Surface>
        )}
      </div>

      {view !== 'active' && (
        <footer className={styles.footer}>
          فانتینو · دسترسی‌ها بر اساس عضویت فعال و سیاست سرور کنترل می‌شوند
        </footer>
      )}
    </PageContainer>
  );
}

function ScopeOptions({
  options,
  activeScope,
  busyKey,
  onChoose,
}: {
  options: OperationsScopeOption[];
  activeScope: OperationsScope | null;
  busyKey: string | null;
  onChoose: (scope: OperationsScope) => void;
}) {
  return (
    <div className={styles.scopeList}>
      {options.map((option) => {
        const key = scopeKey(option.scope);
        const isActive = activeScope !== null && scopeKey(activeScope) === key;
        const isBusy = busyKey === key;
        const label = option.branch?.name ?? option.organization.name;
        return (
          <Surface className={styles.scopeCard} key={key}>
            <div className={styles.scopeMarker} aria-hidden="true">
              {option.branch ? 'ش' : 'م'}
            </div>
            <div className={styles.scopeDetails}>
              <span className={styles.scopeType}>{option.branch ? 'شعبه' : 'مجموعه'}</span>
              <strong>{label}</strong>
              <span>
                {option.branch
                  ? `${option.organization.name} · ${option.branch.city}`
                  : 'دسترسی در سطح مجموعه'}
              </span>
            </div>
            <Button
              aria-pressed={isActive}
              disabled={isActive || busyKey !== null}
              onClick={() => onChoose(option.scope)}
              type="button"
              tone={isActive ? 'ghost' : 'primary'}
            >
              {isBusy ? 'در حال بررسی…' : isActive ? 'محدوده‌ی فعال' : 'انتخاب'}
            </Button>
          </Surface>
        );
      })}
    </div>
  );
}

function errorMessage(failure: unknown): string {
  if (failure instanceof ApiRequestError) return failure.message;
  if (failure instanceof Error && failure.message) return failure.message;
  return 'ارتباط با سرویس ممکن نشد. اتصال را بررسی و دوباره تلاش کنید.';
}
