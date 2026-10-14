'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import styles from './SystemShell.module.css';

type IconName =
  | 'menu'
  | 'activity'
  | 'building'
  | 'forms'
  | 'family'
  | 'access'
  | 'clock'
  | 'shield'
  | 'key'
  | 'chevron'
  | 'user'
  | 'logout'
  | 'close';

type NavigationItem = { href: string; label: string; icon: IconName };
type NavigationGroup = { id: string; label: string; icon: IconName; items: NavigationItem[] };

const groups: NavigationGroup[] = [
  {
    id: 'system',
    label: 'عملیات سامانه',
    icon: 'activity',
    items: [
      { href: '/fa/system-health', label: 'پایش عملیاتی', icon: 'activity' },
      { href: '/fa/organizations', label: 'مجموعه‌ها و شعب', icon: 'building' },
      { href: '/fa/forms', label: 'فرم‌ها و قالب‌ها', icon: 'forms' },
      { href: '/fa/customer-family', label: 'پشتیبانی خانواده', icon: 'family' },
    ],
  },
  {
    id: 'access',
    label: 'دسترسی و امنیت',
    icon: 'shield',
    items: [
      { href: '/fa/access', label: 'کاربران و دسترسی', icon: 'access' },
      { href: '/fa/security/session-policy', label: 'مدت نشست کارکنان', icon: 'clock' },
      { href: '/fa/security/mfa', label: 'تأیید دومرحله‌ای', icon: 'shield' },
      { href: '/fa/security/management-password', label: 'رمز مدیریت', icon: 'key' },
    ],
  },
];

const pageLabels: Record<string, { title: string; section: string }> = {
  '/fa/system-health': { title: 'پایش عملیاتی', section: 'عملیات سامانه' },
  '/fa/organizations': { title: 'مجموعه‌ها و شعب', section: 'عملیات سامانه' },
  '/fa/forms': { title: 'فرم‌ها و قالب‌ها', section: 'عملیات سامانه' },
  '/fa/customer-family': { title: 'پشتیبانی خانواده', section: 'عملیات سامانه' },
  '/fa/access': { title: 'کاربران و دسترسی', section: 'دسترسی و امنیت' },
  '/fa/security/session-policy': { title: 'مدت نشست کارکنان', section: 'دسترسی و امنیت' },
  '/fa/security/mfa': { title: 'تأیید دومرحله‌ای', section: 'دسترسی و امنیت' },
  '/fa/security/management-password': { title: 'رمز مدیریت', section: 'دسترسی و امنیت' },
};

const iconPaths: Record<IconName, ReactNode> = {
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V5l8-2 8 2v16M8 8h1m6 0h1M8 12h1m6 0h1M10 21v-5h4v5" />
    </>
  ),
  forms: (
    <>
      <path d="M7 3h8l4 4v14H7zM15 3v5h5M10 12h6M10 16h6" />
    </>
  ),
  family: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0m0-2a4 4 0 0 1 6 2" />
    </>
  ),
  access: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 7h5m-2.5-2.5v5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 20 6v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8m-2 2 3 3m-6-1 3 3" />
    </>
  ),
  chevron: (
    <>
      <path d="m8 10 4 4 4-4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  logout: (
    <>
      <path d="M10 5H5v14h5m4-3 4-4-4-4m4 4H9" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      className={styles.icon}
      fill="none"
      focusable="false"
      viewBox="0 0 24 24"
    >
      {iconPaths[name]}
    </svg>
  );
}

export function SystemShell({
  children,
  onLogout,
  logoutPending,
}: {
  children: ReactNode;
  onLogout: () => void;
  logoutPending: boolean;
}) {
  const pathname = usePathname();
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(
    () => new Set(groups.map((group) => group.id)),
  );
  const [accountOpen, setAccountOpen] = useState(false);
  const page = pageLabels[pathname] ?? { title: 'مدیریت سامانه', section: 'سامانه' };

  const closeDrawer = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isMobile) setMobileOpen(false);
  }, [isMobile]);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem('funtino-system-sidebar-collapsed') === 'true');
    } catch {
      // The shell remains usable if browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('funtino-system-sidebar-collapsed', String(collapsed));
    } catch {
      // The collapsed state still applies until this view is closed.
    }
  }, [collapsed]);

  useEffect(() => {
    if (!mobileOpen || !isMobile) return;
    const drawer = drawerRef.current;
    const menuButton = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = drawer?.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== 'Tab' || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButton?.focus();
    };
  }, [closeDrawer, isMobile, mobileOpen]);

  useEffect(() => {
    if (!accountOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setAccountOpen(false);
        accountButtonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [accountOpen]);

  useEffect(() => {
    closeDrawer();
    setAccountOpen(false);
  }, [closeDrawer, pathname]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.items.some((item) => item.href === pathname)),
    [pathname],
  );

  return (
    <div
      className={`system-console ${styles.app}`}
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
    >
      <a className={styles.skipLink} href="#main-content">
        رفتن به محتوای صفحه
      </a>
      {mobileOpen && (
        <button className={styles.backdrop} onClick={closeDrawer} aria-label="بستن منو" />
      )}

      <aside
        aria-hidden={isMobile && !mobileOpen}
        aria-label="ناوبری مدیریت سامانه"
        aria-modal={mobileOpen && isMobile ? true : undefined}
        className={styles.sidebar}
        id="system-sidebar"
        inert={isMobile && !mobileOpen}
        ref={drawerRef}
        role={mobileOpen && isMobile ? 'dialog' : undefined}
      >
        <div className={styles.sidebarHeader}>
          <Link className={styles.brand} href="/fa/system-health" onClick={closeDrawer}>
            <span className={styles.brandMark} aria-hidden="true">
              ف
            </span>
            <span className={styles.brandCopy}>
              <strong>فانتینو</strong>
              <small>مدیریت سامانه</small>
            </span>
          </Link>
          {isMobile && (
            <button
              className={styles.iconButton}
              onClick={closeDrawer}
              type="button"
              aria-label="بستن منو"
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        <nav className={styles.navigation} aria-label="بخش‌های پنل">
          {groups.map((group) => {
            const expanded = expandedGroups.has(group.id);
            const groupActive = activeGroup?.id === group.id;
            return (
              <section className={styles.navGroup} key={group.id}>
                <button
                  aria-expanded={expanded}
                  aria-label={`${expanded ? 'بستن' : 'بازکردن'} گروه ${group.label}`}
                  className={`${styles.groupToggle} ${groupActive ? styles.groupToggleActive : ''}`}
                  onClick={() =>
                    setExpandedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  title={collapsed ? group.label : undefined}
                  type="button"
                >
                  <Icon name={group.icon} />
                  <span>{group.label}</span>
                  <Icon name="chevron" />
                </button>
                {expanded && (
                  <div className={styles.navItems}>
                    {group.items.map((item) => {
                      const active = pathname === item.href;
                      return (
                        <Link
                          aria-current={active ? 'page' : undefined}
                          aria-label={collapsed ? item.label : undefined}
                          className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                          href={item.href}
                          key={item.href}
                          onClick={closeDrawer}
                          title={collapsed ? item.label : undefined}
                        >
                          <Icon name={item.icon} />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <span className={styles.scopeDot} aria-hidden="true" />
          <span>دسترسی سامانه از سرور بررسی می‌شود</span>
        </div>
      </aside>

      <div className={styles.workspace} inert={mobileOpen}>
        <header className={styles.topbar}>
          <div className={styles.topbarStart}>
            <button
              aria-controls="system-sidebar"
              aria-expanded={isMobile ? mobileOpen : !collapsed}
              aria-label={
                isMobile
                  ? mobileOpen
                    ? 'بستن منو'
                    : 'بازکردن منو'
                  : collapsed
                    ? 'بازکردن سایدبار'
                    : 'جمع‌کردن سایدبار'
              }
              className={styles.iconButton}
              onClick={() => (isMobile ? setMobileOpen(true) : setCollapsed((value) => !value))}
              ref={menuButtonRef}
              type="button"
            >
              <Icon name="menu" />
            </button>
            <nav className={styles.breadcrumbs} aria-label="مسیر صفحه">
              <span>مدیریت سامانه</span>
              <Icon name="chevron" />
              <span>{page.section}</span>
              <Icon name="chevron" />
              <strong aria-current="page">{page.title}</strong>
            </nav>
          </div>

          <div className={styles.account} ref={accountRef}>
            <button
              aria-expanded={accountOpen}
              aria-controls="system-account-menu"
              className={styles.accountButton}
              onClick={() => setAccountOpen((open) => !open)}
              ref={accountButtonRef}
              type="button"
            >
              <span className={styles.accountAvatar} aria-hidden="true">
                <Icon name="user" />
              </span>
              <span className={styles.accountLabel}>حساب مدیریت</span>
              <Icon name="chevron" />
            </button>
            {accountOpen && (
              <div className={styles.accountMenu} id="system-account-menu">
                <p>امنیت حساب</p>
                <Link href="/fa/security/management-password" onClick={() => setAccountOpen(false)}>
                  <Icon name="key" /> رمز مدیریت
                </Link>
                <Link href="/fa/security/mfa" onClick={() => setAccountOpen(false)}>
                  <Icon name="shield" /> تأیید دومرحله‌ای
                </Link>
                <button onClick={onLogout} disabled={logoutPending} type="button">
                  <Icon name="logout" /> {logoutPending ? 'در حال خروج…' : 'خروج امن'}
                </button>
              </div>
            )}
          </div>
        </header>

        <div className={styles.content} id="main-content" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}
