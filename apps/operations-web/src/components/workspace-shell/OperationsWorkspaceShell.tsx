'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { OperationsThemeToggle } from './OperationsThemeToggle';
import {
  scopeKey,
  type OperationsScope,
  type OperationsScopeOption,
} from '../../lib/auth/operations-access';
import styles from './OperationsWorkspaceShell.module.css';

export type WorkspaceSection =
  | 'overview'
  | 'branches'
  | 'staff'
  | 'staffRoles'
  | 'invitationsReceived'
  | 'invitationsIssued'
  | 'devices'
  | 'cardsInventory'
  | 'cardsAssignments'
  | 'family'
  | 'familyMembers'
  | 'familyInvitations'
  | 'familyHistory'
  | 'formsLibrary'
  | 'formsResponses'
  | 'formsBranches'
  | 'reportsSummary'
  | 'reportsBranches'
  | 'reportsDaily';

type NavigationIcon =
  | 'groupOverview'
  | 'groupOrganization'
  | 'groupEquipment'
  | 'groupForms'
  | 'groupReports'
  | 'groupFamilies'
  | 'overview'
  | 'branches'
  | 'staff'
  | 'invitationsReceived'
  | 'invitationsIssued'
  | 'devices'
  | 'cardsInventory'
  | 'cardsAssignments'
  | 'familySearch'
  | 'familyMembers'
  | 'familyInvitations'
  | 'familyHistory'
  | 'formsLibrary'
  | 'formsResponses'
  | 'formsBranches'
  | 'reportsSummary'
  | 'reportsBranches'
  | 'reportsDaily';

type Props = {
  activeSection: WorkspaceSection;
  activeScope: OperationsScopeOption;
  scopeOptions: OperationsScopeOption[];
  selectingScopeKey: string | null;
  scopeError: string;
  userLabel: string;
  logoutBusy: boolean;
  children: ReactNode;
  onLogout: () => void;
  onSectionChange: (section: WorkspaceSection) => void;
  onSelectScope: (scope: OperationsScope) => void | Promise<void>;
};

const sectionLabels: Record<WorkspaceSection, string> = {
  overview: 'نمای کلی',
  branches: 'شعبه‌ها',
  staff: 'اعضا',
  staffRoles: 'نقش‌ها',
  invitationsReceived: 'دعوت‌های دریافتی',
  invitationsIssued: 'دعوت‌های ارسالی',
  devices: 'دستگاه‌ها',
  cardsInventory: 'موجودی کارت‌ها',
  cardsAssignments: 'کارت خانواده‌ها',
  family: 'جست‌وجوی خانواده‌ها',
  familyMembers: 'اعضای خانواده',
  familyInvitations: 'دعوت‌های خانواده',
  familyHistory: 'سابقه خانواده',
  formsLibrary: 'فهرست فرم‌ها',
  formsResponses: 'پاسخ‌های فرم',
  formsBranches: 'پاسخ فرم‌ها در شعب',
  reportsSummary: 'خلاصه عملکرد',
  reportsBranches: 'مقایسه شعب',
  reportsDaily: 'فعالیت روزانه',
};

const sectionDescriptions: Record<WorkspaceSection, string> = {
  overview: 'وضعیت شعب و دستگاه‌های مجموعه',
  branches: 'فهرست شعب فعال و وضعیت عملیاتی آن‌ها',
  staff: 'اعضای فعال در مجموعه یا شعبه‌ی انتخاب‌شده',
  staffRoles: 'تعریف نقش‌ها و دسترسی‌های همین محدوده',
  invitationsReceived: 'دعوت‌هایی که برای حساب شما فرستاده شده‌اند',
  invitationsIssued: 'دعوت‌های کاری فرستاده‌شده برای همکاران',
  devices: 'فهرست دستگاه‌ها و وضعیت آن‌ها',
  cardsInventory: 'کارت‌های موجود در شعبه‌ی انتخاب‌شده',
  cardsAssignments: 'مدیریت کارت‌های خانواده در شعبه‌ی انتخاب‌شده',
  family: 'جست‌وجو و پیگیری خانواده‌های مشتری',
  familyMembers: 'اعضای خانواده‌ی انتخاب‌شده',
  familyInvitations: 'وضعیت دعوت‌های خانواده‌ی انتخاب‌شده',
  familyHistory: 'تغییرات ثبت‌شده برای خانواده‌ی انتخاب‌شده',
  formsLibrary: 'فرم‌های ثبت‌شده در مجموعه',
  formsResponses: 'پاسخ‌های ثبت‌شده برای یک فرم انتخاب‌شده',
  formsBranches: 'مقایسه‌ی پاسخ فرم‌ها بین شعب',
  reportsSummary: 'خلاصه‌ی گزارش‌ها در بازه‌ی انتخاب‌شده',
  reportsBranches: 'مقایسه‌ی گزارش مجموعه بین شعب',
  reportsDaily: 'روند روزانه‌ی فعالیت‌ها در بازه‌ی انتخاب‌شده',
};

const navigationGroups: Array<{
  id: string;
  label: string;
  icon: NavigationIcon;
  sections: WorkspaceSection[];
}> = [
  { id: 'overview', label: 'پیشخوان', icon: 'groupOverview', sections: ['overview'] },
  {
    id: 'structure-access',
    label: 'شعب و اعضا',
    icon: 'groupOrganization',
    sections: ['branches', 'staff', 'staffRoles', 'invitationsReceived', 'invitationsIssued'],
  },
  {
    id: 'cards-devices',
    label: 'کارت‌ها و دستگاه‌ها',
    icon: 'groupEquipment',
    sections: ['devices', 'cardsInventory', 'cardsAssignments'],
  },
  {
    id: 'forms',
    label: 'فرم‌ها',
    icon: 'groupForms',
    sections: ['formsLibrary', 'formsResponses', 'formsBranches'],
  },
  {
    id: 'reports',
    label: 'گزارش‌ها',
    icon: 'groupReports',
    sections: ['reportsSummary', 'reportsBranches', 'reportsDaily'],
  },
  {
    id: 'support',
    label: 'خانواده‌ها',
    icon: 'groupFamilies',
    sections: ['family', 'familyMembers', 'familyInvitations', 'familyHistory'],
  },
];

const sectionIcons: Record<WorkspaceSection, NavigationIcon> = {
  overview: 'overview',
  branches: 'branches',
  staff: 'staff',
  staffRoles: 'staff',
  invitationsReceived: 'invitationsReceived',
  invitationsIssued: 'invitationsIssued',
  devices: 'devices',
  cardsInventory: 'cardsInventory',
  cardsAssignments: 'cardsAssignments',
  family: 'familySearch',
  familyMembers: 'familyMembers',
  familyInvitations: 'familyInvitations',
  familyHistory: 'familyHistory',
  formsLibrary: 'formsLibrary',
  formsResponses: 'formsResponses',
  formsBranches: 'formsBranches',
  reportsSummary: 'reportsSummary',
  reportsBranches: 'reportsBranches',
  reportsDaily: 'reportsDaily',
};

const sectionHrefs: Record<WorkspaceSection, string> = {
  overview: '/',
  branches: '/branches',
  staff: '/staff',
  staffRoles: '/staff/roles',
  invitationsReceived: '/invitations/received',
  invitationsIssued: '/invitations/issued',
  devices: '/devices',
  cardsInventory: '/cards/inventory',
  cardsAssignments: '/cards/assignments',
  family: '/family',
  familyMembers: '/family/members',
  familyInvitations: '/family/invitations',
  familyHistory: '/family/history',
  formsLibrary: '/forms',
  formsResponses: '/forms/responses',
  formsBranches: '/forms/branches',
  reportsSummary: '/reports',
  reportsBranches: '/reports/branches',
  reportsDaily: '/reports/daily',
};

export function workspaceSectionFromPath(pathname: string): WorkspaceSection {
  const path = pathname.replace(/\/$/, '') || '/';
  if (path.startsWith('/staff/roles/')) return 'staffRoles';
  const section = Object.entries(sectionHrefs).find(([, href]) => href === path)?.[0];
  return (section as WorkspaceSection | undefined) ?? 'overview';
}

export function workspaceHref(section: WorkspaceSection) {
  return sectionHrefs[section];
}

const expandedGroupsStorageKey = 'funtino-operations-sidebar-groups';

function scopeLabel(option: OperationsScopeOption) {
  return option.scope.type === 'organization' ? 'همهٔ شعب' : (option.branch?.name ?? 'شعبه');
}

function scopeDescription(option: OperationsScopeOption) {
  return option.scope.type === 'organization'
    ? option.organization.name
    : [option.organization.name, option.branch?.city].filter(Boolean).join(' · ');
}

export function OperationsWorkspaceShell({
  activeSection,
  activeScope,
  scopeOptions,
  selectingScopeKey,
  scopeError,
  userLabel,
  logoutBusy,
  children,
  onLogout,
  onSectionChange,
  onSelectScope,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const initialActiveSection = useRef(activeSection);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const scopeMenuRef = useRef<HTMLDivElement>(null);
  const scopeTriggerRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const previouslyOpenedMobileMenu = useRef(false);

  const availableScopes = useMemo(() => {
    const unique = new Map<string, OperationsScopeOption>();
    for (const option of [activeScope, ...scopeOptions]) unique.set(scopeKey(option.scope), option);
    return [...unique.values()];
  }, [activeScope, scopeOptions]);
  const hasOtherScopes = availableScopes.some(
    (option) => scopeKey(option.scope) !== scopeKey(activeScope.scope),
  );

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem('funtino-operations-sidebar-collapsed') === 'true');
      const savedGroups = window.localStorage.getItem(expandedGroupsStorageKey);
      const activeGroup = navigationGroups.find((group) =>
        group.sections.includes(initialActiveSection.current),
      );
      const parsedGroups: unknown = savedGroups ? JSON.parse(savedGroups) : [];
      setExpandedGroups(
        Array.isArray(parsedGroups)
          ? [
              ...new Set(
                [
                  ...parsedGroups.filter((value): value is string => typeof value === 'string'),
                  activeGroup?.id,
                ].filter((value): value is string => Boolean(value)),
              ),
            ]
          : activeGroup
            ? [activeGroup.id]
            : [],
      );
    } catch {
      setCollapsed(false);
      const activeGroup = navigationGroups.find((group) =>
        group.sections.includes(initialActiveSection.current),
      );
      setExpandedGroups(activeGroup ? [activeGroup.id] : []);
    }
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      window.localStorage.setItem('funtino-operations-sidebar-collapsed', String(collapsed));
    } catch {
      // The menu still works when browser storage is unavailable.
    }
  }, [collapsed, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      window.localStorage.setItem(expandedGroupsStorageKey, JSON.stringify(expandedGroups));
    } catch {
      // Group controls remain usable when browser storage is unavailable.
    }
  }, [expandedGroups, preferencesReady]);

  useEffect(() => {
    const activeGroup = navigationGroups.find((group) => group.sections.includes(activeSection));
    if (activeGroup) {
      setExpandedGroups((current) =>
        current.includes(activeGroup.id) ? current : [...current, activeGroup.id],
      );
    }
  }, [activeSection]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const updateViewport = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    updateViewport();
    media.addEventListener('change', updateViewport);
    return () => media.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    if (!isMobile || !mobileOpen) {
      if (previouslyOpenedMobileMenu.current) mobileMenuButtonRef.current?.focus();
      previouslyOpenedMobileMenu.current = false;
      return;
    }

    previouslyOpenedMobileMenu.current = true;
    const drawer = sidebarRef.current;
    const firstControl = drawer?.querySelector<HTMLElement>('[data-nav-item]');
    firstControl?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function manageDrawerKeys(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !drawer) return;

      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', manageDrawerKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', manageDrawerKeys);
    };
  }, [isMobile, mobileOpen]);

  useEffect(() => {
    if (!scopeMenuOpen) return;
    function closeScopeMenu(event: PointerEvent) {
      if (event.target instanceof Node && !scopeMenuRef.current?.contains(event.target)) {
        setScopeMenuOpen(false);
      }
    }
    function closeScopeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setScopeMenuOpen(false);
        scopeTriggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', closeScopeMenu);
    document.addEventListener('keydown', closeScopeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeScopeMenu);
      document.removeEventListener('keydown', closeScopeMenuOnEscape);
    };
  }, [scopeMenuOpen]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    function closeAccountMenu(event: PointerEvent) {
      if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    }
    function closeAccountMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAccountMenuOpen(false);
        accountTriggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', closeAccountMenu);
    document.addEventListener('keydown', closeAccountMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeAccountMenu);
      document.removeEventListener('keydown', closeAccountMenuOnEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!mobileOpen) setScopeMenuOpen(false);
  }, [mobileOpen]);

  function chooseScope(scope: OperationsScope) {
    setScopeMenuOpen(false);
    setAccountMenuOpen(false);
    scopeTriggerRef.current?.focus();
    void onSelectScope(scope);
  }

  function toggleScopeMenu() {
    setAccountMenuOpen(false);
    setScopeMenuOpen((open) => !open);
  }

  function toggleAccountMenu() {
    setScopeMenuOpen(false);
    setAccountMenuOpen((open) => !open);
  }

  const currentGroupId = navigationGroups.find((group) =>
    group.sections.includes(activeSection),
  )?.id;

  return (
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ''}`}>
      {isMobile && mobileOpen && (
        <button
          aria-label="بستن منوی پنل"
          className={styles.backdrop}
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      )}

      <aside
        aria-hidden={isMobile && !mobileOpen}
        aria-label={isMobile && mobileOpen ? 'منوی پنل عملیات' : undefined}
        aria-modal={isMobile && mobileOpen ? true : undefined}
        className={`${styles.sidebar} ${mobileOpen ? styles.mobileOpen : ''}`}
        id="operations-sidebar"
        inert={isMobile && !mobileOpen}
        ref={sidebarRef}
        role={isMobile && mobileOpen ? 'dialog' : undefined}
      >
        <div className={styles.brandRow}>
          <a className={styles.brand} href="/" aria-label="صفحه اصلی پنل فانتینو">
            <Image
              alt="فانتینو"
              className={styles.brandImage}
              height={48}
              priority
              src="/brand/operations-panel-logo.webp"
              width={126}
            />
          </a>
          <button
            aria-label="بستن منو"
            className={styles.mobileClose}
            onClick={() => setMobileOpen(false)}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className={styles.scopeSwitcher} ref={scopeMenuRef}>
          {hasOtherScopes ? (
            <button
              aria-controls="operations-scope-options"
              aria-expanded={scopeMenuOpen}
              aria-label={`انتخاب مجموعه یا شعبه، مورد فعلی: ${scopeLabel(activeScope)}`}
              className={`${styles.scopeCard} ${styles.scopeCardButton}`}
              onClick={toggleScopeMenu}
              ref={scopeTriggerRef}
              type="button"
            >
              <span aria-hidden="true" className={styles.scopeMark}>
                <Icon name={activeScope.scope.type === 'organization' ? 'organization' : 'branch'} />
              </span>
              <span className={styles.scopeCopy}>
                <span className={styles.scopeCaption}>محل فعالیت</span>
                <strong>{scopeLabel(activeScope)}</strong>
                <span>{scopeDescription(activeScope)}</span>
              </span>
              {selectingScopeKey ? (
                <span aria-label="در حال تغییر" className={styles.tinySpinner} role="status" />
              ) : (
                <Icon name="chevronDown" />
              )}
            </button>
          ) : (
            <div
              aria-label={`محل فعالیت فعلی: ${scopeLabel(activeScope)}`}
              className={styles.scopeCard}
              role="group"
            >
              <span aria-hidden="true" className={styles.scopeMark}>
                <Icon name={activeScope.scope.type === 'organization' ? 'organization' : 'branch'} />
              </span>
              <span className={styles.scopeCopy}>
                <span className={styles.scopeCaption}>محل فعالیت</span>
                <strong>{scopeLabel(activeScope)}</strong>
                <span>{scopeDescription(activeScope)}</span>
              </span>
            </div>
          )}
          {hasOtherScopes && (
            <div
              aria-label="انتخاب مجموعه یا شعبه"
              className={styles.scopeMenu}
              hidden={!scopeMenuOpen}
              id="operations-scope-options"
              role="group"
            >
              <span className={styles.scopeMenuTitle}>انتخاب مجموعه یا شعبه</span>
              {availableScopes.map((option) => {
                const isCurrent = scopeKey(option.scope) === scopeKey(activeScope.scope);
                const optionKey = scopeKey(option.scope);
                const isSelecting = selectingScopeKey === optionKey;
                return (
                  <button
                    aria-current={isCurrent ? 'true' : undefined}
                    className={`${styles.scopeOption} ${isCurrent ? styles.scopeOptionActive : ''}`}
                    disabled={selectingScopeKey !== null || isCurrent}
                    key={optionKey}
                    onClick={() => chooseScope(option.scope)}
                    type="button"
                  >
                    <span aria-hidden="true" className={styles.optionIcon}>
                      <Icon name={option.scope.type === 'organization' ? 'organization' : 'branch'} />
                    </span>
                    <span className={styles.optionText}>
                      <strong>{scopeLabel(option)}</strong>
                      <small>{scopeDescription(option)}</small>
                    </span>
                    {isSelecting && <span aria-hidden="true" className={styles.tinySpinner} />}
                    {isCurrent && <span className={styles.currentScope}>فعال</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <nav aria-label="بخش‌های پنل عملیات" className={styles.navigation}>
          {navigationGroups.map((group) => {
            const sections = group.sections.filter((section) => {
              if (section === 'branches' && activeScope.scope.type !== 'organization') return false;
              if (
                (section === 'formsBranches' || section === 'reportsBranches') &&
                activeScope.scope.type !== 'organization'
              )
                return false;
              return true;
            });
            if (sections.length === 0) return null;
            const expanded = expandedGroups.includes(group.id);
            const visibleSections = expanded
              ? sections
              : sections.filter((section) => section === activeSection);
            return (
              <div className={styles.navGroup} key={group.id}>
                <h2
                  className={`${styles.groupLabel} ${currentGroupId === group.id ? styles.groupLabelActive : ''}`}
                >
                  <button
                    aria-controls={`operations-nav-${group.id}`}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'بستن' : 'بازکردن'} گروه ${group.label}${currentGroupId === group.id ? `؛ بخش جاری ${sectionLabels[activeSection]}` : ''}`}
                    className={styles.groupToggle}
                    onClick={() =>
                      setExpandedGroups((current) =>
                        current.includes(group.id)
                          ? current.filter((id) => id !== group.id)
                          : [...current, group.id],
                      )
                    }
                    title={collapsed ? group.label : undefined}
                    type="button"
                  >
                    <span className={styles.groupCopy}>
                      <span aria-hidden="true" className={styles.groupIcon}>
                        <Icon name={group.icon} />
                      </span>
                      <span className={styles.groupText}>{group.label}</span>
                    </span>
                    <Icon name="chevronDown" />
                  </button>
                </h2>
                <div className={styles.navItems} id={`operations-nav-${group.id}`}>
                  {visibleSections.map((section) => (
                    <Link
                      aria-current={activeSection === section ? 'page' : undefined}
                      className={`${styles.navItem} ${activeSection === section ? styles.navItemActive : ''}`}
                      data-nav-item
                      href={sectionHrefs[section]}
                      key={section}
                      onClick={() => {
                        onSectionChange(section);
                        setMobileOpen(false);
                      }}
                      title={collapsed ? sectionLabels[section] : undefined}
                    >
                      <span aria-hidden="true" className={styles.navIcon}>
                        <Icon name={sectionIcons[section]} />
                      </span>
                      <span className={styles.navLabel}>{sectionLabels[section]}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <OperationsThemeToggle />
        </div>
      </aside>

      <div className={styles.mainColumn}>
        <header className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <button
              aria-controls="operations-sidebar"
              aria-expanded={isMobile ? mobileOpen : !collapsed}
              aria-label={isMobile ? 'بازکردن منو' : collapsed ? 'بازکردن منو' : 'جمع‌کردن منو'}
              className={styles.mobileMenuButton}
              onClick={() => {
                if (isMobile) setMobileOpen(true);
                else setCollapsed((value) => !value);
              }}
              title={isMobile ? 'بازکردن منو' : collapsed ? 'بازکردن منو' : 'جمع‌کردن منو'}
              ref={mobileMenuButtonRef}
              type="button"
            >
              <Icon name="menu" />
            </button>
            <div className={styles.headingCopy}>
              <nav aria-label="مسیر صفحه" className={styles.breadcrumb}>
                <span>فانتینو</span>
                <Icon name="chevron" />
                <span>پنل عملیات</span>
                <Icon name="chevron" />
                <span aria-current="page">{sectionLabels[activeSection]}</span>
              </nav>
              <h1>{sectionLabels[activeSection]}</h1>
              <p>{sectionDescriptions[activeSection]}</p>
            </div>
          </div>

          <div className={styles.headerContext}>
            <div
              aria-label={`محل فعالیت فعلی: ${scopeLabel(activeScope)}`}
              className={styles.headerScope}
              role="group"
            >
              <span aria-hidden="true" className={styles.headerScopeIcon}>
                <Icon name={activeScope.scope.type === 'organization' ? 'organization' : 'branch'} />
              </span>
              <span className={styles.headerScopeCopy}>
                <strong>{scopeLabel(activeScope)}</strong>
                <small>
                  {activeScope.scope.type === 'organization' ? 'مجموعهٔ فعال' : 'شعبهٔ فعال'}
                </small>
              </span>
            </div>
            <span aria-hidden="true" className={styles.headerDivider} />
            <div className={styles.account} ref={accountMenuRef}>
              <button
                aria-controls="operations-account-actions"
                aria-expanded={accountMenuOpen}
                aria-label={`نمایش حساب ${userLabel}، ${activeScope.scope.type === 'organization' ? 'دسترسی مجموعه' : 'دسترسی شعبه'}`}
                className={styles.accountTrigger}
                onClick={toggleAccountMenu}
                ref={accountTriggerRef}
                type="button"
              >
                <span aria-hidden="true" className={styles.avatar}>
                  {userLabel.slice(0, 1) || 'ک'}
                </span>
                <span className={styles.accountCopy}>
                  <strong dir="auto">{userLabel}</strong>
                  <small>
                    {activeScope.scope.type === 'organization' ? 'دسترسی مجموعه' : 'دسترسی شعبه'}
                  </small>
                </span>
                <Icon name="chevronDown" />
              </button>
              <div
                aria-label="گزینه‌های حساب کاربری"
                className={styles.accountMenu}
                hidden={!accountMenuOpen}
                id="operations-account-actions"
                role="group"
              >
                <Link
                  className={styles.accountMenuItem}
                  href="/account/security/management-password"
                >
                  <span aria-hidden="true" className={styles.accountMenuIcon}>
                    <Icon name="shield" />
                  </span>
                  <span>امنیت حساب</span>
                  <Icon name="chevron" />
                </Link>
                <button
                  className={`${styles.accountMenuItem} ${styles.accountMenuLogout}`}
                  disabled={logoutBusy}
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onLogout();
                  }}
                  type="button"
                >
                  <span aria-hidden="true" className={styles.accountMenuIcon}>
                    <Icon name="logout" />
                  </span>
                  <span>{logoutBusy ? 'در حال خروج…' : 'خروج از حساب'}</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        <nav aria-label="مسیر صفحه" className={styles.mobileBreadcrumb}>
          <span>فانتینو</span>
          <Icon name="chevron" />
          <span>پنل عملیات</span>
          <Icon name="chevron" />
          <span aria-current="page">{sectionLabels[activeSection]}</span>
        </nav>

        {scopeError && (
          <div className={styles.scopeError} role="alert">
            <span aria-hidden="true">
              <Icon name="warning" />
            </span>
            <p>{scopeError}</p>
          </div>
        )}

        <main className={styles.content} id="workspace-content">
          {children}
        </main>
      </div>
    </div>
  );
}

function Icon({
  name,
}: {
  name:
    | NavigationIcon
    | 'organization'
    | 'branch'
    | 'check'
    | 'shield'
    | 'collapse'
    | 'expand'
    | 'menu'
    | 'close'
    | 'chevron'
    | 'chevronDown'
    | 'warning'
    | 'logout';
}) {
  const common = {
    'aria-hidden': true as const,
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
  };

  const content: Record<typeof name, ReactNode> = {
    groupOverview: (
      <>
        <rect x="3.5" y="4" width="7" height="6.5" rx="1.5" />
        <rect x="13.5" y="4" width="7" height="6.5" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="6.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="6.5" rx="1.5" />
      </>
    ),
    groupOrganization: (
      <>
        <path d="M3.5 20.5h17M5.5 20.5V7l6.5-3.5L18.5 7v13.5" />
        <path d="M8.5 9h1M8.5 12h1M14.5 9h1M14.5 12h1M10 20.5v-4h4v4" />
      </>
    ),
    groupEquipment: (
      <>
        <path d="M4 8h16v12H4zM8 8V5h8v3M4 12h16" />
        <path d="M10 12v2h4v-2" />
      </>
    ),
    groupForms: (
      <>
        <path d="M7 4.5h9l3 3V19a1.5 1.5 0 0 1-1.5 1.5H7A2 2 0 0 1 5 18.5v-12a2 2 0 0 1 2-2Z" />
        <path d="M16 4.5v3h3M8.5 11h7M8.5 14.5h7M8.5 18h4" />
        <path d="M3.5 8v11a2 2 0 0 0 2 2" />
      </>
    ),
    groupReports: (
      <>
        <rect x="3.5" y="4" width="17" height="16" rx="2" />
        <path d="M7 16v-3M11 16V8M15 16v-5M18 8.5l-3 3-3-2-4 4" />
      </>
    ),
    groupFamilies: (
      <>
        <circle cx="8" cy="8" r="2.7" />
        <circle cx="16" cy="8" r="2.7" />
        <path d="M3.5 19v-1.5a4 4 0 0 1 4-4h1a4 4 0 0 1 4 4V19M11.5 15a4 4 0 0 1 3.5-1.5h1a4 4 0 0 1 4 4V19" />
      </>
    ),
    overview: (
      <>
        <path d="M4.5 15a7.5 7.5 0 1 1 15 0" />
        <path d="M12 12l4-3M5 19.5h14" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
    branches: (
      <>
        <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" />
        <path d="M9 9h6M9 12h6M10 6h4" />
      </>
    ),
    staff: (
      <>
        <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
        <circle cx="10" cy="7.5" r="3.5" />
        <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M16 4.2a3.5 3.5 0 0 1 0 6.6" />
      </>
    ),
    invitationsReceived: (
      <>
        <path d="M4 14h4l2 3h4l2-3h4v6H4z" />
        <path d="M12 3v10M8.5 9.5 12 13l3.5-3.5" />
      </>
    ),
    invitationsIssued: (
      <>
        <rect x="3.5" y="6" width="13.5" height="12" rx="2" />
        <path d="m4.5 7 5.75 4.5L16 7M14 3h6v6M20 3l-7 7" />
      </>
    ),
    devices: (
      <>
        <rect x="2.5" y="4" width="13" height="11" rx="1.5" />
        <path d="M6 19h6M9 15v4" />
        <rect x="17.5" y="7" width="4" height="11" rx="1" />
        <path d="M19 15.5h1" />
      </>
    ),
    cardsInventory: (
      <>
        <rect x="5" y="3.5" width="15" height="12" rx="2" />
        <rect x="3.5" y="8.5" width="15" height="12" rx="2" />
        <path d="M6.5 12.5h5M6.5 16.5h3" />
      </>
    ),
    cardsAssignments: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9.5h18M6.5 14.5h5" />
        <circle cx="17" cy="15" r="2.2" />
        <path d="M14.5 19a3 3 0 0 1 5 0" />
      </>
    ),
    familySearch: (
      <>
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="m15 15 5 5M8.5 10h4M10.5 8v5" />
      </>
    ),
    familyMembers: (
      <>
        <path d="m3 10 9-7 9 7v10.5H3Z" />
        <circle cx="9" cy="12" r="1.8" />
        <circle cx="15" cy="12" r="1.8" />
        <path d="M6 18a3 3 0 0 1 6 0M12 18a3 3 0 0 1 6 0" />
      </>
    ),
    familyInvitations: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-1.5a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4V20M18 7v6M15 10h6" />
      </>
    ),
    familyHistory: (
      <>
        <circle cx="11" cy="12" r="8" />
        <path d="M11 7v5l3 2M4 4v4h4M4.5 8A8 8 0 0 1 19 7" />
      </>
    ),
    formsLibrary: (
      <>
        <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5Z" />
        <path d="M5 5.5v15M9 7h6M9 10.5h6M9 14h6" />
      </>
    ),
    formsResponses: (
      <>
        <path d="M6 3.5h12v17H6zM9 3.5v-1h6v1" />
        <path d="m9 11 2 2 4-4M9 17h6" />
      </>
    ),
    formsBranches: (
      <>
        <path d="M5 4.5h9l3 3v3M14 4.5v3h3M8 10v4m0 0h8m-8 0v5m8-5v5" />
        <circle cx="8" cy="20" r="1.5" />
        <circle cx="16" cy="20" r="1.5" />
        <path d="M5 10h6" />
      </>
    ),
    reportsSummary: (
      <>
        <path d="M12 3.5v8.5h8.5A8.5 8.5 0 1 1 12 3.5Z" />
        <path d="M15 3.8a8.5 8.5 0 0 1 5.2 5.2H15Z" />
      </>
    ),
    reportsBranches: (
      <>
        <path d="M4 19.5h16M6 16V9M12 16V5M18 16v-5" />
        <path d="M4.5 7.5 9 5l3 2 6-3" />
      </>
    ),
    reportsDaily: (
      <>
        <rect x="3.5" y="5" width="17" height="16" rx="2" />
        <path d="M7.5 3v4M16.5 3v4M3.5 9h17" />
        <circle cx="12" cy="15" r="3" />
        <path d="M12 13.5V15l1 1" />
      </>
    ),
    organization: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h2M14 7h2M8 11h2M14 11h2M10 21v-5h4v5" />
      </>
    ),
    branch: (
      <>
        <path d="M6 20v-5a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3V4" />
        <circle cx="6" cy="20" r="2" />
        <circle cx="18" cy="4" r="2" />
        <circle cx="18" cy="20" r="2" />
        <path d="M18 6v12" />
      </>
    ),
    check: (
      <>
        <path d="m5 12.5 4.5 4.5L19 7" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 19 6v5c0 4.4-2.7 7.7-7 10-4.3-2.3-7-5.6-7-10V6l7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    collapse: (
      <>
        <path d="M14.5 5H19v14h-4.5M10 8l-4 4 4 4" />
      </>
    ),
    expand: (
      <>
        <path d="M9.5 5H5v14h4.5M14 8l4 4-4 4" />
      </>
    ),
    menu: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    chevron: (
      <>
        <path d="m9 5 7 7-7 7" />
      </>
    ),
    chevronDown: (
      <>
        <path d="m6 9 6 6 6-6" />
      </>
    ),
    warning: (
      <>
        <path d="M12 3 2.8 19a1.6 1.6 0 0 0 1.4 2.4h15.6a1.6 1.6 0 0 0 1.4-2.4L12 3Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    logout: (
      <>
        <path d="M10 5H5v14h5M15 16l4-4-4-4M19 12H9" />
      </>
    ),
  };

  return <svg {...common}>{content[name]}</svg>;
}
