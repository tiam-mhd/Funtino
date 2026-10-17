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

type ThemeMode = 'light' | 'dark';

export function OperationsEntry({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<View>('loading');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
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
      setError('شماره‌ی همراه را به‌درستی وارد کنید.');
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
    <PageContainer
      className={`${styles.page} ${view === 'active' ? styles.pageActive : styles.authMode}`}
      data-theme={themeMode}
    >
      {view !== 'active' && (
        <header className={styles.topbar}>
          <a className={styles.brand} href="/" aria-label="صفحه‌ی آغاز فانتینو">
            <Image
              src="/brand/operations-panel-logo.webp"
              alt="فانتینو"
              width={126}
              height={48}
              priority
            />
            <span>مدیریت مجموعه و شعب</span>
          </a>
          <div className={styles.topbarActions}>
            <div
              className={styles.themeControl}
              data-active-theme={themeMode}
              role="group"
              aria-label="حالت نمایش"
            >
              <button
                aria-label="حالت روشن"
                aria-pressed={themeMode === 'light'}
                className={styles.themeButton}
                onClick={() => setThemeMode('light')}
                title="روشن"
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className={styles.themeIcon}
                  fill="none"
                  focusable="false"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="3.75" />
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                </svg>
              </button>
              <button
                aria-label="حالت تیره"
                aria-pressed={themeMode === 'dark'}
                className={styles.themeButton}
                onClick={() => setThemeMode('dark')}
                title="تیره"
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className={styles.themeIcon}
                  fill="none"
                  focusable="false"
                  viewBox="0 0 24 24"
                >
                  <path d="M20.1 15.2A8.4 8.4 0 0 1 8.8 3.9 8.5 8.5 0 1 0 20.1 15.2Z" />
                  <path d="m17.5 3 .55 1.45L19.5 5l-1.45.55L17.5 7l-.55-1.45L15.5 5l1.45-.55L17.5 3Z" />
                </svg>
              </button>
            </div>
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
          </div>
        </header>
      )}

      <div
        className={view === 'active' ? `${styles.content} ${styles.contentWide}` : styles.content}
      >
        {view === 'loading' && (
          <Surface className={styles.stateCard} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <strong>در حال آماده‌سازی حساب شما…</strong>
            <p>چند لحظه صبر کنید.</p>
          </Surface>
        )}

        {(view === 'sign-in' || view === 'password-required' || view === 'scope-picker') && (
          <div className={styles.entryLayout}>
            <section className={styles.storyPanel} aria-labelledby="operations-story-title">
              <div className={styles.storyContent}>
                <p className={styles.storyEyebrow}>فانتینو، کنار شما</p>
                <h2 id="operations-story-title">
                  مدیریت حرفه‌ای،
                  <br />
                  <span>در یک نگاه</span>
                </h2>
                <p className={styles.storyIntro}>
                  همه‌چیز برای اداره‌ی بهتر مجموعه و ساختن روزهایی شادتر برای مهمانان.
                </p>
                <ul className={styles.storyHighlights}>
                  <li>
                    <strong>مدیریت شعب</strong>
                    <span>همه‌ی شعبه‌ها، کنار هم</span>
                  </li>
                  <li>
                    <strong>کارهای روزانه</strong>
                    <span>ساده، سریع و منظم</span>
                  </li>
                  <li>
                    <strong>مهمانان خوشحال‌تر</strong>
                    <span>با تجربه‌ای بهتر در هر بازدید</span>
                  </li>
                </ul>
              </div>
              <span className={styles.storyCaption}>Funtino · مدیریت مجموعه‌های تفریحی</span>
            </section>

            {view === 'sign-in' && (
              <Surface className={styles.authCard} aria-labelledby="operations-login-title">
                <div className={styles.eyebrow}>ورود مدیران مجموعه</div>
                <h1 id="operations-login-title">
                  {challenge ? 'کد ورود را وارد کنید' : 'ورود به پنل فانتینو'}
                </h1>
                <p className={styles.intro}>
                  {challenge
                    ? 'کد ۶ رقمی فرستاده‌شده برای شماره‌ی همراهتان را وارد کنید.'
                    : 'شماره‌ی همراه خود را وارد کنید تا کد ورود برایتان فرستاده شود.'}
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
                      placeholder="۰۹۱۲…"
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
                      <span>کد را به این شماره فرستادیم</span>
                      <strong dir="ltr">{loginPhone}</strong>
                    </div>
                    {challenge.deliveryStatus === 'unknown' && (
                      <p className={styles.deliveryWarning} role="status">
                        ممکن است پیامک با کمی تأخیر برسد. اگر کد را دریافت نکردید، شماره‌ی همراه را
                        بررسی کنید و دوباره درخواست دهید.
                      </p>
                    )}
                    <label htmlFor="operations-code">کد ورود</label>
                    <input
                      autoComplete="one-time-code"
                      className={styles.codeInput}
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
                      {busy ? 'در حال تأیید…' : 'ورود به پنل'}
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
                      تغییر شماره‌ی همراه
                    </button>
                  </form>
                )}
                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
                <p className={styles.securityNote}>
                  برای بعضی کارهای مهم، یک کد تأیید دیگر هم از شما خواسته می‌شود.
                </p>
              </Surface>
            )}

            {view === 'password-required' && (
              <Surface className={styles.authCard} aria-labelledby="management-password-title">
                <div className={styles.eyebrow}>ادامه‌ی ورود</div>
                <h1 id="management-password-title">رمز مدیریت را وارد کنید</h1>
                <p className={styles.intro}>کد ورود تأیید شد. حالا رمز مدیریت خود را وارد کنید.</p>
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
                    {busy ? 'در حال ورود…' : 'ورود به پنل'}
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
                    بازگشت به ورود با کد
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
                <div className={styles.eyebrow}>محل کار شما</div>
                <h1 id="scope-title">مجموعه یا شعبه را انتخاب کنید</h1>
                <p className={styles.intro}>
                  مجموعه یا شعبه‌ای را که می‌خواهید مدیریت کنید انتخاب کنید.
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
          </div>
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
              <div className={styles.eyebrow}>به فانتینو خوش آمدید</div>
              <h1>هنوز مجموعه‌ای برای شما ثبت نشده</h1>
              <p>
                اگر برای مجموعه‌ای دعوت شده‌اید، دعوت‌نامه‌اش را همین‌جا بررسی کنید. در غیر این صورت،
                از مدیر مجموعه بخواهید شما را دعوت کند.
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
            <div className={styles.eyebrow}>مشکلی پیش آمد</div>
            <h1>فعلاً نمی‌توانیم ادامه بدهیم</h1>
            <p>اطلاعات حساب شما کامل بارگذاری نشد. لطفاً دوباره تلاش کنید.</p>
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
          فانتینو · مدیریت ساده‌تر، روزهایی شادتر
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
              {isBusy ? 'در حال بررسی…' : isActive ? 'انتخاب‌شده' : 'انتخاب'}
            </Button>
          </Surface>
        );
      })}
    </div>
  );
}

function errorMessage(failure: unknown): string {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 0) {
      return 'ارتباط برقرار نشد. اتصال را بررسی کنید و دوباره تلاش کنید.';
    }
    if (failure.status === 401) {
      return 'ورود شما نیاز به تأیید دوباره دارد. دوباره کد ورود بگیرید.';
    }
    if (failure.status === 403) {
      return 'برای ادامه، از مدیر مجموعه راهنمایی بگیرید.';
    }
    if (failure.status === 429) {
      return 'درخواست‌های زیادی فرستاده‌اید. کمی صبر کنید و دوباره تلاش کنید.';
    }
    if (failure.status >= 500) {
      return 'فعلاً انجام این کار ممکن نیست. کمی بعد دوباره تلاش کنید.';
    }
    return 'اطلاعات واردشده را بررسی کنید و دوباره تلاش کنید.';
  }
  return 'مشکلی پیش آمد. لطفاً دوباره تلاش کنید.';
}
