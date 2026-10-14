'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@funtino/design-system';
import { SystemPageHeader } from './SystemPageHeader';
import styles from './ManagementListPage.module.css';

export type ManagementListPagination = {
  page: number;
  itemCount: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  busy?: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

export function ManagementListPage({
  eyebrow,
  title,
  description,
  headerActions,
  toolbarActions,
  filterTitle = 'فیلتر فهرست',
  filterDescription = 'شرایط جست‌وجو و فیلتر را تنظیم کنید.',
  filterFields,
  onOpenFilters,
  appliedFilterCount = 0,
  onApplyFilters,
  onClearFilters,
  filtersBusy = false,
  pagination,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  headerActions?: ReactNode;
  toolbarActions?: ReactNode;
  filterTitle?: string;
  filterDescription?: string;
  filterFields?: ReactNode;
  onOpenFilters?: () => void;
  appliedFilterCount?: number;
  onApplyFilters?: (event: FormEvent<HTMLFormElement>) => Promise<boolean | void> | boolean | void;
  onClearFilters?: () => Promise<boolean | void> | boolean | void;
  filtersBusy?: boolean;
  pagination?: ManagementListPagination;
  children: ReactNode;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (filterOpen && dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [filterOpen]);

  async function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onApplyFilters || filtersBusy) return;
    const applied = await onApplyFilters(event);
    if (applied !== false) setFilterOpen(false);
  }

  async function clearFilters() {
    if (!onClearFilters || filtersBusy) return;
    const cleared = await onClearFilters();
    if (cleared !== false) setFilterOpen(false);
  }

  return (
    <div className={styles.page}>
      <SystemPageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={headerActions}
      />

      {(toolbarActions || filterFields) && (
        <section className={styles.toolbar} aria-label="عملیات فهرست">
          <div className={styles.toolbarPrimary}>
            {toolbarActions}
            {filterFields && (
              <Button
                type="button"
                tone="secondary"
                aria-haspopup="dialog"
                aria-expanded={filterOpen}
                onClick={() => {
                  onOpenFilters?.();
                  setFilterOpen(true);
                }}
              >
                فیلتر و جست‌وجو
                {appliedFilterCount > 0 && (
                  <span
                    className={styles.filterCount}
                    aria-label={`${appliedFilterCount} فیلتر فعال`}
                  >
                    {appliedFilterCount.toLocaleString('fa-IR')}
                  </span>
                )}
              </Button>
            )}
          </div>
          {appliedFilterCount > 0 && <span className={styles.activeFilters}>فیلتر اعمال‌شده</span>}
        </section>
      )}

      <section className={styles.content} aria-label={`محتوای ${title}`}>
        {children}
      </section>

      {pagination && (
        <nav className={styles.pagination} aria-label="صفحه‌بندی فهرست">
          <span className={styles.pageMeta} aria-live="polite">
            صفحهٔ {pagination.page.toLocaleString('fa-IR')} ·{' '}
            {pagination.itemCount.toLocaleString('fa-IR')} مورد در این صفحه
          </span>
          <div className={styles.pageActions}>
            <Button
              type="button"
              tone="ghost"
              disabled={!pagination.canGoPrevious || pagination.busy}
              onClick={pagination.onPrevious}
            >
              صفحهٔ قبل
            </Button>
            <Button
              type="button"
              tone="secondary"
              disabled={!pagination.canGoNext || pagination.busy}
              onClick={pagination.onNext}
            >
              صفحهٔ بعد
            </Button>
          </div>
        </nav>
      )}

      {filterFields && (
        <dialog
          className={styles.dialog}
          aria-labelledby="management-list-filter-title"
          aria-describedby="management-list-filter-description"
          onCancel={(event) => {
            event.preventDefault();
            setFilterOpen(false);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFilterOpen(false);
          }}
          onClose={() => setFilterOpen(false)}
          ref={dialogRef}
        >
          <form className={styles.dialogForm} onSubmit={(event) => void submitFilters(event)}>
            <header className={styles.dialogHeader}>
              <div>
                <h2 id="management-list-filter-title">{filterTitle}</h2>
                <p id="management-list-filter-description">{filterDescription}</p>
              </div>
              <button
                className={styles.closeButton}
                type="button"
                aria-label="بستن پنجرهٔ فیلتر"
                onClick={() => setFilterOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>
            <div className={styles.filterFields}>{filterFields}</div>
            <footer className={styles.dialogActions}>
              {onClearFilters && (
                <Button
                  type="button"
                  tone="ghost"
                  disabled={filtersBusy || appliedFilterCount === 0}
                  onClick={() => void clearFilters()}
                >
                  پاک‌کردن فیلترها
                </Button>
              )}
              <div>
                <Button type="button" tone="ghost" onClick={() => setFilterOpen(false)}>
                  انصراف
                </Button>
                <Button type="submit" disabled={filtersBusy}>
                  {filtersBusy ? 'در حال دریافت…' : 'اعمال فیلتر'}
                </Button>
              </div>
            </footer>
          </form>
        </dialog>
      )}
    </div>
  );
}
