'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type OperationsThemeMode = 'light' | 'dark';

type OperationsThemeContextValue = {
  themeMode: OperationsThemeMode;
  setThemeMode: (mode: OperationsThemeMode) => void;
};

const themeStorageKey = 'funtino-operations-theme';
const OperationsThemeContext = createContext<OperationsThemeContextValue | null>(null);

export function OperationsThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setCurrentThemeMode] = useState<OperationsThemeMode>('dark');
  const [themeReady, setThemeReady] = useState(false);

  const setThemeMode = useCallback((mode: OperationsThemeMode) => {
    setCurrentThemeMode(mode);
  }, []);

  useEffect(() => {
    let storedMode: string | null = null;
    try {
      storedMode = window.localStorage.getItem(themeStorageKey);
    } catch {
      // The selected appearance remains available for this session.
    }

    if (storedMode === 'light' || storedMode === 'dark') {
      setCurrentThemeMode(storedMode);
      document.documentElement.dataset.operationsTheme = storedMode;
    }
    setThemeReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.operationsTheme = themeMode;
    if (!themeReady) return;

    try {
      window.localStorage.setItem(themeStorageKey, themeMode);
    } catch {
      // Theme changes still work when browser storage is unavailable.
    }
  }, [themeMode, themeReady]);

  useEffect(() => {
    function syncTheme(event: StorageEvent) {
      if (event.key === themeStorageKey && (event.newValue === 'light' || event.newValue === 'dark')) {
        setCurrentThemeMode(event.newValue);
      }
    }
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);

  const value = useMemo(() => ({ themeMode, setThemeMode }), [themeMode, setThemeMode]);
  return <OperationsThemeContext.Provider value={value}>{children}</OperationsThemeContext.Provider>;
}

export function useOperationsTheme() {
  const value = useContext(OperationsThemeContext);
  if (!value) throw new Error('OperationsThemeProvider is required.');
  return value;
}
