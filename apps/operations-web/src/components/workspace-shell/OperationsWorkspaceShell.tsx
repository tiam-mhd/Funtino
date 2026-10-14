'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Button } from '@funtino/design-system';
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
  | 'devices'
  | 'cards'
  | 'family'
  | 'reports'
  | 'forms';

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
  branches: 'شعب',
  staff: 'کارکنان و دسترسی‌ها',
  devices: 'دستگاه‌ها و پایش',
  cards: 'موجودی کارت‌ها',
  family: 'خانواده‌ی مشتری',
  reports: 'گزارش‌ها',
  forms: 'فرم‌ها و پاسخ‌ها',
};

const sectionDescriptions: Record<WorkspaceSection, string> = {
  overview: 'وضعیت شعب و سلامت دستگاه‌ها در محدودهٔ مجاز شما',
  branches: 'فهرست شعب فعال و وضعیت عملیاتی آن‌ها',
  staff: 'دعوت‌ها، کارکنان و دسترسی‌های محدودهٔ فعلی',
  devices: 'وضعیت دستگاه‌ها و پیگیری موارد نیازمند رسیدگی',
  cards: 'موجودی کارت و تخصیص‌های مجاز شعبه',
  family: 'مشاهده‌ی محدود خانواده‌ی مشتری در شعبه‌ی انتخاب‌شده',
  reports: 'گزارش تجمیعی رویدادها و سلامت دستگاه‌ها',
  forms: 'فرم‌های مجموعه و پاسخ‌های ثبت‌شده',
};

const navigationGroups: Array<{ id: string; label: string; sections: WorkspaceSection[] }> = [
  { id: 'overview', label: 'پیشخوان', sections: ['overview', 'branches'] },
  { id: 'management', label: 'مدیریت', sections: ['staff', 'family', 'forms'] },
  { id: 'operations', label: 'عملیات', sections: ['devices', 'cards'] },
  { id: 'monitoring', label: 'پایش', sections: ['reports'] },
];

const expandedGroupsStorageKey = 'funtino-operations-sidebar-groups';

function scopeLabel(option: OperationsScopeOption) {
  return option.scope.type === 'organization' ? 'همهٔ شعب' : (option.branch?.name ?? 'شعبه');
}

function scopeDescription(option: OperationsScopeOption) {
  return option.scope.type === 'organization'
    ? option.organization.name
    : `${option.organization.name} · ${option.branch?.city ?? 'شعبهٔ مجاز'}`;
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
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const initialActiveSection = useRef(activeSection);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const scopeMenuRef = useRef<HTMLDivElement>(null);
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
        setScopeMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', closeScopeMenu);
    document.addEventListener('keydown', closeScopeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeScopeMenu);
      document.removeEventListener('keydown', closeScopeMenuOnEscape);
    };
  }, [scopeMenuOpen]);

  function chooseSection(section: WorkspaceSection) {
    onSectionChange(section);
    setMobileOpen(false);
  }

  function chooseScope(scope: OperationsScope) {
    setScopeMenuOpen(false);
    void onSelectScope(scope);
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
          <a className={styles.brand} href="/" aria-label="فانتینو، پنل عملیات">
            <Image
              alt="فانتینو"
              className={styles.brandImage}
              height={42}
              priority
              src="/brand/funtino-logo.png"
              width={126}
            />
            <span className={styles.brandDivider} />
            <span className={styles.brandLabel}>پنل عملیات</span>
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

        <div className={styles.scopeCard}>
          <span aria-hidden="true" className={styles.scopeMark}>
            <Icon name={activeScope.scope.type === 'organization' ? 'organization' : 'branch'} />
          </span>
          <span className={styles.scopeCopy}>
            <span className={styles.scopeCaption}>محدودهٔ فعال</span>
            <strong>
              {activeScope.scope.type === 'organization' ? 'همهٔ شعب' : activeScope.branch?.name}
            </strong>
            <span>{activeScope.organization.name}</span>
          </span>
          <span
            aria-label="محدوده توسط سرور تأیید شده"
            className={styles.scopeVerified}
            role="img"
            title="محدوده تأیید شده"
          >
            <Icon name="check" />
          </span>
        </div>

        <nav aria-label="بخش‌های پنل عملیات" className={styles.navigation}>
          {navigationGroups.map((group) => {
            const sections = group.sections.filter(
              (section) => section !== 'branches' || activeScope.scope.type === 'organization',
            );
            if (sections.length === 0) return null;
            const expanded = expandedGroups.includes(group.id);
            const visibleSections = expanded
              ? sections
              : sections.filter((section) => section === activeSection);
            return (
              <div className={styles.navGroup} key={group.label}>
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
                    <span>{group.label}</span>
                    <Icon name="chevronDown" />
                  </button>
                </h2>
                <div className={styles.navItems} id={`operations-nav-${group.id}`}>
                  {visibleSections.map((section) => (
                    <button
                      aria-current={activeSection === section ? 'page' : undefined}
                      className={`${styles.navItem} ${activeSection === section ? styles.navItemActive : ''}`}
                      data-nav-item
                      key={section}
                      onClick={() => chooseSection(section)}
                      title={collapsed ? sectionLabels[section] : undefined}
                      type="button"
                    >
                      <span aria-hidden="true" className={styles.navIcon}>
                        <Icon name={section} />
                      </span>
                      <span className={styles.navLabel}>{sectionLabels[section]}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <span aria-hidden="true" className={styles.footerShield}>
            <Icon name="shield" />
          </span>
          <span className={styles.footerText}>مجوز هر درخواست در سرور بررسی می‌شود.</span>
          <button
            aria-label={collapsed ? 'بازکردن منوی کناری' : 'بستن منوی کناری'}
            className={styles.collapseButton}
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? 'بازکردن منو' : 'جمع‌کردن منو'}
            type="button"
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} />
          </button>
        </div>
      </aside>

      <div className={styles.mainColumn}>
        <header className={styles.header}>
          <button
            aria-controls="operations-sidebar"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'بستن منو' : 'بازکردن منو'}
            className={styles.mobileMenuButton}
            onClick={() => setMobileOpen(true)}
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

          <div className={styles.headerActions}>
            <div className={styles.scopeSwitcher} ref={scopeMenuRef}>
              <span className={styles.actionCaption}>محدودهٔ کاری</span>
              {hasOtherScopes ? (
                <button
                  aria-label={`تغییر محدودهٔ کاری، محدودهٔ فعلی: ${scopeLabel(activeScope)}`}
                  aria-expanded={scopeMenuOpen}
                  aria-haspopup="true"
                  className={styles.scopeButton}
                  onClick={() => setScopeMenuOpen((open) => !open)}
                  type="button"
                >
                  <span aria-hidden="true" className={styles.scopeButtonIcon}>
                    <Icon name="organization" />
                  </span>
                  <span className={styles.scopeButtonCopy}>
                    <strong>{scopeLabel(activeScope)}</strong>
                    <small>{scopeDescription(activeScope)}</small>
                  </span>
                  {selectingScopeKey ? (
                    <span aria-label="در حال تغییر محدوده" className={styles.tinySpinner} />
                  ) : (
                    <Icon name="chevronDown" />
                  )}
                </button>
              ) : (
                <div
                  aria-label={`محدودهٔ کاری فعلی: ${scopeLabel(activeScope)}`}
                  className={styles.scopeButtonStatic}
                  role="group"
                >
                  <span aria-hidden="true" className={styles.scopeButtonIcon}>
                    <Icon name="organization" />
                  </span>
                  <span className={styles.scopeButtonCopy}>
                    <strong>{scopeLabel(activeScope)}</strong>
                    <small>{scopeDescription(activeScope)}</small>
                  </span>
                  <span aria-label="تأییدشده" className={styles.inlineVerified} role="img">
                    <Icon name="check" />
                  </span>
                </div>
              )}
              {scopeMenuOpen && hasOtherScopes && (
                <div aria-label="انتخاب محدودهٔ کاری" className={styles.scopeMenu}>
                  <span className={styles.scopeMenuTitle}>محدودهٔ مجاز را انتخاب کنید</span>
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
                          <Icon
                            name={option.scope.type === 'organization' ? 'organization' : 'branch'}
                          />
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
                  <p className={styles.scopeMenuNote}>
                    انتخاب محدوده در سرور دوباره بررسی و ثبت می‌شود.
                  </p>
                </div>
              )}
            </div>

            <div className={styles.account}>
              <span aria-hidden="true" className={styles.avatar}>
                {userLabel.slice(0, 1) || 'ک'}
              </span>
              <span className={styles.accountCopy}>
                <strong dir="auto">{userLabel}</strong>
                <small>
                  {activeScope.scope.type === 'organization' ? 'دسترسی مجموعه' : 'دسترسی شعبه'}
                </small>
              </span>
              <a
                className={styles.accountSecurityLink}
                href="/account/security/management-password"
              >
                امنیت حساب
              </a>
              <Button
                className={styles.logoutButton}
                disabled={logoutBusy}
                onClick={onLogout}
                tone="ghost"
                type="button"
              >
                {logoutBusy ? 'در حال خروج…' : 'خروج امن'}
              </Button>
            </div>
          </div>
        </header>

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
    | WorkspaceSection
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
    | 'warning';
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
    overview: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ),
    branches: (
      <>
        <path d="M6 20v-5a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3V4" />
        <circle cx="6" cy="20" r="2" />
        <circle cx="18" cy="4" r="2" />
        <circle cx="18" cy="20" r="2" />
        <path d="M18 6v12" />
      </>
    ),
    staff: (
      <>
        <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
        <circle cx="10" cy="7.5" r="3.5" />
        <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M16 4.2a3.5 3.5 0 0 1 0 6.6" />
      </>
    ),
    devices: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 7h6M9 11h6M9 15h2" />
        <circle cx="16" cy="16" r="1" />
      </>
    ),
    cards: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18M7 15h3" />
      </>
    ),
    family: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.2" />
        <path d="M3.5 20v-1.3a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4V20M15 15a3.5 3.5 0 0 1 5.5 2.8V20" />
      </>
    ),
    reports: (
      <>
        <path d="M4 19.5h16M6 16V9M12 16V4M18 16v-4" />
        <circle cx="6" cy="7" r="1" />
        <circle cx="18" cy="10" r="1" />
      </>
    ),
    forms: (
      <>
        <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" />
        <path d="M14 3.5v4h4M8.5 12h7M8.5 16h7" />
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
  };

  return <svg {...common}>{content[name]}</svg>;
}
