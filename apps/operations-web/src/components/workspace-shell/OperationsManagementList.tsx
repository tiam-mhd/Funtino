'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@funtino/design-system';
import styles from './OperationsManagementList.module.css';

export function OperationsManagementList({
  title,
  description,
  searchValue,
  onSearchChange,
  searchLabel,
  searchPlaceholder,
  toolbarLabel = 'عملیات فهرست نقش‌ها',
  filterTitle = 'فیلتر نقش‌ها',
  filterDescription = 'وضعیت و نوع نقش را انتخاب کنید. جست‌وجوی نام از کادر بالای فهرست انجام می‌شود.',
  loadMoreLabel = 'نمایش نقش‌های بیشتر',
  filterFields,
  onApplyFilters,
  onClearFilters,
  appliedFilterCount = 0,
  filtersBusy = false,
  showHeading = true,
  toolbarActions,
  pagination,
  children,
}: {
  title: string;
  description: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchLabel: string;
  searchPlaceholder: string;
  toolbarLabel?: string;
  filterTitle?: string;
  filterDescription?: string;
  loadMoreLabel?: string;
  filterFields: ReactNode;
  onApplyFilters: () => void;
  onClearFilters: () => void;
  appliedFilterCount?: number;
  filtersBusy?: boolean;
  showHeading?: boolean;
  toolbarActions: ReactNode;
  pagination?: { hasMore: boolean; busy: boolean; onLoadMore: () => void };
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

  return (
    <section className={styles.page} aria-labelledby="operations-list-title">
      <header className={styles.heading}>
        {showHeading ? (
          <div>
            <p className={styles.eyebrow}>محدوده‌ی فعال</p>
            <h2 id="operations-list-title">{title}</h2>
            <p className={styles.description}>{description}</p>
          </div>
        ) : (
          <h2 className={styles.visuallyHidden} id="operations-list-title">
            {title}
          </h2>
        )}
        <div className={styles.headerActions}>{toolbarActions}</div>
      </header>

      <div className={styles.toolbar} aria-label={toolbarLabel}>
        <label className={styles.searchField}>
          <span className={styles.searchIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <circle cx="10.8" cy="10.8" r="6.4" />
              <path d="m16 16 4.1 4.1" />
            </svg>
          </span>
          <span className={styles.visuallyHidden}>{searchLabel}</span>
          <input
            aria-label={searchLabel}
            autoComplete="off"
            maxLength={80}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder={searchPlaceholder}
            type="search"
            value={searchValue}
          />
        </label>
        <Button
          aria-expanded={filterOpen}
          aria-haspopup="dialog"
          className={styles.filterButton}
          onClick={() => setFilterOpen(true)}
          type="button"
          tone="secondary"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 6h16M7 12h10m-7 6h4" />
          </svg>
          <span>فیلتر</span>
          {appliedFilterCount > 0 && (
            <span className={styles.filterCount}>{appliedFilterCount}</span>
          )}
        </Button>
      </div>

      <div className={styles.content}>{children}</div>

      {pagination?.hasMore && (
        <Button
          className={styles.loadMore}
          disabled={pagination.busy}
          onClick={pagination.onLoadMore}
          type="button"
          tone="ghost"
        >
          {pagination.busy ? 'در حال دریافت…' : loadMoreLabel}
        </Button>
      )}

      <dialog
        aria-labelledby="operations-list-filter-title"
        aria-describedby="operations-list-filter-description"
        className={styles.dialog}
        onCancel={(event) => {
          event.preventDefault();
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setFilterOpen(false);
        }}
        ref={dialogRef}
      >
        <div className={styles.dialogBody}>
          <header className={styles.dialogHeader}>
            <div>
              <h3 id="operations-list-filter-title">{filterTitle}</h3>
              <p id="operations-list-filter-description">{filterDescription}</p>
            </div>
            <button
              aria-label="بستن فیلترها"
              className={styles.closeButton}
              onClick={() => setFilterOpen(false)}
              type="button"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className={styles.filterFields}>{filterFields}</div>
          <footer className={styles.dialogActions}>
            <Button
              disabled={filtersBusy}
              onClick={() => {
                onClearFilters();
                setFilterOpen(false);
              }}
              type="button"
              tone="ghost"
            >
              پاک‌کردن فیلتر
            </Button>
            <Button
              disabled={filtersBusy}
              onClick={() => {
                onApplyFilters();
                setFilterOpen(false);
              }}
              type="button"
            >
              اعمال فیلتر
            </Button>
          </footer>
        </div>
      </dialog>
    </section>
  );
}
