'use client';

import { useOperationsTheme } from './OperationsThemeProvider';
import styles from './OperationsThemeToggle.module.css';

export function OperationsThemeToggle() {
  const { themeMode, setThemeMode } = useOperationsTheme();

  return (
    <div
      className={styles.control}
      data-active-theme={themeMode}
      role="group"
      aria-label="حالت نمایش"
    >
      <button
        aria-label="حالت روشن"
        aria-pressed={themeMode === 'light'}
        className={styles.button}
        onClick={() => setThemeMode('light')}
        title="روشن"
        type="button"
      >
        <svg aria-hidden="true" className={styles.icon} fill="none" focusable="false" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.75" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l-1.42 1.42m11.3-11.3 1.42-1.42" />
        </svg>
      </button>
      <button
        aria-label="حالت تیره"
        aria-pressed={themeMode === 'dark'}
        className={styles.button}
        onClick={() => setThemeMode('dark')}
        title="تیره"
        type="button"
      >
        <svg aria-hidden="true" className={styles.icon} fill="none" focusable="false" viewBox="0 0 24 24">
          <path d="M20.1 15.2A8.4 8.4 0 0 1 8.8 3.9 8.5 8.5 0 1 0 20.1 15.2Z" />
          <path d="m17.5 3 .55 1.45L19.5 5l-1.45.55L17.5 7l-.55-1.45L15.5 5l1.45-.55L17.5 3Z" />
        </svg>
      </button>
    </div>
  );
}
