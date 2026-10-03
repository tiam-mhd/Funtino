'use client';

import { useEffect, useRef, useState } from 'react';

import {
  avatarSource,
  updateProfile,
  uploadAvatar,
  type CustomerGender,
  type CustomerProfileUpdate,
  type CustomerUser,
} from '../lib/customer-api';
import { useCustomerAuth } from './customer-auth-gate';
import { CustomerIcon } from './customer-icons';
import { formatPersianDate, PersianDatePicker } from './persian-date-picker';
import { SquareImageCropper } from './square-image-cropper';

type EditableField = 'firstName' | 'lastName' | 'birthDate' | 'gender' | 'city' | 'email';

const editableFields: Array<{ key: EditableField; label: string }> = [
  { key: 'firstName', label: 'نام' },
  { key: 'lastName', label: 'نام خانوادگی' },
  { key: 'birthDate', label: 'تاریخ تولد' },
  { key: 'gender', label: 'جنسیت' },
  { key: 'city', label: 'شهر' },
  { key: 'email', label: 'ایمیل' },
];

const genderLabels: Record<Exclude<CustomerGender, null>, string> = {
  female: 'زن',
  male: 'مرد',
  other: 'سایر',
  prefer_not_to_say: 'ترجیح می‌دهم نگویم',
};

export function CustomerProfile() {
  const { profile, refreshProfile } = useCustomerAuth();
  const [currentProfile, setCurrentProfile] = useState(profile);
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [busyField, setBusyField] = useState<EditableField | 'avatar' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cropSource, setCropSource] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentProfile(profile);
  }, [profile]);

  function startEditing(field: EditableField) {
    setEditingField(field);
    setDraftValue(getRawValue(currentProfile, field));
    setError('');
    setNotice('');
  }

  function cancelEditing() {
    setEditingField(null);
    setDraftValue('');
    setError('');
  }

  async function saveField(field: EditableField) {
    const value = normalizeFieldValue(field, draftValue);
    if (field !== 'email' && !value) {
      setError(`${getFieldLabel(field)} را وارد کن.`);
      return;
    }
    if (field === 'gender' && value && !isCustomerGender(value)) {
      setError('یک گزینه معتبر برای جنسیت انتخاب کن.');
      return;
    }

    setBusyField(field);
    setError('');
    setNotice('');
    try {
      await updateProfile({ [field]: value } as CustomerProfileUpdate);
      const next = await refreshProfile();
      setCurrentProfile(next);
      setEditingField(null);
      setDraftValue('');
      setNotice(`${getFieldLabel(field)} با موفقیت به‌روزرسانی شد.`);
    } catch (saveError) {
      setError(readError(saveError));
    } finally {
      setBusyField(null);
    }
  }

  async function saveAvatar(file: File) {
    setBusyField('avatar');
    setError('');
    setNotice('');
    try {
      await uploadAvatar(file);
      const next = await refreshProfile();
      setCurrentProfile(next);
      setNotice('تصویر پروفایل با موفقیت به‌روزرسانی شد.');
    } catch (uploadError) {
      setError(readError(uploadError));
    } finally {
      setBusyField(null);
    }
  }

  const avatarUrl = avatarSource(currentProfile);

  return (
    <main className="customer-page customer-profile-details-page">
      <section className="customer-profile-identity-card" aria-labelledby="profile-identity-title">
        <button
          type="button"
          className="customer-profile-avatar"
          onClick={() => fileInput.current?.click()}
          disabled={busyField === 'avatar'}
          aria-label="تغییر تصویر پروفایل"
        >
          {avatarUrl ? (
            // The avatar endpoint is private and cookie-authenticated.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" />
          ) : (
            <CustomerIcon name="user" size={30} />
          )}
          <span>
            <CustomerIcon name="plus" size={13} />
          </span>
        </button>
        <div>
          <span className="customer-profile-card__eyebrow">حساب کاربری</span>
          <h2 id="profile-identity-title">{currentProfile.displayName || 'پروفایل فانتینو'}</h2>
          <p>{busyField === 'avatar' ? 'در حال ذخیره تصویر…' : 'برای تغییر تصویر روی آن بزن.'}</p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null;
            event.currentTarget.value = '';
            if (nextFile) setCropSource(nextFile);
          }}
        />
      </section>

      <section className="customer-profile-readonly" aria-label="اطلاعات ورود">
        <div>
          <span>شماره موبایل</span>
          <strong dir="ltr">{currentProfile.phoneE164}</strong>
        </div>
        <small>برای امنیت حساب، تغییر شماره از مسیر ورود امن انجام می‌شود.</small>
      </section>

      <section className="customer-profile-details" aria-label="اطلاعات پروفایل">
        {editableFields.map((field) => {
          const isEditing = editingField === field.key;
          const isBusy = busyField === field.key;

          return (
            <article className="customer-profile-detail" key={field.key}>
              <div className="customer-profile-detail__summary">
                <span>{field.label}</span>
                <strong>{formatFieldValue(currentProfile, field.key)}</strong>
              </div>
              {!isEditing ? (
                <button
                  type="button"
                  className="customer-profile-detail__edit"
                  onClick={() => startEditing(field.key)}
                  aria-label={`ویرایش ${field.label}`}
                >
                  ویرایش
                </button>
              ) : (
                <form
                  className="customer-profile-detail__editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveField(field.key);
                  }}
                >
                  {renderEditor(field.key, draftValue, setDraftValue)}
                  <div className="customer-profile-detail__actions">
                    <button
                      type="button"
                      className="customer-secondary-button"
                      onClick={cancelEditing}
                      disabled={isBusy}
                    >
                      انصراف
                    </button>
                    <button className="customer-primary-button" type="submit" disabled={isBusy}>
                      {isBusy ? 'در حال ذخیره…' : 'ذخیره'}
                      {!isBusy && <CustomerIcon name="check" size={16} />}
                    </button>
                  </div>
                </form>
              )}
            </article>
          );
        })}
      </section>

      <div aria-live="polite">
        {notice && <p className="customer-profile-notice">{notice}</p>}
        {error && (
          <p className="customer-auth-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {cropSource && (
        <SquareImageCropper
          file={cropSource}
          onCancel={() => setCropSource(null)}
          onConfirm={(croppedFile) => {
            setCropSource(null);
            void saveAvatar(croppedFile);
          }}
        />
      )}
    </main>
  );
}

function renderEditor(field: EditableField, value: string, onChange: (value: string) => void) {
  if (field === 'birthDate') {
    return <PersianDatePicker value={value} onChange={onChange} required />;
  }

  if (field === 'gender') {
    return (
      <label className="customer-field">
        <span className="sr-only">جنسیت</span>
        <select required value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="" disabled>
            انتخاب کن
          </option>
          {Object.entries(genderLabels).map(([option, label]) => (
            <option value={option} key={option}>
              {label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="customer-field">
      <span className="sr-only">{getFieldLabel(field)}</span>
      <input
        required={field !== 'email'}
        type={field === 'email' ? 'email' : 'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        dir={field === 'email' ? 'ltr' : undefined}
        placeholder={field === 'email' ? 'you@example.com' : undefined}
      />
    </label>
  );
}

function getRawValue(profile: CustomerUser, field: EditableField): string {
  const value = profile[field];
  if (typeof value !== 'string') return '';
  return field === 'birthDate' ? value.slice(0, 10) : value;
}

function formatFieldValue(profile: CustomerUser, field: EditableField): string {
  const value = getRawValue(profile, field);
  if (!value) return 'ثبت نشده';
  if (field === 'birthDate') return formatPersianDate(value);
  if (field === 'gender') return genderLabels[value as Exclude<CustomerGender, null>] ?? 'ثبت نشده';
  return value;
}

function normalizeFieldValue(field: EditableField, value: string): string | null {
  const normalized = value.trim();
  return field === 'email' && !normalized ? null : normalized;
}

function getFieldLabel(field: EditableField): string {
  return editableFields.find((item) => item.key === field)?.label ?? 'اطلاعات';
}

function isCustomerGender(value: string): value is Exclude<CustomerGender, null> {
  return value in genderLabels;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : 'عملیات انجام نشد. دوباره تلاش کن.';
}
