'use client';

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
} from 'react';
import type { FormEvent, ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { FuntinoMark } from '@funtino/design-system';
import { PersianDatePicker } from './persian-date-picker';
import { SquareImageCropper } from './square-image-cropper';
import { CustomerPageHeader } from './customer-page-header';

import {
  avatarSource,
  CustomerApiError,
  getProfile,
  logout,
  requestOtp,
  updateProfile,
  uploadAvatar,
  verifyOtp,
  type AvatarPreset,
  type CustomerUser,
} from '../lib/customer-api';
import { CustomerIcon, type CustomerIconName } from './customer-icons';

type CustomerAuthContextValue = {
  profile: CustomerUser;
  refreshProfile: () => Promise<CustomerUser>;
  signOut: () => Promise<void>;
};

const CustomerAuthContext = createContext<CustomerAuthContextValue | null>(null);

export function useCustomerAuth(): CustomerAuthContextValue {
  const value = useContext(CustomerAuthContext);
  if (!value) throw new Error('useCustomerAuth must be used inside CustomerAuthGate.');
  return value;
}

export function CustomerAuthGate({ children, locale }: { children: ReactNode; locale: string }) {
  const [status, setStatus] = useState<'loading' | 'signed-out' | 'profile' | 'ready'>('loading');
  const [profile, setProfile] = useState<CustomerUser | null>(null);
  const [bootError, setBootError] = useState('');

  const refreshProfile = useCallback(async () => {
    const next = await getProfile();
    setProfile(next);
    setStatus(next.profileCompleted ? 'ready' : 'profile');
    return next;
  }, []);

  useEffect(() => {
    void refreshProfile().catch((error: unknown) => {
      if (error instanceof CustomerApiError && error.statusCode === 401) {
        setStatus('signed-out');
        return;
      }
      setBootError('اتصال به حساب کاربری برقرار نشد. مطمئن شو API در حال اجراست و دوباره تلاش کن.');
      setStatus('signed-out');
    });
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    await logout();
    setProfile(null);
    setStatus('signed-out');
  }, []);

  const contextValue = useMemo<CustomerAuthContextValue | null>(() => {
    if (!profile) return null;
    return { profile, refreshProfile, signOut };
  }, [profile, refreshProfile, signOut]);

  const onAuthenticated = useCallback(async () => {
    await refreshProfile();
  }, [refreshProfile]);

  const onProfileSaved = useCallback((next: CustomerUser) => {
    setProfile(next);
    setStatus(next.profileCompleted ? 'ready' : 'profile');
  }, []);

  const isReady = status === 'ready' && Boolean(profile);

  return (
    <>
      <div className="customer-app">
        {status !== 'ready' && (
          <header className="customer-mini-header">
            <FuntinoMark compact className="customer-brand-lockup" />
            <span className="customer-mini-header__status">
              <span className="customer-mini-header__dot" aria-hidden="true" />
              <CustomerIcon name="shield" size={13} />
              ورود امن با موبایل
            </span>
          </header>
        )}

        {status === 'loading' && <LoadingState />}
        {status === 'signed-out' && (
          <AuthPanel bootError={bootError} locale={locale} onAuthenticated={onAuthenticated} />
        )}
        {status === 'profile' && profile && (
          <ProfileEditor profile={profile} required onSaved={onProfileSaved} />
        )}
        {isReady && contextValue && (
          <CustomerAuthContext.Provider value={contextValue}>
            <CustomerPageHeader locale={locale} profile={contextValue.profile} />
            {children}
          </CustomerAuthContext.Provider>
        )}
      </div>

      {isReady && <CustomerBottomNav locale={locale} />}
    </>
  );
}

function LoadingState() {
  return (
    <main className="customer-auth-page customer-auth-page--loading" aria-busy="true">
      <div className="customer-auth-spinner" aria-hidden="true" />
      <p role="status" aria-live="polite">
        در حال آماده‌سازی حساب فانتینو...
      </p>
    </main>
  );
}

function AuthPanel({
  bootError,
  onAuthenticated,
}: {
  bootError: string;
  locale: string;
  onAuthenticated: () => Promise<void>;
}) {
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function sendOtp() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await requestOtp(toEnglishDigits(phone));
      setChallengeId(result.challengeId);
      setDevCode(result.devCode ?? null);
      setCooldown(30);
      if (result.deliveryStatus === 'unknown') {
        setNotice(
          'ممکن است کد با کمی تأخیر برسد؛ اگر آن را دریافت نکردید، پس از پایان شمارش معکوس دوباره درخواست کنید.',
        );
      }
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendOtp();
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId) return;
    setError('');
    setBusy(true);
    try {
      await verifyOtp({
        challengeId,
        phone: toEnglishDigits(phone),
        code: toEnglishDigits(code),
      });
      await onAuthenticated();
    } catch (verifyError) {
      setError(readError(verifyError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="customer-auth-page">
      <section className="customer-auth-hero">
        <div className="customer-auth-hero__orb customer-auth-hero__orb--one" aria-hidden="true" />
        <div className="customer-auth-hero__orb customer-auth-hero__orb--two" aria-hidden="true" />
        <span className="customer-auth-hero__eyebrow">
          <CustomerIcon name="sparkles" size={15} /> بازی از همین‌جا شروع می‌شه
        </span>
        <h1>
          هر تجربه‌ی خوب،
          <br />
          با یک ورود ساده شروع می‌شه.
        </h1>
        <p>شماره موبایلت رو وارد کن تا کد ورود امن فانتینو برات ارسال بشه.</p>
        <div className="customer-auth-hero__icons" aria-hidden="true">
          <span>
            <CustomerIcon name="ticket" size={23} />
          </span>
          <span>
            <CustomerIcon name="gift" size={19} />
          </span>
          <span>
            <CustomerIcon name="trophy" size={21} />
          </span>
        </div>
      </section>

      <section className="customer-auth-card">
        <div className="customer-auth-card__topline">
          <span className="customer-auth-card__step">
            {challengeId ? 'مرحله ۲ از ۲' : 'مرحله ۱ از ۲'}
          </span>
          <span className="customer-auth-card__secure">
            <CustomerIcon name="shield" size={14} /> رمز یک‌بارمصرف
          </span>
        </div>
        {challengeId ? (
          <form onSubmit={handleVerifyOtp} className="customer-auth-form">
            <button
              type="button"
              className="customer-auth-back"
              onClick={() => {
                setChallengeId(null);
                setCode('');
                setError('');
                setNotice('');
              }}
            >
              <CustomerIcon name="arrow-left" size={16} /> تغییر شماره
            </button>
            <h2>کد رو وارد کن</h2>
            <p className="customer-auth-card__hint">
              کد ۶ رقمی ارسال‌شده به <strong dir="ltr">{phone}</strong> رو وارد کن.
            </p>
            {notice && (
              <p className="customer-auth-info" role="status">
                {notice}
              </p>
            )}
            <label className="customer-field customer-field--otp">
              <span>کد تأیید</span>
              <input
                autoFocus
                required
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                onChange={(event) =>
                  setCode(toEnglishDigits(event.target.value).replace(/\D/g, ''))
                }
                placeholder="۱۲۳۴۵۶"
                dir="ltr"
              />
            </label>
            {devCode && (
              <div className="customer-auth-dev-hint">
                کد تست محیط توسعه: <strong dir="ltr">{devCode}</strong>
              </div>
            )}
            {cooldown ? (
              <p className="customer-auth-resend">ارسال دوباره تا {cooldown} ثانیه دیگر</p>
            ) : (
              <button
                type="button"
                className="customer-auth-resend customer-auth-resend--button"
                onClick={() => void sendOtp()}
              >
                ارسال دوباره کد
              </button>
            )}
            <button
              className="customer-primary-button"
              type="submit"
              disabled={busy || code.length !== 6}
            >
              {busy ? 'در حال بررسی...' : 'ورود به فانتینو'}{' '}
              <CustomerIcon name="arrow-left" size={18} />
            </button>
          </form>
        ) : (
          <form onSubmit={handleRequestOtp} className="customer-auth-form">
            <h2>خوش اومدی!</h2>
            <p className="customer-auth-card__hint">
              برای ورود یا ساخت حساب جدید، شماره موبایلت رو وارد کن.
            </p>
            <label className="customer-field">
              <span>شماره موبایل</span>
              <input
                required
                inputMode="tel"
                value={phone}
                onChange={(event) =>
                  setPhone(toEnglishDigits(event.target.value).replace(/[^0-9+]/g, ''))
                }
                placeholder="۰۹۱۲۱۲۳۴۵۶۷"
                dir="ltr"
              />
            </label>
            <button
              className="customer-primary-button"
              type="submit"
              disabled={busy || phone.length < 10}
            >
              {busy ? 'در حال ارسال...' : 'دریافت کد ورود'}{' '}
              <CustomerIcon name="arrow-left" size={18} />
            </button>
            <p className="customer-auth-card__legal">
              با ادامه دادن، با قوانین استفاده و حریم خصوصی فانتینو موافقی.
            </p>
          </form>
        )}
        {(error || bootError) && (
          <p className="customer-auth-error" role="alert">
            {error || bootError}
          </p>
        )}
      </section>
    </main>
  );
}

export function ProfileEditor({
  profile,
  required = false,
  onSaved,
}: {
  profile: CustomerUser;
  required?: boolean;
  onSaved: (profile: CustomerUser) => void;
}) {
  const [firstName, setFirstName] = useState(profile.firstName ?? '');
  const [lastName, setLastName] = useState(profile.lastName ?? '');
  const [email, setEmail] = useState(profile.email ?? '');
  const [birthDate, setBirthDate] = useState(profile.birthDate?.slice(0, 10) ?? '');
  const [gender, setGender] = useState(profile.gender ?? '');
  const [city, setCity] = useState(profile.city ?? '');
  const [selectedPreset, setSelectedPreset] = useState<AvatarPreset | null>(profile.avatarPreset);
  const [file, setFile] = useState<File | null>(null);
  const [cropSource, setCropSource] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const existingAvatar = avatarSource(profile);
  const avatarPreview = previewUrl || existingAvatar;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!birthDate) {
      setError('تاریخ تولد را از فیلد انتخاب تاریخ مشخص کن.');
      return;
    }
    if (!file && !selectedPreset && !profile.avatarUrl) {
      setError('یک تصویر مربعی برای پروفایلت انتخاب کن.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      let next = await updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || null,
        birthDate,
        gender: gender as Exclude<CustomerUser['gender'], null>,
        city: city.trim(),
        avatarPreset: file ? null : selectedPreset,
      });
      if (file) next = await uploadAvatar(file);
      onSaved(next);
    } catch (saveError) {
      setError(readError(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="customer-profile-page">
      <section className="customer-profile-intro">
        <span className="customer-auth-hero__eyebrow">
          <CustomerIcon name="sparkles" size={15} />{' '}
          {required ? 'یک قدم تا شروع بازی' : 'حساب کاربری من'}
        </span>
        <h1>{required ? 'پروفایلت رو کامل کن' : 'اطلاعات پروفایل'}</h1>
        <p>
          {required
            ? 'این اطلاعات کمک می‌کنه تجربه‌ی فانتینو شخصی‌تر و امن‌تر باشه.'
            : 'اطلاعاتت را ویرایش کن و تصویر پروفایل مربعی خودت را تنظیم کن.'}
        </p>
      </section>

      <form className="customer-profile-card" onSubmit={handleSubmit}>
        <div className="customer-profile-card__identity">
          <button
            type="button"
            className="customer-profile-avatar"
            onClick={() => fileInput.current?.click()}
            aria-label="انتخاب عکس پروفایل"
          >
            {avatarPreview ? (
              // The avatar endpoint is private and cookie-authenticated; Next Image optimization cannot access it.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarPreview} alt="پیش‌نمایش تصویر پروفایل" />
            ) : (
              <CustomerIcon name="user" size={30} />
            )}
            <span>
              <CustomerIcon name="plus" size={13} />
            </span>
          </button>
          <div>
            <strong>تصویر پروفایل</strong>
            <small>عکس خودت را انتخاب کن؛ برش تصویر دقیقاً مربعی انجام می‌شود.</small>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              event.currentTarget.value = '';
              if (!nextFile) return;
              setCropSource(nextFile);
              setSelectedPreset(null);
            }}
          />
        </div>

        {/*
        <div className="customer-avatar-grid" aria-label="انتخاب آواتار">
          {avatarOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              className={selectedPreset === option.value ? 'is-selected' : ''}
              onClick={() => {
                setSelectedPreset(option.value);
                setFile(null);
              }}
              aria-label={`آواتار ${option.label}`}
            >
              <span className={'customer-avatar-token customer-avatar-token--' + option.value}>
                <CustomerIcon name={option.icon} size={22} />
              </span>
              <small>{option.label}</small>
            </button>
          ))}
        </div>
        */}

        <div className="customer-profile-fields">
          <label className="customer-field">
            <span>نام</span>
            <input
              required
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </label>
          <label className="customer-field">
            <span>نام خانوادگی</span>
            <input
              required
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </label>
          <div className="customer-field">
            <span>تاریخ تولد</span>
            <PersianDatePicker value={birthDate} onChange={setBirthDate} required />
          </div>
          <label className="customer-field">
            <span>شهر</span>
            <input
              required
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="مثلاً تهران"
            />
          </label>
          <label className="customer-field">
            <span>جنسیت</span>
            <select required value={gender} onChange={(event) => setGender(event.target.value)}>
              <option value="" disabled>
                انتخاب کن
              </option>
              <option value="female">زن</option>
              <option value="male">مرد</option>
              <option value="other">سایر</option>
              <option value="prefer_not_to_say">ترجیح می‌دهم نگویم</option>
            </select>
          </label>
          <label className="customer-field">
            <span>
              ایمیل <small>(اختیاری)</small>
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              dir="ltr"
              placeholder="you@example.com"
            />
          </label>
        </div>
        {error && (
          <p className="customer-auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="customer-primary-button" type="submit" disabled={busy}>
          {busy ? 'در حال ذخیره...' : required ? 'ذخیره و شروع کنیم' : 'ذخیره تغییرات'}{' '}
          <CustomerIcon name="check" size={18} />
        </button>
      </form>
      {cropSource && (
        <SquareImageCropper
          file={cropSource}
          onCancel={() => setCropSource(null)}
          onConfirm={(croppedFile) => {
            setFile(croppedFile);
            setCropSource(null);
          }}
        />
      )}
    </main>
  );
}

function CustomerBottomNav({ locale }: { locale: string }) {
  const links = [
    { key: 'home', label: 'خانه', icon: 'home' as CustomerIconName, href: '' },
    { key: 'cards', label: 'کارت‌ها', icon: 'card' as CustomerIconName, href: '/cards' },
    {
      key: 'missions',
      label: 'ماموریت‌ها',
      icon: 'sparkles' as CustomerIconName,
      href: '/missions',
    },
    { key: 'family', label: 'خانواده', icon: 'family' as CustomerIconName, href: '/family' },
    { key: 'account', label: 'حساب', icon: 'user' as CustomerIconName, href: '/account' },
  ];
  const pathname = usePathname();
  const activeKey = pathname.split('/')[2] || 'home';
  return (
    <nav className="customer-bottom-nav" aria-label="ناوبری اصلی">
      {links.map((link) => (
        <a
          key={link.key}
          href={'/' + locale + link.href}
          className={
            activeKey === link.key
              ? 'customer-bottom-nav__item is-active'
              : 'customer-bottom-nav__item'
          }
          aria-current={activeKey === link.key ? 'page' : undefined}
        >
          <span className="customer-bottom-nav__icon">
            <CustomerIcon name={link.icon} size={18} />
          </span>
          <span>{link.label}</span>
        </a>
      ))}
    </nav>
  );
}

/* آواتارهای preset برای فعال‌سازی بعدی نگه داشته شده‌اند.
const avatarOptions: Array<{ value: AvatarPreset; label: string; icon: CustomerIconName }> = [
  { value: 'sun', label: 'خورشید', icon: 'sparkles' },
  { value: 'star', label: 'ستاره', icon: 'trophy' },
  { value: 'rainbow', label: 'رنگین‌کمان', icon: 'heart' },
  { value: 'rocket', label: 'موشک', icon: 'route' },
  { value: 'crown', label: 'قهرمان', icon: 'target' },
  { value: 'bear', label: 'خرس', icon: 'family' },
  { value: 'cat', label: 'گربه', icon: 'gift' },
  { value: 'fox', label: 'روباه', icon: 'candy' },
];
*/

function toEnglishDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : 'عملیات انجام نشد. دوباره تلاش کن.';
}
