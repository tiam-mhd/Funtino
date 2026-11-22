'use client';

import { useEffect, useRef, useState } from 'react';
import { NfcReaderError, scanNfcBalance } from '@funtino/nfc-reader';
import { ApiRequestError } from '../../lib/api/client';
import { lookupOperationsCardBalance } from '../../lib/api/operations-cards';
import styles from './CardInventoryManagement.module.css';
import { CardBalanceScanView, type BalanceScanState } from './CardBalanceScanView';

const scanTimeoutMs = 20_000;
const lookupTimeoutMs = 12_000;

export function CardBalanceScan({
  organizationId,
  branchId,
  onSessionExpired,
}: {
  organizationId: string;
  branchId: string;
  onSessionExpired: () => void;
}) {
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
        lookup: (cardUidHash, signal) =>
          lookupOperationsCardBalance(organizationId, branchId, cardUidHash, signal),
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
      } else if (error instanceof ApiRequestError) {
        if (error.status === 401) onSessionExpired();
        setState(
          error.status === 401 || error.status === 403
            ? 'unauthorized'
            : error.status === 429
              ? 'rate-limited'
              : error.status === 0 || error.status >= 500
                ? 'network-error'
                : error.status === 404 || error.status === 409
                  ? 'unavailable'
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
    <CardBalanceScanView
      className={styles.balanceScan}
      state={state}
      balanceRial={balanceRial}
      onStart={() => void startScan()}
      onCancel={cancelScan}
    />
  );
}
