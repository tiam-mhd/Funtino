'use client';

import {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './ToastProvider.module.css';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';
export type ToastInput = {
  tone: ToastTone;
  message: string;
  title?: string;
  action?: { label: string; run: () => void };
  duration?: number;
};
type ToastItem = ToastInput & { id: number; exiting?: boolean };
type ToastContextValue = { showToast: (input: ToastInput) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const itemsRef = useRef<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const updateItems = useCallback((update: (current: ToastItem[]) => ToastItem[]) => {
    const next = update(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      const item = itemsRef.current.find((current) => current.id === id);
      if (!item || item.exiting) return;
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer);
      updateItems((current) =>
        current.map((currentItem) =>
          currentItem.id === id ? { ...currentItem, exiting: true } : currentItem,
        ),
      );
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          updateItems((current) => current.filter((currentItem) => currentItem.id !== id));
        }, 160),
      );
    },
    [updateItems],
  );

  const showToast = useCallback(
    (input: ToastInput) => {
      if (
        itemsRef.current.some((item) => item.tone === input.tone && item.message === input.message)
      ) {
        return;
      }
      const item = { ...input, id: ++nextId.current };
      const currentErrors = itemsRef.current.filter((existing) => existing.tone === 'error');
      const currentTransient = itemsRef.current.filter((existing) => existing.tone !== 'error');
      const nextErrors = item.tone === 'error' ? [...currentErrors, item] : currentErrors;
      const nextTransient = item.tone === 'error' ? currentTransient : [...currentTransient, item];
      const next = [...nextErrors, ...nextTransient.slice(-3)].sort(
        (left, right) => left.id - right.id,
      );
      const retainedIds = new Set(next.map(({ id }) => id));
      for (const [id, timer] of timers.current) {
        if (!retainedIds.has(id)) {
          clearTimeout(timer);
          timers.current.delete(id);
        }
      }
      updateItems(() => next);
      if (item.tone !== 'error') {
        const duration = item.duration ?? (item.tone === 'warning' ? 7000 : 4500);
        timers.current.set(
          item.id,
          setTimeout(() => dismiss(item.id), duration),
        );
      }
    },
    [dismiss, updateItems],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.viewport} aria-label="اعلان‌ها" role="region">
        {items.map((item) => (
          <article
            aria-live={item.tone === 'error' ? 'assertive' : 'polite'}
            className={`${styles.toast} ${styles[item.tone]} ${item.exiting ? styles.exiting : ''}`}
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
          >
            <span className={styles.marker} aria-hidden="true">
              {markerFor(item.tone)}
            </span>
            <div className={styles.copy}>
              {item.title && <strong>{item.title}</strong>}
              <p>{item.message}</p>
              {item.action && (
                <button
                  className={styles.action}
                  onClick={() => {
                    item.action?.run();
                    dismiss(item.id);
                  }}
                  type="button"
                >
                  {item.action.label}
                </button>
              )}
            </div>
            <button
              aria-label="بستن اعلان"
              className={styles.close}
              onClick={() => dismiss(item.id)}
              disabled={item.exiting}
              type="button"
            >
              ×
            </button>
          </article>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useSystemToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useSystemToast must be used within ToastProvider.');
  return context.showToast;
}

function markerFor(tone: ToastTone) {
  return { success: '✓', info: 'i', warning: '!', error: '×' }[tone];
}
