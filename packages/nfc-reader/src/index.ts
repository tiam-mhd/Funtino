export type NfcReaderErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'cancelled'
  | 'card-unavailable'
  | 'read-failed';

export class NfcReaderError extends Error {
  constructor(readonly code: NfcReaderErrorCode) {
    super(code);
    this.name = 'NfcReaderError';
  }
}

export type NdefReaderLike = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  scan(options?: { signal?: AbortSignal }): Promise<void>;
};

export type NdefReaderFactory = () => NdefReaderLike;

export type NfcScanPhase = 'scanning' | 'checking';

export async function scanNfcBalance<T>(input: {
  signal: AbortSignal;
  lookup: (cardUidHash: string, signal: AbortSignal) => Promise<T>;
  readerFactory?: NdefReaderFactory;
  onPhase?: (phase: NfcScanPhase) => void;
}): Promise<T> {
  input.onPhase?.('scanning');
  const cardUidHash = await readNfcCardUidHash(input.signal, input.readerFactory);
  if (input.signal.aborted) throw new NfcReaderError('cancelled');
  input.onPhase?.('checking');
  return input.lookup(cardUidHash, input.signal);
}

async function readNfcCardUidHash(
  signal: AbortSignal,
  readerFactory = getBrowserReaderFactory(),
): Promise<string> {
  if (signal.aborted) throw new NfcReaderError('cancelled');
  if (!readerFactory) throw new NfcReaderError('unsupported');

  let reader: NdefReaderLike;
  try {
    reader = readerFactory();
  } catch {
    throw new NfcReaderError('unsupported');
  }

  return new Promise<string>((resolve, reject) => {
    const scanController = new AbortController();
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      reader.removeEventListener('reading', onReading);
      reader.removeEventListener('readingerror', onReadingError);
    };
    const fail = (code: NfcReaderErrorCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      scanController.abort();
      reject(new NfcReaderError(code));
    };
    const succeed = (hash: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      scanController.abort();
      resolve(hash);
    };
    const onAbort = () => fail('cancelled');
    const onReading = (event: Event) => {
      const serialNumber = (event as Event & { serialNumber?: unknown }).serialNumber;
      void hashFourByteSerialNumber(serialNumber)
        .then((hash) => {
          if (hash === null) fail('card-unavailable');
          else succeed(hash);
        })
        .catch(() => fail('read-failed'));
    };
    const onReadingError = () => fail('card-unavailable');

    reader.addEventListener('reading', onReading);
    reader.addEventListener('readingerror', onReadingError);
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      void reader.scan({ signal: scanController.signal }).catch((error: unknown) => {
        if (signal.aborted) fail('cancelled');
        else fail(classifyScanError(error));
      });
    } catch (error) {
      fail(classifyScanError(error));
    }
  });
}

async function hashFourByteSerialNumber(serialNumber: unknown): Promise<string | null> {
  if (typeof serialNumber !== 'string') return null;
  const compact = /^(?:[0-9a-f]{2}){4}$/i.test(serialNumber)
    ? serialNumber
    : /^(?:[0-9a-f]{2}-){3}[0-9a-f]{2}$/i.test(serialNumber)
      ? serialNumber.replaceAll('-', '')
      : null;
  if (!compact) return null;

  const canonicalWindowsInput = compact.toUpperCase();
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalWindowsInput),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getBrowserReaderFactory(): NdefReaderFactory | undefined {
  const Reader = (globalThis as typeof globalThis & { NDEFReader?: new () => NdefReaderLike })
    .NDEFReader;
  return typeof Reader === 'function' ? () => new Reader() : undefined;
}

function classifyScanError(error: unknown): NfcReaderErrorCode {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (name === 'NotAllowedError') return 'permission-denied';
    if (name === 'NotSupportedError' || name === 'SecurityError') return 'unsupported';
  }
  return 'read-failed';
}
