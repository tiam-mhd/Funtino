'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { useCustomerAuth } from '../../components/customer-auth-gate';
import {
  acceptCustomerFamilyInvitation,
  archiveCustomerFamilyMember,
  addCustomerFamilyMember,
  approveCustomerDependentClaim,
  createCustomerHousehold,
  declineCustomerFamilyInvitation,
  getCustomerFamily,
  linkCustomerFamilyInvitation,
  revokeCustomerFamilyInvitation,
  removeCustomerFamilyRelationship,
  updateCustomerFamilyMember,
  type AddCustomerFamilyMemberInput,
  type CustomerFamilyData,
  type CustomerFamilyHousehold,
  type CustomerFamilyMember,
  type CustomerFamilyHousehold as FamilyHousehold,
} from '../../lib/customer-api';
import styles from './CustomerFamily.module.css';

type Draft = {
  displayName: string;
  isDependent: boolean;
  relativeMemberId: string;
  relationship: AddCustomerFamilyMemberInput['relationship'];
  basis: AddCustomerFamilyMemberInput['basis'];
  displayGender: NonNullable<AddCustomerFamilyMemberInput['displayGender']>;
  phone: string;
  createClaimLink: boolean;
};

type MemberEditDraft = {
  displayName: string;
  displayGender: 'female' | 'male' | 'unspecified' | null;
  changeRelationship: boolean;
  relationshipId?: string;
  relativeMemberId: string;
  relationship: AddCustomerFamilyMemberInput['relationship'];
  basis: AddCustomerFamilyMemberInput['basis'];
};

const emptyDraft: Draft = {
  displayName: '',
  isDependent: true,
  relativeMemberId: 'viewer',
  relationship: 'child',
  basis: 'biological',
  displayGender: 'unspecified',
  phone: '',
  createClaimLink: true,
};

const relationLabels: Record<Draft['relationship'], string> = {
  parent: 'والد',
  child: 'فرزند',
  spouse: 'همسر',
  sibling: 'خواهر یا برادر',
  guardian: 'سرپرست',
  ward: 'فرد تحت سرپرستی',
};

const basisLabels: Record<AddCustomerFamilyMemberInput['basis'], string> = {
  biological: 'زیستی',
  legal: 'قانونی',
  adoptive: 'فرزندخواندگی',
  step: 'ناتنی',
  partner: 'همسر یا شریک زندگی',
  unspecified: 'مشخص نشده',
};

export function CustomerFamily() {
  const { profile } = useCustomerAuth();
  const viewerName =
    [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.displayName;
  const [data, setData] = useState<CustomerFamilyData | null>(null);
  const dataRef = useRef<CustomerFamilyData | null>(null);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [memberStep, setMemberStep] = useState<1 | 2 | 3>(1);
  const memberCreateIdempotencyKey = useRef<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState('');
  const [memberEditDraft, setMemberEditDraft] = useState<MemberEditDraft | null>(null);
  const memberActionKey = useRef<{ scope: string; key: string } | null>(null);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const next = await getCustomerFamily();
      dataRef.current = next;
      setData(next);
      setSelectedHouseholdId((current) =>
        next.items.some((household) => household.id === current)
          ? current
          : (next.items[0]?.id ?? ''),
      );
      setStale(false);
    } catch (failure) {
      setStale(Boolean(dataRef.current));
      setError(readError(failure));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  const household = useMemo(
    () => data?.items.find((item) => item.id === selectedHouseholdId) ?? null,
    [data, selectedHouseholdId],
  );
  const groupedMembers = useMemo(() => {
    const closeLabels = new Set([
      'من',
      'پدر',
      'مادر',
      'والد',
      'دختر',
      'پسر',
      'فرزند',
      'همسر',
      'شریک زندگی',
      'خواهر',
      'برادر',
      'خواهر یا برادر',
      'خواهر ناتنی',
      'برادر ناتنی',
      'خواهر یا برادر ناتنی',
      'سرپرست',
      'سرپرست قانونی',
      'تحت سرپرستی شما',
      'فرزندخوانده',
      'فرزند ناتنی',
    ]);
    return {
      close: household?.members.filter((member) => closeLabels.has(member.relationshipLabel)) ?? [],
      extended:
        household?.members.filter((member) => !closeLabels.has(member.relationshipLabel)) ?? [],
    };
  }, [household]);

  async function submitHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await createCustomerHousehold(householdName.trim());
      setHouseholdName('');
      setSelectedHouseholdId(created.id);
      await refresh();
      setNotice('خانواده ساخته شد. حالا می‌توانی اعضا را اضافه کنی.');
    } catch (failure) {
      setError(readError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function submitMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!household) return;
    setBusy(true);
    setError('');
    setNotice('');
    setShareLink('');
    try {
      const input: AddCustomerFamilyMemberInput = {
        displayName: draft.displayName.trim(),
        relativeMemberId: draft.relativeMemberId,
        relationship: draft.relationship,
        basis: draft.basis,
        displayGender: draft.displayGender,
        isDependent: draft.isDependent,
        ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
        ...(draft.isDependent && !draft.phone.trim() && draft.createClaimLink
          ? { createClaimLink: true }
          : {}),
      };
      const idempotencyKey =
        memberCreateIdempotencyKey.current ??
        (memberCreateIdempotencyKey.current = crypto.randomUUID());
      const created = await addCustomerFamilyMember(household.id, input, idempotencyKey);
      if (created.invitation?.shareToken) {
        const locale = window.location.pathname.split('/').filter(Boolean)[0] || 'fa';
        setShareLink(
          `${window.location.origin}/${locale}/family/invitation#${created.invitation.shareToken}`,
        );
        setNotice(
          'دعوت ساخته شد. این پیوند را فقط برای همان فرد بفرست؛ برای پذیرش باید با شماره‌ی تأییدشده‌ی او وارد فانتینو شود.',
        );
      } else if (created.invitation) {
        setNotice(
          'این دعوت قبلاً ثبت شده و هنوز در انتظار پاسخ است. از فهرست دعوت‌ها وضعیت آن را پیگیری کن.',
        );
      } else if (!created.relationship) {
        setNotice('این حساب از قبل عضو همین خانواده است؛ عضو تکراری ساخته نشد.');
      } else {
        setNotice('عضو خانواده ثبت شد.');
      }
      memberCreateIdempotencyKey.current = null;
      setDraft(emptyDraft);
      setMemberStep(1);
      await refresh();
    } catch (failure) {
      setError(readError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvitation(invitationId: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const accepted = await acceptCustomerFamilyInvitation({ invitationId });
      if (accepted.kind === 'adult_account' && accepted.status === 'accepted') {
        await linkCustomerFamilyInvitation(accepted.id);
        setNotice('حساب شما با موفقیت به خانواده پیوند خورد.');
      } else if (accepted.kind === 'adult_account' && accepted.status === 'linked') {
        setNotice('دعوت پذیرفته شد و حساب شما به خانواده پیوند خورد.');
      } else if (accepted.status === 'claim_pending') {
        setNotice('درخواست پیوند ثبت شد و پس از تأیید سرپرست فعال می‌شود.');
      }
      await refresh();
    } catch (failure) {
      setError(readError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function runInvitationAction(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await refresh();
    } catch (failure) {
      setError(readError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('کپی خودکار ممکن نشد؛ پیوند را انتخاب و کپی کن.');
    }
  }

  function startMemberEdit(member: CustomerFamilyMember) {
    if (!household) return;
    const firstEdge = household.relationships.find(
      (edge) => edge.fromMemberId === member.id || edge.toMemberId === member.id,
    );
    setEditingMemberId(member.id);
    setMemberEditDraft({
      displayName: member.displayName,
      displayGender: member.displayGender,
      changeRelationship: false,
      ...(firstEdge?.id ? { relationshipId: firstEdge.id } : {}),
      relativeMemberId: firstEdge
        ? firstEdge.fromMemberId === member.id
          ? firstEdge.toMemberId
          : firstEdge.fromMemberId
        : '',
      relationship: firstEdge ? relationshipFromEdge(firstEdge, member.id) : 'child',
      basis: firstEdge?.basis ?? 'unspecified',
    });
    memberActionKey.current = null;
  }

  async function runMemberAction(
    scope: string,
    action: (idempotencyKey: string) => Promise<unknown>,
    successMessage: string,
  ) {
    if (memberActionKey.current?.scope !== scope) {
      memberActionKey.current = { scope, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action(memberActionKey.current.key);
      memberActionKey.current = null;
      setEditingMemberId('');
      setMemberEditDraft(null);
      setNotice(successMessage);
      await refresh();
    } catch (failure) {
      setError(readError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function submitMemberEdit(event: FormEvent<HTMLFormElement>, member: CustomerFamilyMember) {
    event.preventDefault();
    if (!household || !memberEditDraft) return;
    const input = {
      expectedVersion: member.version,
      displayName: memberEditDraft.displayName.trim(),
      displayGender: memberEditDraft.displayGender,
      ...(memberEditDraft.changeRelationship
        ? {
            ...(memberEditDraft.relationshipId
              ? { relationshipId: memberEditDraft.relationshipId }
              : {}),
            relativeMemberId: memberEditDraft.relativeMemberId,
            relationship: memberEditDraft.relationship,
            basis: memberEditDraft.basis,
          }
        : {}),
    };
    await runMemberAction(
      `update:${member.id}`,
      (idempotencyKey) =>
        updateCustomerFamilyMember(household.id, member.id, input, idempotencyKey),
      'اطلاعات عضو خانواده به‌روز شد.',
    );
  }

  async function archiveMember(member: CustomerFamilyMember) {
    if (!household) return;
    if (
      !window.confirm(
        'این عضویت بایگانی می‌شود و دعوت‌های در انتظار لغو می‌شوند. تاریخچه حفظ می‌شود و کارت مشترک خانواده تغییر نمی‌کند. ادامه می‌دهی؟',
      )
    )
      return;
    await runMemberAction(
      `archive:${member.id}:${member.version}`,
      (idempotencyKey) =>
        archiveCustomerFamilyMember(household.id, member.id, member.version, idempotencyKey),
      'عضویت بایگانی شد و دسترسی مرتبط لغو شد.',
    );
  }

  async function removeRelationship(
    member: CustomerFamilyMember,
    relationship: FamilyHousehold['relationships'][number],
  ) {
    if (!household || !relationship.id) return;
    const relativeId =
      relationship.fromMemberId === member.id ? relationship.toMemberId : relationship.fromMemberId;
    const relative = household.members.find((item) => item.id === relativeId);
    if (
      !window.confirm(
        `نسبت ثبت‌شده با «${relative?.displayName ?? 'عضو خانواده'}» قطع می‌شود. این شخص از خانواده حذف نمی‌شود و نسبت‌های دیگر باقی می‌مانند. ادامه می‌دهی؟`,
      )
    )
      return;
    await runMemberAction(
      `relationship:${relationship.id}`,
      (idempotencyKey) =>
        removeCustomerFamilyRelationship(
          household.id,
          relationship.id!,
          { memberId: member.id, expectedVersion: member.version },
          idempotencyKey,
        ),
      'نسبت قطع شد؛ سایر اعضا و نسبت‌ها باقی ماندند.',
    );
  }

  function renderFamilyMember(member: CustomerFamilyHousehold['members'][number]) {
    if (!household) return null;
    const editable = member.isViewer || (household.canManage && member.isDependent);
    const canEditRelationship = household.canManage && (member.isDependent || member.isViewer);
    const canArchive =
      (household.canManage && member.isDependent) ||
      (member.isViewer && household.accessRole === 'member');
    const memberEdges = household.relationships.filter(
      (edge) => edge.fromMemberId === member.id || edge.toMemberId === member.id,
    );
    const linkedRelatives = household.members.filter(
      (relative) => relative.isAccountLinked && !relative.isViewer,
    );
    return (
      <Surface className={styles.memberCard} key={member.id}>
        <div className={styles.avatar} aria-hidden="true">
          {member.isViewer ? 'ش' : initials(member.displayName)}
        </div>
        <div className={styles.memberText}>
          <h3>
            {member.isViewer ? `${viewerName || member.displayName} (من)` : member.displayName}
          </h3>
          <p>{member.relationshipLabel}</p>
          <small>
            {member.isAccountLinked ? 'حساب فانتینو متصل' : 'هنوز حسابی به این عضو متصل نیست'}
          </small>
          {member.relationshipStatus === 'needs_review' && member.relationship !== 'خودم' && (
            <small>نسبت قدیمی ثبت‌شده: {member.relationship}</small>
          )}
          {member.relationshipStatus === 'ambiguous' && (
            <small>برای نمایش دقیق، نسبت‌های ثبت‌شده را بازبینی کن.</small>
          )}
        </div>
        <span className={styles.memberType}>{member.isDependent ? 'وابسته' : 'بزرگسال'}</span>
        {(editable || canArchive || canEditRelationship) && (
          <div className={styles.memberActions}>
            {editable && (
              <Button
                disabled={busy}
                onClick={() => {
                  if (editingMemberId === member.id) {
                    setEditingMemberId('');
                    setMemberEditDraft(null);
                    memberActionKey.current = null;
                  } else {
                    startMemberEdit(member);
                  }
                }}
                type="button"
                tone="secondary"
              >
                {editingMemberId === member.id ? 'بستن ویرایش' : 'ویرایش اطلاعات'}
              </Button>
            )}
            {canArchive && (
              <Button
                disabled={busy}
                onClick={() => void archiveMember(member)}
                type="button"
                tone="secondary"
              >
                بایگانی عضویت
              </Button>
            )}
          </div>
        )}
        {editingMemberId === member.id && memberEditDraft && (
          <div className={styles.memberEditor}>
            {editable && (
              <form
                className={styles.memberEditForm}
                onSubmit={(event) => void submitMemberEdit(event, member)}
              >
                <label className={styles.field}>
                  <span>نام نمایشی</span>
                  <input
                    required
                    maxLength={80}
                    minLength={2}
                    value={memberEditDraft.displayName}
                    onChange={(event) => {
                      memberActionKey.current = null;
                      setMemberEditDraft({
                        ...memberEditDraft,
                        displayName: event.currentTarget.value,
                      });
                    }}
                  />
                </label>
                <label className={styles.field}>
                  <span>عنوان نمایشی (اختیاری)</span>
                  <select
                    value={memberEditDraft.displayGender ?? ''}
                    onChange={(event) => {
                      memberActionKey.current = null;
                      setMemberEditDraft({
                        ...memberEditDraft,
                        displayGender: event.currentTarget.value
                          ? (event.currentTarget.value as NonNullable<
                              MemberEditDraft['displayGender']
                            >)
                          : null,
                      });
                    }}
                  >
                    <option value="">ثبت نشده</option>
                    <option value="female">زن</option>
                    <option value="male">مرد</option>
                    <option value="unspecified">عنوان خنثی</option>
                  </select>
                </label>
                {canEditRelationship && (
                  <label className={styles.relationshipToggle}>
                    <input
                      checked={memberEditDraft.changeRelationship}
                      onChange={(event) => {
                        memberActionKey.current = null;
                        setMemberEditDraft({
                          ...memberEditDraft,
                          changeRelationship: event.currentTarget.checked,
                        });
                      }}
                      type="checkbox"
                    />
                    <span>ویرایش یا ثبت نسبت ساختاریافته</span>
                  </label>
                )}
                {canEditRelationship && memberEditDraft.changeRelationship && (
                  <>
                    {memberEdges.length > 0 && (
                      <label className={styles.field}>
                        <span>نسبتی که ویرایش می‌شود</span>
                        <select
                          value={memberEditDraft.relationshipId ?? ''}
                          onChange={(event) => {
                            const edge = memberEdges.find(
                              (item) => item.id === event.currentTarget.value,
                            );
                            memberActionKey.current = null;
                            setMemberEditDraft({
                              ...memberEditDraft,
                              ...(edge
                                ? {
                                    relationshipId: edge.id,
                                    relativeMemberId:
                                      edge.fromMemberId === member.id
                                        ? edge.toMemberId
                                        : edge.fromMemberId,
                                    relationship: relationshipFromEdge(edge, member.id),
                                    basis: edge.basis,
                                  }
                                : { relationshipId: undefined, relativeMemberId: '' }),
                            });
                          }}
                        >
                          <option value="">ثبت نسبت تازه</option>
                          {memberEdges.map((edge) => {
                            const relativeId =
                              edge.fromMemberId === member.id ? edge.toMemberId : edge.fromMemberId;
                            const relative = household.members.find(
                              (item) => item.id === relativeId,
                            );
                            return (
                              <option key={edge.id} value={edge.id}>
                                {relative?.displayName ?? 'عضو خانواده'} ·{' '}
                                {relationLabels[relationshipFromEdge(edge, member.id)]}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}
                    <label className={styles.field}>
                      <span>نسبت این عضو با فرد انتخاب‌شده</span>
                      <select
                        required
                        value={memberEditDraft.relationship}
                        onChange={(event) => {
                          memberActionKey.current = null;
                          setMemberEditDraft({
                            ...memberEditDraft,
                            relationship: event.currentTarget
                              .value as MemberEditDraft['relationship'],
                          });
                        }}
                      >
                        {Object.entries(relationLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>فرد مرتبط</span>
                      <select
                        required
                        value={memberEditDraft.relativeMemberId}
                        onChange={(event) => {
                          memberActionKey.current = null;
                          setMemberEditDraft({
                            ...memberEditDraft,
                            relativeMemberId: event.currentTarget.value,
                          });
                        }}
                      >
                        <option value="">یک عضو را انتخاب کن</option>
                        {household.members
                          .filter((relative) => relative.id !== member.id)
                          .map((relative) => (
                            <option
                              key={relative.id}
                              disabled={linkedRelatives.some((linked) => linked.id === relative.id)}
                              value={relative.id}
                            >
                              {relative.displayName}
                              {linkedRelatives.some((linked) => linked.id === relative.id)
                                ? ' · ثبت نسبت نیازمند تأیید خودش است'
                                : ''}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>مبنای نسبت</span>
                      <select
                        value={memberEditDraft.basis}
                        onChange={(event) => {
                          memberActionKey.current = null;
                          setMemberEditDraft({
                            ...memberEditDraft,
                            basis: event.currentTarget.value as MemberEditDraft['basis'],
                          });
                        }}
                      >
                        {Object.entries(basisLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {linkedRelatives.length > 0 && (
                      <p className={styles.hint}>
                        برای حفظ رضایت، نسبت جدید با حساب بزرگسال متصل از این صفحه قابل‌تغییر نیست؛
                        خود آن شخص باید تأیید کند.
                      </p>
                    )}
                  </>
                )}
                <div className={styles.memberActions}>
                  <Button disabled={busy} type="submit">
                    ذخیره تغییرات
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setEditingMemberId('');
                      setMemberEditDraft(null);
                    }}
                    type="button"
                    tone="secondary"
                  >
                    انصراف
                  </Button>
                </div>
              </form>
            )}
            {memberEdges.length > 0 && (
              <section className={styles.relationshipList} aria-label="نسبت‌های ثبت‌شده">
                <h4>نسبت‌های ثبت‌شده</h4>
                <ul>
                  {memberEdges.map((edge) => {
                    const relativeId =
                      edge.fromMemberId === member.id ? edge.toMemberId : edge.fromMemberId;
                    const relative = household.members.find((item) => item.id === relativeId);
                    return (
                      <li key={edge.id ?? `${edge.fromMemberId}:${edge.toMemberId}:${edge.kind}`}>
                        <span>
                          {relative?.displayName ?? 'عضو خانواده'} ·{' '}
                          {relationLabels[relationshipFromEdge(edge, member.id)]} ·{' '}
                          {basisLabels[edge.basis]}
                        </span>
                        {canEditRelationship && edge.id && (
                          <Button
                            disabled={busy}
                            onClick={() => void removeRelationship(member, edge)}
                            type="button"
                            tone="secondary"
                          >
                            قطع نسبت
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
      </Surface>
    );
  }

  if (loading) {
    return (
      <main className={`customer-page ${styles.page}`}>
        <Surface className={styles.state} aria-busy="true">
          <span className={styles.spinner} aria-hidden="true" />
          <p role="status">در حال دریافت اطلاعات خانواده…</p>
        </Surface>
      </main>
    );
  }

  return (
    <main className={`customer-page ${styles.page}`}>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <Button onClick={() => void refresh(true)} type="button" tone="secondary">
            تلاش دوباره
          </Button>
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {stale && (
        <p className={styles.stale} role="status">
          نمایش آخرین اطلاعات دریافت‌شده؛ اتصال را بررسی کن و تازه‌سازی را بزن.
        </p>
      )}

      {(data?.invitations.length ?? 0) > 0 && (
        <section className={styles.section} aria-labelledby="family-inbox-title">
          <div className={styles.sectionHeading}>
            <span>دعوت‌ها</span>
            <h2 id="family-inbox-title">درخواست‌های خانواده</h2>
          </div>
          <div className={styles.invitationList}>
            {data!.invitations.map((invitation) => (
              <Surface className={styles.invitationCard} key={invitation.id}>
                <div className={styles.invitationText}>
                  <strong>{invitation.householdName}</strong>
                  <span>دعوت برای عضویت در خانواده‌ی «{invitation.memberName}»</span>
                  <InvitationStatus status={invitation.status} />
                </div>
                {invitation.status === 'pending' && (
                  <div className={styles.actions}>
                    <Button
                      disabled={busy}
                      onClick={() => void acceptInvitation(invitation.id)}
                      type="button"
                    >
                      پذیرش و پیوند
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void runInvitationAction(
                          () => declineCustomerFamilyInvitation(invitation.id),
                          'دعوت رد شد.',
                        )
                      }
                      type="button"
                      tone="secondary"
                    >
                      رد دعوت
                    </Button>
                  </div>
                )}
                {invitation.status === 'accepted' && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void runInvitationAction(
                        () => linkCustomerFamilyInvitation(invitation.id),
                        'حساب شما به خانواده پیوند خورد.',
                      )
                    }
                    type="button"
                  >
                    تکمیل پیوند حساب
                  </Button>
                )}
                {invitation.status === 'claim_pending' && (
                  <span className={styles.waiting}>در انتظار تأیید سرپرست</span>
                )}
                {invitation.status === 'conflict_review' && (
                  <span className={styles.waiting}>نیازمند بررسی پشتیبانی</span>
                )}
              </Surface>
            ))}
          </div>
        </section>
      )}

      {data?.items.length ? (
        <>
          <section className={styles.section} aria-labelledby="household-title">
            <div className={styles.sectionHeading}>
              <span>خانواده‌های من</span>
              <h2 id="household-title">اعضا و نسبت‌ها</h2>
            </div>
            {data.items.length > 1 && (
              <label className={styles.field}>
                <span>انتخاب خانواده</span>
                <select
                  value={selectedHouseholdId}
                  onChange={(event) => setSelectedHouseholdId(event.currentTarget.value)}
                >
                  {data.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {household && (
              <div className={styles.householdHeader}>
                <div>
                  <h3>{household.name}</h3>
                  <p>
                    {household.members.length} عضو ثبت‌شده ·{' '}
                    {
                      household.invitations.filter(
                        (invite) =>
                          invite.status === 'pending' || invite.status === 'claim_pending',
                      ).length
                    }{' '}
                    دعوت در انتظار · دسترسی شما: {roleLabel(household.accessRole)}
                  </p>
                </div>
                <Badge tone={household.status === 'active' ? 'success' : 'warning'}>
                  {household.status === 'active' ? 'فعال' : 'غیرفعال'}
                </Badge>
              </div>
            )}
          </section>

          {household && (
            <section className={styles.section} aria-labelledby="members-title">
              <div className={styles.sectionHeading}>
                <span>نمودار خانواده</span>
                <h2 id="members-title">اعضا</h2>
              </div>
              {household.members.length ? (
                <div className={styles.memberGroups}>
                  {groupedMembers.close.length > 0 && (
                    <section aria-labelledby="close-family-title">
                      <h3 className={styles.memberGroupHeader} id="close-family-title">
                        خانواده‌ی نزدیک
                      </h3>
                      <div className={styles.memberList}>
                        {groupedMembers.close.map(renderFamilyMember)}
                      </div>
                    </section>
                  )}
                  {groupedMembers.extended.length > 0 && (
                    <details
                      className={styles.extendedGroup}
                      open={groupedMembers.close.length === 0}
                    >
                      <summary>
                        بستگان دیگر و نسبت‌های نیازمند بازبینی ({groupedMembers.extended.length})
                      </summary>
                      <div className={styles.memberList}>
                        {groupedMembers.extended.map(renderFamilyMember)}
                      </div>
                    </details>
                  )}
                </div>
              ) : (
                <Surface className={styles.empty}>
                  <h3>هنوز عضوی ثبت نشده</h3>
                  <p>
                    نام افراد را وارد کن و نسبت هر نفر را بر اساس اطلاعاتی که خودت می‌دانی ثبت کن.
                  </p>
                </Surface>
              )}
              {household.canManage && (
                <MemberWizard
                  busy={busy}
                  draft={draft}
                  household={household}
                  onChange={(next) => {
                    memberCreateIdempotencyKey.current = null;
                    setDraft(next);
                  }}
                  onSubmit={submitMember}
                  onStepChange={setMemberStep}
                  step={memberStep}
                />
              )}
            </section>
          )}

          {household?.canManage && household.invitations.length > 0 && (
            <section className={styles.section} aria-labelledby="sent-invitations-title">
              <div className={styles.sectionHeading}>
                <span>پیگیری</span>
                <h2 id="sent-invitations-title">دعوت‌های این خانواده</h2>
              </div>
              <div className={styles.invitationList}>
                {household.invitations.map((invitation) => {
                  return (
                    <Surface className={styles.invitationCard} key={invitation.id}>
                      <div className={styles.invitationText}>
                        <strong>{invitation.memberName ?? 'عضو خانواده'}</strong>
                        <InvitationStatus status={invitation.status} />
                      </div>
                      {invitation.status === 'claim_pending' && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void runInvitationAction(
                              () => approveCustomerDependentClaim(invitation.id),
                              'پیوند حساب وابسته تأیید شد.',
                            )
                          }
                          type="button"
                        >
                          تأیید پیوند حساب
                        </Button>
                      )}
                      {(invitation.status === 'pending' ||
                        invitation.status === 'claim_pending' ||
                        invitation.status === 'conflict_review' ||
                        invitation.status === 'expired') && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void runInvitationAction(
                              () => revokeCustomerFamilyInvitation(invitation.id),
                              'دعوت لغو شد.',
                            )
                          }
                          type="button"
                          tone="secondary"
                        >
                          لغو دعوت
                        </Button>
                      )}
                    </Surface>
                  );
                })}
              </div>
            </section>
          )}
        </>
      ) : (
        <section className={styles.section} aria-labelledby="create-household-title">
          <div className={styles.sectionHeading}>
            <span>شروع کار</span>
            <h2 id="create-household-title">خانواده‌ات را بساز</h2>
          </div>
          <Surface className={styles.empty}>
            <p>
              برای ثبت اعضا، ابتدا یک خانواده بساز. ثبت خانواده، شعبه یا کارت را به حساب شما متصل
              نمی‌کند.
            </p>
            <form className={styles.createForm} onSubmit={submitHousehold}>
              <label className={styles.field}>
                <span>نام خانواده</span>
                <input
                  maxLength={80}
                  minLength={2}
                  onChange={(event) => setHouseholdName(event.currentTarget.value)}
                  required
                  value={householdName}
                />
              </label>
              <Button disabled={busy || householdName.trim().length < 2} type="submit">
                ساخت خانواده
              </Button>
            </form>
          </Surface>
        </section>
      )}

      {shareLink && (
        <section className={styles.sharePanel} aria-labelledby="share-link-title">
          <div>
            <span>پیوند یک‌بارمصرف دعوت</span>
            <h2 id="share-link-title">برای عضو خانواده بفرست</h2>
            <p>
              پیوند را فقط برای همان فرد بفرست. پذیرش به ورود با حساب و شماره‌ی تأییدشده نیاز دارد؛
              با لغو دعوت، پیوند هم بی‌اعتبار می‌شود.
            </p>
          </div>
          <div className={styles.copyRow}>
            <input
              aria-label="پیوند دعوت"
              dir="ltr"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              value={shareLink}
            />
            <Button onClick={() => void copyShareLink()} type="button" tone="secondary">
              {copied ? 'کپی شد' : 'کپی پیوند'}
            </Button>
          </div>
        </section>
      )}

      <p className={styles.privacyNote}>
        {profile.firstName ? `${profile.firstName}، ` : ''}اطلاعات خانواده فقط در خانواده‌های مجاز
        نمایش داده می‌شود. نسبت‌های قدیمی تا زمان بازبینی به‌عنوان واقعیت تأییدشده در نظر گرفته
        نمی‌شوند.
      </p>
    </main>
  );
}

function relationshipFromEdge(
  edge: FamilyHousehold['relationships'][number],
  memberId: string,
): AddCustomerFamilyMemberInput['relationship'] {
  if (edge.kind === 'parent_of') return edge.fromMemberId === memberId ? 'parent' : 'child';
  if (edge.kind === 'guardian_of') return edge.fromMemberId === memberId ? 'guardian' : 'ward';
  return edge.kind === 'spouse_of' ? 'spouse' : 'sibling';
}

function MemberWizard({
  busy,
  draft,
  household,
  onChange,
  onSubmit,
  onStepChange,
  step,
}: {
  busy: boolean;
  draft: Draft;
  household: CustomerFamilyHousehold;
  onChange: (draft: Draft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStepChange: (step: 1 | 2 | 3) => void;
  step: 1 | 2 | 3;
}) {
  return (
    <Surface className={styles.wizard}>
      <div className={styles.wizardHeader}>
        <div>
          <span>افزودن عضو · گام {step} از ۳</span>
          <h3>{step === 1 ? 'مشخصات عضو' : step === 2 ? 'نسبت و دعوت حساب' : 'بازبینی و تأیید'}</h3>
        </div>
        <div
          className={styles.progress}
          role="progressbar"
          aria-label={`گام ${step} از ۳`}
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={step}
        >
          <span style={{ width: `${Math.round((step / 3) * 100)}%` }} />
        </div>
      </div>
      <form
        onSubmit={(event) => {
          if (step < 3) {
            event.preventDefault();
            onStepChange((step + 1) as 2 | 3);
            return;
          }
          onSubmit(event);
        }}
      >
        {step === 1 ? (
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>نام نمایشی</span>
              <input
                autoComplete="off"
                maxLength={80}
                minLength={2}
                onChange={(event) => onChange({ ...draft, displayName: event.currentTarget.value })}
                required
                value={draft.displayName}
              />
            </label>
            <label className={styles.checkboxField}>
              <input
                checked={draft.isDependent}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    isDependent: event.currentTarget.checked,
                    relationship: event.currentTarget.checked ? 'child' : 'sibling',
                    basis: event.currentTarget.checked ? 'biological' : 'unspecified',
                  })
                }
                type="checkbox"
              />
              <span>این عضو وابسته و تحت سرپرستی من است</span>
            </label>
            <Button
              disabled={draft.displayName.trim().length < 2}
              onClick={() => onStepChange(2)}
              type="button"
            >
              ادامه به تعیین نسبت
            </Button>
          </div>
        ) : step === 2 ? (
          <>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>نسبت عضو جدید با</span>
                <select
                  value={draft.relativeMemberId}
                  onChange={(event) =>
                    onChange({ ...draft, relativeMemberId: event.currentTarget.value })
                  }
                >
                  <option value="viewer">من</option>
                  {household.members
                    .filter((member) => !member.isViewer)
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>نسبت عضو جدید</span>
                <select
                  value={draft.relationship}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      relationship: event.currentTarget.value as Draft['relationship'],
                    })
                  }
                >
                  {Object.entries(relationLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>مبنای نسبت</span>
                <select
                  value={draft.basis}
                  onChange={(event) =>
                    onChange({ ...draft, basis: event.currentTarget.value as Draft['basis'] })
                  }
                >
                  {Object.entries(basisLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>جنسیت برای نمایش دقیق‌تر نسبت‌های دورتر (اختیاری)</span>
                <select
                  value={draft.displayGender}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      displayGender: event.currentTarget.value as Draft['displayGender'],
                    })
                  }
                >
                  <option value="unspecified">ثبت نمی‌کنم</option>
                  <option value="female">زن</option>
                  <option value="male">مرد</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>شماره‌ی همراه برای دعوت (اختیاری)</span>
                <input
                  autoComplete="off"
                  dir="ltr"
                  inputMode="tel"
                  onChange={(event) => onChange({ ...draft, phone: event.currentTarget.value })}
                  placeholder="09…"
                  value={draft.phone}
                />
                <small>شماره فقط در Gateway برای یافتن حساب یا ساخت hash امن استفاده می‌شود.</small>
              </label>
              {draft.isDependent && !draft.phone.trim() && (
                <label className={styles.checkboxField}>
                  <input
                    checked={draft.createClaimLink}
                    onChange={(event) =>
                      onChange({ ...draft, createClaimLink: event.currentTarget.checked })
                    }
                    type="checkbox"
                  />
                  <span>ساخت پیوند درخواست اتصال حساب کودک</span>
                </label>
              )}
            </div>
            <p className={styles.hint}>
              اگر نسبت‌ها کامل نباشند، سامانه عنوان خنثی نمایش می‌دهد و از روی نام یا شماره حدس
              نمی‌زند.
            </p>
            <div className={styles.actions}>
              <Button
                disabled={busy}
                onClick={() => onStepChange(1)}
                type="button"
                tone="secondary"
              >
                بازگشت
              </Button>
              <Button disabled={busy} onClick={() => onStepChange(3)} type="button">
                بازبینی اطلاعات
              </Button>
            </div>
          </>
        ) : (
          <>
            <dl className={styles.reviewList}>
              <div>
                <dt>نام</dt>
                <dd>{draft.displayName.trim()}</dd>
              </div>
              <div>
                <dt>نوع عضو</dt>
                <dd>{draft.isDependent ? 'وابسته و تحت سرپرستی' : 'بزرگسال'}</dd>
              </div>
              <div>
                <dt>نسبت به</dt>
                <dd>
                  {draft.relativeMemberId === 'viewer'
                    ? 'من'
                    : (household.members.find((member) => member.id === draft.relativeMemberId)
                        ?.displayName ?? 'عضو انتخاب‌شده')}
                </dd>
              </div>
              <div>
                <dt>نسبت پیشنهادی</dt>
                <dd>
                  {relationLabels[draft.relationship]} · {basisLabels[draft.basis]}
                </dd>
              </div>
              <div>
                <dt>اتصال حساب</dt>
                <dd>
                  {draft.phone.trim()
                    ? 'ارسال دعوت با شماره‌ی واردشده؛ پذیرش با حساب و شماره‌ی تأییدشده لازم است'
                    : draft.createClaimLink
                      ? 'پیوند درخواست اتصال حساب ساخته می‌شود و پس از تأیید سرپرست فعال خواهد شد'
                      : 'فعلاً بدون دعوت حساب'}
                </dd>
              </div>
            </dl>
            <p className={styles.hint}>
              شماره فقط برای یافتن حساب یا ساخت hash دعوت استفاده می‌شود و در سرویس خانواده ذخیره
              نمی‌شود. نسبتِ دعوت بزرگسال تنها پس از پذیرش صریح او فعال می‌شود.
            </p>
            <div className={styles.actions}>
              <Button
                disabled={busy}
                onClick={() => onStepChange(2)}
                type="button"
                tone="secondary"
              >
                بازگشت
              </Button>
              <Button disabled={busy} type="submit">
                {busy ? 'در حال ثبت…' : 'تأیید و ثبت عضو'}
              </Button>
            </div>
          </>
        )}
      </form>
    </Surface>
  );
}

function InvitationStatus({
  status,
}: {
  status: CustomerFamilyHousehold['invitations'][number]['status'];
}) {
  const labels: Record<typeof status, string> = {
    pending: 'در انتظار پاسخ',
    accepted: 'پذیرفته‌شده · پیوند در انتظار تکمیل',
    declined: 'رد شده',
    revoked: 'لغو شده',
    expired: 'منقضی شده',
    claim_pending: 'در انتظار تأیید سرپرست',
    linked: 'حساب پیوند خورده',
    conflict_review: 'نیازمند بررسی',
  };
  return <span className={styles.status}>{labels[status]}</span>;
}

function roleLabel(role: CustomerFamilyHousehold['accessRole']) {
  if (role === 'owner') return 'مالک';
  if (role === 'guardian') return 'سرپرست';
  return 'عضو';
}

function initials(value: string) {
  return (
    value
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => [...part][0])
      .join('') || '؟'
  );
}

function readError(failure: unknown) {
  if (failure instanceof Error && failure.message) return failure.message;
  return 'ارتباط با سرویس خانواده برقرار نشد. اتصال را بررسی و دوباره تلاش کن.';
}
