'use client';

import { useEffect, useRef, useState } from 'react';
import { NfcReaderError, scanNfcBalance } from '@funtino/nfc-reader';
import { CustomerApiError, lookupCustomerCardBalance } from '../lib/customer-api';
import styles from './customer-card-balance-scan.module.css';
import {
  CustomerCardBalanceScanView,
  type BalanceScanState,
} from './customer-card-balance-scan-view';

const scanTimeoutMs = 20_000;
const lookupTimeoutMs = 12_000;

export function CustomerCardBalanceScan() {
  const [state, setState] = useState<BalanceScanState>('ready');
  const [balanceRial, setBalanceRial] = useState<number | null>(null);
  const activeRun = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRun.current?.abort();
      activeRun.current = null;
    };
  }, []);

  async function startScan() {
    if (activeRun.current) return;
    const controller = new AbortController();
    activeRun.current = controller;
    let timeoutPhase: 'scanning' | 'checking' | null = 'scanning';
    let timeout: number | null = window.setTimeout(() => controller.abort(), scanTimeoutMs);
    setBalanceRial(null);
    setState('scanning');

    try {
      const result = await scanNfcBalance({
        signal: controller.signal,
        lookup: (cardUidHash, signal) => lookupCustomerCardBalance(cardUidHash, signal),
        onPhase: (phase) => {
          if (!mounted.current) return;
          if (timeout !== null) window.clearTimeout(timeout);
          timeoutPhase = phase;
          timeout = window.setTimeout(
            () => controller.abort(),
            phase === 'scanning' ? scanTimeoutMs : lookupTimeoutMs,
          );
          setState(phase);
        },
      });
      if (!mounted.current || controller.signal.aborted) return;
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
      if (result.status === 'available') {
        setBalanceRial(result.balanceRial);
        setState('available');
      } else {
        setBalanceRial(null);
        setState(result.status);
      }
    } catch (error) {
      if (!mounted.current || activeRun.current !== controller) return;
      setBalanceRial(null);
      if (controller.signal.aborted) {
        setState(timeoutPhase === 'scanning' ? 'no-card' : 'network-error');
      } else if (error instanceof NfcReaderError) {
        setState(
          error.code === 'permission-denied'
            ? 'permission-denied'
            : error.code === 'unsupported'
              ? 'unsupported'
              : error.code === 'card-unavailable'
                ? 'no-card'
                : 'error',
        );
      } else if (error instanceof CustomerApiError) {
        setState(
          error.statusCode === 401 || error.statusCode === 403
            ? 'unauthorized'
            : error.statusCode === 429
              ? 'rate-limited'
              : error.statusCode === 0 || error.statusCode >= 500
                ? 'network-error'
                : 'error',
        );
      } else {
        setState('error');
      }
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
      if (activeRun.current === controller) activeRun.current = null;
    }
  }

  function cancelScan() {
    activeRun.current?.abort();
    activeRun.current = null;
    setBalanceRial(null);
    setState('ready');
  }

  return (
    <CustomerCardBalanceScanView
      className={styles.panel}
      state={state}
      balanceRial={balanceRial}
      onStart={() => void startScan()}
      onCancel={cancelScan}
    />
  );
}
