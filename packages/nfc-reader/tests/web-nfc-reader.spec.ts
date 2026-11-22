import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NfcReaderError, scanNfcBalance, type NdefReaderLike } from '../src/index.js';

const expectedHash = '34b8d380d481b933d5238d945a16ee6c0be176960926735bce473b829e4bd517';

class FakeNdefReader implements NdefReaderLike {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  readonly started: Promise<void>;
  private markStarted!: () => void;
  scanFailure: unknown;

  constructor() {
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const current = this.listeners.get(type) ?? new Set();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  async scan() {
    this.markStarted();
    if (this.scanFailure) throw this.scanFailure;
  }

  emitReading(serialNumber: string) {
    const event = new Event('reading');
    Object.defineProperty(event, 'serialNumber', { value: serialNumber });
    for (const listener of this.listeners.get('reading') ?? []) listener(event);
  }

  emitReadingError() {
    const event = new Event('readingerror');
    for (const listener of this.listeners.get('readingerror') ?? []) listener(event);
  }
}

test('maps the Windows four-byte fixture hash and never returns the serial number', async () => {
  const reader = new FakeNdefReader();
  const controller = new AbortController();
  let lookupInput = '';
  const pending = scanNfcBalance({
    signal: controller.signal,
    readerFactory: () => reader,
    lookup: async (hash) => {
      lookupInput = hash;
      return { status: 'available', balanceRial: 125_000 };
    },
  });

  await reader.started;
  reader.emitReading('01-02-03-04');
  const result = await pending;

  assert.equal(lookupInput, expectedHash);
  assert.deepEqual(result, { status: 'available', balanceRial: 125_000 });
  assert.equal(JSON.stringify(result).includes('01-02-03-04'), false);
  assert.equal(reader.listeners.get('reading')?.size, 0);
});

test('accepts the same four bytes without separators', async () => {
  const reader = new FakeNdefReader();
  let lookupInput = '';
  const pending = scanNfcBalance({
    signal: new AbortController().signal,
    readerFactory: () => reader,
    lookup: async (hash) => {
      lookupInput = hash;
      return { status: 'unavailable' };
    },
  });
  await reader.started;
  reader.emitReading('01020304');
  assert.deepEqual(await pending, { status: 'unavailable' });
  assert.equal(lookupInput, expectedHash);
});

test('rejects unsupported serial lengths without calling the lookup', async () => {
  const reader = new FakeNdefReader();
  let lookupCalled = false;
  const pending = scanNfcBalance({
    signal: new AbortController().signal,
    readerFactory: () => reader,
    lookup: async () => {
      lookupCalled = true;
      return { status: 'unavailable' };
    },
  });
  await reader.started;
  reader.emitReading('00-11-22-33-44-55-66');
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof NfcReaderError && error.code === 'card-unavailable',
  );
  assert.equal(lookupCalled, false);
});

test('maps permission, incompatible-card, unsupported, and cancellation states', async () => {
  const permissionReader = new FakeNdefReader();
  permissionReader.scanFailure = Object.assign(new Error('hidden'), { name: 'NotAllowedError' });
  const permission = scanNfcBalance({
    signal: new AbortController().signal,
    readerFactory: () => permissionReader,
    lookup: async () => ({ status: 'unavailable' }),
  });
  await permissionReader.started;
  await assert.rejects(
    permission,
    (error: unknown) => error instanceof NfcReaderError && error.code === 'permission-denied',
  );

  const cardReader = new FakeNdefReader();
  const cardError = scanNfcBalance({
    signal: new AbortController().signal,
    readerFactory: () => cardReader,
    lookup: async () => ({ status: 'unavailable' }),
  });
  await cardReader.started;
  cardReader.emitReadingError();
  await assert.rejects(
    cardError,
    (error: unknown) => error instanceof NfcReaderError && error.code === 'card-unavailable',
  );

  await assert.rejects(
    scanNfcBalance({
      signal: new AbortController().signal,
      lookup: async () => ({ status: 'unavailable' }),
    }),
    (error: unknown) => error instanceof NfcReaderError && error.code === 'unsupported',
  );

  const cancelledReader = new FakeNdefReader();
  const controller = new AbortController();
  const cancelled = scanNfcBalance({
    signal: controller.signal,
    readerFactory: () => cancelledReader,
    lookup: async () => ({ status: 'unavailable' }),
  });
  await cancelledReader.started;
  controller.abort();
  await assert.rejects(
    cancelled,
    (error: unknown) => error instanceof NfcReaderError && error.code === 'cancelled',
  );
});
