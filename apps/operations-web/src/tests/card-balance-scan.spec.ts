import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CardBalanceScanView,
  type BalanceScanState,
} from '../features/cashier/CardBalanceScanView';

Object.assign(globalThis, { React });

test('Operations scan view renders all states and hides balance for every non-success result', () => {
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
      createElement(CardBalanceScanView, {
        state,
        balanceRial: 1_250_000,
        onStart: () => undefined,
        onCancel: () => undefined,
      }),
    );
    assert.match(markup, /dir="rtl"/);
    assert.match(markup, /خواندن موجودی کارت/);
    assert.doesNotMatch(markup, /cardId|householdId|memberId|cardUidHash|NDEFReader|••••/i);
    if (state === 'available') assert.match(markup, /ریال/);
    else assert.doesNotMatch(markup, /ریال/);
  }
});

test('Operations success view exposes only a formatted amount and currency', () => {
  const markup = renderToStaticMarkup(
    createElement(CardBalanceScanView, {
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
