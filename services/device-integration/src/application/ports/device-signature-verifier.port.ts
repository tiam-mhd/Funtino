export const DEVICE_SIGNATURE_VERIFIER = Symbol('DEVICE_SIGNATURE_VERIFIER');

export interface DeviceSignatureVerifier {
  isConfigured(): boolean;
  verify(rawBody: Buffer, signature: string | undefined): boolean;
}
