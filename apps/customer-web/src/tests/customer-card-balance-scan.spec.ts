import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CustomerCardBalanceScanView,
  type BalanceScanState,
} from '../components/customer-card-balance-scan-view';

Object.assign(globalThis, { React });

test('customer scan view renders every state without exposing a balance outside success', () => {
  const states: BalanceScanState[] = [
    'ready',
    'scanning',
    'checking',
    'available',
    'pending',
    'unavailable',
    'unsupported',
    'permission-denied',
    'no-card',
    'network-error',
    'rate-limited',
    'unauthorized',
    'error',
  ];

  for (const state of states) {
    const markup = renderToStaticMarkup(
      createElement(CustomerCardBalanceScanView, {
        state,
        balanceRial: 1_250_000,
        onStart: () => undefined,
        onCancel: () => undefined,
      }),
    );
    assert.match(markup, /dir="rtl"/);
    assert.match(markup, /بررسی موجودی کارت/);
    assert.doesNotMatch(markup, /cardId|householdId|memberId|cardUidHash|NDEFReader|••••/i);
    if (state === 'available') assert.match(markup, /ریال/);
    else assert.doesNotMatch(markup, /ریال/);
  }
});

test('customer success view shows only the formatted amount and unit as its result', () => {
  const markup = renderToStaticMarkup(
    createElement(CustomerCardBalanceScanView, {
      state: 'available',
      balanceRial: 1_250_000,
      onStart: () => undefined,
      onCancel: () => undefined,
    }),
  );
  assert.match(markup, /ریال/);
  assert.match(markup, /١|۱|٬/);
  assert.doesNotMatch(markup, /تأیید|تازه|شعبه|عضو|وضعیت|شناسه/);
});
